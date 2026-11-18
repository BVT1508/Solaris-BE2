import { Hono } from "hono";

/**
 * Gói Y1, khách hàng. Gắn ở /clients.
 * Chỉ quản trị viên: thêm route.use(authCtrl.restrictTo("admin")) ở đầu.
 * GET /, GET /:id, PATCH /:id
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

export default route;
