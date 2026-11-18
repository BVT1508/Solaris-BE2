import { z } from "zod";
import { CLIENT_SOURCES } from "../utils/enums.js";
import { objectIdSchema } from "./common.js";

export const clientIdParams = z.object({ id: objectIdSchema }).strict();

export const listClientsQuery = z
  .object({
    search: z.string().trim().max(100).optional(),
    source: z.enum(CLIENT_SOURCES).optional(),
    tag: z.string().trim().max(50).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: objectIdSchema.optional(),
  })
  .strict();

export const updateClientSchema = z
  .object({
    version: z.number().int().positive({ error: "Thiếu version." }),
    name: z.string().trim().min(1).max(150).optional(),
    source: z.enum(CLIENT_SOURCES).optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (body) => Object.keys(body).some((key) => key !== "version"),
    "Không có gì để cập nhật."
  );
