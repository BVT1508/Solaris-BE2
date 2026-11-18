import {
  all,
  first,
  guard,
  readAll,
  run,
  sql,
  transact,
  uniqueViolationOf,
} from "../db/d1.js";
import { Feedback } from "../models/index.js";
import { assertCan, isLeaderOf } from "../policies/policy.js";
import AppError, { STALE } from "../utils/appError.js";
import { auditStatement } from "../utils/audit.js";
import { safeEqual } from "../utils/hash.js";
import { newId } from "../utils/id.js";
import { notifyFeedback } from "../utils/realtime.js";
import { now } from "../utils/time.js";
import {
  assertCanComment,
  assertOrderOpen,
  assertSameSite,
} from "./feedbackRules.js";
import * as storage from "./storageService.js";

// Hạn mức góp ý của khách trong một vòng, đếm theo link: mã thiết bị do trình duyệt tự gửi nên đổi được,
// đếm theo máy thì ai muốn vượt chỉ cần đổi mã.
const MAX_PER_LINK_PER_ROUND = 300;
// Ảnh chụp được đính sau khi lưu góp ý (chụp và đẩy lên kho chạy nền). Trễ hơn mức này thì không nhận nữa.
const SHOT_ATTACH_WINDOW_MS = 15 * 60 * 1000;
/** Một luồng trao đổi không dài quá chừng này trả lời. */
const MAX_REPLIES = 200;
/** Ảnh chụp màn hình kèm góp ý trên site web. */
const SHOT_MAX_BYTES = 5 * 1024 * 1024;
const LIST_LIMIT = 500;
const SHOT_MISSING = "Chưa thấy ảnh chụp trên kho.";

const NOT_FOUND = () => new AppError("Không tìm thấy góp ý.", 404);
const ROUND_CLOSED = () =>
  new AppError("Vòng góp ý đã khép. Chờ team gửi bản sửa để góp ý tiếp.", 409);
const TOO_LONG = () => new AppError("Luồng trao đổi này đã quá dài.", 400);
const FILE_REPLACED = () =>
  new AppError("File này đã được thay, hãy góp ý trên bản mới.", 400);

/** Câu thêm trả lời không đổi dòng nào: bài vừa bị xóa thì 404, còn bài mà không thêm được là luồng đã quá dài. */
const replyRejected = async (feedbackId) =>
  (await first(sql`SELECT 1 FROM feedback WHERE id = ${feedbackId}`))
    ? TOO_LONG()
    : NOT_FOUND();

const fromRow = (row) => Feedback.fromRow(row);

// ---------- Dựng dữ liệu trả về ----------

const toTarget = (fb) =>
  fb.targetFileId
    ? { fileId: fb.targetFileId, page: fb.targetPage || null }
    : null;

const toMark = (mark) => {
  if (!mark?.kind) return null;
  if (mark.kind === "pin") return { kind: "pin", x: mark.x, y: mark.y };
  if (mark.kind === "region") {
    return { kind: "region", x: mark.x, y: mark.y, w: mark.w, h: mark.h };
  }
  return { kind: "stroke", points: mark.points };
};

const toAnchor = (anchor) =>
  anchor?.pageUrl
    ? {
        pageUrl: anchor.pageUrl,
        selector: anchor.selector || null,
        viewport: anchor.viewport?.w ? anchor.viewport : null,
        scroll: anchor.scroll?.x !== undefined ? anchor.scroll : null,
        docSize: anchor.docSize?.w ? anchor.docSize : null,
        offset: anchor.offset?.x !== undefined ? anchor.offset : null,
        element: anchor.element?.kind
          ? {
              kind: anchor.element.kind,
              tag: anchor.element.tag || null,
              text: anchor.element.text || null,
              src: anchor.element.src || null,
              rect: anchor.element.rect?.w ? anchor.element.rect : null,
            }
          : null,
      }
    : null;

const toScreenshot = (shot) =>
  shot?.key
    ? {
        url: storage.readUrl(shot),
        // Ảnh nhỏ cho thẻ góp ý; null thì dùng url.
        thumbUrl: storage.thumbUrl(shot),
        width: shot.width || null,
        height: shot.height || null,
        // Vùng của trang mà ảnh bao phủ (px, tọa độ cả trang); null là cả khung nhìn lúc chụp.
        rect: shot.rect?.w ? shot.rect : null,
      }
    : null;

/** Gắn vùng bao phủ vào bản ghi ảnh chụp, nếu trình duyệt có gửi. */
const withRect = (shot, rect) => (shot && rect ? { ...shot, rect } : shot);

/** Người đang xem phía khách: máy nào, qua link nào. */
const viewerOf = (guest) => ({
  deviceHash: guest.deviceHash,
  linkId: guest.link.id,
});

/**
 * Bài của người đang xem: cùng link (khách mở link trong Zalo rồi mở lại bằng trình duyệt khác vẫn là họ),
 * hoặc cùng máy. Mỗi người liên hệ có link riêng nên nháp của người khác vẫn tách nhau.
 */
const isOwnFeedback = (fb, viewer) =>
  fb.authorKind === "guest" &&
  ((Boolean(fb.shareLink) && fb.shareLink === viewer.linkId) ||
    (Boolean(viewer.deviceHash) && fb.authorDeviceHash === viewer.deviceHash));

/**
 * Mốc thay đổi mà khách thấy được. Không dùng updatedAt của bản ghi: ghi chú nội bộ của team cũng làm nó đổi,
 * khách nhìn vào sẽ biết team vừa trao đổi riêng trên bài nào.
 */
const guestUpdatedAt = (fb, visibleReplies) => {
  if (fb.status === "draft") return fb.updatedAt;
  const marks = [
    fb.createdAt,
    fb.submittedAt,
    fb.resolvedAt,
    fb.confirmedAt,
    ...visibleReplies.map((reply) => reply.createdAt),
  ].filter(Boolean);
  // Mọi mốc đều là chuỗi ISO cùng dạng nên so chuỗi là so thời gian.
  return marks.reduce((latest, mark) => (mark > latest ? mark : latest));
};

/**
 * Bản cho khách: không có băm thiết bị, người xử lý, ghi chú "chỉ team" hay bất cứ thứ gì nội bộ.
 * mine: bài của người đang xem (được sửa, xóa khi còn nháp).
 */
