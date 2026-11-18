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
const strictRoundPagesSchema = z
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

// ---------- Đường kiểm nhanh cho payload hợp lệ ----------
//
// Payload lớn nhất được phép (30 trang, mỗi trang 300 ghim, khoảng 530 KB) tốn zod chừng 7 ms: riêng bước kiểm đã gần hết
// 10 ms CPU của gói miễn phí. Phần nặng là 9.000 ghim, mỗi ghim một object strict với ba trường.
// Cách làm: tự kiểm bằng vòng lặp thường. Payload qua được thì trả luôn kết quả (đúng thứ zod sẽ trả: id về chữ thường,
// chuỗi đã cắt khoảng trắng, pins mặc định là mảng rỗng). Chỉ cần MỘT chỗ không chắc hợp lệ là trả null và giao lại cho
// schema zod ở trên, nên lời báo lỗi luôn do zod sinh ra, không đổi một chữ.
// Hàm này phải khớp từng luật với strictRoundPagesSchema: sửa schema thì sửa cả ở đây
// (kịch bản so hai bên bằng dữ liệu ngẫu nhiên: qa-scripts/cf/so-kiem-nhanh-anh-trang.mjs).

const HEX_ID = /^[0-9a-fA-F]{24}$/;
const isPlainObject = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (object, allowed) => {
  for (const key of Object.keys(object)) if (!allowed.has(key)) return false;
  return true;
};
const isRatio = (value) =>
  typeof value === "number" && value >= 0 && value <= 1;
const isSizePart = (value, max) =>
  Number.isSafeInteger(value) && value > 0 && value <= max;

const BODY_KEYS = new Set(["pages", "force"]);
const PAGE_KEYS = new Set(["id", "shotKey", "pageUrl", "docSize", "pins"]);
const SIZE_KEYS = new Set(["w", "h"]);

/** Một ghim hợp lệ thành { feedbackId, x, y }; không chắc hợp lệ thì null. */
function fastPin(pin) {
  if (!isPlainObject(pin)) return null;
  // Đúng ba khóa, không thừa không thiếu.
  let count = 0;
  for (const key in pin) {
    if (key !== "feedbackId" && key !== "x" && key !== "y") return null;
    count += 1;
  }
  if (count !== 3) return null;
  const { feedbackId, x, y } = pin;
  if (typeof feedbackId !== "string" || !HEX_ID.test(feedbackId)) return null;
  if (!isRatio(x) || !isRatio(y)) return null;
  return { feedbackId: feedbackId.toLowerCase(), x, y };
}

function fastPage(page) {
  if (!isPlainObject(page) || !onlyKeys(page, PAGE_KEYS)) return null;
  const out = {};

  if (page.id !== undefined) {
    if (typeof page.id !== "string" || !HEX_ID.test(page.id)) return null;
    out.id = page.id.toLowerCase();
  }
  if (page.shotKey !== undefined) {
    if (typeof page.shotKey !== "string") return null;
    const shotKey = page.shotKey.trim();
    if (shotKey.length < 1 || shotKey.length > 300) return null;
    out.shotKey = shotKey;
  }
  if (typeof page.pageUrl !== "string") return null;
  const pageUrl = page.pageUrl.trim();
  if (pageUrl.length < 1 || pageUrl.length > 2000) return null;
  out.pageUrl = pageUrl;

  if (page.docSize !== undefined) {
    const size = page.docSize;
    if (!isPlainObject(size) || !onlyKeys(size, SIZE_KEYS)) return null;
    if (!isSizePart(size.w, 100000) || !isSizePart(size.h, 1000000)) {
      return null;
    }
    out.docSize = { w: size.w, h: size.h };
  }

  if (page.pins === undefined) out.pins = [];
  else {
    if (!Array.isArray(page.pins) || page.pins.length > 300) return null;
    const pins = new Array(page.pins.length);
    for (let i = 0; i < page.pins.length; i += 1) {
      const pin = fastPin(page.pins[i]);
      if (!pin) return null;
      pins[i] = pin;
    }
    out.pins = pins;
  }

  // Đúng một trong hai: ảnh mới (shotKey) hoặc giữ ảnh cũ (id).
  if (Boolean(out.id) === Boolean(out.shotKey)) return null;
  return out;
}

/** Cả body hợp lệ thành kết quả đã chuẩn hóa; không chắc hợp lệ thì null. */
export function fastRoundPages(body) {
  if (!isPlainObject(body) || !onlyKeys(body, BODY_KEYS)) return null;
  if (!Array.isArray(body.pages) || body.pages.length > 30) return null;
  if (body.force !== undefined && typeof body.force !== "boolean") return null;
  const pages = new Array(body.pages.length);
  for (let i = 0; i < body.pages.length; i += 1) {
    const page = fastPage(body.pages[i]);
    if (!page) return null;
    pages[i] = page;
  }
  const out = { pages };
  if (body.force !== undefined) out.force = body.force;
  return out;
}

/**
 * Thứ route dùng: cùng giao diện `safeParse` với một schema zod (validateMiddleware chỉ gọi hàm này).
 * Payload hợp lệ đi đường nhanh; còn lại đi qua zod để ra đúng lời báo lỗi.
 */
export const roundPagesSchema = {
  safeParse(input) {
    const data = fastRoundPages(input);
    return data
      ? { success: true, data }
      : strictRoundPagesSchema.safeParse(input);
  },
};

/** Schema zod đầy đủ, xuất ra để kịch bản so sánh với đường nhanh. */
export { strictRoundPagesSchema };
