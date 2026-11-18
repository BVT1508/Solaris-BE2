import { guard, sql } from "../db/d1.js";
import { MANUAL_ORDER_STATUSES } from "../utils/enums.js";
import { now } from "../utils/time.js";

/**
 * Trạng thái đơn suy ra từ vòng review. Đặt câu lệnh này vào lô của `transact`, SAU các câu đổi vòng hoặc sản phẩm:
 * nó chạy trong cùng lô nên thấy đúng dữ liệu vừa đổi, và cả lô là nguyên tử nên không còn cảnh hai giao dịch
 * cùng tính trên bản chụp cũ (backend cũ phải ghi statusSyncedAt lên đơn để ép hai giao dịch đụng nhau; ở đây bỏ).
 *
 * Chỉ xét vòng mới nhất của từng sản phẩm đang hoạt động:
 *   - có sản phẩm khách đã gửi góp ý (submitted): revising, team có việc phải sửa;
 *   - không thì có sản phẩm đang chờ khách (open): awaiting_feedback;
 *   - mọi sản phẩm đang hoạt động đều có vòng và đều đã được duyệt: approved;
 *   - còn lại: đơn đang ở trạng thái đặt tay (received, in_progress) thì giữ nguyên, không thì về in_progress.
 * Đơn đã bàn giao (delivered) thì không đổi nữa. Trạng thái đổi thì version của đơn tăng 1.
 *
 * Câu lệnh có RETURNING status: trong `done`, lấy trạng thái mới bằng `orderStatusOf(results[i])`.
 */
export const syncOrderStatusStatement = (orderId) => sql`
  WITH latest AS (
    SELECT r.status FROM rounds r JOIN deliverables d ON d.id = r.deliverable_id
    WHERE d.order_id = ${orderId} AND d.status = 'active'
      AND r.number = (SELECT MAX(number) FROM rounds WHERE deliverable_id = r.deliverable_id)
  )
  UPDATE orders SET
    status = computed.next,
    version = orders.version + (computed.next <> orders.status),
    updated_at = CASE WHEN computed.next <> orders.status THEN ${now()} ELSE orders.updated_at END
  FROM (
    SELECT CASE
      WHEN EXISTS (SELECT 1 FROM latest WHERE status = 'submitted') THEN 'revising'
      WHEN EXISTS (SELECT 1 FROM latest WHERE status = 'open') THEN 'awaiting_feedback'
      WHEN (SELECT count(*) FROM latest) > 0
        AND (SELECT count(*) FROM latest) =
            (SELECT count(*) FROM deliverables WHERE order_id = ${orderId} AND status = 'active')
        AND NOT EXISTS (SELECT 1 FROM latest WHERE status <> 'approved') THEN 'approved'
      WHEN o.status IN ('received', 'in_progress') THEN o.status
      ELSE 'in_progress'
    END AS next
    FROM orders o WHERE o.id = ${orderId}
  ) AS computed
  WHERE orders.id = ${orderId} AND orders.status <> 'delivered'
  RETURNING status`;

/** Trạng thái đơn sau câu lệnh trên. Không có dòng trả về nghĩa là đơn đã bàn giao (câu lệnh bỏ qua đơn đó). */
export const orderStatusOf = (result) => result.rows[0]?.status || "delivered";

/** Đơn đang theo vòng review thì team không đặt tay trạng thái được nữa. */
export const isManualStatus = (status) =>
  MANUAL_ORDER_STATUSES.includes(status);

/**
 * Guard cho lô: đơn chưa bàn giao. Đơn đã bàn giao là đã đóng: không thêm sản phẩm, không tạo link, không mở vòng.
 * Hàm `plan` đã đọc đơn và ném 409 "Đơn đã bàn giao. Mở lại đơn trước khi làm tiếp." nếu cần; guard này chỉ chặn trường hợp
 * đơn vừa được bàn giao giữa lúc đọc và lúc ghi (không đặt nhãn: `transact` chạy lại `plan`, lần sau ra đúng lời báo).
 */
export const orderNotDeliveredGuard = (orderId) =>
  guard(
    sql`SELECT 1 FROM orders WHERE id = ${orderId} AND status <> 'delivered'`
  );