const toGuestView = (fb, viewer) => {
  const visibleReplies = (fb.replies || []).filter(
    (reply) => reply.visibility === "customer"
  );
  return {
    id: fb.id,
    seq: fb.seq,
    clientId: fb.clientId,
    body: fb.body,
    authorName: fb.authorName,
    authorKind: fb.authorKind,
    mine: isOwnFeedback(fb, viewer),
    status: fb.status,
    roundNumber: fb.roundNumber,
    target: toTarget(fb),
    mark: toMark(fb.mark),
    anchor: toAnchor(fb.anchor),
    screenshot: toScreenshot(fb.screenshot),
    replies: visibleReplies.map((reply) => ({
      id: reply.id,
      body: reply.body,
      authorName: reply.authorName,
      authorKind: reply.authorKind,
      mine:
        reply.authorKind === "guest" &&
        Boolean(viewer.deviceHash) &&
        reply.deviceHash === viewer.deviceHash,
      createdAt: reply.createdAt,
    })),
    reopenedCount: fb.reopenedCount || 0,
    // Vòng mà khách bấm "Cần sửa tiếp" lần gần nhất; bằng vòng hiện tại thì bài này đang chờ gửi lại cho team.
    reopenedRoundNumber: fb.reopenedRoundNumber || null,
    createdAt: fb.createdAt,
    updatedAt: guestUpdatedAt(fb, visibleReplies),
  };
};

/**
 * Câu SELECT cho bản của team: góp ý kèm tên người xử lý, tên sản phẩm, tên đơn (thay cho populate của Mongoose).
 * Bí danh f cho bảng feedback để nơi gọi viết điều kiện.
 */
const TEAM_SELECT = sql.raw(`
  SELECT f.*, a.name AS assignee_name, a.email AS assignee_email,
         d.name AS deliverable_name, d.type AS deliverable_type, o.title AS order_title
  FROM feedback f
  JOIN deliverables d ON d.id = f.deliverable_id
  JOIN orders o ON o.id = f.order_id
  LEFT JOIN members a ON a.id = f.assignee_id`);

/** Bản cho team: thêm người xử lý, mọi trả lời kể cả ghi chú nội bộ, mốc thời gian xử lý. */
const toTeamView = (row) => {
  const fb = fromRow(row);
  return {
    id: fb.id,
    seq: fb.seq,
    body: fb.body,
    authorName: fb.authorName,
    authorKind: fb.authorKind,
    authorMemberId: fb.authorMember || null,
    visibility: fb.visibility,
    status: fb.status,
    roundNumber: fb.roundNumber,
    shareLinkId: fb.shareLink || null,
    order: { id: fb.order, title: row.order_title },
    deliverable: {
      id: fb.deliverable,
      name: row.deliverable_name,
      type: row.deliverable_type,
    },
    target: toTarget(fb),
    mark: toMark(fb.mark),
    anchor: toAnchor(fb.anchor),
    screenshot: toScreenshot(fb.screenshot),
    assignee:
      fb.assignee && row.assignee_name !== null
        ? {
            id: fb.assignee,
            name: row.assignee_name,
            email: row.assignee_email,
          }
        : null,
    replies: (fb.replies || []).map((reply) => ({
      id: reply.id,
      body: reply.body,
      authorName: reply.authorName,
      authorKind: reply.authorKind,
      authorMemberId: reply.authorMember || null,
      visibility: reply.visibility,
      createdAt: reply.createdAt,
    })),
    reopenedCount: fb.reopenedCount || 0,
    submittedAt: fb.submittedAt || null,
    resolvedAt: fb.resolvedAt || null,
    confirmedAt: fb.confirmedAt || null,
    version: fb.version,
    createdAt: fb.createdAt,
    updatedAt: fb.updatedAt,
  };
};

const teamViewById = async (id) =>
  toTeamView(await first(sql`${TEAM_SELECT} WHERE f.id = ${id}`));

const guestViewById = async (id, viewer) =>
  toGuestView(
    fromRow(await first(sql`SELECT * FROM feedback WHERE id = ${id}`)),
    viewer
  );

// ---------- Luật dùng chung ----------

/**
 * Đơn đã bàn giao: khách không gửi hay trả lời được nữa, nên team cũng không nhắn thêm cho khách
 * (lời nhắn sẽ không có hồi âm). Ghi chú nội bộ thì vẫn được.
 */
async function assertOrderOpenForCustomer(orderId) {
  const order = await first(
    sql`SELECT status FROM orders WHERE id = ${orderId}`
  );
  if (order?.status === "delivered") {
    throw new AppError(
      "Đơn đã bàn giao. Mở lại đơn trước khi trao đổi thêm với khách.",
      409
    );
  }
}

/**
 * Kiểm vị trí góp ý với sản phẩm. Trả { target, mark, anchor } (khóa nào không có thì undefined).
 * web: không gắn theo file; ghim thì phải kèm anchor (do bridge đo), dấu tính theo tỷ lệ trang.
 * design, document: target là một file đang dùng của sản phẩm; PDF phải có số trang hợp lệ.
 * Không có gì trong ba thứ đó: nhận xét chung cho cả sản phẩm.
 */
function resolvePlacement(deliverable, { target, mark, anchor }, allowedIds) {
  if (deliverable.type === "web") {
    if (target) {
      throw new AppError("Sản phẩm web không gắn góp ý theo file.", 400);
    }
    if (mark && !anchor) {
      throw new AppError(
        "Dấu ghim trên site cần thông tin trang (anchor).",
        400
      );
    }
    if (anchor) assertSameSite(deliverable.url, anchor.pageUrl);
    return { anchor: anchor || undefined, mark: mark || undefined };
  }
  if (anchor) throw new AppError("Chỉ sản phẩm web mới có anchor.", 400);
  if (!target) {
    if (mark) throw new AppError("Dấu ghim cần chỉ rõ file.", 400);
    return {};
  }
  const file = (deliverable.files || []).find((f) => f.id === target.fileId);
  if (!file) throw new AppError("File không thuộc sản phẩm này.", 400);
  // allowedIds: các file được phép góp ý (bộ file của vòng hiện tại). Không truyền thì là file đang dùng.
  const allowed = allowedIds ? allowedIds.has(file.id) : !file.removedAt;
  if (!allowed) {
    throw new AppError("File này đã được thay, hãy góp ý trên bản mới.", 400);
  }

  if (file.contentType === "application/pdf") {
    if (!target.page) throw new AppError("Cần số trang của PDF.", 400);
    if (file.pages && target.page > file.pages) {
      throw new AppError(`PDF chỉ có ${file.pages} trang.`, 400);
    }
    return {
      target: { fileId: file.id, page: target.page },
      mark: mark || undefined,
    };
  }
  if (target.page) throw new AppError("Ảnh không có số trang.", 400);
  return { target: { fileId: file.id }, mark: mark || undefined };
}

