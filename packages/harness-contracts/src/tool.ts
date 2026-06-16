import { z } from "zod";

export const harnessToolOriginSchema = z.enum(["resource", "mcp", "plugin", "system"]);

export const harnessToolDescriptorSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
  origin: harnessToolOriginSchema,
  input_schema: z.record(z.unknown()).optional(),
  output_schema: z.record(z.unknown()).optional(),
});

export const harnessToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  origin: harnessToolOriginSchema,
  input: z.record(z.unknown()).default({}),
});

export const harnessToolResultSchema = z.object({
  tool_call_id: z.string().min(1),
  status: z.enum(["completed", "failed", "canceled"]),
  output: z.unknown().optional(),
  error: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
      details: z.record(z.unknown()).optional(),
    })
    .optional(),
});

export type HarnessToolOrigin = z.infer<typeof harnessToolOriginSchema>;
export type HarnessToolDescriptor = z.infer<typeof harnessToolDescriptorSchema>;
export type HarnessToolCall = z.infer<typeof harnessToolCallSchema>;
export type HarnessToolResult = z.infer<typeof harnessToolResultSchema>;
