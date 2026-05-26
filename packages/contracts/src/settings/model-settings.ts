import { z } from "zod";

export const modelProviderSchema = z.enum(["deepseek", "openai", "openai_compatible"]);
export const agentModeSchema = z.enum(["rule", "auto", "langchain"]);
export const apiKeySourceSchema = z.enum(["env", "auth_json", "none"]);

export const modelConfigSchema = z.object({
  provider: modelProviderSchema,
  model: z.string().min(1),
  base_url: z.string().url().nullable().optional(),
  temperature: z.number().min(0).max(2),
  timeout_seconds: z.number().positive(),
  structured_output: z.boolean(),
});

export const agentModeConfigSchema = z.object({
  parser: agentModeSchema,
  structurer: agentModeSchema,
  reviewer: agentModeSchema,
  rewriter: agentModeSchema,
  opportunity_calibrator: agentModeSchema,
});

export const apiKeyStatusSchema = z.object({
  configured: z.boolean(),
  source: apiKeySourceSchema,
  preview: z.string().nullable().optional(),
});

export const modelSettingsResponseSchema = z.object({
  config_path: z.string().min(1),
  auth_path: z.string().min(1),
  model: modelConfigSchema,
  agents: agentModeConfigSchema,
  api_key: apiKeyStatusSchema,
});

export const modelSettingsUpdateSchema = z.object({
  model: modelConfigSchema,
  agents: agentModeConfigSchema,
  api_key: z.string().min(1).optional(),
});

export const modelSettingsTestResponseSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});

export type ModelProvider = z.infer<typeof modelProviderSchema>;
export type AgentMode = z.infer<typeof agentModeSchema>;
export type ApiKeySource = z.infer<typeof apiKeySourceSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type AgentModeConfig = z.infer<typeof agentModeConfigSchema>;
export type ApiKeyStatus = z.infer<typeof apiKeyStatusSchema>;
export type ModelSettingsResponse = z.infer<typeof modelSettingsResponseSchema>;
export type ModelSettingsUpdate = z.infer<typeof modelSettingsUpdateSchema>;
export type ModelSettingsTestResponse = z.infer<typeof modelSettingsTestResponseSchema>;
