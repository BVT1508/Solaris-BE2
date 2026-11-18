import AppError from "../utils/appError.js";

/**
 * Nơi duy nhất quyết định quyền. Controller và service gọi can() hoặc assertCan().
 * Chép nguyên logic từ policies/policy.js của backend cũ.
 *
 * actor (gắn ở authCtrl.protect):
 *   { kind: "member", memberId, orgId, email, name, role, isOwner, orderIds: Set, leadOrderIds: Set }
 *   { kind: "guest", deliverableId, orderId, shareLinkId }
 *
 * resource: { orderId } cho việc trong một đơn hàng.
 *
 * Trong một đơn có ba mức:
 *   leader   quản lý (vai trò manager) ở mọi đơn mình tham gia, hoặc nhân viên được chọn làm leader của đúng đơn đó.
 *            Duyệt việc của team rồi gửi cho khách.
 *   staff    nhân viên: xử lý góp ý, thêm, thay, gỡ file của sản phẩm. Không tự gửi cho khách.
 *   viewer   chỉ xem.
 * Quản trị viên làm được mọi việc ở mọi đơn.
 */

// Việc cấp tổ chức: chỉ admin.
const ORG_ACTIONS = new Set([
  "org.manage",
  "member.manage",
  "client.manage",
  "order.create",
]);

const READ_ACTIONS = [
  "order.read",
  "deliverable.read",
  "feedback.read",
  "feedback.readTeamOnly",
];
// Việc của người làm: góp ý, file của sản phẩm, bộ ảnh trang của vòng (trình duyệt của team tự chụp).
const WORK_ACTIONS = [
  "feedback.create",
  "feedback.triage",
  "feedback.delete",
  "deliverable.files",
  "round.pages",
];
// Việc của leader: thông tin đơn và sản phẩm, team của đơn, link chia sẻ, gửi khách xem lại (mở vòng), bàn giao.
const LEAD_ACTIONS = [
  "order.update",
  "order.team",
  "deliverable.create",
  "deliverable.update",
  "shareLink.manage",
  "round.create",
];

// Chỉ admin (không nằm trong bảng nào): deliverable.archive, deliverable.rotateKey.
const ORDER_ACTIONS_BY_LEVEL = {
  leader: new Set([...READ_ACTIONS, ...WORK_ACTIONS, ...LEAD_ACTIONS]),
  staff: new Set([...READ_ACTIONS, ...WORK_ACTIONS]),
  viewer: new Set(READ_ACTIONS),
};

// Khách chỉ đọc và gửi góp ý trên đúng sản phẩm của link; không bao giờ thấy bài "Chỉ team".
const GUEST_ACTIONS = new Set([
  "deliverable.read",
  "feedback.read",
  "feedback.create",
]);

/** Mức của một thành viên (không phải admin) trong đơn mình tham gia. */
const levelIn = (actor, orderId) => {
  if (actor.role === "manager") return "leader";
  if (actor.role === "staff") {
    return actor.leadOrderIds?.has(orderId) ? "leader" : "staff";
  }
  return "viewer";
};

/** Người gọi có phải leader của đơn không (admin cũng tính). Dùng khi luật cần phân biệt leader với nhân viên. */
export const isLeaderOf = (actor, orderId) => {
  if (!actor || actor.kind !== "member") return false;
  if (actor.role === "admin") return true;
  const id = String(orderId);
  return actor.orderIds.has(id) && levelIn(actor, id) === "leader";
};

/** Mức của người gọi trong một đơn: "leader" (kể cả admin), "staff", "viewer", hoặc null khi không thuộc đơn. */
export const levelOf = (actor, orderId) => {
  if (!actor || actor.kind !== "member") return null;
  if (actor.role === "admin") return "leader";
  const id = String(orderId);
  return actor.orderIds.has(id) ? levelIn(actor, id) : null;
};

export const can = (actor, action, resource = {}) => {
  if (!actor) return false;

  if (actor.kind === "guest") {
    return (
      GUEST_ACTIONS.has(action) &&
      resource.deliverableId !== undefined &&
      String(resource.deliverableId) === String(actor.deliverableId)
    );
  }

  if (actor.role === "admin") return true;
  if (ORG_ACTIONS.has(action)) return false;

  const orderId = resource.orderId ? String(resource.orderId) : null;
  if (!orderId || !actor.orderIds.has(orderId)) return false;
  return ORDER_ACTIONS_BY_LEVEL[levelIn(actor, orderId)].has(action);
};

export const assertCan = (actor, action, resource) => {
  if (!can(actor, action, resource)) {
    throw new AppError("Bạn không có quyền làm việc này.", 403);
  }
};
