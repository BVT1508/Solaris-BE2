import { z } from "zod";
import { ACTIVITY_CATEGORIES } from "../services/activityService.js";
import { objectIdSchema } from "./common.js";

/** Hoạt động của đơn: lọc theo nhóm việc, theo sản phẩm, theo người làm. */
export const listActivityQuery = z
  .object({
    category: z
      .enum(ACTIVITY_CATEGORIES, { error: "Nhóm hoạt động không hợp lệ." })
      .optional(),
    deliverableId: objectIdSchema.optional(),
    memberId: objectIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    cursor: objectIdSchema.optional(),
  })
  .strict();
