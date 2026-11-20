import { createHash, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import { randomBytes } from "../config/runtime.js";

/** Băm SHA-256 dạng hex. Đồng bộ (node:crypto qua nodejs_compat): không tốn vòng chờ như crypto.subtle. */
export const sha256Hex = (text) =>
  createHash("sha256").update(text).digest("hex");

/** `bytes` byte ngẫu nhiên dạng base64url (không có dấu =, +, /): gọn trong cookie và đường dẫn. */
export const randomToken = (bytes) =>
  Buffer.from(randomBytes(bytes)).toString("base64url");

export const randomHex = (bytes) =>
  Buffer.from(randomBytes(bytes)).toString("hex");

/** So hai chuỗi với thời gian không phụ thuộc vị trí khác nhau đầu tiên (so khóa bí mật). */
export const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
};
