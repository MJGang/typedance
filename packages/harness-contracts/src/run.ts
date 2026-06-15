import { z } from "zod";
import { isoDateTimeSchema } from "./shared";

export const harnessRunStatusSchema = z.enum([
  "queued",
  "running",
  "awaiting_permission",
  "awaiting_user_input",
  "completed",
  "failed",
  "canceled",
]);

export const harnessCapabilityPolicySchema = z.object({
  scope_ids: z.array(z.string().min(1)).default([]),
  plugin_ids: z.array(z.string().min(1)).default([]),
});

export const harnessRunRequestSchema = z.object({
  capability_policy: harnessCapabilityPolicySchema.default({}),
  user_message: z.string().min(1),
  context: z.record(z.unknown()).default({}),
});

export const harnessRunSchema = z.object({
  id: z.string().min(1),
  capability_policy: harnessCapabilityPolicySchema.default({}),
  status: harnessRunStatusSchema,
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type HarnessCapabilityPolicy = z.infer<typeof harnessCapabilityPolicySchema>;
export type HarnessRunStatus = z.infer<typeof harnessRunStatusSchema>;
export type HarnessRunRequest = z.infer<typeof harnessRunRequestSchema>;
export type HarnessRun = z.infer<typeof harnessRunSchema>;
