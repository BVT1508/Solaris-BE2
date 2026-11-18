import { Hono } from "hono";

/**
 * Gói Y3 và Y4, khách mở link và khép vòng. Gắn ở /r (không đăng nhập).
 * GET /:token, POST /:token/submit, POST /:token/approve
 * Giới hạn publicLimiter đã gắn cho cả /r ở routes/index.js.
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

export default route;
