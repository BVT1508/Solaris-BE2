import { z } from "zod";
import {
  FEEDBACK_STATUSES,
  FEEDBACK_VISIBILITIES,
  TRIAGE_STATUSES,
  VERDICTS,
  ANCHOR_ELEMENT_KINDS,
} from "../utils/enums.js";
import { objectIdSchema } from "./common.js";

// ratio, size, pageRect, pendingKeySchema được xuất để validator của vòng review (ảnh trang, ghim) dùng chung.

/** Tọa độ là tỷ lệ 0..1 so với ảnh, trang PDF, hoặc toàn trang web (docSize). */
export const ratio = z
  .number({ error: "Tọa độ phải là số." })
  .min(0, "Tọa độ nằm ngoài ảnh.")
  .max(1, "Tọa độ nằm ngoài ảnh.");

const pinSchema = z
  .object({ kind: z.literal("pin"), x: ratio, y: ratio })
  .strict();

const regionSchema = z
  .object({
    kind: z.literal("region"),
    x: ratio,
    y: ratio,
    w: ratio.gt(0, "Vùng khoanh phải có chiều rộng."),
    h: ratio.gt(0, "Vùng khoanh phải có chiều cao."),
  })
  .strict()
  .refine((m) => m.x + m.w <= 1 && m.y + m.h <= 1, {
    message: "Vùng khoanh tràn ra ngoài ảnh.",
    path: ["w"],
  });

/** Nét vẽ tự do: danh sách điểm [x, y], tối đa 2.000 điểm. */
const slowPointsSchema = z
  .array(z.tuple([ratio, ratio]))
  .min(2, "Nét vẽ cần ít nhất 2 điểm.")
  .max(2000, "Nét vẽ tối đa 2.000 điểm.");

const isRatio = (value) =>
  typeof value === "number" && value >= 0 && value <= 1;

/** true khi là danh sách từ 2 tới 2.000 điểm, mỗi điểm đúng hai số trong khoảng 0..1. */
const pointsAreValid = (value) => {
  if (!Array.isArray(value) || value.length < 2 || value.length > 2000) {
    return false;
  }
  for (let i = 0; i < value.length; i += 1) {
    const point = value[i];
    if (
      !Array.isArray(point) ||
      point.length !== 2 ||
      !isRatio(point[0]) ||
      !isRatio(point[1])
    ) {
      return false;
    }
  }
  return true;
};

/**
 * Nét vẽ 2.000 điểm mà để zod kiểm từng điểm thì tốn khoảng 5 ms CPU trên Cloudflare (nửa hạn mức của một request).
 * Đường nhanh: một vòng lặp thường. Chỉ khi vòng lặp thấy có gì sai mới giao lại cho schema zod, để lời báo lỗi
 * giữ nguyên như trước; dữ liệu hợp lệ không bao giờ đi đường chậm.
 */
const pointsSchema = z.unknown().transform((value, ctx) => {
  if (pointsAreValid(value)) return value;
  const result = slowPointsSchema.safeParse(value);
  if (result.success) return result.data;
  for (const issue of result.error.issues) ctx.addIssue({ ...issue });
  return z.NEVER;
});

const strokeSchema = z
  .object({ kind: z.literal("stroke"), points: pointsSchema })
  .strict();

const markSchema = z.discriminatedUnion("kind", [
  pinSchema,
  regionSchema,
  strokeSchema,
]);

const targetSchema = z
  .object({
    fileId: objectIdSchema,
    page: z.number().int().min(1, "Số trang bắt đầu từ 1.").optional(),
  })
  .strict();

export const size = z
  .object({
    w: z.number().int().positive().max(100000),
    h: z.number().int().positive().max(1000000),
  })
  .strict();

