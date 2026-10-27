import { z } from "zod";
import { isoDateTimeSchema } from "./shared";
import { harnessPermissionDecisionSchema, harnessPermissionRequestSchema } from "./permission";
import { harnessCapabilityPolicySchema } from "./run";
import { harnessToolCallSchema, harnessToolResultSchema } from "./tool";
import { harnessPlanItemSchema } from "./checkpoint";
import { harnessUserQuestionSchema, harnessUserAnswersSchema } from "./user-input";

const harnessRunEventBaseSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  created_at: isoDateTimeSchema,
});

const harnessRunStartedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("run.started"),
  capability_policy: harnessCapabilityPolicySchema.default({}),
  input: z.record(z.unknown()).default({}),
});

const harnessAssistantDeltaEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("assistant.delta"),
  message_id: z.string().min(1),
  delta: z.string(),
});

const harnessReasoningSummaryDeltaEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("reasoning.summary.delta"),
  summary_id: z.string().min(1),
  delta: z.string(),
});

const harnessPlanUpdatedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("plan.updated"),
  items: z.array(harnessPlanItemSchema),
});

const harnessToolCallStartedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("tool.call.started"),
  tool_call: harnessToolCallSchema,
});

const harnessToolCallDeltaEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("tool.call.delta"),
  tool_call_id: z.string().min(1),
  delta: z.unknown(),
});

const harnessToolCallCompletedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("tool.call.completed"),
  result: harnessToolResultSchema,
});

const harnessPermissionRequestedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("permission.requested"),
  request: harnessPermissionRequestSchema,
});

const harnessPermissionResolvedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("permission.resolved"),
  decision: harnessPermissionDecisionSchema,
});

const harnessArtifactPatchProposedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("artifact.patch.proposed"),
  artifact_id: z.string().min(1),
  patch_id: z.string().min(1),
  summary: z.string().min(1),
  diff: z.string().optional(),
});

const harnessArtifactPatchAppliedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("artifact.patch.applied"),
  artifact_id: z.string().min(1),
  patch_id: z.string().min(1),
});

const harnessVerificationStartedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("verification.started"),
  verification_id: z.string().min(1),
  name: z.string().min(1),
});

const harnessVerificationCompletedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("verification.completed"),
  verification_id: z.string().min(1),
  status: z.enum(["passed", "failed", "canceled"]),
  summary: z.string().min(1).optional(),
});

const harnessEvidenceAddedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("evidence.added"),
  evidence_id: z.string().min(1),
  target: z.record(z.unknown()).default({}),
  summary: z.string().min(1),
});

const harnessMemoryUpdatedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("memory.updated"),
  memory_id: z.string().min(1),
  scope: z.enum(["run", "context", "user", "global"]),
  summary: z.string().min(1),
});

const harnessSubagentStartedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("subagent.started"),
  subagent_id: z.string().min(1),
  name: z.string().min(1),
});

const harnessSubagentCompletedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("subagent.completed"),
  subagent_id: z.string().min(1),
  status: z.enum(["completed", "failed", "canceled"]),
  summary: z.string().min(1).optional(),
});

const harnessRunCompletedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("run.completed"),
  output: z.record(z.unknown()).default({}),
});

const harnessRunFailedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("run.failed"),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    details: z.record(z.unknown()).optional(),
  }),
});

const harnessRunCanceledEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("run.canceled"),
  reason: z.string().min(1).optional(),
});

const harnessUserInputReceivedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("user.input.received"),
  input: z.record(z.unknown()).default({}),
});

const harnessUserInputAppliedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("user.input.applied"),
  input_id: z.string().min(1),
});

const harnessModelInputConsumedEventSchema = harnessRunEventBaseSchema.extend({
  type: z.literal("model.input.consumed"),
  input_ids: z.array(z.string().min(1)),
});

export const harnessRunEventSchema = z.discriminatedUnion("type", [
  harnessRunEventBaseSchema.extend({
    type: z.literal("model.call.started"), call_id: z.string(), model: z.string().optional(),
    purpose: z.enum(["response", "compaction"]), input_tokens: z.number().nonnegative(),
    predicted_input_tokens: z.number().nonnegative().optional(), input_calibrated: z.boolean().optional(),
    budget_tokens: z.number().positive(), system_tokens: z.number().nonnegative(),
    tool_tokens: z.number().nonnegative(), conversation_tokens: z.number().nonnegative(),
  }),
  harnessRunEventBaseSchema.extend({
    type: z.literal("model.call.progress"), call_id: z.string(),
    ttft_ms: z.number().nonnegative(), output_tokens: z.number().nonnegative(), output_characters: z.number().nonnegative(),
  }),
  harnessRunEventBaseSchema.extend({
    type: z.literal("model.call.completed"), call_id: z.string(), model: z.string().optional(),
    duration_ms: z.number().nonnegative(), ttft_ms: z.number().nonnegative().optional(),
    status: z.enum(["completed", "failed", "canceled"]),
    usage: z.object({
      inputTokens: z.number().nonnegative().optional(), outputTokens: z.number().nonnegative().optional(),
      totalTokens: z.number().nonnegative().optional(), cacheReadInputTokens: z.number().nonnegative().optional(),
      cacheMissInputTokens: z.number().nonnegative().optional(), reasoningOutputTokens: z.number().nonnegative().optional(),
    }).optional(),
  }),
  harnessRunEventBaseSchema.extend({ type: z.literal("interaction.superseded"), request_id: z.string(), kind: z.enum(["questions", "permissions"]) }),
  harnessRunEventBaseSchema.extend({ type: z.literal("model.retrying"), attempt: z.number().int(), max_retries: z.number().int(), delay_ms: z.number() }),
  harnessRunEventBaseSchema.extend({ type: z.literal("user.questions.requested"), request_id: z.string(), questions: z.array(harnessUserQuestionSchema) }),
  harnessRunEventBaseSchema.extend({ type: z.literal("user.questions.answered"), request_id: z.string(), answers: harnessUserAnswersSchema }),
  harnessRunEventBaseSchema.extend({ type: z.literal("context.compacted"), before_tokens: z.number(), after_tokens: z.number(), compaction: z.number().int() }),
  harnessRunEventBaseSchema.extend({ type: z.literal("run.resumed"), source_run_id: z.string() }),
  harnessRunEventBaseSchema.extend({ type: z.literal("completion.blocked"), message: z.string() }),
  harnessRunStartedEventSchema,
  harnessAssistantDeltaEventSchema,
  harnessReasoningSummaryDeltaEventSchema,
  harnessPlanUpdatedEventSchema,
  harnessToolCallStartedEventSchema,
  harnessToolCallDeltaEventSchema,
  harnessToolCallCompletedEventSchema,
  harnessPermissionRequestedEventSchema,
  harnessPermissionResolvedEventSchema,
  harnessArtifactPatchProposedEventSchema,
  harnessArtifactPatchAppliedEventSchema,
  harnessVerificationStartedEventSchema,
  harnessVerificationCompletedEventSchema,
  harnessEvidenceAddedEventSchema,
  harnessMemoryUpdatedEventSchema,
  harnessSubagentStartedEventSchema,
  harnessSubagentCompletedEventSchema,
  harnessRunCompletedEventSchema,
  harnessRunFailedEventSchema,
  harnessRunCanceledEventSchema,
  harnessUserInputReceivedEventSchema,
  harnessUserInputAppliedEventSchema,
  harnessModelInputConsumedEventSchema,
]);

export type HarnessRunEvent = z.infer<typeof harnessRunEventSchema>;
