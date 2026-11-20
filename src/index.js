import app from "./app.js";
import { countOutcome, countRequest } from "./db/usageCounter.js";
import { runScheduled } from "./jobs/index.js";
import { scheduleUsageFlush } from "./services/usageService.js";
// Làm nóng lúc nạp module: chạy thử các request mẫu qua cả app trước khi nhận request thật (xem warmup.js).
import "./warmup.js";

/**
 * Điểm vào của Worker.
 *   fetch       request tới /api/*, và request không khớp file tĩnh nào (xem "assets" trong wrangler.jsonc)
 *   scheduled   việc định kỳ theo Cron Triggers
 *   RealtimeHub Durable Object giữ kết nối trực tiếp của màn góp ý
 */
export default {
  async fetch(request, env, ctx) {
    // Đếm mức dùng gói miễn phí: cộng một số trong bộ nhớ và hẹn ghi xuống D1 sau response (services/usageService.js).
    countRequest();
    scheduleUsageFlush();
    const response = await app.fetch(request, env, ctx);
    // Phân loại người gọi (thành viên, khách, không danh tính) và mã trả về cho biểu đồ của trang hạ tầng.
    countOutcome(request, response.status);
    return response;
  },

  async scheduled(controller, _env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron));
  },
};

export { RealtimeHub } from "./realtime/realtimeHub.js";
