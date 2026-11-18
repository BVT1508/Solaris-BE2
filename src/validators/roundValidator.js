import { z } from "zod";
import { objectIdSchema } from "./common.js";
import { pendingKeySchema, ratio, size } from "./feedbackValidator.js";

/** Sản phẩm trong đường dẫn /deliverables/:id/rounds..., /deliverables/:id/shots. */
export const deliverableIdParams = z.object({ id: objectIdSchema }).strict();

export const openRoundSchema = z
  .object({
    // Lời nhắn cho khách khi gửi xem lại, ví dụ "Đã sửa logo và căn lại khối".
    note: z
      .string()
      .trim()
      .max(1000, "Lời nhắn tối đa 1.000 ký tự.")
      .optional(),
  })
  .strict();

/** Team xin chỗ đẩy ảnh chụp cả trang của sản phẩm web. */
export const pageShotUploadSchema = z
  .object({
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"], {
      error: "Ảnh chụp trang phải là PNG, JPG hoặc WebP.",
    }),
    bytes: z
      .number()
      .int()
      .positive({ error: "Thiếu dung lượng ảnh." })
      .max(10 * 1024 * 1024, "Ảnh chụp trang tối đa 10 MB."),
  })
  .strict();

/**
 * Bộ ảnh chụp trang của vòng. Mỗi trang gửi đúng một trong hai: shotKey (ảnh vừa đẩy lên)
 * hoặc id (giữ ảnh của trang đang có trong vòng, chỉ đổi ghim hay docSize).
 */
export const roundPagesSchema = z
  .object({
    pages: z
      .array(
        z
          .object({
            id: objectIdSchema.optional(),
            shotKey: pendingKeySchema.optional(),
            pageUrl: z
              .string()
              .trim()
              .min(1)
              .max(2000, "Địa chỉ trang quá dài."),
            docSize: size.optional(),
            pins: z
              .array(
                z
                  .object({ feedbackId: objectIdSchema, x: ratio, y: ratio })
                  .strict()
              )
              .max(300, "Mỗi trang tối đa 300 ghim.")
              .default([]),
          })
          .strict()
          .refine((page) => Boolean(page.id) !== Boolean(page.shotKey), {
            message:
              "Mỗi trang cần shotKey (ảnh mới) hoặc id (giữ ảnh cũ), đúng một trong hai.",
            path: ["shotKey"],
          })
      )
      .max(30, "Mỗi vòng tối đa 30 trang."),
    // Người dùng chủ ý chụp lại bản của vòng khách đã gửi (bộ ảnh đang khóa).
    force: z.boolean().optional(),
  })
  .strict();
