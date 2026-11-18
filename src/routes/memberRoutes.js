import { Hono } from "hono";

/**
 * Gói X1, thành viên. Gắn ở /members.
 * Chỉ quản trị viên: thêm route.use(authCtrl.restrictTo("admin")) ở đầu.
 * GET /, POST /, GET /:id, PATCH /:id, POST /:id/suspend, POST /:id/activate
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

export default route;
