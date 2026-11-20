import env from "../config/env.js";
import { isPaused, nextReset } from "../services/usageService.js";

/**
 * Tạm ngừng khi sắp hết hạn mức gói miễn phí của hôm nay (services/usageService.js quyết định lúc nào).
 * Đứng TRƯỚC việc đọc body, giới hạn tần suất, đọc phiên và mọi truy vấn D1: request bị chặn chỉ tốn một phép so sánh
 * và một response nhỏ, không đụng database.
 */
export const PAUSE_CODE = "quota_paused";
export const PAUSE_MESSAGE =
  "Hệ thống tạm ngừng vì đã dùng hết lưu lượng miễn phí của hôm nay. Hoạt động lại lúc 07:00 (giờ Việt Nam).";

// Vẫn phục vụ lúc tạm ngừng: đủ để quản trị viên đăng nhập và xem mức dùng, và để giao diện biết ai đang đăng nhập.
const ALLOWED = new Set([
  "GET /api/v1/auth/me",
  "POST /api/v1/auth/logout",
  "GET /api/v1/auth/google",
  "GET /api/v1/auth/google/callback",
  "GET /api/v1/usage",
  "GET /api/v1/infrastructure",
  // Đăng nhập dev chỉ tồn tại trên máy dev (bản deploy trả 404 cho hai đường này).
  ...(env.IS_DEV
    ? ["GET /api/v1/auth/dev/members", "POST /api/v1/auth/dev/login"]
    : []),
]);

/** Response 503 báo tạm ngừng: cùng một hình dạng ở mọi nơi (middleware này và bộ xử lý lỗi khi D1 báo chạm trần). */
export const pausedResponse = (c) => {
  const resetAt = nextReset();
  c.header(
    "Retry-After",
    String(Math.max(1, Math.ceil((Date.parse(resetAt) - Date.now()) / 1000)))
  );
  c.header("Cache-Control", "no-store");
  return c.json(
    {
      status: "fail",
      code: PAUSE_CODE,
      message: PAUSE_MESSAGE,
      data: { resetAt },
    },
    503
  );
};

export const pauseGate = async (c, next) => {
  if (
    isPaused() &&
    c.req.method !== "OPTIONS" &&
    !ALLOWED.has(`${c.req.method} ${c.req.path.replace(/\/+$/, "")}`)
  ) {
    return pausedResponse(c);
  }
  await next();
  return undefined;
};
