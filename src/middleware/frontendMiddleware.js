import { bindings } from "../config/env.js";

const NOT_FRONTEND = /^\/(api|socket\.io)(\/|$)/;
const HAS_EXTENSION = /\.[^/]+$/;

/**
 * Đường dẫn của ứng dụng frontend (không khớp file tĩnh nào) trả index.html để React Router xử lý, như
 * middleware/frontendMiddleware.js của backend cũ. Trả null khi request không phải của frontend, để nơi gọi trả 404 JSON.
 *
 * File tĩnh có thật (index.html, assets/, bridge.js, demo-site/) do Cloudflare phục vụ trước khi tới Worker; hàm này chỉ
 * thấy những đường dẫn KHÔNG khớp file nào. Không dùng chế độ "single-page-application" của Cloudflare vì chế độ đó trả
 * index.html cho cả file thiếu (ví dụ một gói JS cũ sau lần deploy): trình duyệt nhận HTML thay cho 404 và báo lỗi kiểu file.
 * Ở đây đường dẫn có đuôi file thì để 404; chỉ GET và HEAD; /api và /socket.io không bao giờ nhận index.html.
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
