import { z } from "zod";
import { harnessPermissionKindSchema } from "./permission";

export const harnessPluginScopeSchema = z.string().min(1).regex(/^[a-zA-Z0-9._:-]+$/);

export const harnessSkillDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  instruction_files: z.array(z.string().min(1)).default([]),
  tool_names: z.array(z.string().min(1)).default([]),
});

export const harnessAgentRoleSchema = z.enum(["primary", "subagent", "reviewer", "dream", "verifier"]);

export const harnessAgentDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: harnessAgentRoleSchema,
  description: z.string().min(1).optional(),
  skill_ids: z.array(z.string().min(1)).default([]),
  allowed_tool_names: z.array(z.string().min(1)).default([]),
});

export const harnessMcpServerDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    transport: z.enum(["stdio", "http", "sse"]),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).default([]),
    url: z.string().url().optional(),
    env: z.record(z.string()).default({}),
  })
  .superRefine((server, ctx) => {
    if (server.transport === "stdio" && !server.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "stdio MCP servers require command",
        path: ["command"],
      });
    }

    if ((server.transport === "http" || server.transport === "sse") && !server.url) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "remote MCP servers require url",
        path: ["url"],
      });
    }
  });

export const harnessPluginManifestSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  module_format: z.literal("esm"),
  scopes: z.array(harnessPluginScopeSchema).min(1),
  description: z.string().min(1).optional(),
  instructions: z.array(z.string().min(1)).default([]),
  skills: z.array(harnessSkillDefinitionSchema).default([]),
  agents: z.array(harnessAgentDefinitionSchema).default([]),
  mcp_servers: z.array(harnessMcpServerDefinitionSchema).default([]),
  permissions: z.array(harnessPermissionKindSchema).default([]),
});

export type HarnessPluginScope = z.infer<typeof harnessPluginScopeSchema>;
export type HarnessSkillDefinition = z.infer<typeof harnessSkillDefinitionSchema>;
export type HarnessAgentRole = z.infer<typeof harnessAgentRoleSchema>;
export type HarnessAgentDefinition = z.infer<typeof harnessAgentDefinitionSchema>;
export type HarnessMcpServerDefinition = z.infer<typeof harnessMcpServerDefinitionSchema>;
export type HarnessPluginManifest = z.infer<typeof harnessPluginManifestSchema>;
