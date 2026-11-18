import { Hono } from "hono";

/**
 * Gói Y1, đơn hàng. Gắn ở /orders.
 * GET /, POST /, GET /:id, PATCH /:id, GET /:id/assignable-members, PUT /:id/members, POST /:id/deliver, POST /:id/reopen
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

export default route;
