import env from "../config/env.js";
import AppError from "../utils/appError.js";

/**
 * Header bảo mật cho mọi response của API, đúng bộ mà helmet 8 đặt ở backend cũ (API chỉ trả JSON).
 * File tĩnh của frontend không đi qua Worker nên không mang các header này: trang của frontend phải nhúng được
 * site của khách trong iframe và nạp ảnh từ kho file.
 */
const SECURITY_HEADERS = {
  "Content-Security-Policy":
    "default-src 'self';base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';img-src 'self' data:;object-src 'none';script-src 'self';script-src-attr 'none';style-src 'self' https: 'unsafe-inline';upgrade-insecure-requests",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-DNS-Prefetch-Control": "off",
  "X-Download-Options": "noopen",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
};

export const securityHeaders = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    c.res.headers.set(name, value);
  }
  // Express ghi rõ bảng mã; giữ nguyên để client cũ đọc như trước.
  if (c.res.headers.get("Content-Type") === "application/json") {
    c.res.headers.set("Content-Type", "application/json; charset=utf-8");
  }
};

/** Dữ liệu API thay đổi liên tục và có phần riêng tư: trình duyệt và proxy không được giữ bản sao. */
export const noStore = async (c, next) => {
  await next();
  c.res.headers.set("Cache-Control", "no-store");
};

// ---------- Origin ----------

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Origin được tin: danh sách CLIENT_ORIGINS, cộng chính origin của Worker (bản deploy phục vụ cả frontend lẫn API
 * ở một địa chỉ, nên trang của frontend gọi API cùng origin).
 */
export const isTrustedOrigin = (origin, requestUrl) =>
  env.CLIENT_ORIGINS.includes(origin) || origin === new URL(requestUrl).origin;

/** CORS: chỉ origin được tin mới được gọi API kèm cookie. Origin lạ không nhận header cho phép nào. */
export const cors = async (c, next) => {
  const origin = c.req.header("origin");
  const allowed = Boolean(origin) && isTrustedOrigin(origin, c.req.url);

  if (
    c.req.method === "OPTIONS" &&
    c.req.header("access-control-request-method")
  ) {
    // Preflight: trả lời ngay, không vào route.
    const headers = new Headers({
      Vary: "Origin, Access-Control-Request-Headers",
    });
    if (allowed) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Access-Control-Allow-Credentials", "true");
    }
    headers.set(
      "Access-Control-Allow-Methods",
      "GET,HEAD,PUT,PATCH,POST,DELETE"
    );
    const requested = c.req.header("access-control-request-headers");
    if (requested) headers.set("Access-Control-Allow-Headers", requested);
    return new Response(null, { status: 204, headers });
  }

  await next();
  c.res.headers.append("Vary", "Origin");
  if (allowed) {
    c.res.headers.set("Access-Control-Allow-Origin", origin);
    c.res.headers.set("Access-Control-Allow-Credentials", "true");
  }
  return undefined;
};

/**
 * Chống CSRF cho phiên cookie: request ghi dữ liệu mang Origin lạ thì từ chối.
 * Trình duyệt luôn gửi Origin với POST, PATCH, DELETE từ trang khác. Không có Origin: gọi từ server, curl, Postman.
 */
export const requireTrustedOrigin = async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    const origin = c.req.header("origin");
    if (origin && !isTrustedOrigin(origin, c.req.url)) {
      throw new AppError("Yêu cầu đến từ nguồn không được phép.", 403);
    }
  }
  await next();
};