/** Vị trí đã kiểm thành các cột của bảng feedback; thứ không có thì NULL. */
const placementColumns = (placement) => ({
  targetFileId: placement.target?.fileId ?? null,
  targetPage: placement.target?.page ?? null,
  mark: placement.mark ?? null,
  anchor: placement.anchor ?? null,
});

/** Khách chỉ góp ý trên bộ file của vòng hiện tại (bản team đã gửi). */
const guestAllowedFiles = (guest) => new Set(guest.round?.files || []);

/** Team góp ý được trên bản khách đang xem và cả bản đang sửa dở. */
const memberAllowedFiles = (deliverable, round) =>
  new Set([
    ...(round?.files || []),
    ...(deliverable.files || []).filter((f) => !f.removedAt).map((f) => f.id),
  ]);

/** Hai câu lệnh cấp số thứ tự kế tiếp của sản phẩm: tăng bộ đếm, rồi bài mới lấy đúng giá trị vừa tăng. */
const bumpSeq = (deliverableId) =>
  sql`UPDATE deliverables SET feedback_seq = feedback_seq + 1 WHERE id = ${deliverableId}`;
const currentSeq = (deliverableId) =>
  sql`(SELECT feedback_seq FROM deliverables WHERE id = ${deliverableId})`;

/** Câu lệnh thêm một trả lời vào cuối luồng (không đọc rồi ghi), chỉ khi luồng chưa quá dài. */
const appendReply = (feedbackId, reply) => sql`
  UPDATE feedback SET
    replies = json_insert(replies, '$[#]', json(${JSON.stringify({ id: newId(), ...reply, createdAt: now() })})),
    version = version + 1, updated_at = ${now()}
  WHERE id = ${feedbackId} AND json_array_length(replies) < ${MAX_REPLIES}`;

/**
 * Nhận ảnh chụp màn hình khách đã đẩy lên kho: kiểm có thật, là ảnh, không quá cỡ, đo kích thước,
 * rồi chuyển sang key chính thức. Trả bản ghi screenshot để lưu vào góp ý.
 */
async function adoptScreenshot(deliverable, key) {
  if (deliverable.type !== "web") {
    throw new AppError("Chỉ sản phẩm web mới gửi ảnh chụp màn hình.", 400);
  }
  storage.assertStorageEnabled();
  if (!storage.pendingKeyPattern(deliverable.id).test(key)) {
    throw new AppError("Ảnh chụp không thuộc sản phẩm này.", 400);
  }
  const provider = storage.activeProvider();
  const info = await storage.statPending(key);
  if (!info) throw new AppError(SHOT_MISSING, 400);

  const rule = storage.ruleFor(info.contentType);
  if (!rule || rule.kind !== "image" || info.bytes > SHOT_MAX_BYTES) {
    await storage.trashQuietly([{ provider, key }]);
    throw new AppError(
      "Ảnh chụp phải là PNG, JPG hoặc WebP, tối đa 5 MB.",
      400
    );
  }
  const measured = await storage.measurePending(key, rule, info);
  const finalKey = storage.shotKey(deliverable.order, deliverable.id, rule.ext);
  await storage.promote(key, finalKey);
  return {
    provider,
    key: finalKey,
    contentType: info.contentType,
    bytes: info.bytes,
    ...measured,
  };
}

/** Bài của sản phẩm trong link, đủ mọi cột (kể cả băm thiết bị, để nhận ra bài của chính người đang xem). */
const findInDeliverable = async (guest, id) =>
  fromRow(
    await first(
      sql`SELECT * FROM feedback WHERE id = ${id} AND deliverable_id = ${guest.deliverable.id}`
    )
  );

/** Nháp của người đang xem (cùng link hoặc cùng máy); không thì báo lỗi đúng lý do. */
async function findOwnDraft(guest, id) {
  const fb = await findInDeliverable(guest, id);
  if (!fb || fb.visibility !== "customer") throw NOT_FOUND();
  if (!isOwnFeedback(fb, viewerOf(guest))) {
    // Nháp của người khác coi như không tồn tại; bài đã gửi thì nói rõ là không phải của mình.
    if (fb.status === "draft") throw NOT_FOUND();
    throw new AppError("Chỉ sửa được góp ý của chính bạn.", 403);
  }
  if (fb.status !== "draft") {
    throw new AppError("Góp ý đã gửi cho team, không sửa được nữa.", 409);
  }
  return fb;
}

/** Góp ý khách được thấy (đã gửi, không phải "chỉ team") của sản phẩm trong link. */
async function findVisibleToGuest(guest, id) {
  const fb = await findInDeliverable(guest, id);
  if (!fb || fb.visibility !== "customer" || fb.status === "draft") {
    throw NOT_FOUND();
  }
  return fb;
}

// ---------- Khách ----------

/** Điều kiện "nháp của người đang xem": soạn qua cùng link, hoặc trên cùng máy. */
const ownDraftCondition = (guest) =>
  sql.or([
    sql`share_link_id = ${guest.link.id}`,
    ...(guest.deviceHash
      ? [sql`author_device_hash = ${guest.deviceHash}`]
      : []),
  ]);

/**
 * Khách thấy: nháp của chính mình (cùng link hoặc cùng máy), và mọi góp ý "khách & team" đã gửi của sản phẩm (mọi vòng).
 * Nháp của người khác và bài "chỉ team" không bao giờ tới đây; otherDrafts chỉ cho biết còn bao nhiêu nháp
 * của người khác đang chờ (chúng đi cùng khi bấm gửi, và chặn nút duyệt).
 */
export async function listForGuest(guest) {
  assertCan(guest.actor, "feedback.read", {
    deliverableId: guest.deliverable.id,
  });
  const base = sql`deliverable_id = ${guest.deliverable.id} AND visibility = 'customer'`;
  const [rows, [{ n: drafts }]] = await readAll([
    sql`SELECT * FROM feedback
        WHERE ${base} AND (status <> 'draft' OR ${ownDraftCondition(guest)})
        ORDER BY seq`,
    sql`SELECT count(*) AS n FROM feedback WHERE ${base} AND status = 'draft'`,
  ]);
  const viewer = viewerOf(guest);
  const list = rows.map(fromRow);
  const ownDrafts = list.filter((fb) => fb.status === "draft").length;
  return {
    feedback: list.map((fb) => toGuestView(fb, viewer)),
    otherDrafts: Math.max(0, drafts - ownDrafts),
  };
}

