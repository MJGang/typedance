import {
  harnessToolCallSchema,
  harnessToolResultSchema,
  type HarnessToolCall,
  type HarnessToolOrigin,
  type HarnessToolResult,
  type HarnessContentPart,
} from "@typedance/harness-contracts";
import type { HarnessPermissionRequirement } from "../permission/permission-engine";

/** 工具可单独返回可记录的元数据与仅供模型读取的多模态内容。 */
export class HarnessToolOutput {
  constructor(readonly output: unknown, readonly content: HarnessContentPart[]) {}
}

export type HarnessToolHandler = (
  input: Record<string, unknown>,
  call: HarnessToolCall,
  context: { signal: AbortSignal }
) => Promise<unknown> | unknown;

export type HarnessToolRegistration = {
  name: string;
  origin: HarnessToolOrigin;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  handler: HarnessToolHandler;
  requiresPermission?: (input: Record<string, unknown>, call: HarnessToolCall) => HarnessPermissionRequirement | undefined;
};

export type HarnessToolInvocationResult =
  | { status: "completed"; result: HarnessToolResult }
  | { status: "failed"; result: HarnessToolResult };

export class HarnessToolRegistry {
  #tools = new Map<string, HarnessToolRegistration>();

  register(registration: HarnessToolRegistration): HarnessToolRegistration {
    this.#tools.set(registration.name, registration);
    return registration;
  }

  has(name: string): boolean {
    return this.#tools.has(name);
  }

  get(name: string): HarnessToolRegistration {
    const registration = this.#tools.get(name);
    if (!registration) {
      throw new Error(`Unknown harness tool: ${name}`);
    }
    return registration;
  }

  describe(name: string): {
    name: string;
    origin: HarnessToolOrigin;
    description: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
  } {
    const registration = this.get(name);
    return {
      name: registration.name,
      origin: registration.origin,
      description: registration.description ?? `Harness tool ${registration.name}`,
      inputSchema: registration.inputSchema,
      outputSchema: registration.outputSchema,
    };
  }

  parseCall(input: HarnessToolCall): HarnessToolCall {
    return harnessToolCallSchema.parse(input);
  }

  async invoke(call: HarnessToolCall, context = { signal: new AbortController().signal }): Promise<HarnessToolInvocationResult> {
    context.signal.throwIfAborted();
    const parsedCall = this.parseCall(call);
    const registration = this.get(parsedCall.name);

    if (registration.origin !== parsedCall.origin) {
      throw new Error(`Tool origin mismatch for ${parsedCall.name}: ${parsedCall.origin}`);
    }

    try {
      const output = await registration.handler(parsedCall.input, parsedCall, context);
      const result = harnessToolResultSchema.parse({
        tool_call_id: parsedCall.id,
        status: "completed",
        output: output instanceof HarnessToolOutput ? output.output : output,
        ...(output instanceof HarnessToolOutput ? { content: output.content } : {}),
      });
      return { status: "completed", result };
    } catch (error) {
      const result = harnessToolResultSchema.parse({
        tool_call_id: parsedCall.id,
        status: "failed",
        error: {
          code: "tool_failed",
          message: error instanceof Error ? error.message : "Tool failed",
        },
      });
      return { status: "failed", result };
    }
  }
}
