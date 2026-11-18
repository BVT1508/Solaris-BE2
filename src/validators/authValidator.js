import { z } from "zod";

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email tối đa 254 ký tự.")
  .pipe(z.email({ error: "Email không hợp lệ." }));

export const devLoginSchema = z.object({ email: emailSchema }).strict();

export const googleCallbackSchema = z
  .object({
    code: z.string().min(1).optional(),
    state: z.string().min(1).optional(),
    error: z.string().optional(),
  })
  .passthrough();