/** Khách xin chỗ đẩy ảnh chụp màn hình (bridge chụp) trước khi gửi góp ý trên site web. */
export async function createGuestUpload(guest, input) {
  const { deliverable } = guest;
  assertCan(guest.actor, "feedback.create", { deliverableId: deliverable.id });
  assertCanComment(guest);
  if (deliverable.type !== "web") {
    throw new AppError("Chỉ sản phẩm web mới gửi ảnh chụp màn hình.", 400);
  }
  const rule = storage.ruleFor(input.contentType);
  if (!rule || rule.kind !== "image" || input.bytes > SHOT_MAX_BYTES) {
    throw new AppError(
      "Ảnh chụp phải là PNG, JPG hoặc WebP, tối đa 5 MB.",
      400
    );
  }
  storage.assertStorageEnabled();
  const key = storage.pendingKey(deliverable.id, rule.ext);
  return storage.createUpload(key, rule, input.contentType, input.bytes);
}

/**
 * Khách tạo góp ý ở trạng thái nháp. Gửi lại cùng clientId từ cùng link hoặc cùng máy thì trả bài cũ (created: false),
 * không tạo bài mới và không tốn số thứ tự.
 */
export async function createByGuest(guest, input) {
  const { link, deliverable, round, deviceHash } = guest;
  assertCan(guest.actor, "feedback.create", { deliverableId: deliverable.id });
  assertCanComment(guest);
  const placement = resolvePlacement(
    deliverable,
    input,
    guestAllowedFiles(guest)
  );

  const findExisting = async () =>
    fromRow(
      await first(sql`
        SELECT * FROM feedback WHERE deliverable_id = ${deliverable.id} AND client_id = ${input.clientId}`)
    );
  const viewer = viewerOf(guest);
  const replay = (existing) => {
    if (!isOwnFeedback(existing, viewer)) {
      throw new AppError("Mã góp ý này đã được dùng.", 409);
    }
    return { feedback: toGuestView(existing, viewer), created: false };
  };

  const existing = await findExisting();
  if (existing) return replay(existing);

  const sentCount = sql`
    SELECT count(*) FROM feedback WHERE round_id = ${round.id} AND share_link_id = ${link.id}`;
  const TOO_MANY = () =>
    new AppError(
      "Bạn đã gửi rất nhiều góp ý trong vòng này. Hãy gửi cho team trước khi thêm.",
      429
    );
  const { n: sent } = await first(sql`SELECT (${sentCount}) AS n`);
  if (sent >= MAX_PER_LINK_PER_ROUND) throw TOO_MANY();

  let screenshot;
  if (input.screenshotKey) {
    try {
      screenshot = await adoptScreenshot(deliverable, input.screenshotKey);
    } catch (err) {
      // Trình duyệt gửi lại cùng clientId trong lúc lần đầu đang chạy: ảnh tạm đã được lần đầu chuyển đi nên ở đây
      // không còn thấy. Chờ lần đầu ghi xong rồi trả đúng bài đó, thay vì báo lỗi cho một thao tác đã thành công.
      if (err.message !== SHOT_MISSING && err.statusCode !== 502) throw err;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const winner = await findExisting();
        if (winner) return replay(winner);
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      throw err;
    }
  }

  const at = now();
  try {
    const created = await transact(
      async () => ({
        statements: [
          // Vòng phải còn mở lúc ghi: nếu đúng lúc này có người bấm "Gửi góp ý cho team" thì lô gửi chạy trước hoặc sau lô này.
          // Trước: guard sai, nháp bị từ chối rõ ràng. Sau: nháp đi cùng lượt gửi. Không kẹt giữa chừng.
          guard(
            sql`SELECT 1 FROM rounds WHERE id = ${round.id} AND status = 'open'`,
            "closed"
          ),
          // Hạn mức đếm lại ngay trong lô: nhiều request cùng lúc không vượt được trần.
          guard(
            sql`SELECT 1 WHERE (${sentCount}) < ${MAX_PER_LINK_PER_ROUND}`,
            "limit"
          ),
          // File được ghim phải còn trong bộ file của vòng lúc ghi (vòng vừa được cập nhật bản đang gửi thì file cũ có thể đã bị xóa hẳn).
          ...(placement.target
            ? [
                guard(
                  sql`SELECT 1 FROM rounds r, json_each(r.files) f
                      WHERE r.id = ${round.id} AND f.value = ${placement.target.fileId}`,
                  "file"
                ),
              ]
            : []),
          bumpSeq(deliverable.id),
          sql`${Feedback.insert({
            id: newId(),
            org: link.org,
            order: link.order,
            deliverable: deliverable.id,
            round: round.id,
            roundNumber: round.number,
            shareLink: link.id,
            seq: currentSeq(deliverable.id),
            clientId: input.clientId,
            authorKind: "guest",
            authorName: input.authorName,
            authorDeviceHash: deviceHash,
            visibility: "customer",
            body: input.body,
            ...placementColumns(placement),
            screenshot: withRect(screenshot, input.screenshotRect) ?? null,
            status: "draft",
            createdAt: at,
            updatedAt: at,
          })} RETURNING *`,
        ],
        // Câu INSERT luôn đứng cuối lô (số guard phía trước thay đổi theo từng bài).
        done: (results) => fromRow(results[results.length - 1].rows[0]),
      }),
      {
        errors: {
          closed: ROUND_CLOSED,
          limit: TOO_MANY,
          file: FILE_REPLACED,
        },
      }
    );
    return { feedback: toGuestView(created, viewer), created: true };
  } catch (err) {
    if (screenshot) await storage.trashQuietly([screenshot]);
    // Hai request cùng clientId tới gần như cùng lúc: bên thua lấy bài bên thắng vừa tạo.
    if (uniqueViolationOf(err)) {
      const winner = await findExisting();
      if (winner) return replay(winner);
    }
    throw err;
  }
}

/**
 * Đính ảnh chụp cho góp ý đã lưu. Trình duyệt lưu góp ý ngay (không chờ gì), còn việc chụp và đẩy ảnh lên kho
 * chạy nền rồi gọi vào đây: người dùng không phải đợi kho mỗi lần lưu.
 * Chỉ cho bài của chính người đó (cùng link hoặc cùng máy), ghim trên site, chưa có ảnh, và còn trong khoảng
 * SHOT_ATTACH_WINDOW_MS kể từ lúc tạo. Bài đã gửi cho team trong lúc ảnh còn đang đẩy vẫn đính được.
 * Gọi lại khi bài đã có ảnh thì trả bài như đang có (không lỗi), để trình duyệt thử lại an toàn.
 */
