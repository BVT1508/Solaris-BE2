import { z } from "zod";

/**
 * Schema dùng chung cho mọi validator (backend cũ để ở memberValidator.js).
 * Id nhận cả chữ hoa như cũ nhưng được đổi sang chữ thường: trong D1 id là chuỗi, so sánh phân biệt hoa thường.
 */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Id không hợp lệ.")
  .transform((id) => id.toLowerCase());

/** Body chỉ có version, cho các hành động như khóa, mở khóa, lưu trữ. */
export const versionOnlySchema = z
  .object({
    version: z.number().int().positive({ error: "Thiếu version." }),
  })
  .strict();

/** Token của link chia sẻ trong đường dẫn công khai /r/:token: 24 byte ngẫu nhiên dạng base64url, đúng 32 ký tự. */
export const tokenParams = z
  .object({
    token: z.string().regex(/^[A-Za-z0-9_-]{32}$/, "Link không hợp lệ."),
  })
  .strict();
