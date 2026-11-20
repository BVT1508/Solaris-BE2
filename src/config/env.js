import { env as bindings } from "cloudflare:workers";
import { z } from "zod";

/**
 * Cấu hình của Worker, kiểm một lần lúc nạp module. Thiếu hoặc sai thì Worker không khởi động, kèm lời báo rõ.
 *
 * Nguồn giá trị: "vars" trong wrangler.jsonc và khóa bí mật (`wrangler secret put`) ở bản deploy; file .dev.vars trên máy dev.
 * Đọc qua `import { env } from "cloudflare:workers"` nên dùng được ở mọi file mà không phải truyền `c.env` đi khắp nơi:
 *   import env from "../config/env.js";       giá trị cấu hình đã kiểm (file này)
 *   import { db } from "../db/d1.js";         database D1
 */
const optionalString = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined);

/** Biến dạng số: bỏ trống (hoặc không khai) thì lấy mặc định, có giá trị thì đổi sang số rồi kiểm. */
const numberOr = (fallback, schema) =>
  z.preprocess(
    (value) =>
      value === undefined || String(value).trim() === ""
        ? fallback
        : Number(value),
    schema
  );

const envSchema = z
  .object({
    // "production" là mặc định trong wrangler.jsonc; chỉ .dev.vars mới đặt "development".
    ENVIRONMENT: z.enum(["development", "production"]).default("production"),
    CLIENT_ORIGINS: z
      .string()
      .default("http://localhost:5173")
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim().replace(/\/$/, ""))
          .filter(Boolean)
      ),
    // Chủ hệ thống: luôn là admin, không ai hạ quyền hay khóa được.
    OWNER_EMAIL: z
      .string({ error: "Thiếu OWNER_EMAIL." })
      .trim()
      .toLowerCase()
      .pipe(z.email({ error: "OWNER_EMAIL không phải email hợp lệ." })),
    SESSION_HOURS: z.coerce.number().int().positive().default(12),
    // Địa chỉ trình duyệt dùng để tới API (Google chuyển về đây). Để trống: origin đầu tiên của CLIENT_ORIGINS.
    API_PUBLIC_URL: optionalString(),
    COOKIE_DOMAIN: optionalString(),
    GOOGLE_CLIENT_ID: optionalString(),
    GOOGLE_CLIENT_SECRET: optionalString(),
    // Dạng cloudinary://<api_key>:<api_secret>@<cloud_name>. Chưa điền thì API file trả 503.
    CLOUDINARY_URL: z
      .string()
      .trim()
      .regex(
        /^cloudinary:\/\/[^:@/]+:[^:@/]+@[^:@/]+$/,
        "CLOUDINARY_URL phải có dạng cloudinary://api_key:api_secret@cloud_name."
      )
      .optional()
      .or(z.literal("").transform(() => undefined)),
    LOG_LEVEL: z
      .enum(["debug", "info", "warn", "error", "silent"])
      .default("info"),
    // Trần mỗi ngày (UTC) của gói miễn phí Cloudflare, để tính phần trăm đã dùng và cảnh báo. Xem services/usageService.js.
    USAGE_LIMIT_REQUESTS: numberOr(100000, z.number().int().positive()),
    USAGE_LIMIT_ROWS_READ: numberOr(5000000, z.number().int().positive()),
    USAGE_LIMIT_ROWS_WRITTEN: numberOr(100000, z.number().int().positive()),
    // Số đếm nằm trong bộ nhớ bao nhiêu giây rồi mới ghi xuống D1 (một lần ghi cho mọi request trong khoảng đó).
    // Tối đa 25: việc ghi chạy sau response, Cloudflare chỉ giữ request sống thêm 30 giây.
    USAGE_FLUSH_SECONDS: numberOr(15, z.number().min(0).max(25)),
    // Khóa API của Resend để gửi email cảnh báo hạn mức. Chưa có thì không gửi email, chỉ ghi nhận ngưỡng đã vượt.
    RESEND_API_KEY: optionalString(),
    // Người gửi. Mặc định là địa chỉ thử của Resend: chỉ gửi được tới email của chính tài khoản Resend.
    ALERT_EMAIL_FROM: z
      .string()
      .trim()
      .optional()
      .transform((value) => value || "Solaris <onboarding@resend.dev>"),
    // Người nhận email cảnh báo. Để trống: OWNER_EMAIL. Cần khi tài khoản Resend đăng ký bằng một email khác email chủ hệ thống
    // (chưa có tên miền thì Resend chỉ gửi được tới email của chính tài khoản Resend).
    ALERT_EMAIL_TO: z
      .string()
      .trim()
      .toLowerCase()
      .optional()
      .transform((value) => value || undefined)
      .pipe(
        z.email({ error: "ALERT_EMAIL_TO không phải email hợp lệ." }).optional()
      ),
  })
  .refine(
    (env) =>
      Boolean(env.GOOGLE_CLIENT_ID) === Boolean(env.GOOGLE_CLIENT_SECRET),
    {
      message:
        "GOOGLE_CLIENT_ID và GOOGLE_CLIENT_SECRET phải cùng có hoặc cùng trống.",
      path: ["GOOGLE_CLIENT_ID"],
    }
  );

