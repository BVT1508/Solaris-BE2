import { binding } from "../config/runtime.js";
import { runAfterResponse } from "./background.js";

/**
 * Báo trực tiếp cho các màn đang mở khi góp ý của một sản phẩm thay đổi (có trả lời mới, đổi trạng thái...).
 *
 * Chỉ BÁO, không gửi nội dung: mỗi tin là "bài X của sản phẩm Y vừa có thay đổi loại Z". Trình duyệt nhận được thì gọi lại
 * API đang có để lấy dữ liệu, nên quyền xem vẫn quyết ở một chỗ (policy và bản cho khách của feedbackService) và
 * ghi chú nội bộ không có đường nào lọt sang khách.
 *
 * Kết nối WebSocket nằm trong Durable Object RealtimeHub (src/realtime/realtimeHub.js); file này chỉ gọi sang đó.
 * Mọi hàm ở đây chạy SAU khi đã trả lời người dùng và nuốt lỗi: báo trực tiếp là phần thêm, không báo được thì
 * người dùng tải lại vẫn thấy. Gọi sau khi `transact` xong, không gọi trong hàm `plan` (plan có thể chạy lại).
 * File này không import service nào, để service gọi được mà không tạo vòng import.
 */
const SOCKET_ID = /^[A-Za-z0-9_-]{10,40}$/;

const hub = () => {
  const namespace = binding("REALTIME");
  return namespace.get(namespace.idFromName("hub"));
};

/**
 * Mã kết nối trực tiếp của chính tab đang gọi API (header X-Socket-Id). Có mã này thì sự kiện do request đó gây ra
 * không báo ngược lại cho chính nó: nó đã có kết quả trong response.
 */
export const socketIdOf = (c) => {
  const id = c.req.header("x-socket-id");
  return typeof id === "string" && SOCKET_ID.test(id) ? id : null;
};

/**
 * Báo một thay đổi trên góp ý của sản phẩm.
 *   kind        "reply" (có trả lời mới), "status" (đổi trạng thái hoặc người nhận), "verdict" (khách xác nhận hoặc từ chối),
 *               "created", "deleted", "submitted" (khách gửi góp ý của vòng), "approved" (khách duyệt), "round" (mở vòng mới).
 *   visibility  "team": chỉ phía team. "customer": cả team lẫn khách.
 *   actor       người gây ra (actor của request). Phía khách không nhận tên hay id của thành viên.
 */
export function notifyFeedback({
  deliverableId,
  feedbackId,
  kind,
  visibility,
  actor,
}) {
  if (!deliverableId) return;
  const event = {
    deliverableId: String(deliverableId),
    feedbackId: feedbackId ? String(feedbackId) : null,
    kind,
    visibility,
    at: new Date().toISOString(),
    actor: {
      kind: actor?.kind || "system",
      memberId: actor?.memberId ? String(actor.memberId) : null,
      name: actor?.name || null,
    },
  };
  const exceptSocketId = actor?.socketId || null;
  runAfterResponse(() => hub().publish(event, exceptSocketId), "báo trực tiếp");
}

/**
 * Ngắt mọi kết nối của một thành viên khi quyền của họ vừa đổi (bị khóa, bị gỡ khỏi đơn, đổi vai trò, đăng xuất).
 * Trình duyệt còn phiên thì nối lại và xin theo dõi lại; lúc đó quyền mới được kiểm.
 */
export function disconnectMember(memberId) {
  runAfterResponse(
    () => hub().disconnect(`m:${memberId}`),
    "ngắt kết nối thành viên"
  );
}

/** Ngắt mọi kết nối của khách đang dùng một link (khi link bị thu hồi). */
export function disconnectLink(shareLinkId) {
  runAfterResponse(
    () => hub().disconnect(`l:${shareLinkId}`),
    "ngắt kết nối link"
  );
}

/** Ngắt mọi khách đang nghe một sản phẩm (khi sản phẩm bị lưu trữ: link của nó ngừng chia sẻ). */
export function disconnectGuestsOf(deliverableId) {
  runAfterResponse(
    () => hub().disconnect(`g:${deliverableId}`),
    "ngắt kết nối khách"
  );
}
