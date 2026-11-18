import app from "./app.js";
import { runScheduled } from "./jobs/index.js";

/**
 * Điểm vào của Worker.
 *   fetch       request tới /api/*, và request không khớp file tĩnh nào (xem "assets" trong wrangler.jsonc)
 *   scheduled   việc định kỳ theo Cron Triggers
 *   RealtimeHub Durable Object giữ kết nối trực tiếp của màn góp ý
 */
export default {
  fetch: app.fetch,

  async scheduled(controller, _env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron));
  },
};

export { RealtimeHub } from "./realtime/realtimeHub.js";
