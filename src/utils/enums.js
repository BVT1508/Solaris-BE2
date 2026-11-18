// Enum dùng chung cho validator, service và policy. Frontend giữ bản nhãn tiếng Việt riêng.
// Chép nguyên từ backend cũ; các ràng buộc CHECK trong migrations/0001_init.sql phải khớp với file này.

/** Vai trò cấp tổ chức. admin thấy mọi đơn hàng; vai trò khác chỉ thấy đơn hàng được giao. */
export const ROLES = ["admin", "manager", "staff", "viewer"];

export const MEMBER_STATUSES = ["invited", "active", "suspended"];

/** Kỹ năng để gợi ý và tự động giao góp ý. Tách khỏi vai trò (quyền). */
export const SKILLS = ["design", "frontend", "backend", "content", "qa", "seo"];

export const SKILL_LEVELS = ["primary", "secondary"];

export const ACTOR_KINDS = ["member", "guest", "system"];

/** Khách đến từ đâu, để marketing lọc. */
export const CLIENT_SOURCES = [
  "outreach",
  "referral",
  "returning",
  "inbound",
  "other",
];

/** Loại đơn hàng: khách đặt làm gì. */
export const ORDER_TYPES = ["web", "print", "video", "other"];

/**
 * Trạng thái đơn hàng. Team đặt tay được received và in_progress;
 * các trạng thái sau suy ra từ vòng review của deliverable.
 */
export const ORDER_STATUSES = [
  "received",
  "in_progress",
  "awaiting_feedback",
  "revising",
  "approved",
  "delivered",
];
export const MANUAL_ORDER_STATUSES = ["received", "in_progress"];

/** Sản phẩm bàn giao trong đơn: web nhúng bridge; design, document là file. */
export const DELIVERABLE_TYPES = ["web", "design", "document"];

/** Không xóa cứng sản phẩm, chỉ lưu trữ. */
export const DELIVERABLE_STATUSES = ["active", "archived"];

/** Link chia sẻ: active xem và góp ý; paused xem được, không gửi được; revoked chết hẳn. */
export const SHARE_LINK_STATUSES = ["active", "paused", "revoked"];

/** Vòng review: open khách đang góp ý; submitted khách đã gửi về, team sửa; approved khách duyệt. */
export const ROUND_STATUSES = ["open", "submitted", "approved"];

/**
 * Góp ý. draft: khách đang soạn, chỉ máy đó thấy. open: đã gửi cho team. in_progress: đang sửa.
 * done: team báo đã sửa, chờ khách xem. confirmed: khách xác nhận "Đã đúng" (hoặc duyệt cả sản phẩm).
 * Khách bấm "Cần sửa tiếp" thì done quay về open.
 */
export const FEEDBACK_STATUSES = [
  "draft",
  "open",
  "in_progress",
  "done",
  "confirmed",
];

/** Trạng thái team đặt được khi xử lý góp ý. */
export const TRIAGE_STATUSES = ["open", "in_progress", "done"];

/** Khách xác nhận một góp ý đã sửa: accepted là "Đã đúng", rejected là "Cần sửa tiếp". */
export const VERDICTS = ["accepted", "rejected"];

/** customer: khách và team cùng thấy. team: chỉ team, không bao giờ tới khách. */
export const FEEDBACK_VISIBILITIES = ["customer", "team"];

/** Loại phần tử trên site mà người góp ý đã chọn (bridge nhận ra). */
export const ANCHOR_ELEMENT_KINDS = [
  "text",
  "image",
  "button",
  "link",
  "input",
  "video",
  "block",
];

/** Cách đánh dấu trên ảnh hoặc trang: ghim điểm, khoanh vùng, vẽ tự do. */
export const MARK_KINDS = ["pin", "region", "stroke"];
