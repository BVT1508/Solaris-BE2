import { all, first, readAll, sql } from "../db/d1.js";
import { AuditLog } from "../models/index.js";
import { assertCan, levelOf } from "../policies/policy.js";
import AppError from "../utils/appError.js";
import { beforeCursor, pageOf } from "../utils/pagination.js";

/**
 * "Hoạt động" của một đơn: ai đã làm gì, đọc từ bảng audit_logs (mỗi thao tác ghi nhật ký trong cùng lô với nó).
 *
 * Mỗi vai trò thấy một phần khác nhau, lọc ngay ở truy vấn:
 *   leader (và quản trị viên)  mọi thứ trong đơn, kể cả đổi team, đổi leader, link chia sẻ.
 *   nhân viên                  việc làm hằng ngày: sản phẩm, file, góp ý, giao việc, các lần gửi khách.
 *   người chỉ xem              chỉ các mốc: tạo đơn, gửi khách, khách gửi góp ý, khách duyệt, bàn giao, mở lại.
 *
 * Bảng dưới: hành động -> [nhóm, mức thấp nhất được thấy]. Hành động không có trong bảng thì không hiện
 * (ví dụ round.pages: trình duyệt tự chụp ảnh trang, không phải việc ai làm).
 */
const ACTIONS = {
  "order.create": ["order", "viewer"],
  "order.update": ["order", "leader"],
  "order.setMembers": ["team", "leader"],
  "order.deliver": ["order", "viewer"],
  "order.reopen": ["order", "viewer"],
  "deliverable.create": ["product", "staff"],
  "deliverable.update": ["product", "staff"],
  "deliverable.archive": ["product", "staff"],
  "deliverable.restore": ["product", "staff"],
  "deliverable.rotateKey": ["product", "leader"],
  "deliverable.fileAdd": ["file", "staff"],
  "deliverable.fileRemove": ["file", "staff"],
  "shareLink.create": ["link", "viewer"],
  "shareLink.update": ["link", "leader"],
  "shareLink.pause": ["link", "leader"],
  "shareLink.resume": ["link", "leader"],
  "shareLink.revoke": ["link", "leader"],
  "round.open": ["round", "viewer"],
  "round.submit": ["round", "viewer"],
  "round.approve": ["round", "viewer"],
  "round.refresh": ["round", "staff"],
  "feedback.create": ["feedback", "staff"],
  "feedback.triage": ["feedback", "staff"],
  "feedback.delete": ["feedback", "staff"],
  "feedback.accept": ["feedback", "staff"],
  "feedback.reject": ["feedback", "staff"],
};

export const ACTIVITY_CATEGORIES = [
  "order",
  "team",
  "product",
  "file",
  "link",
  "round",
  "feedback",
];

const RANK = { viewer: 0, staff: 1, leader: 2 };

/** Các hành động một mức được thấy, thu hẹp theo nhóm nếu có. */
const visibleActions = (level, category) =>
  Object.entries(ACTIONS)
    .filter(
      ([, [group, min]]) =>
        RANK[level] >= RANK[min] && (!category || group === category)
    )
    .map(([action]) => action);

// ---------- Viết thành câu ----------

const ORDER_FIELDS = {
  title: "tiêu đề",
  description: "mô tả",
  deadline: "hạn",
  notes: "ghi chú",
  status: "trạng thái",
};
const DELIVERABLE_FIELDS = { name: "tên", url: "địa chỉ site" };

const quote = (text) => `«${text}»`;
const listOf = (items) => items.join(", ");
const labels = (changes, dict) =>
  Object.keys(changes || {})
    .map((key) => dict[key])
    .filter(Boolean);

/** Người thêm vào và người bị bỏ ra giữa hai danh sách id. */
const diff = (before = [], after = []) => {
  const was = new Set(before.map(String));
  const now = new Set(after.map(String));
  return {
    added: [...now].filter((id) => !was.has(id)),
    removed: [...was].filter((id) => !now.has(id)),
  };
};

function describeTeam(log, ctx) {
  const names = (ids) => listOf(ids.map((id) => ctx.memberName(id)));
  const members = diff(log.before?.members, log.after?.members);
  const leaders = diff(log.before?.leaders, log.after?.leaders);
  const parts = [];
  if (members.added.length) parts.push(`thêm ${names(members.added)}`);
  if (members.removed.length) parts.push(`gỡ ${names(members.removed)}`);
  if (leaders.added.length) {
    parts.push(`chọn ${names(leaders.added)} làm leader`);
  }
  // Người bị gỡ khỏi team thì đương nhiên thôi leader: không nhắc lại.
  const demoted = leaders.removed.filter((id) => !members.removed.includes(id));
  if (demoted.length) parts.push(`bỏ leader ${names(demoted)}`);
  return parts.length
    ? `cập nhật team: ${parts.join("; ")}`
    : "cập nhật team của đơn";
}

