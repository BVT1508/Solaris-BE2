import { checkUsage, purgeOldUsage } from "../services/usageService.js";

/**
 * Việc định kỳ của phần cảnh báo hạn mức gói miễn phí. Mỗi phần tử là [tên việc, hàm async trả kết quả để ghi log].
 *   hourlyJobs  kiểm mức dùng trong ngày: ngưỡng 70%, 90% hoặc ngưỡng tạm ngừng mới vượt thì ghi nhận và gửi email;
 *               bỏ số đếm theo giờ cũ hơn 14 ngày, số đếm theo ngày và cảnh báo cũ hơn 400 ngày
 */
export const hourlyJobs = [
  ["kiểm hạn mức gói miễn phí", checkUsage],
  ["dọn số đếm mức dùng cũ", purgeOldUsage],
];
