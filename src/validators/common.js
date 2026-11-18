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
