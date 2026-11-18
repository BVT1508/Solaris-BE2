import { purgeDeliveredVersions } from "../services/maintenanceService.js";

/**
 * Gói Y4: việc định kỳ của vòng review. Mỗi phần tử là [tên việc, hàm async trả kết quả để ghi log].
 *   sixHourlyJobs  dọn bản cũ của đơn đã bàn giao quá 30 ngày, chỉ giữ bản cuối
 * File thừa chỉ được ghi vào thùng rác của kho; việc dọn thùng rác (gói X2, mỗi giờ) mới xóa trên kho.
 */
export const sixHourlyJobs = [
  [
    "dọn bản cũ của đơn đã bàn giao",
    async () => ({ files: await purgeDeliveredVersions() }),
  ],
];
