import { z } from "zod";
import {
  ROLES,
  MEMBER_STATUSES,
  SKILLS,
  SKILL_LEVELS,
} from "../utils/enums.js";
import { emailSchema } from "./authValidator.js";
import { objectIdSchema } from "./common.js";

const nameSchema = z
  .string()
  .trim()
  .min(1, "Tên không được để trống.")
  .max(100, "Tên tối đa 100 ký tự.");

const skillSchema = z
  .object({
    skill: z.enum(SKILLS, { error: "Kỹ năng không hợp lệ." }),
    level: z.enum(SKILL_LEVELS, { error: "Mức kỹ năng không hợp lệ." }),
  })
  .strict();

const skillsSchema = z
  .array(skillSchema)
  .max(SKILLS.length)
  .refine(
    (list) => new Set(list.map((s) => s.skill)).size === list.length,
    "Mỗi kỹ năng chỉ chọn một mức."
  );

export const memberIdParams = z.object({ id: objectIdSchema }).strict();

export const listMembersQuery = z
  .object({
    role: z.enum(ROLES).optional(),
    status: z.enum(MEMBER_STATUSES).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

export const createMemberSchema = z
  .object({
    email: emailSchema,
    name: nameSchema,
    role: z.enum(ROLES, { error: "Vai trò không hợp lệ." }),
    skills: skillsSchema.default([]),
    capacity: z.number().int().min(0).max(50).optional(),
  })
  .strict();

// Mọi trường tùy chọn, nhưng phải gửi ít nhất một. version bắt buộc để chống hai người sửa cùng lúc.
export const updateMemberSchema = z
  .object({
    version: z.number().int().positive({ error: "Thiếu version." }),
    name: nameSchema.optional(),
    role: z.enum(ROLES, { error: "Vai trò không hợp lệ." }).optional(),
    skills: skillsSchema.optional(),
    capacity: z.number().int().min(0).max(50).optional(),
    paused: z.boolean().optional(),
    slackUserId: z.string().trim().max(50).nullable().optional(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body).some((key) => key !== "version"),
    "Không có gì để cập nhật."
  );