/** Một khung chữ nhật trên trang, px theo tọa độ cả trang: khung của phần tử được chọn, hoặc vùng mà ảnh chụp bao phủ. */
export const pageRect = z
  .object({
    x: z.number().min(0).max(100000),
    y: z.number().min(0).max(1000000),
    w: z.number().positive().max(100000),
    h: z.number().positive().max(1000000),
  })
  .strict();

/**
 * Phần tử trên site mà người góp ý đã chọn. text là trích chữ của phần tử (hoặc alt của ảnh); src là nguồn ảnh, video
 * và chỉ nhận địa chỉ http(s) hoặc đường dẫn bắt đầu bằng "/", để giao diện hiện làm link được mà không lo javascript: hay data:.
 */
const anchorElementSchema = z
  .object({
    kind: z.enum(ANCHOR_ELEMENT_KINDS, {
      error: "Loại phần tử không hợp lệ.",
    }),
    tag: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9-]{0,29}$/, "Tên thẻ không hợp lệ.")
      .optional(),
    text: z.string().trim().max(200, "Trích chữ tối đa 200 ký tự.").optional(),
    src: z
      .string()
      .trim()
      .max(1000, "Địa chỉ nguồn quá dài.")
      .regex(/^(https?:\/\/|\/(?!\/))/i, "Địa chỉ nguồn không hợp lệ.")
      .optional(),
    rect: pageRect.optional(),
  })
  .strict();

/** Vị trí trên site web do bridge đo. pageUrl: đường dẫn tương đối hoặc địa chỉ cùng origin với site. */
const anchorSchema = z
  .object({
    pageUrl: z.string().trim().min(1).max(2000, "Địa chỉ trang quá dài."),
    selector: z.string().trim().max(1000).optional(),
    viewport: size.optional(),
    scroll: z
      .object({ x: z.number().min(0), y: z.number().min(0) })
      .strict()
      .optional(),
    docSize: size.optional(),
    // Vị trí điểm neo trong khung của phần tử `selector`, tỷ lệ 0..1. Có nó thì dấu bám theo phần tử
    // khi site đổi bố cục theo bề rộng; không có thì dấu chỉ đặt theo tỷ lệ cả trang (docSize).
    offset: z.object({ x: ratio, y: ratio }).strict().optional(),
    // Phần tử được chọn (công cụ chọn theo vùng chữ, ảnh, khối). Không có khi là điểm ghim trần hay nét vẽ.
    element: anchorElementSchema.optional(),
  })
  .strict();

const bodySchema = z
  .string()
  .trim()
  .min(1, "Nội dung không được để trống.")
  .max(4000, "Nội dung tối đa 4.000 ký tự.");

const authorNameSchema = z
  .string()
  .trim()
  .min(1, "Cho team biết tên của bạn.")
  .max(60, "Tên tối đa 60 ký tự.");

/** Mã do trình duyệt sinh cho mỗi lần gửi (ví dụ UUID), để gửi lại không tạo bài trùng. */
const clientIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/, "clientId không hợp lệ.");

const tokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{32}$/, "Link không hợp lệ.");

export const pendingKeySchema = z.string().trim().min(1).max(300);

// ---------- Khách ----------

export const guestFeedbackParams = z
  .object({ token: tokenSchema, id: objectIdSchema })
  .strict();

export const createGuestFeedbackSchema = z
  .object({
    clientId: clientIdSchema,
    authorName: authorNameSchema,
    body: bodySchema,
    target: targetSchema.optional(),
    mark: markSchema.optional(),
    anchor: anchorSchema.optional(),
    // Ảnh chụp màn hình đã đẩy lên kho (key nhận từ POST /r/:token/uploads). Chỉ cho sản phẩm web.
    // Nên lưu góp ý trước rồi đính ảnh sau bằng PUT .../feedback/:id/screenshot để người dùng không phải chờ kho.
    screenshotKey: pendingKeySchema.optional(),
    // Vùng của trang mà ảnh bao phủ, khi ảnh là một vùng cắt quanh chỗ được chọn chứ không phải cả khung nhìn.
    screenshotRect: pageRect.optional(),
  })
  .strict();

