import { z } from "zod";
import {
  CLIENT_SOURCES,
  ORDER_TYPES,
  ORDER_STATUSES,
  MANUAL_ORDER_STATUSES,
} from "../utils/enums.js";
import { objectIdSchema } from "./common.js";

const text = (max, label) =>
  z.string().trim().max(max, `${label} tối đa ${max} ký tự.`);

const requiredText = (max, label) =>
  text(max, label).min(1, `${label} không được để trống.`);

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email({ error: "Email không hợp lệ." }))
  .optional();

// Điện thoại dùng luôn làm Zalo nên không có trường zalo riêng. Tối đa 20 ký tự, ít nhất 8 chữ số.
const phoneSchema = z
  .string()
  .trim()
  .max(20, "Số điện thoại tối đa 20 ký tự.")
  .regex(/^\+?[0-9 .-]{8,20}$/, "Số điện thoại không hợp lệ.")
  .refine((value) => value.replace(/\D/g, "").length >= 8, {
    error: "Số điện thoại không hợp lệ.",
  })
  .optional();

// Hạn: chỉ nhận chuỗi ngày hoặc Date. z.coerce.date() trần sẽ ép null thành 01/01/1970 và true thành 1 ms.
const deadlineSchema = z.preprocess(
  (value) =>
    typeof value === "string" || value instanceof Date
      ? new Date(value)
      : value,
  z.date({ error: "Hạn không hợp lệ." })
);

const contactSchema = z
  .object({
    name: requiredText(100, "Tên người liên hệ"),
    phone: phoneSchema,
    email: optionalEmail,
  })
  .strict();

/** Khách mới tạo ngay trong request tạo đơn. */
const newClientSchema = z
  .object({
    name: requiredText(150, "Tên khách hàng"),
    contact: contactSchema.optional(),
    source: z.enum(CLIENT_SOURCES).optional(),
  })
  .strict();

export const orderIdParams = z.object({ id: objectIdSchema }).strict();

export const listOrdersQuery = z
  .object({
    status: z.enum(ORDER_STATUSES).optional(),
    type: z.enum(ORDER_TYPES).optional(),
    clientId: objectIdSchema.optional(),
    search: text(100, "Từ khóa").optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: objectIdSchema.optional(),
  })
  .strict();

export const createOrderSchema = z
  .object({
    clientId: objectIdSchema.optional(),
    client: newClientSchema.optional(),
    type: z.enum(ORDER_TYPES, { error: "Loại đơn hàng không hợp lệ." }),
    title: requiredText(150, "Tiêu đề"),
    description: text(5000, "Mô tả").optional(),
    deadline: deadlineSchema.optional(),
    notes: text(5000, "Ghi chú").optional(),
    memberIds: z.array(objectIdSchema).max(50).default([]),
    // Leader của đơn (nhân viên hoặc quản lý). Tự nằm trong team, không cần lặp lại ở memberIds.
    leaderIds: z.array(objectIdSchema).max(50).default([]),
  })
  .strict()
  .refine((body) => Boolean(body.clientId) !== Boolean(body.client), {
    message:
      "Chọn khách hàng có sẵn (clientId) hoặc nhập khách mới (client), đúng một trong hai.",
    path: ["clientId"],
  });

export const updateOrderSchema = z
  .object({
    version: z.number().int().positive({ error: "Thiếu version." }),
    title: requiredText(150, "Tiêu đề").optional(),
    description: text(5000, "Mô tả").nullable().optional(),
    deadline: deadlineSchema.nullable().optional(),
    notes: text(5000, "Ghi chú").nullable().optional(),
    status: z
      .enum(MANUAL_ORDER_STATUSES, {
        error: "Chỉ đặt tay được trạng thái received hoặc in_progress.",
      })
      .optional(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body).some((key) => key !== "version"),
    "Không có gì để cập nhật."
  );

export const setOrderMembersSchema = z
  .object({
    version: z.number().int().positive({ error: "Thiếu version." }),
    memberIds: z.array(objectIdSchema).max(50),
    // Bỏ trống: giữ các leader hiện tại còn ở trong team. Chỉ quản trị viên đổi được danh sách này.
    leaderIds: z.array(objectIdSchema).max(50).optional(),
  })
  .strict();
