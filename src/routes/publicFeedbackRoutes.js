import { Hono } from "hono";

/**
 * Gói X3, góp ý của khách. Gắn ở /r (không đăng nhập).
 * GET /:token/feedback, POST /:token/feedback, PATCH /:token/feedback/:id, PUT /:token/feedback/:id/screenshot,
 * DELETE /:token/feedback/:id, POST /:token/feedback/:id/replies, POST /:token/feedback/:id/verdict,
 * POST /:token/uploads, POST /:token/bridge-check
 * Giới hạn publicLimiter đã gắn cho cả /r ở routes/index.js.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

export default route;
