import { z } from "zod";

export const modelSettingsResponseSchema = z.object({
  provider: z.literal("deepseek"),
  model: z.string().min(1),
  base_url: z.string().url(),
  api_key: z.object({
    configured: z.boolean(),
    preview: z.string().nullable(),
  }).strict(),
}).strict();

export const modelSettingsUpdateSchema = z.object({
  model: z.string().trim().min(1),
  base_url: z.string().url(),
  api_key: z.string().trim().min(1).optional(),
}).strict();

export type ModelSettingsResponse = z.infer<typeof modelSettingsResponseSchema>;
export type ModelSettingsUpdate = z.infer<typeof modelSettingsUpdateSchema>;
