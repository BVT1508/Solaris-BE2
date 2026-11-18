import { createHash } from "node:crypto";

/**
 * Phần ký của Cloudinary, viết lại từ SDK Node mà backend cũ dùng (không gọi mạng, không đọc cấu hình: nhận khóa qua tham số).
 * Tách riêng để đối chiếu được với SDK thật bằng Node thường (kịch bản ở qa-scripts).
 * Băm đồng bộ bằng node:crypto: một response có thể cần hàng trăm chữ ký, crypto.subtle thì mỗi lần là một vòng chờ.
 */

/** Chữ ký của một lời gọi Upload API (và của bộ trường cho trình duyệt đẩy file): như api_sign_request của SDK. */
export function signParams(params, apiSecret) {
  const toSign = Object.entries(params)
    .filter(
      ([, value]) => value !== undefined && value !== null && value !== ""
    )
    .map(
      ([key, value]) =>
        `${key}=${Array.isArray(value) ? value.join(",") : value}`
    )
    .sort()
    .join("&");
  return createHash("sha1")
    .update(toSign + apiSecret)
    .digest("hex");
}

/**
 * URL đọc có chữ ký của một file dạng "authenticated" (resource_type image), như cloudinary.url(publicId, { sign_url: true }).
 *   publicId        "solaris/orders/<id>/deliverables/<id>/<uuid>" (không có đuôi)
 *   format          đuôi của URL: đuôi gốc của file, hoặc "jpg" cho ảnh nhỏ và ảnh trang PDF
 *   transformation  chuỗi biến đổi đã dựng sẵn ("c_limit,pg_1,q_auto,w_480"), hoặc "" khi lấy bản gốc
 * Chữ ký: 8 ký tự đầu của base64url(SHA-1(<biến đổi>/<publicId>.<format> + apiSecret)). Đoạn "v1" SDK tự thêm cho
 * public_id có thư mục không nằm trong phần được ký.
 */
export function signedUrl(
  { cloudName, apiSecret },
  publicId,
  format,
  transformation = ""
) {
  const source = `${encodeURIComponent(decodeURIComponent(publicId))
    .replace(/%3A/g, ":")
    .replace(/%2F/g, "/")}.${format}`;
  const toSign = [transformation, source].filter(Boolean).join("/");
  const signature = createHash("sha1")
    .update(toSign + apiSecret)
    .digest("base64")
    .slice(0, 8)
    .replace(/\//g, "_")
    .replace(/\+/g, "-");
  return [
    `https://res.cloudinary.com/${cloudName}/image/authenticated`,
    `s--${signature}--`,
    transformation,
    "v1",
    source,
  ]
    .filter(Boolean)
    .join("/");
}

/** Ảnh nhỏ (rộng tối đa 480px, JPG) cho ô xem trước; PDF lấy trang đầu. Thứ tự tham số như SDK sinh ra. */
export const THUMB_TRANSFORMATION = "c_limit,pg_1,q_auto,w_480";

/** Ảnh JPG của một trang PDF. */
export const pageTransformation = (page) => `dn_150,pg_${page},q_auto`;