export async function attachScreenshotByGuest(guest, id, input) {
  assertCan(guest.actor, "feedback.create", {
    deliverableId: guest.deliverable.id,
  });
  assertOrderOpen(guest.orderStatus);
  const viewer = viewerOf(guest);
  const fb = await findInDeliverable(guest, id);
  if (!fb || fb.visibility !== "customer" || fb.authorKind !== "guest") {
    throw NOT_FOUND();
  }
  if (!isOwnFeedback(fb, viewer)) {
    if (fb.status === "draft") throw NOT_FOUND();
    throw new AppError("Chỉ sửa được góp ý của chính bạn.", 403);
  }
  if (fb.screenshot?.key) return toGuestView(fb, viewer);
  if (!fb.anchor?.pageUrl) {
    throw new AppError("Chỉ góp ý ghim trên site mới có ảnh chụp.", 400);
  }
  const tooLate =
    Date.now() - new Date(fb.createdAt).getTime() > SHOT_ATTACH_WINDOW_MS;
  if (fb.status === "confirmed" || tooLate) {
    throw new AppError("Đã quá lúc đính ảnh chụp cho góp ý này.", 409);
  }

  const screenshot = withRect(
    await adoptScreenshot(guest.deliverable, input.screenshotKey),
    input.screenshotRect
  );
  // Ghi có điều kiện "chưa có ảnh": hai lần đính cùng lúc thì một bên thua và ảnh của bên thua bị dọn.
  // Không tăng version: đính ảnh không đụng trường nào team đang sửa, không nên làm thao tác của team bị 409.
  const updated = fromRow(
    await first(sql`
      UPDATE feedback SET screenshot = ${JSON.stringify(screenshot)}, updated_at = ${now()}
      WHERE id = ${fb.id} AND screenshot IS NULL RETURNING *`)
  );
  if (!updated) {
    await storage.trashQuietly([screenshot]);
    const current = await findInDeliverable(guest, fb.id);
    // Nháp vừa bị xóa trong lúc ảnh còn đang đẩy lên.
    if (!current) throw NOT_FOUND();
    return toGuestView(current, viewer);
  }
  // Bài đã gửi cho team: màn của team đang mở lấy lại bài để hiện ảnh.
  if (updated.status !== "draft") {
    notifyFeedback({
      deliverableId: updated.deliverable,
      feedbackId: updated.id,
      kind: "status",
      visibility: "customer",
      actor: guest.actor,
    });
  }
  return toGuestView(updated, viewer);
}

/** Sửa nháp của chính mình: nội dung, dấu, vị trí. Ảnh chụp không đổi được. */
export async function updateDraftByGuest(guest, id, input) {
  assertCanComment(guest);
  const fb = await findOwnDraft(guest, id);

  const changes = {};
  if (input.body !== undefined) changes.body = input.body;
  const touchesPlacement = ["target", "mark", "anchor"].some(
    (key) => input[key] !== undefined
  );
  if (touchesPlacement) {
    const current = { target: toTarget(fb), mark: fb.mark, anchor: fb.anchor };
    const merged = {};
    for (const key of ["target", "mark", "anchor"]) {
      merged[key] = input[key] === undefined ? current[key] : input[key];
    }
    Object.assign(
      changes,
      placementColumns(
        resolvePlacement(guest.deliverable, merged, guestAllowedFiles(guest))
      )
    );
  }

  const updated = fromRow(
    await first(sql`
      UPDATE feedback SET ${Feedback.set({ ...changes, updatedAt: now() })}, version = version + 1
      WHERE id = ${fb.id} AND status = 'draft' RETURNING *`)
  );
  if (!updated) {
    throw new AppError("Góp ý đã gửi cho team, không sửa được nữa.", 409);
  }
  return toGuestView(updated, viewerOf(guest));
}

/** Xóa nháp của chính mình. Số thứ tự của nó không cấp lại. */
export async function deleteDraftByGuest(guest, id) {
  assertCanComment(guest);
  const fb = await findOwnDraft(guest, id);
  await transact(
    async () => ({
      statements: [
        guard(
          sql`SELECT 1 FROM feedback WHERE id = ${fb.id} AND status = 'draft'`,
          "sent"
        ),
        sql`DELETE FROM feedback WHERE id = ${fb.id}`,
        storage.trashStatement([fb.screenshot]),
      ],
    }),
    {
      errors: {
        sent: () =>
          new AppError("Góp ý đã gửi cho team, không xóa được nữa.", 409),
      },
    }
  );
  if (fb.screenshot?.key) storage.emptyTrashSoon();
}

/** Khách trả lời trong luồng của một góp ý đã gửi. Link tạm dừng thì không trả lời được. */
export async function replyByGuest(guest, id, input) {
  assertCan(guest.actor, "feedback.create", {
    deliverableId: guest.deliverable.id,
  });
  assertOrderOpen(guest.orderStatus);
  if (guest.link.status !== "active") {
    throw new AppError("Link đang tạm dừng, chưa gửi góp ý được.", 403);
  }
  const fb = await findVisibleToGuest(guest, id);
  if ((fb.replies || []).length >= MAX_REPLIES) throw TOO_LONG();
  const { changes } = await run(
    appendReply(fb.id, {
      authorKind: "guest",
      authorName: input.authorName,
      deviceHash: guest.deviceHash,
      visibility: "customer",
      body: input.body,
    })
  );
  if (changes === 0) throw await replyRejected(fb.id);
  notifyFeedback({
    deliverableId: fb.deliverable,
    feedbackId: fb.id,
    kind: "reply",
    visibility: "customer",
    actor: guest.actor,
  });
  return guestViewById(fb.id, viewerOf(guest));
}

/**
 * Khách xác nhận một góp ý team đã báo sửa xong.
 * accepted ("Đã đúng"): góp ý thành confirmed. rejected ("Cần sửa tiếp"): quay về open, tăng reopenedCount,
 * ghi lại vòng (để lúc bấm gửi bài này tính là nội dung gửi), lời nhắn kèm theo (nếu có) vào luồng trao đổi.
 * Bài quay về open mà người được giao đã mất quyền với đơn thì bỏ giao, để nó về hàng "chưa giao".
 */
