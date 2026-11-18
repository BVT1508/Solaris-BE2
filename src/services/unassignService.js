import { sql } from "../db/d1.js";
import { now } from "../utils/time.js";

/**
 * Câu lệnh bỏ giao các góp ý còn dang dở của những người vừa mất quyền (bị khóa, bị gỡ khỏi đơn, bị hạ vai trò).
 * Đặt vào cùng lô `transact` với thao tác làm mất quyền. Backend cũ để hàm này trong feedbackService; tách ra file riêng
 * vì thành viên và đơn hàng (làm trước) cũng cần, không phải chờ gói góp ý.
 *
 *   orderId          chỉ trong đơn đó; bỏ trống: mọi đơn.
 *   exceptOrderIds   giữ nguyên việc ở các đơn này (người bị hạ vai trò vẫn còn trong team của chúng).
 * Không còn ai nhận thì không thể là "đang làm": bài về open để nằm đúng hàng "chưa giao".
 * memberIds rỗng thì câu lệnh không đổi dòng nào.
 */
export const unassignOpenWorkStatement = ({
  memberIds,
  orderId,
  exceptOrderIds,
}) => {
  const where = [
    sql`assignee_id IN ${sql.list(memberIds || [])}`,
    sql`status IN ('open', 'in_progress')`,
  ];
  if (orderId) where.push(sql`order_id = ${orderId}`);
  if (exceptOrderIds?.length) {
    where.push(sql`order_id NOT IN ${sql.list(exceptOrderIds)}`);
  }
  return sql`
    UPDATE feedback SET status = 'open', assignee_id = NULL, version = version + 1, updated_at = ${now()}
    WHERE ${sql.and(where)}`;
};
