import env from "../config/env.js";
import { dry } from "../config/runtime.js";

/**
 * Ghi log dạng JSON một dòng ra console: Cloudflare (Workers Logs) và `wrangler dev` đều đọc được.
 * Cách gọi giữ như pino của backend cũ: logger.warn({ err, key }, "Không xóa được file").
 * Không ghi cookie, token, mật khẩu, email hay nội dung góp ý ra log.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const threshold = LEVELS[env.LOG_LEVEL] ?? LEVELS.info;

const REDACTED = new Set(["password", "email", "token", "cookie", "secret"]);

/** Lỗi thành object ghi được; trường nhạy cảm ở tầng đầu bị che. */
const clean = (fields) => {
  const out = {};
  for (const [key, value] of Object.entries(fields || {})) {
    if (REDACTED.has(key)) out[key] = "[ẩn]";
    else if (value instanceof Error) {
      out[key] = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
    } else out[key] = value;
  }
  return out;
};

const write = (level, method) => (fields, message) => {
  // Request mẫu lúc làm nóng không ghi log.
  if (LEVELS[level] < threshold || dry()) return;
  const entry =
    typeof fields === "string"
      ? { level, msg: fields }
      : { level, msg: message, ...clean(fields) };
  console[method](JSON.stringify(entry));
};

const logger = {
  debug: write("debug", "log"),
  info: write("info", "log"),
  warn: write("warn", "warn"),
  error: write("error", "error"),
};

export default logger;