function describeTriage(log, ctx, feedback) {
  const before = log.before || {};
  const after = log.after || {};
  const parts = [];
  if (String(before.assignee || "") !== String(after.assignee || "")) {
    if (!after.assignee) parts.push(`bỏ giao ${feedback}`);
    else if (String(after.assignee) === String(log.actorMember || "")) {
      parts.push(`nhận ${feedback}`);
    } else {
      parts.push(`giao ${feedback} cho ${ctx.memberName(after.assignee)}`);
    }
  }
  if (before.status !== after.status) {
    const first = parts.length === 0;
    if (after.status === "in_progress") {
      parts.push(first ? `bắt đầu làm ${feedback}` : "chuyển sang đang làm");
    } else if (after.status === "done") {
      parts.push(first ? `báo đã sửa ${feedback}` : "báo đã sửa");
    } else if (after.status === "open") {
      parts.push(first ? `đưa ${feedback} về chưa làm` : "đưa về chưa làm");
    }
  }
  return parts.length ? parts.join(" và ") : `cập nhật ${feedback}`;
}

function describeFileAdd(log, product) {
  const after = log.after || {};
  const name = after.originalName ? `file ${quote(after.originalName)}` : null;
  const replaced = after.replaced || [];
  if (replaced.length === 0) {
    return `thêm ${name || "một file"} vào ${product}`;
  }
  const oldNames = (after.replacedNames || []).filter(Boolean);
  const old = oldNames.length
    ? `file ${listOf(oldNames.map(quote))}`
    : "file đang dùng";
  return `thay ${old} bằng ${name || "file mới"} ở ${product}`;
}

function describeSubmit(log, product) {
  const { number, feedback = 0, reopened = 0 } = log.after || {};
  const where = `ở vòng ${number} của ${product}`;
  if (feedback > 0 && reopened > 0) {
    return `gửi ${feedback} góp ý mới và ${reopened} góp ý cần sửa tiếp ${where}`;
  }
  if (feedback > 0) return `gửi ${feedback} góp ý ${where}`;
  return `báo ${reopened} góp ý cần sửa tiếp ${where}`;
}

/** Phần vị ngữ của câu (không gồm tên người làm): giao diện ghép "<người làm> <text>". */
function describe(log, ctx) {
  const product = ctx.deliverableName(log.deliverable);
  const seq = log.after?.seq ?? log.before?.seq ?? ctx.feedbackSeq(log);
  const feedback = seq ? `góp ý #${seq}` : "một góp ý";
  const contact = ctx.contactName(log);

  switch (log.action) {
    case "order.create":
      return "tạo đơn";
    case "order.update": {
      const fields = labels(log.after, ORDER_FIELDS);
      return fields.length
        ? `sửa thông tin đơn (${listOf(fields)})`
        : "sửa thông tin đơn";
    }
    case "order.setMembers":
      return describeTeam(log, ctx);
    case "order.deliver":
      return "bàn giao đơn";
    case "order.reopen":
      return "mở lại đơn";
    case "deliverable.create":
      return `thêm sản phẩm ${product}`;
    case "deliverable.update": {
      const fields = labels(log.after, DELIVERABLE_FIELDS);
      return fields.length
        ? `sửa sản phẩm ${product} (${listOf(fields)})`
        : `sửa sản phẩm ${product}`;
    }
    case "deliverable.archive":
      return `lưu trữ sản phẩm ${product}`;
    case "deliverable.restore":
      return `khôi phục sản phẩm ${product}`;
    case "deliverable.rotateKey":
      return `đổi khóa nhúng của ${product}`;
    case "deliverable.fileAdd":
      return describeFileAdd(log, product);
    case "deliverable.fileRemove":
      return log.before?.originalName
        ? `gỡ file ${quote(log.before.originalName)} khỏi ${product}`
        : `gỡ một file khỏi ${product}`;
    case "shareLink.create":
      return log.after?.openedRound
        ? `tạo link cho ${contact} và gửi ${product} cho khách (vòng ${log.after.openedRound})`
        : `tạo link cho ${contact} ở ${product}`;
    case "shareLink.update":
      return `sửa link của ${contact} ở ${product}`;
    case "shareLink.pause":
      return `tạm dừng link của ${contact} ở ${product}`;
    case "shareLink.resume":
      return `bật lại link của ${contact} ở ${product}`;
    case "shareLink.revoke":
      return `thu hồi link của ${contact} ở ${product}`;
    case "round.open":
      return `gửi ${product} cho khách xem lại (vòng ${log.after?.number})`;
    case "round.submit":
      return describeSubmit(log, product);
    case "round.approve":
      return `duyệt ${product} (vòng ${log.after?.number})`;
    case "round.refresh":
      return `cập nhật bản đang gửi của ${product}`;
    case "feedback.create":
      return log.after?.visibility === "customer"
        ? `thêm ${feedback} cho khách thấy ở ${product}`
        : `thêm ghi chú nội bộ #${seq} ở ${product}`;
    case "feedback.triage":
      return describeTriage(log, ctx, feedback);
    case "feedback.delete":
      return `xóa ghi chú #${seq} ở ${product}`;
    case "feedback.accept":
      return `xác nhận ${feedback} đã đúng`;
    case "feedback.reject":
      return `báo ${feedback} cần sửa tiếp`;
    default:
      return log.action;
  }
}

