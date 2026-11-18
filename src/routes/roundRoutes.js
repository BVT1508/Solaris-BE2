import { Hono } from "hono";

/**
 * Gói Y4, vòng review phía team. Gắn ở /deliverables.
 * POST /:id/rounds, POST /:id/rounds/current/refresh, POST /:id/shots, PUT /:id/rounds/current/pages
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

export default route;