export async function verdictByGuest(guest, id, input) {
  assertCan(guest.actor, "feedback.create", {
    deliverableId: guest.deliverable.id,
  });
  assertCanComment(guest);
  const fb = await findVisibleToGuest(guest, id);
  if (fb.status === "confirmed") {
    throw new AppError("Góp ý này đã được xác nhận rồi.", 409);
  }
  if (fb.status !== "done") {
    throw new AppError("Góp ý này chưa được team báo đã sửa.", 409);
  }

  const accepted = input.verdict === "accepted";
  const keepAssignee =
    accepted ||
    !fb.assignee ||
    (await isAssignable(guest.link.org, fb.order, fb.assignee));
  const at = now();
  const status = accepted ? "confirmed" : "open";
  const update = accepted
    ? sql`UPDATE feedback SET status = 'confirmed', confirmed_at = ${at}, version = version + 1, updated_at = ${at}
          WHERE id = ${fb.id}`
    : sql`UPDATE feedback SET status = 'open', reopened_round_number = ${guest.round.number},
            resolved_at = NULL, resolved_by = NULL,
            assignee_id = ${keepAssignee ? fb.assignee : null},
            reopened_count = reopened_count + 1, version = version + 1, updated_at = ${at}
          WHERE id = ${fb.id}`;

  await transact(
    async () => ({
      statements: [
        // Vòng vừa khép (người khác bấm gửi hay duyệt) giữa lúc kiểm và lúc ghi: từ chối như mọi thao tác ghi của khách.
        guard(
          sql`SELECT 1 FROM rounds WHERE id = ${guest.round.id} AND status = 'open'`,
          "closed"
        ),
        guard(
          sql`SELECT 1 FROM feedback WHERE id = ${fb.id} AND status = 'done'`,
          "stale"
        ),
        update,
        // Lời nhắn kèm theo đi vào luồng trao đổi (không tăng version thêm lần nữa: cùng một thao tác).
        ...(input.note
          ? [
              sql`UPDATE feedback SET replies = json_insert(replies, '$[#]', json(${JSON.stringify(
                {
                  id: newId(),
                  authorKind: "guest",
                  authorName: input.authorName || guest.link.contactName,
                  deviceHash: guest.deviceHash,
                  visibility: "customer",
                  body: input.note,
                  createdAt: at,
                }
              )})) WHERE id = ${fb.id}`,
            ]
          : []),
        auditStatement({
          actor: guest.actor,
          action: accepted ? "feedback.accept" : "feedback.reject",
          entityType: "feedback",
          entityId: fb.id,
          orderId: fb.order,
          deliverableId: fb.deliverable,
          before: { status: "done" },
          after: { status, seq: fb.seq },
        }),
      ],
    }),
    { errors: { stale: STALE, closed: ROUND_CLOSED } }
  );
  notifyFeedback({
    deliverableId: fb.deliverable,
    feedbackId: fb.id,
    kind: "verdict",
    visibility: "customer",
    actor: guest.actor,
  });
  return guestViewById(fb.id, viewerOf(guest));
}

/**
 * So khóa mà bridge trong site báo lên với khóa của sản phẩm, không để lộ khóa (so sánh thời gian hằng).
 * Đúng thì ghi nhận site đã nhúng bridge. Sản phẩm không phải web thì luôn sai.
 */
async function matchSdkKey(deliverableId, sdkKey) {
  const d = await first(
    sql`SELECT type, sdk_key FROM deliverables WHERE id = ${deliverableId}`
  );
  if (!d || d.type !== "web") return false;
  const valid = safeEqual(d.sdk_key || "", sdkKey);
  if (valid) {
    const at = now();
    await run(sql`
      UPDATE deliverables SET bridge_seen_at = ${at}, updated_at = ${at} WHERE id = ${deliverableId}`);
  }
  return valid;
}

/**
 * Màn review của khách báo khóa mà bridge gửi lên (qua postMessage); server xác nhận có đúng khóa của sản phẩm.
 * Khách không bao giờ nhận được khóa; chỉ nhận đúng hay sai.
 */
export async function checkBridge(guest, sdkKey) {
  return { valid: await matchSdkKey(guest.deliverable.id, sdkKey) };
}

/**
 * Cũng việc đó cho màn góp ý của team. Ai trong đơn cũng gọi được, kể cả staff và viewer:
 * họ không được xem sdkKey nên không tự so được.
 */
export async function checkBridgeForMember(actor, deliverableId, sdkKey) {
  const d = await findDeliverableOrder(actor, deliverableId);
  assertCan(actor, "deliverable.read", { orderId: d.order_id });
  return { valid: await matchSdkKey(d.id, sdkKey) };
}

// ---------- Team ----------

async function findDeliverableOrder(actor, deliverableId) {
  const d = await first(sql`
    SELECT id, order_id FROM deliverables WHERE id = ${deliverableId} AND org_id = ${actor.orgId}`);
  if (!d) throw new AppError("Không tìm thấy sản phẩm bàn giao.", 404);
  return d;
}

/** Điều kiện lọc cho danh sách của team: mặc định mọi bài đã gửi; nháp của khách không bao giờ có. */
function teamFilter(actor, base, query = {}) {
  const where = [
    ...base,
    query.status ? sql`f.status = ${query.status}` : sql`f.status <> 'draft'`,
  ];
  if (query.visibility) where.push(sql`f.visibility = ${query.visibility}`);
  if (query.round) where.push(sql`f.round_number = ${query.round}`);
  if (query.assignee === "me") {
    where.push(sql`f.assignee_id = ${actor.memberId}`);
  } else if (query.assignee === "none") where.push(sql`f.assignee_id IS NULL`);
  else if (query.assignee) where.push(sql`f.assignee_id = ${query.assignee}`);
  return where;
}

/** Tối đa LIST_LIMIT bài; truncated cho giao diện biết danh sách đã bị cắt để nhắc người dùng lọc bớt. */
const listViews = async (where, orderBy) => {
  const rows = await all(sql`
    ${TEAM_SELECT} WHERE ${sql.and(where)} ORDER BY ${sql.raw(orderBy)} LIMIT ${LIST_LIMIT + 1}`);
  return {
    feedback: rows.slice(0, LIST_LIMIT).map(toTeamView),
    truncated: rows.length > LIST_LIMIT,
  };
};

