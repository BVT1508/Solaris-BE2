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
});

export default env;

/** Các binding của Cloudflare (DB, REALTIME, ASSETS, các bộ giới hạn tần suất). */
export { bindings };
