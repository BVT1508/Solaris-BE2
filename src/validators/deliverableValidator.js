import { z } from "zod";
import { ALLOWED_CONTENT_TYPES } from "../services/storageService.js";
import { DELIVERABLE_TYPES, DELIVERABLE_STATUSES } from "../utils/enums.js";
import { objectIdSchema } from "./common.js";

const nameSchema = z
  .string()
  .trim()
  .min(1, "Tên sản phẩm không được để trống.")
  .max(150, "Tên sản phẩm tối đa 150 ký tự.");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Site bàn giao phải chạy https; chỉ cho http khi là máy local để dev thử. */
const urlSchema = z
  .string()
  .trim()
  .max(2000, "Địa chỉ tối đa 2000 ký tự.")
  .pipe(
    z.url({
      error:
        "Địa chỉ không hợp lệ. Cần địa chỉ đầy đủ, ví dụ https://ten-mien.vn.",
    })
  )
  .refine(
    (value) => {
      // zod vẫn chạy refine khi bước z.url() ở trên đã lỗi, nên không được để new URL ném ra (thành 500).
      if (!URL.canParse(value)) return false;
      const { protocol, hostname } = new URL(value);
      if (protocol === "https:") return true;
      return protocol === "http:" && LOCAL_HOSTS.has(hostname);
    },
    {
      error:
        "Địa chỉ phải đầy đủ và dùng https, ví dụ https://ten-mien.vn (http chỉ cho localhost).",
    }
  );

/** Dùng cho cả /deliverables/:id lẫn /orders/:id/deliverables (id của đơn). */
export const deliverableIdParams = z.object({ id: objectIdSchema }).strict();

export const listDeliverablesQuery = z
  .object({
    status: z.enum(DELIVERABLE_STATUSES).optional(),
  })
  .strict();

export const createDeliverableSchema = z
  .object({
    type: z.enum(DELIVERABLE_TYPES, {
      error: "Loại sản phẩm không hợp lệ.",
    }),
    name: nameSchema,
    url: urlSchema.optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (body.type === "web" && !body.url) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Sản phẩm web cần địa chỉ site.",
      });
    }
    if (body.type !== "web" && body.url) {
      ctx.addIssue({
        code: "custom",
        path: ["url"],
        message: "Chỉ sản phẩm web mới có địa chỉ.",
      });
    }
  });

export const updateDeliverableSchema = z
  .object({
    version: z.number().int().positive({ error: "Thiếu version." }),
    name: nameSchema.optional(),
    url: urlSchema.optional(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body).some((key) => key !== "version"),
    "Không có gì để cập nhật."
  );

export const fileIdParams = z
  .object({ id: objectIdSchema, fileId: objectIdSchema })
  .strict();

const originalNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255, "Tên file tối đa 255 ký tự.")
  .optional();

/** Bước 1 của upload: khai loại và dung lượng để nhận thông tin đẩy file đã ký. */
export const createUploadSchema = z
  .object({
    contentType: z.enum(ALLOWED_CONTENT_TYPES, {
      error: "Chỉ nhận PNG, JPG, WebP cho design và PDF cho document.",
    }),
    bytes: z
      .number()
      .int()
      .positive({ error: "Thiếu dung lượng file." })
      .max(30 * 1024 * 1024, "File tối đa 30 MB."),
    fileName: originalNameSchema,
  })
  .strict();

/** Bước 3: đính file đã đẩy vào sản phẩm. */
export const attachFileSchema = z
  .object({
    version: z.number().int().positive({ error: "Thiếu version." }),
    key: z.string().trim().min(1, "Thiếu key.").max(300),
    originalName: originalNameSchema,
    // design: id của ảnh đang dùng mà file này thay thế ("thay ảnh này"). document thì luôn thay file đang dùng.
    replacesFileId: objectIdSchema.optional(),
  })
  .strict();