// ---------- Tra tên cho cả trang trong một lượt đi về ----------

const idsOf = (values) => [...new Set(values.filter(Boolean).map(String))];

const byId = (rows) => new Map(rows.map((row) => [row.id, row]));

async function loadContext(logs) {
  const memberIds = idsOf(
    logs.flatMap((log) => [
      log.after?.assignee,
      ...(log.action === "order.setMembers"
        ? [
            ...(log.before?.members || []),
            ...(log.after?.members || []),
            ...(log.before?.leaders || []),
            ...(log.after?.leaders || []),
          ]
        : []),
    ])
  );
  const entityIds = (type) =>
    idsOf(
      logs.filter((log) => log.entityType === type).map((log) => log.entityId)
    );
  // Danh sách rỗng thì câu IN không trả dòng nào: gom cả bốn câu vào một lượt cho gọn.
  const [members, deliverables, feedbacks, links] = await readAll([
    sql`SELECT id, name FROM members WHERE id IN ${sql.list(memberIds)}`,
    sql`SELECT id, name FROM deliverables
        WHERE id IN ${sql.list(idsOf(logs.map((log) => log.deliverable)))}`,
    sql`SELECT id, seq FROM feedback WHERE id IN ${sql.list(entityIds("feedback"))}`,
    sql`SELECT id, contact_name FROM share_links
        WHERE id IN ${sql.list(entityIds("shareLink"))}`,
  ]);
  const memberMap = byId(members);
  const deliverableMap = byId(deliverables);
  const feedbackMap = byId(feedbacks);
  const linkMap = byId(links);

  return {
    memberName: (id) => memberMap.get(String(id))?.name || "một thành viên",
    deliverable: (id) => (id ? deliverableMap.get(String(id)) || null : null),
    deliverableName: (id) => {
      const name = id && deliverableMap.get(String(id))?.name;
      return name ? quote(name) : "sản phẩm";
    },
    feedbackSeq: (log) =>
      log.entityType === "feedback"
        ? feedbackMap.get(String(log.entityId))?.seq || null
        : null,
    contactName: (log) =>
      log.after?.contactName ||
      linkMap.get(String(log.entityId))?.contact_name ||
      "khách",
  };
}

const toPublic = (log, ctx) => {
  const [category, minLevel] = ACTIONS[log.action];
  const deliverable = ctx.deliverable(log.deliverable);
  const seq =
    log.entityType === "feedback"
      ? (log.after?.seq ?? log.before?.seq ?? ctx.feedbackSeq(log))
      : null;
  return {
    id: log.id,
    at: log.at,
    action: log.action,
    category,
    // Mốc của đơn (ai trong đơn cũng thấy): giao diện làm nổi, dùng để chia dòng thời gian theo từng lần gửi khách.
    milestone: minLevel === "viewer",
    actor: {
      kind: log.actorKind,
      memberId: log.actorMember || null,
      name:
        log.actorLabel || (log.actorKind === "guest" ? "Khách" : "Hệ thống"),
    },
    deliverable: deliverable
      ? { id: deliverable.id, name: deliverable.name }
      : null,
    // Bài đã bị xóa thì id vẫn còn nhưng không mở được nữa.
    feedback:
      log.entityType === "feedback" && log.action !== "feedback.delete"
        ? { id: log.entityId, seq }
        : null,
    text: describe(log, ctx),
  };
};

/**
 * Hoạt động của một đơn, mới nhất trước, phân trang con trỏ. Ai trong đơn cũng gọi được, mỗi mức thấy một phần (xem đầu file).
 * query: category (một nhóm), deliverableId, memberId (người làm), limit, cursor.
 */
export async function listForOrder(actor, orderId, query = {}) {
  assertCan(actor, "order.read", { orderId });
  const exists = await first(
    sql`SELECT 1 FROM orders WHERE id = ${orderId} AND org_id = ${actor.orgId}`
  );
  if (!exists) throw new AppError("Không tìm thấy đơn hàng.", 404);

  const level = levelOf(actor, orderId);
  const where = [
    sql`order_id = ${orderId}`,
    sql`action IN ${sql.list(visibleActions(level, query.category))}`,
  ];
  if (query.deliverableId) {
    where.push(sql`deliverable_id = ${query.deliverableId}`);
  }
  if (query.memberId) where.push(sql`actor_member_id = ${query.memberId}`);
  where.push(...beforeCursor(query));

  const rows = await all(sql`
    SELECT * FROM audit_logs WHERE ${sql.and(where)}
    ORDER BY id DESC LIMIT ${query.limit + 1}`);
  const { items, nextCursor } = pageOf(rows, query.limit);
  const logs = items.map((row) => AuditLog.fromRow(row));
  const ctx = await loadContext(logs);
  return { activity: logs.map((log) => toPublic(log, ctx)), nextCursor };
}
