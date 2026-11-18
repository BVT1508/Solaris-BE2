import { Hono } from "hono";
import app from "./app.js";
import { runScheduled } from "./jobs/index.js";
import { connectRealtime } from "./realtime/connect.js";

/**
 * Điểm vào của Worker.
 *   fetch       mọi request tới /api/* (file tĩnh của frontend không qua đây, xem "assets" trong wrangler.jsonc)
 *   scheduled   việc định kỳ theo Cron Triggers
 *   RealtimeHub Durable Object giữ kết nối trực tiếp của màn góp ý
 */

// Kết nối trực tiếp đi riêng, không qua chuỗi middleware của API: response nâng cấp WebSocket không cho sửa header.
const realtime = new Hono();
realtime.get("/api/v1/realtime", connectRealtime);
realtime.all("*", (c) => app.fetch(c.req.raw, c.env, c.executionCtx));

export default {
  fetch: realtime.fetch,

  async scheduled(controller, _env, ctx) {
    ctx.waitUntil(runScheduled(controller.cron));
  },
};

export { RealtimeHub } from "./realtime/realtimeHub.js";
