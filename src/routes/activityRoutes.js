import { Hono } from "hono";

/**
 * Gói Y2, nhật ký hoạt động. Gắn ở /orders.
 * GET /:id/activity
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

export default route;
