import { z } from "zod";

export const DEFAULT_MODEL_API_PROTOCOL = "responses";
export const modelApiProtocolSchema = z.enum([DEFAULT_MODEL_API_PROTOCOL, "chat_completions"]);
export type ModelApiProtocol = z.infer<typeof modelApiProtocolSchema>;

export const modelSettingsResponseSchema = z.object({
  provider: z.literal("deepseek"),
  model: z.string().min(1),
  base_url: z.string().url(),
  api_protocol: modelApiProtocolSchema,
  api_key: z.object({
    configured: z.boolean(),
    preview: z.string().nullable(),
  }).strict(),
}).strict();

export const modelSettingsUpdateSchema = z.object({
  model: z.string().trim().min(1),
  base_url: z.string().url(),
  api_protocol: modelApiProtocolSchema.optional(),
  api_key: z.string().trim().min(1).optional(),
}).strict();

export type ModelSettingsResponse = z.infer<typeof modelSettingsResponseSchema>;
export type ModelSettingsUpdate = z.infer<typeof modelSettingsUpdateSchema>;
