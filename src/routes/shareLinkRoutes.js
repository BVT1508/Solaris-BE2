import { Hono } from "hono";

/**
 * Gói Y3, link chia sẻ. `route` gắn ở /share-links, `deliverableShareLinkRoutes` gắn ở /deliverables.
 * /share-links:  PATCH /:id, POST /:id/pause, POST /:id/resume, POST /:id/revoke
 * /deliverables: GET /:id/share-links, POST /:id/share-links, GET /:id/rounds
 * Đăng nhập (protect) đã gắn theo tiền tố ở routes/index.js: file này không gọi lại.
 */
const route = new Hono();

export const deliverableShareLinkRoutes = new Hono();

export default route;
