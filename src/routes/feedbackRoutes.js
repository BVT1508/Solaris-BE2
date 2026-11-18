import { Hono } from "hono";

/**
 * Gói X4, góp ý phía team. `route` gắn ở /feedback, `deliverableFeedbackRoutes` ở /deliverables, `orderFeedbackRoutes` ở /orders.
 * /feedback:     GET /mine (đặt trước /:id), GET /:id, PATCH /:id, DELETE /:id, POST /:id/replies
 * /deliverables: GET /:id/feedback, POST /:id/feedback, POST /:id/bridge-check
 * /orders:       GET /:id/feedback
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

export const deliverableFeedbackRoutes = new Hono();

export const orderFeedbackRoutes = new Hono();

export default route;
