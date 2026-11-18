import { DurableObject } from "cloudflare:workers";
import { all, first, sql } from "../db/d1.js";
import { can } from "../policies/policy.js";
import { resolveSessionByHash } from "../services/authService.js";
import { randomToken } from "../utils/hash.js";
import { isId } from "../utils/id.js";
import logger from "../utils/logger.js";
import { now } from "../utils/time.js";

/**
 * Durable Object giữ mọi kết nối WebSocket của màn góp ý (thay cho Socket.IO của backend cũ).
 * Cả hệ thống dùng MỘT object (tên "hub"): một kết nối của thành viên theo dõi được nhiều sản phẩm,
 * nên không chia object theo sản phẩm. Giao thức phía trình duyệt: docs/hop-dong-realtime.md.
 *
 * Dùng WebSocket Hibernation: khi không có tin, object ngủ và không tính thời gian chạy; kết nối vẫn mở.
 * Vì object có thể ngủ rồi dậy bất cứ lúc nào, KHÔNG giữ gì quan trọng trong biến của class: danh tính và danh sách
 * đang theo dõi của mỗi kết nối nằm trong attachment của chính kết nối đó; "phòng" là nhãn (tag) gắn lúc nhận kết nối.
 *
 *   thành viên   nhãn "team" và "m:<memberId>". attachment.watching: các sản phẩm đang theo dõi (tối đa 30).
 *   khách        nhãn "guest", "l:<shareLinkId>", "g:<deliverableId>". Tự nghe đúng sản phẩm của link.
 *
 * Xác thực lúc mở kết nối do Worker làm (src/realtime/connect.js) rồi mới chuyển vào đây.
 */
const MAX_WATCHED = 30;
// Mỗi lệnh xin theo dõi tốn hai truy vấn: một kết nối không gửi quá chừng này lệnh trong 10 giây.
const WATCH_LIMIT = 40;
const WATCH_WINDOW_MS = 10 * 1000;
// Kết nối sống lâu hơn phiên: cứ mỗi khoảng này kiểm lại phiên của các thành viên đang nối, hết hạn thì ngắt.
const RECHECK_MS = 10 * 60 * 1000;
const MAX_MESSAGE_CHARS = 1024;

/** Mã đóng kết nối (4000 đến 4999 dành cho ứng dụng). Trình duyệt đọc ở sự kiện close. */
export const CLOSE = {
  // Server chủ động ngắt vì quyền vừa đổi: trình duyệt nên nối lại một lần, quyền mới sẽ được kiểm.
  KICKED: 4000,
  // Lỗi không nên thử lại: mã là 4000 + mã HTTP tương ứng.
  UNAUTHENTICATED: 4401,
  NOT_FOUND: 4404,
  GONE: 4410,
};

