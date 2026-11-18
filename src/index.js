import { Hono } from "hono";
import app from "./app.js";
import { runScheduled } from "./jobs/index.js";
import { serveFrontend } from "./middleware/frontendMiddleware.js";
import { connectRealtime } from "./realtime/connect.js";

/**
 * Điểm vào của Worker.
 *   fetch       request tới /api/*, và request không khớp file tĩnh nào (xem "assets" trong wrangler.jsonc)
 *   scheduled   việc định kỳ theo Cron Triggers
 *   RealtimeHub Durable Object giữ kết nối trực tiếp của màn góp ý
 */
const entry = new Hono();

// Kết nối trực tiếp đi riêng, không qua chuỗi middleware của API: response nâng cấp WebSocket không cho sửa header.
entry.get("/api/v1/realtime", connectRealtime);

// Còn lại: đường dẫn của ứng dụng frontend thì trả index.html; mọi thứ khác (API, file thiếu) vào app của API.
entry.all(
  "*",
  (c) => serveFrontend(c) || app.fetch(c.req.raw, c.env, c.executionCtx)
);

export default {
  fetch: entry.fetch,

  async scheduled(controller, _env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron));
  },
};

export { RealtimeHub } from "./realtime/realtimeHub.js";
