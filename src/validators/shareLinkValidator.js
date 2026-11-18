import { z } from "zod";
import { objectIdSchema } from "./common.js";

const contactNameSchema = z
  .string()
  .trim()
  .min(1, "Tên người nhận không được để trống.")
  .max(100, "Tên người nhận tối đa 100 ký tự.");

const noteSchema = z.string().trim().max(500, "Ghi chú tối đa 500 ký tự.");

export const shareLinkIdParams = z.object({ id: objectIdSchema }).strict();

/** Sản phẩm trong đường dẫn /deliverables/:id/share-links và /deliverables/:id/rounds. */
export const deliverableIdParams = z.object({ id: objectIdSchema }).strict();

/** Chọn người liên hệ có sẵn của khách (contactId) hoặc gõ tên (contactName), ít nhất một trong hai. */
export const createShareLinkSchema = z
  .object({
    contactId: objectIdSchema.optional(),
    contactName: contactNameSchema.optional(),
    note: noteSchema.optional(),
  })
  .strict()
  .refine((body) => body.contactId || body.contactName, {
    message: "Cần chọn người liên hệ hoặc nhập tên người nhận link.",
    path: ["contactName"],
  });

export const updateShareLinkSchema = z
  .object({
    version: z.number().int().positive({ error: "Thiếu version." }),
    contactName: contactNameSchema.optional(),
    note: noteSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body).some((key) => key !== "version"),
    "Không có gì để cập nhật."
  );