export class RealtimeHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // Trình duyệt gửi "ping" để giữ kết nối: runtime tự trả "pong" mà không đánh thức object.
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair("ping", "pong")
    );
    // Đếm lệnh theo dõi của từng kết nối. Mất khi object ngủ, không sao: object chỉ ngủ khi kết nối đã im lặng.
    this.watchTimes = new Map();
  }

  /** Worker chuyển yêu cầu nâng cấp WebSocket đã xác thực vào đây, danh tính nằm ở tham số `identity`. */
  async fetch(request) {
    const identity = JSON.parse(
      new URL(request.url).searchParams.get("identity")
    );
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const socketId = randomToken(15);
    const tags =
      identity.kind === "guest"
        ? ["guest", `l:${identity.shareLinkId}`, `g:${identity.deliverableId}`]
        : ["team", `m:${identity.memberId}`];
    this.ctx.acceptWebSocket(server, tags);
    server.serializeAttachment({ ...identity, socketId, watching: [] });
    server.send(JSON.stringify({ type: "ready", socketId }));

    if (
      identity.kind === "member" &&
      (await this.ctx.storage.getAlarm()) === null
    ) {
      await this.ctx.storage.setAlarm(Date.now() + RECHECK_MS);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------- Tin từ trình duyệt ----------

  async webSocketMessage(ws, message) {
    if (typeof message !== "string" || message.length > MAX_MESSAGE_CHARS)
      return;
    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }
    if (!data || typeof data !== "object") return;

    const ack = (result) =>
      ws.send(JSON.stringify({ type: "ack", id: data.id ?? null, ...result }));

    if (data.type === "deliverable:watch") {
      let result;
      try {
        result = this.tooManyWatches(ws)
          ? {
              ok: false,
              message: "Thao tác quá nhanh. Hãy thử lại sau ít giây.",
            }
          : await this.watch(ws, data.deliverableId);
      } catch (err) {
        logger.error({ err }, "Lỗi khi xin theo dõi sản phẩm");
        result = { ok: false, message: "Không theo dõi được. Hãy thử lại." };
      }
      ack(result);
    } else if (data.type === "deliverable:unwatch") {
      const state = ws.deserializeAttachment();
      if (isId(lower(data.deliverableId)) && state.kind === "member") {
        const id = lower(data.deliverableId);
        state.watching = state.watching.filter((item) => item !== id);
        ws.serializeAttachment(state);
      }
      ack({ ok: true });
    }
  }

  /** Thành viên xin nghe một sản phẩm. Đọc lại phiên mỗi lần: quyền vừa đổi hay tài khoản vừa bị khóa có hiệu lực ngay. */
  async watch(ws, rawId) {
    const id = lower(rawId);
    if (!isId(id)) return { ok: false, message: "Sản phẩm không hợp lệ." };

    const state = ws.deserializeAttachment();
    if (state.kind === "guest") {
      // Khách đã nghe sẵn sản phẩm của link; không nghe được sản phẩm khác.
      return state.deliverableId === id
        ? { ok: true }
        : { ok: false, message: "Bạn không có quyền làm việc này." };
    }

    const resolved = await resolveSessionByHash(state.sessionHash);
    if (!resolved) {
      ws.close(CLOSE.UNAUTHENTICATED, "session expired");
      return {
        ok: false,
        message: "Bạn chưa đăng nhập hoặc phiên đã hết hạn.",
      };
    }
    const d = await first(
      sql`SELECT order_id FROM deliverables WHERE id = ${id} AND org_id = ${resolved.actor.orgId}`
    );
    if (!d || !can(resolved.actor, "feedback.read", { orderId: d.order_id })) {
      return { ok: false, message: "Bạn không có quyền làm việc này." };
    }
    // Hai lệnh của cùng một kết nối có thể chạy xen nhau ở các chỗ chờ database: đọc lại trạng thái ngay trước khi ghi.
    const fresh = ws.deserializeAttachment();
    if (!fresh.watching.includes(id)) {
      if (fresh.watching.length >= MAX_WATCHED) {
        return { ok: false, message: "Đang theo dõi quá nhiều sản phẩm." };
      }
      fresh.watching.push(id);
      ws.serializeAttachment(fresh);
    }
    return { ok: true };
  }

  tooManyWatches(ws) {
    const { socketId } = ws.deserializeAttachment();
    const current = Date.now();
    const recent = (this.watchTimes.get(socketId) || []).filter(
      (at) => current - at < WATCH_WINDOW_MS
    );
    recent.push(current);
    this.watchTimes.set(socketId, recent);
    return recent.length > WATCH_LIMIT;
  }

  webSocketClose(ws) {
    this.watchTimes.delete(ws.deserializeAttachment()?.socketId);
  }

  webSocketError(ws) {
    this.watchTimes.delete(ws.deserializeAttachment()?.socketId);
  }

  // ---------- Gọi từ Worker (RPC, xem utils/realtime.js) ----------

  /**
   * Phát sự kiện "feedback:event". Phía team: các kết nối đang theo dõi sản phẩm đó, nhận đủ actor.
   * Phía khách: chỉ khi visibility là "customer", và actor chỉ còn `kind` (không lộ tên hay id thành viên).
   * exceptSocketId: kết nối của chính tab gây ra thay đổi, không báo ngược lại.
   */
  publish(event, exceptSocketId) {
    const forTeam = JSON.stringify({ type: "feedback:event", data: event });
    for (const ws of this.ctx.getWebSockets("team")) {
      const state = ws.deserializeAttachment();
      if (
        state.socketId !== exceptSocketId &&
        state.watching.includes(event.deliverableId)
      ) {
        send(ws, forTeam);
      }
    }
    if (event.visibility !== "customer") return;
    const forGuests = JSON.stringify({
      type: "feedback:event",
      data: { ...event, actor: { kind: event.actor.kind } },
    });
    for (const ws of this.ctx.getWebSockets(`g:${event.deliverableId}`)) {
      if (ws.deserializeAttachment().socketId !== exceptSocketId) {
        send(ws, forGuests);
      }
    }
  }

  /** Ngắt mọi kết nối mang một nhãn: "m:<memberId>", "l:<shareLinkId>" hoặc "g:<deliverableId>". */
  disconnect(tag) {
    for (const ws of this.ctx.getWebSockets(tag)) {
      ws.close(CLOSE.KICKED, "access changed");
    }
  }

  // ---------- Kiểm lại phiên định kỳ ----------

  async alarm() {
    const members = this.ctx.getWebSockets("team");
    if (members.length === 0) return;

    const hashes = [
      ...new Set(members.map((ws) => ws.deserializeAttachment().sessionHash)),
    ];
    const alive = await all(sql`
      SELECT s.token_hash FROM sessions s JOIN members m ON m.id = s.member_id
      WHERE s.token_hash IN ${sql.list(hashes)} AND s.expires_at > ${now()} AND m.status = 'active'`);
    const valid = new Set(alive.map((row) => row.token_hash));
    for (const ws of members) {
      if (!valid.has(ws.deserializeAttachment().sessionHash)) {
        ws.close(CLOSE.UNAUTHENTICATED, "session expired");
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + RECHECK_MS);
  }
}

const lower = (value) => (typeof value === "string" ? value.toLowerCase() : "");

/** Kết nối đang đóng dở thì send ném lỗi: bỏ qua, không để một kết nối hỏng chặn các kết nối khác. */
const send = (ws, text) => {
  try {
    ws.send(text);
  } catch {
    // Kết nối đã đóng.
  }
};