/** Góp ý đã gửi của một sản phẩm; ai trong đơn cũng xem được. */
export async function listForTeam(actor, deliverableId, query) {
  const d = await findDeliverableOrder(actor, deliverableId);
  assertCan(actor, "feedback.read", { orderId: d.order_id });
  return listViews(
    teamFilter(actor, [sql`f.deliverable_id = ${d.id}`], query),
    "f.seq"
  );
}

/** Mọi góp ý của một đơn: màn "Cần xử lý". */
export async function listForOrder(actor, orderId, query = {}) {
  assertCan(actor, "feedback.read", { orderId });
  const order = await first(
    sql`SELECT 1 FROM orders WHERE id = ${orderId} AND org_id = ${actor.orgId}`
  );
  if (!order) throw new AppError("Không tìm thấy đơn hàng.", 404);
  const base = [sql`f.order_id = ${orderId}`];
  if (query.deliverableId) {
    base.push(sql`f.deliverable_id = ${query.deliverableId}`);
  }
  return listViews(teamFilter(actor, base, query), "f.deliverable_id, f.seq");
}

/** Việc của tôi: góp ý đang giao cho người gọi, mặc định những bài còn phải làm. */
export async function listMine(actor, query = {}) {
  const where = [
    sql`f.org_id = ${actor.orgId}`,
    sql`f.assignee_id = ${actor.memberId}`,
    query.status
      ? sql`f.status = ${query.status}`
      : sql`f.status IN ('open', 'in_progress')`,
  ];
  if (actor.role !== "admin") {
    // Chỉ việc ở các đơn người gọi còn tham gia.
    where.push(sql`f.order_id IN (
      SELECT order_id FROM order_members WHERE member_id = ${actor.memberId})`);
  }
  return listViews(where, "f.updated_at DESC, f.id DESC");
}

/** Nạp một góp ý đã gửi và kiểm quyền theo đơn của nó. */
async function findForMember(actor, id, action) {
  const fb = fromRow(
    await first(sql`
      SELECT * FROM feedback WHERE id = ${id} AND org_id = ${actor.orgId} AND status <> 'draft'`)
  );
  if (!fb) throw NOT_FOUND();
  assertCan(actor, action, { orderId: fb.order });
  return fb;
}

export async function getForTeam(actor, id) {
  const fb = await findForMember(actor, id, "feedback.read");
  return teamViewById(fb.id);
}

/**
 * Team tự thêm góp ý: ghi chú nội bộ (visibility "team", mặc định) hoặc bài cho khách thấy.
 * Bài của team không qua bước nháp: tạo ra là open, thuộc vòng mới nhất của sản phẩm.
 */
export async function createByMember(actor, deliverableId, input) {
  const [[dRow], [roundRow]] = await readAll([
    sql`SELECT * FROM deliverables WHERE id = ${deliverableId} AND org_id = ${actor.orgId}`,
    sql`SELECT id, number, files FROM rounds WHERE deliverable_id = ${deliverableId}
        ORDER BY number DESC LIMIT 1`,
  ]);
  if (!dRow) throw new AppError("Không tìm thấy sản phẩm bàn giao.", 404);
  const d = {
    id: dRow.id,
    order: dRow.order_id,
    type: dRow.type,
    url: dRow.url,
    status: dRow.status,
    files: JSON.parse(dRow.files),
  };
  assertCan(actor, "feedback.create", { orderId: d.order });
  if (d.status === "archived") {
    throw new AppError("Sản phẩm đã lưu trữ, khôi phục trước khi góp ý.", 400);
  }
  if (!roundRow) {
    throw new AppError(
      "Sản phẩm chưa có vòng review. Tạo link chia sẻ trước.",
      400
    );
  }
  const round = { ...roundRow, files: JSON.parse(roundRow.files) };
  if (input.visibility === "customer")
    await assertOrderOpenForCustomer(d.order);
  const placement = resolvePlacement(d, input, memberAllowedFiles(d, round));

  const findExisting = () =>
    first(sql`
      SELECT id, author_member_id FROM feedback
      WHERE deliverable_id = ${d.id} AND client_id = ${input.clientId}`);
  const replay = async (existing) => {
    if (existing.author_member_id !== actor.memberId) {
      throw new AppError("Mã góp ý này đã được dùng.", 409);
    }
    return { feedback: await teamViewById(existing.id), created: false };
  };
  const existing = await findExisting();
  if (existing) return replay(existing);

  const id = newId();
  const at = now();
  try {
    await transact(
      async () => ({
        statements: [
          // File được ghim phải còn thuộc sản phẩm lúc ghi (đồng nghiệp vừa gỡ hẳn file đó thì bài sẽ trỏ vào chỗ trống).
          ...(placement.target
            ? [
                guard(
                  sql`SELECT 1 FROM deliverables d, json_each(d.files) f
                      WHERE d.id = ${d.id} AND f.value ->> 'id' = ${placement.target.fileId}`,
                  "file"
                ),
              ]
            : []),
          bumpSeq(d.id),
          Feedback.insert({
            id,
            org: actor.orgId,
            order: d.order,
            deliverable: d.id,
            round: round.id,
            roundNumber: round.number,
            seq: currentSeq(d.id),
            clientId: input.clientId,
            authorKind: "member",
            authorName: actor.name,
            authorMember: actor.memberId,
            visibility: input.visibility,
            body: input.body,
            ...placementColumns(placement),
            status: "open",
            submittedAt: at,
            createdAt: at,
            updatedAt: at,
          }),
          auditStatement({
            actor,
            action: "feedback.create",
            entityType: "feedback",
            entityId: id,
            orderId: d.order,
            deliverableId: d.id,
            // Số thứ tự chỉ có lúc lô chạy: lấy bằng truy vấn con.
            after: sql`json_object('deliverable', ${d.id}, 'seq', ${currentSeq(d.id)}, 'visibility', ${input.visibility})`,
          }),
        ],
      }),
      { errors: { file: FILE_REPLACED } }
    );
  } catch (err) {
    // Hai request cùng clientId tới gần như cùng lúc: bên thua lấy bài bên thắng vừa tạo.
    if (uniqueViolationOf(err)) {
      const winner = await findExisting();
      if (winner) return replay(winner);
    }
    throw err;
  }
  notifyFeedback({
    deliverableId: d.id,
    feedbackId: id,
    kind: "created",
    visibility: input.visibility,
    actor,
  });
  return { feedback: await teamViewById(id), created: true };
}

/**
 * Người nhận việc được: không bị khóa, không phải người chỉ xem (viewer không xử lý được góp ý),
 * và là quản trị viên hoặc thuộc team của đơn. Dùng cả để kiểm trước lẫn làm guard trong lô.
 */
