import { checkUsage } from "../services/usageService.js";

/**
 * Việc định kỳ của phần cảnh báo hạn mức gói miễn phí. Mỗi phần tử là [tên việc, hàm async trả kết quả để ghi log].
 *   hourlyJobs  kiểm mức dùng trong ngày; ngưỡng 70% hoặc 90% mới vượt thì ghi nhận và gửi email cho chủ hệ thống
 */
export const hourlyJobs = [["kiểm hạn mức gói miễn phí", checkUsage]];
