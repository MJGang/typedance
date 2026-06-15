import { z } from "zod";
import { isoDateTimeSchema } from "./shared";

export const harnessPermissionKindSchema = z.enum([
  "filesystem.read",
  "filesystem.write",
  "network",
  "shell",
  "mcp.tool",
  "artifact.write",
  "memory.read",
  "memory.write",
]);

export const harnessPermissionScopeSchema = z.object({
  uri: z.string().min(1),
  access: z.enum(["read", "write", "execute", "connect", "invoke"]),
  metadata: z.record(z.unknown()).optional(),
});

export const harnessPermissionRequestSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  tool_call_id: z.string().min(1).optional(),
  kind: harnessPermissionKindSchema,
  reason: z.string().min(1),
  scope: harnessPermissionScopeSchema,
  created_at: isoDateTimeSchema,
});

export const harnessPermissionDecisionSchema = z.object({
  id: z.string().min(1),
  request_id: z.string().min(1),
  status: z.enum(["approved", "denied"]),
  remember: z.enum(["never", "run", "workspace", "always"]).default("never"),
  created_at: isoDateTimeSchema,
});

export type HarnessPermissionKind = z.infer<typeof harnessPermissionKindSchema>;
export type HarnessPermissionScope = z.infer<typeof harnessPermissionScopeSchema>;
export type HarnessPermissionRequest = z.infer<typeof harnessPermissionRequestSchema>;
export type HarnessPermissionDecision = z.infer<typeof harnessPermissionDecisionSchema>;