/** Đính ảnh chụp cho góp ý đã lưu (ảnh chụp và đẩy lên kho chạy nền sau khi lưu). */
export const attachScreenshotSchema = z
  .object({
    screenshotKey: pendingKeySchema,
    screenshotRect: pageRect.optional(),
  })
  .strict();

/** Sửa nháp: nội dung, dấu, vị trí. null để bỏ dấu, bỏ gắn file, bỏ anchor. */
export const updateGuestFeedbackSchema = z
  .object({
    body: bodySchema.optional(),
    target: targetSchema.nullable().optional(),
    mark: markSchema.nullable().optional(),
    anchor: anchorSchema.nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Không có gì để cập nhật.");

export const guestReplySchema = z
  .object({ authorName: authorNameSchema, body: bodySchema })
  .strict();

export const verdictSchema = z
  .object({
    verdict: z.enum(VERDICTS, {
      error: "Chọn accepted (Đã đúng) hoặc rejected (Cần sửa tiếp).",
    }),
    // Lời nhắn kèm theo, vào luồng trao đổi của góp ý.
    note: bodySchema.optional(),
    authorName: authorNameSchema.optional(),
  })
  .strict();

export const guestUploadSchema = z
  .object({
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"], {
      error: "Ảnh chụp phải là PNG, JPG hoặc WebP.",
    }),
    bytes: z
      .number()
      .int()
      .positive({ error: "Thiếu dung lượng ảnh." })
      .max(5 * 1024 * 1024, "Ảnh chụp tối đa 5 MB."),
  })
  .strict();

export const bridgeCheckSchema = z
  .object({
    sdkKey: z.string().regex(/^[0-9a-f]{32}$/, "Khóa nhúng không hợp lệ."),
  })
  .strict();

// ---------- Team ----------

export const feedbackIdParams = z.object({ id: objectIdSchema }).strict();

/** Lọc danh sách của team. status không nhận draft: nháp của khách không bao giờ tới team. */
const listFilters = {
  status: z.enum(FEEDBACK_STATUSES.filter((s) => s !== "draft")).optional(),
  visibility: z.enum(FEEDBACK_VISIBILITIES).optional(),
  // me: giao cho tôi. none: chưa giao ai. Hoặc id của một thành viên.
  assignee: z.union([z.enum(["me", "none"]), objectIdSchema]).optional(),
  round: z.coerce.number().int().min(1).optional(),
};

export const listDeliverableFeedbackQuery = z.object(listFilters).strict();

export const listOrderFeedbackQuery = z
  .object({ ...listFilters, deliverableId: objectIdSchema.optional() })
  .strict();

export const listMineQuery = z.object({ status: listFilters.status }).strict();

/** Team tự thêm góp ý. Mặc định là ghi chú "chỉ team"; đặt visibility "customer" để khách thấy. */
export const createMemberFeedbackSchema = z
  .object({
    clientId: clientIdSchema,
    body: bodySchema,
    visibility: z.enum(FEEDBACK_VISIBILITIES).default("team"),
    target: targetSchema.optional(),
    mark: markSchema.optional(),
    anchor: anchorSchema.optional(),
  })
  .strict();

export const triageSchema = z
  .object({
    version: z.number().int().positive({ error: "Thiếu version." }),
    status: z
      .enum(TRIAGE_STATUSES, {
        error: "Trạng thái chỉ nhận open, in_progress hoặc done.",
      })
      .optional(),
    // null để bỏ giao.
    assigneeId: objectIdSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body).some((key) => key !== "version"),
    "Không có gì để cập nhật."
  );

export const memberReplySchema = z
  .object({
    body: bodySchema,
    // customer: khách thấy. team: ghi chú nội bộ.
    visibility: z.enum(FEEDBACK_VISIBILITIES).default("customer"),
  })
  .strict();
