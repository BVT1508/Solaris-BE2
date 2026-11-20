/**
 * Kết quả của việc làm nóng lúc nạp module (src/warmup.js ghi vào, trang hạ tầng đọc ra).
 * Để riêng một file không import gì: warmup.js import cả app, nên service không import ngược warmup.js được.
 *   requests  số request mẫu đã chạy
 *   stale     các request mẫu lệch bản ghi (không còn được làm nóng trọn vẹn)
 */
export const warmupReport = { requests: 0, stale: [] };
