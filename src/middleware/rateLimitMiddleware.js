import env from "../config/env.js";
import { binding } from "../config/runtime.js";
import { first, sql } from "../db/d1.js";
import AppError from "../utils/appError.js";

/**
 * Giới hạn tần suất. Worker không giữ bộ nhớ giữa các request nên không đếm trong tiến trình như backend cũ.
 *
 * Theo IP: Rate Limiting binding của Cloudflare (khai ở "ratelimits" trong wrangler.jsonc). Không tốn lượt ghi database,
 * nhưng cửa sổ chỉ là 10 hoặc 60 giây và số đếm là gần đúng theo từng điểm hiện diện của Cloudflare.
 * Vì vậy trần ở đây tính theo phút, không còn theo 15 phút như cũ (bảng đối chiếu ở docs/kien-truc.md mục 6).
 *
 * Theo khóa nghiệp vụ cần chính xác (ví dụ một link xin chỗ đẩy ảnh): đếm trong bảng rate_counters của D1, xem `countedLimit`.
 */
const TOO_FAST = "Bạn đang gửi quá nhanh. Hãy thử lại sau ít phút.";

/** IP do Cloudflare ghi (client không giả được). Máy dev: 127.0.0.1. */
export const clientIp = (c) => c.req.header("cf-connecting-ip") || "unknown";

const tooFast = (c, seconds) => {
  c.header("Retry-After", String(seconds));
  return c.json({ status: "fail", message: TOO_FAST }, 429);
};

/**
 * devOnlyRelaxed: trần chặt (đăng nhập, đường của khách) không áp khi chạy máy dev, để bộ Postman chạy liền nhiều lần
 * không bị chặn oan (backend cũ nới gấp 10 khi development). Trần chung của API thì luôn áp.
 */
const byIp =
  (name, bindingName, limit, { devOnlyRelaxed = true } = {}) =>
  async (c, next) => {
    c.header("RateLimit-Policy", `"${name}";q=${limit};w=60`);
    const limiter = binding(bindingName);
    if (limiter && !(devOnlyRelaxed && env.IS_DEV)) {
      const { success } = await limiter.limit({ key: clientIp(c) });
      if (!success) return tooFast(c, 60);
    }
    await next();
    return undefined;
  };

// Số ở đây phải khớp "ratelimits" trong wrangler.jsonc (chỉ dùng để ghi header RateLimit-Policy).
/** Giới hạn chung cho API. */
export const apiLimiter = byIp("api", "API_LIMITER", 600, {
  devOnlyRelaxed: false,
});
/** Chặt hơn cho đăng nhập: chống dò email và spam bắt đầu đăng nhập Google. */
export const authLimiter = byIp("auth", "AUTH_LIMITER", 10);
/** Đường công khai cho khách (mở link chia sẻ): lớp thứ hai chống dò token. */
export const publicLimiter = byIp("public", "PUBLIC_LIMITER", 120);
/** Khách ghi góp ý: chặt hơn đọc. */
export const guestWriteLimiter = byIp("guest-write", "GUEST_WRITE_LIMITER", 60);

/**
 * Đếm chính xác theo một khóa trong cửa sổ cố định, lưu ở D1 (một dòng ghi mỗi lần gọi: chỉ dùng cho thao tác thưa).
 *   route.post("/:token/uploads", countedLimit({ key: (c) => `upload:${c.req.param("token")}`, limit: 60, windowMs: 10 * 60 * 1000 }), ...)
 * Dòng của cửa sổ cũ do cron dọn.
 */
export const countedLimit =
  ({ key, limit, windowMs }) =>
  async (c, next) => {
    const scaled = env.IS_DEV ? limit * 10 : limit;
    const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
    const row = await first(sql`
      INSERT INTO rate_counters (key, window_start, count) VALUES (${key(c)}, ${windowStart}, 1)
      ON CONFLICT (key, window_start) DO UPDATE SET count = count + 1
      RETURNING count`);
    if (row.count > scaled) {
      c.header(
        "Retry-After",
        String(Math.ceil((windowStart + windowMs - Date.now()) / 1000))
      );
      throw new AppError(TOO_FAST, 429);
    }
    await next();
  };
