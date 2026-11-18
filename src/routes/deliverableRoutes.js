import { Hono } from "hono";

/**
 * Gói X2, sản phẩm bàn giao và file. `route` gắn ở /deliverables, `orderDeliverableRoutes` gắn ở /orders.
 * /deliverables: GET /:id, PATCH /:id, POST /:id/archive, POST /:id/restore, POST /:id/sdk-key/rotate,
 *                POST /:id/uploads, POST /:id/files, DELETE /:id/files/:fileId
 * /orders:       GET /:id/deliverables, POST /:id/deliverables
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

export const orderDeliverableRoutes = new Hono();

export default route;