const loadEnv = (source) => {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Cấu hình thiếu hoặc sai (${detail}). Xem .dev.vars.example.`
    );
  }
  const env = parsed.data;
  env.IS_DEV = env.ENVIRONMENT === "development";
  env.FRONTEND_URL = env.CLIENT_ORIGINS[0];
  env.API_PUBLIC_URL = (env.API_PUBLIC_URL || env.FRONTEND_URL).replace(
    /\/$/,
    ""
  );
  env.GOOGLE_ENABLED = Boolean(env.GOOGLE_CLIENT_ID);
  if (env.CLOUDINARY_URL) {
    const [, apiKey, apiSecret, cloudName] = env.CLOUDINARY_URL.match(
      /^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/
    );
    env.CLOUDINARY = { apiKey, apiSecret, cloudName };
  }
  // Đăng nhập dev: chỉ khi ENVIRONMENT=development. Từng request còn phải tới từ chính máy này (authController.requireDevLogin).
  env.DEV_LOGIN_ENABLED = env.IS_DEV;
  return env;
};

const env = loadEnv({
  ENVIRONMENT: bindings.ENVIRONMENT,
  CLIENT_ORIGINS: bindings.CLIENT_ORIGINS,
  OWNER_EMAIL: bindings.OWNER_EMAIL,
  SESSION_HOURS: bindings.SESSION_HOURS,
  API_PUBLIC_URL: bindings.API_PUBLIC_URL,
  COOKIE_DOMAIN: bindings.COOKIE_DOMAIN,
  GOOGLE_CLIENT_ID: bindings.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: bindings.GOOGLE_CLIENT_SECRET,
  CLOUDINARY_URL: bindings.CLOUDINARY_URL,
  LOG_LEVEL: bindings.LOG_LEVEL,
  USAGE_LIMIT_REQUESTS: bindings.USAGE_LIMIT_REQUESTS,
  USAGE_LIMIT_ROWS_READ: bindings.USAGE_LIMIT_ROWS_READ,
  USAGE_LIMIT_ROWS_WRITTEN: bindings.USAGE_LIMIT_ROWS_WRITTEN,
  USAGE_FLUSH_SECONDS: bindings.USAGE_FLUSH_SECONDS,
  RESEND_API_KEY: bindings.RESEND_API_KEY,
  ALERT_EMAIL_FROM: bindings.ALERT_EMAIL_FROM,
  ALERT_EMAIL_TO: bindings.ALERT_EMAIL_TO,
});

export default env;

/** Các binding của Cloudflare (DB, REALTIME, ASSETS, các bộ giới hạn tần suất). */
export { bindings };