const assignableQuery = (orgId, orderId, memberId) => sql`
  SELECT 1 FROM members m
  WHERE m.id = ${memberId} AND m.org_id = ${orgId} AND m.status <> 'suspended' AND m.role <> 'viewer'
    AND (m.role = 'admin' OR EXISTS (
      SELECT 1 FROM order_members om WHERE om.order_id = ${orderId} AND om.member_id = m.id))`;

const isAssignable = async (orgId, orderId, memberId) =>
  Boolean(await first(assignableQuery(orgId, orderId, memberId)));

/**
 * Team xử lý: đổi trạng thái (open, in_progress, done) và giao người.
 * Bài khách đã xác nhận thì khóa lại. done ghi lại ai sửa, lúc nào; rời done thì xóa mốc đó.
 */
export async function triage(actor, id, input) {
  let touched = null;
  await transact(
    async () => {
      const fb = await findForMember(actor, id, "feedback.triage");
      if (fb.version !== input.version) throw STALE();
      if (fb.status === "confirmed") {
        throw new AppError(
          "Góp ý đã được khách xác nhận, không đổi được nữa.",
          409
        );
      }

      const at = now();
      const changes = {};
      if (input.status && input.status !== fb.status) {
        changes.status = input.status;
        if (input.status === "done") {
          changes.resolvedAt = at;
          changes.resolvedBy = actor.memberId;
        } else if (fb.status === "done") {
          changes.resolvedAt = null;
          changes.resolvedBy = null;
        }
      }
      const assigning =
        input.assigneeId !== undefined && input.assigneeId !== null;
      if (input.assigneeId !== undefined) {
        if (
          assigning &&
          !(await isAssignable(actor.orgId, fb.order, input.assigneeId))
        ) {
          throw new AppError(
            "Người được giao phải thuộc team của đơn và có quyền xử lý góp ý.",
            400
          );
        }
        changes.assignee = input.assigneeId;
      }
      const after = { ...fb, ...changes };

      return {
        statements: [
          guard(
            sql`SELECT 1 FROM feedback WHERE id = ${fb.id} AND version = ${input.version}`,
            "stale"
          ),
          // Người được giao vừa bị khóa hay bị gỡ khỏi đơn giữa lúc kiểm và lúc ghi: chạy lại, lần sau báo đúng lời.
          ...(assigning
            ? [guard(assignableQuery(actor.orgId, fb.order, input.assigneeId))]
            : []),
          sql`UPDATE feedback SET ${Feedback.set({ ...changes, updatedAt: at })}, version = version + 1
              WHERE id = ${fb.id}`,
          auditStatement({
            actor,
            action: "feedback.triage",
            entityType: "feedback",
            entityId: fb.id,
            orderId: fb.order,
            deliverableId: fb.deliverable,
            before: { status: fb.status, assignee: fb.assignee || null },
            after: {
              status: after.status,
              assignee: after.assignee || null,
              seq: fb.seq,
            },
          }),
        ],
        done: () => {
          touched = fb;
        },
      };
    },
    { errors: { stale: STALE } }
  );
  if (touched) {
    notifyFeedback({
      deliverableId: touched.deliverable,
      feedbackId: touched.id,
      kind: "status",
      visibility: touched.visibility,
      actor,
    });
  }
  return teamViewById(id);
}

/** Team trả lời. Trong bài "chỉ team" mọi trả lời đều là nội bộ; bài cho khách thì chọn được. */
export async function replyByMember(actor, id, input) {
  const fb = await findForMember(actor, id, "feedback.create");
  if ((fb.replies || []).length >= MAX_REPLIES) throw TOO_LONG();
  const toCustomer =
    fb.visibility !== "team" && input.visibility === "customer";
  if (toCustomer) await assertOrderOpenForCustomer(fb.order);
  const visibility = fb.visibility === "team" ? "team" : input.visibility;
  const { changes } = await run(
    appendReply(fb.id, {
      authorKind: "member",
      authorName: actor.name,
      authorMember: actor.memberId,
      visibility,
      body: input.body,
    })
  );
  if (changes === 0) throw await replyRejected(fb.id);
  notifyFeedback({
    deliverableId: fb.deliverable,
    feedbackId: fb.id,
    kind: "reply",
    visibility,
    actor,
  });
  return teamViewById(fb.id);
}

/**
 * Chỉ xóa được bài do team tạo; người viết tự xóa, hoặc quản trị viên, leader của đơn. Bài của khách thì không.
 * Bài khách đã trả lời hoặc đã xác nhận thì giữ lại: xóa là mất luôn lời của khách.
 */
export async function deleteByMember(actor, id) {
  const fb = await findForMember(actor, id, "feedback.delete");
  if (fb.authorKind !== "member") {
    throw new AppError("Chỉ xóa được góp ý do team tạo.", 403);
  }
  const isAuthor = fb.authorMember === actor.memberId;
  if (!isAuthor && !isLeaderOf(actor, fb.order)) {
    throw new AppError("Chỉ người viết hoặc leader của đơn mới xóa được.", 403);
  }
  const guestReplied = (fb.replies || []).some(
    (reply) => reply.authorKind === "guest"
  );
  if (guestReplied || fb.status === "confirmed") {
    throw new AppError(
      "Khách đã trả lời hoặc xác nhận góp ý này nên không xóa được nữa.",
      409
    );
  }
  await transact(
    async () => ({
      statements: [
        // Có điều kiện theo version: khách vừa trả lời trong lúc này thì không xóa mất lời của họ.
        guard(
          sql`SELECT 1 FROM feedback WHERE id = ${fb.id} AND version = ${fb.version}`,
          "stale"
        ),
        sql`DELETE FROM feedback WHERE id = ${fb.id}`,
        auditStatement({
          actor,
          action: "feedback.delete",
          entityType: "feedback",
          entityId: fb.id,
          orderId: fb.order,
          deliverableId: fb.deliverable,
          before: { seq: fb.seq, visibility: fb.visibility, body: fb.body },
        }),
        storage.trashStatement([fb.screenshot]),
      ],
    }),
    { errors: { stale: STALE } }
  );
  notifyFeedback({
    deliverableId: fb.deliverable,
    feedbackId: fb.id,
    kind: "deleted",
    visibility: fb.visibility,
    actor,
  });
  if (fb.screenshot?.key) storage.emptyTrashSoon();
}
