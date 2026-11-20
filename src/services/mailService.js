import env, { bindings } from "../config/env.js";

/**
 * Gửi email qua Resend (resend.com) bằng một lời gọi HTTP. Chỉ dùng cho email cảnh báo của hệ thống tới chủ hệ thống.
 *
 * Vì sao Resend: Worker trên địa chỉ workers.dev không có tên miền, mà cách gửi email của chính Cloudflare
 * (binding send_email) bắt người gửi phải thuộc một tên miền đã đưa vào Cloudflare. Resend cho gửi từ địa chỉ thử
 * onboarding@resend.dev mà không cần tên miền, với điều kiện người nhận là email của chính tài khoản Resend:
 * đăng ký Resend bằng đúng OWNER_EMAIL là đủ. Gói miễn phí của Resend: 100 email mỗi ngày, 3.000 mỗi tháng.
 *
 * Chưa đặt khóa RESEND_API_KEY thì `mailEnabled()` là false và nơi gọi tự bỏ qua bước gửi.
 */
// Riêng máy dev: RESEND_API_URL trỏ sang một server giả để thử luồng gửi mà không gửi email thật. Bản deploy bỏ qua biến này.
const ENDPOINT =
  (env.IS_DEV && bindings.RESEND_API_URL) || "https://api.resend.com/emails";
const TIMEOUT_MS = 10 * 1000;

export const mailEnabled = () => Boolean(env.RESEND_API_KEY);

/**
 * Gửi một email chữ thường. Trả mã email của Resend; lỗi thì ném Error có mã HTTP và lời của Resend (không chứa khóa).
 * idempotencyKey: gửi lại cùng khóa trong 24 giờ thì Resend không gửi lần hai (dùng khi thử lại sau lỗi mạng).
 */
export async function sendMail({ to, subject, text, idempotencyKey }) {
  const headers = {
    Authorization: `Bearer ${env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
    // Resend từ chối (403) request không có User-Agent.
    "User-Agent": "solaris-cf/1.0",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey.slice(0, 256);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({
      from: env.ALERT_EMAIL_FROM,
      to: [to],
      subject,
      text,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`Resend trả ${res.status}: ${body.slice(0, 300)}`);
  }
  try {
    return JSON.parse(body).id || null;
  } catch {
    return null;
  }
}
