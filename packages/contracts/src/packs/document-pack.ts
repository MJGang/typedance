import { z } from "zod";

export const moduleSpecSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  required: z.boolean().default(false),
  repeatable: z.boolean().default(false),
  default_visibility: z.enum(["visible", "hidden"]).default("visible"),
});

export const issueTypeSpecSchema = z.object({
  type: z.string().min(1),
  default_severity: z.enum(["info", "warning", "blocking"]),
  title: z.string().min(1),
});

export const actionSpecSchema = z.object({
  action_type: z.string().min(1),
  label: z.string().min(1),
  creates_run_type: z.string().optional(),
});

export const qualityRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(["info", "warning", "blocking"]),
});

export const evidenceRuleSchema = z.object({
  id: z.string().min(1),
  claim_type: z.string().min(1),
  requires_evidence: z.boolean(),
  requires_user_confirmation_when_missing: z.boolean(),
});

export const agentContractSchema = z.object({
  agent_name: z.string().min(1),
  input_schema: z.string().min(1),
  output_schema: z.string().min(1),
});

export const renderMappingSchema = z.object({
  default_profile: z.string().min(1),
  supported_profiles: z.array(z.string()).default([]),
});

export const documentPackSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  modules: z.array(moduleSpecSchema),
  issue_types: z.array(issueTypeSpecSchema),
  actions: z.array(actionSpecSchema),
  quality_rules: z.array(qualityRuleSchema),
  evidence_rules: z.array(evidenceRuleSchema),
  agent_contracts: z.array(agentContractSchema),
  render_mapping: renderMappingSchema,
});

export type ModuleSpec = z.infer<typeof moduleSpecSchema>;
export type IssueTypeSpec = z.infer<typeof issueTypeSpecSchema>;
export type ActionSpec = z.infer<typeof actionSpecSchema>;
export type QualityRule = z.infer<typeof qualityRuleSchema>;
export type EvidenceRule = z.infer<typeof evidenceRuleSchema>;
export type AgentContract = z.infer<typeof agentContractSchema>;
export type RenderMapping = z.infer<typeof renderMappingSchema>;
export type DocumentPack = z.infer<typeof documentPackSchema>;
