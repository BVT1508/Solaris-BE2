import { getCookie } from "hono/cookie";
import env, { bindings } from "../config/env.js";
import { first, sql } from "../db/d1.js";
import { isTrustedOrigin } from "../middleware/securityMiddleware.js";
import { clientIp } from "../middleware/rateLimitMiddleware.js";
import { hashToken, resolveSession } from "../services/authService.js";
import logger from "../utils/logger.js";
import { CLOSE } from "./realtimeHub.js";

/**
 * GET /api/v1/realtime: mở kết nối trực tiếp (WebSocket thường). Giao thức: docs/hop-dong-realtime.md.
 *
 *   thành viên   không có tham số; xác thực bằng cookie phiên (trình duyệt tự gửi khi cùng site).
 *   khách        ?token=<token của link chia sẻ>
 *
 * Worker xác thực ở đây rồi mới chuyển kết nối vào Durable Object, nên kết nối không hợp lệ không chạm tới object.
 * Trình duyệt không đọc được mã HTTP của lần bắt tay WebSocket hỏng, nên lỗi xác thực vẫn được nâng cấp thành công
 * rồi đóng ngay bằng một mã đóng (4401, 4404, 4410) kèm một tin { type: "error", status, message }.
 */
export const SESSION_COOKIE = "solaris_sid";
const LINK_TOKEN = /^[A-Za-z0-9_-]{32}$/;

/** Nâng cấp rồi đóng ngay với lời báo, không qua Durable Object. */
const refuse = (status, message) => {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair);
  server.accept();
  server.send(JSON.stringify({ type: "error", status, message }));
  server.close(4000 + status, "refused");
  return new Response(null, { status: 101, webSocket: client });
};

async function identify(c) {
  const token = c.req.query("token");
  if (token !== undefined) {
    if (!LINK_TOKEN.test(token)) {
      return { error: [404, "Link không hợp lệ."] };
    }
    const link = await first(sql`
      SELECT l.id, l.status, l.deliverable_id, d.status AS deliverable_status
      FROM share_links l JOIN deliverables d ON d.id = l.deliverable_id
      WHERE l.token = ${token}`);
    if (!link || link.status === "revoked") {
      return { error: [404, "Link không tồn tại hoặc đã bị thu hồi."] };
    }
    if (link.deliverable_status === "archived") {
      return { error: [410, "Sản phẩm này đã ngừng chia sẻ."] };
    }
    return {
      identity: {
        kind: "guest",
        shareLinkId: link.id,
        deliverableId: link.deliverable_id,
      },
    };
  }

  const sid = getCookie(c, SESSION_COOKIE);
  const resolved = await resolveSession(sid);
  if (!resolved) {
    return { error: [401, "Bạn chưa đăng nhập hoặc phiên đã hết hạn."] };
  }
  return {
    identity: {
      kind: "member",
      memberId: resolved.actor.memberId,
      // Chỉ giữ băm của token: đủ để kiểm lại phiên, không đủ để dùng phiên.
      sessionHash: hashToken(sid),
    },
  };
}

export async function connectRealtime(c) {
  if (c.req.header("upgrade")?.toLowerCase() !== "websocket") {
    return c.json(
      { status: "fail", message: "Đường này chỉ nhận kết nối WebSocket." },
      426
    );
  }
  // Kết nối dùng cookie phiên: chỉ nhận từ origin của frontend (nâng cấp WebSocket không qua CORS).
  // Không có Origin là client không phải trình duyệt, không mang cookie của ai.
  const origin = c.req.header("origin");
  if (origin && !isTrustedOrigin(origin, c.req.url)) {
    return c.json(
      { status: "fail", message: "Yêu cầu đến từ nguồn không được phép." },
      403
    );
  }
  // Mỗi lần mở kết nối tốn một lần đọc phiên hoặc link: một IP không mở quá 120 kết nối mỗi phút.
  if (bindings.SOCKET_LIMITER && !env.IS_DEV) {
    const { success } = await bindings.SOCKET_LIMITER.limit({
      key: clientIp(c),
    });
    if (!success) {
      return c.json(
        {
          status: "fail",
          message: "Bạn đang gửi quá nhanh. Hãy thử lại sau ít phút.",
        },
        429
      );
    }
  }

  let result;
  try {
    result = await identify(c);
  } catch (err) {
    logger.error({ err }, "Lỗi khi xác thực kết nối trực tiếp");
    return refuse(500, "Không kết nối được. Hãy thử lại.");
  }
  if (result.error) return refuse(...result.error);

  const target = new URL("https://realtime/connect");
  target.searchParams.set("identity", JSON.stringify(result.identity));
  const hub = bindings.REALTIME.get(bindings.REALTIME.idFromName("hub"));
  return hub.fetch(new Request(target, c.req.raw));
}

export { CLOSE };
