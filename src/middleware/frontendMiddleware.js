import { bindings } from "../config/env.js";

const NOT_FRONTEND = /^\/(api|socket\.io)(\/|$)/;
const HAS_EXTENSION = /\.[^/]+$/;

/**
 * Đường dẫn của ứng dụng frontend (không khớp file tĩnh nào) trả index.html để React Router xử lý, như
 * middleware/frontendMiddleware.js của backend cũ. Trả null khi request không phải của frontend, để nơi gọi trả 404 JSON.
 *
 * Từ 21/11/2026 đây chỉ còn là lưới đỡ: wrangler.jsonc để tầng file tĩnh của Cloudflare tự trả index.html cho mọi đường
 * dẫn ngoài /api (chế độ "single-page-application"), nên bình thường Worker không còn thấy các đường dẫn này (để request
 * của bot dò quét không tính vào hạn mức). Hàm này chỉ chạy nếu cấu hình assets bị đổi lại.
 * Đường dẫn có đuôi file thì để 404; chỉ GET và HEAD; /api và /socket.io không bao giờ nhận index.html.
 */
export function serveFrontend(c) {
  const { pathname } = new URL(c.req.url);
  if (
    !["GET", "HEAD"].includes(c.req.method) ||
    NOT_FRONTEND.test(pathname) ||
    HAS_EXTENSION.test(pathname)
  ) {
    return null;
  }
  return bindings.ASSETS.fetch(new Request(new URL("/", c.req.url), c.req.raw));
}
