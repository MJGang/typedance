import type { ModelSelection, ReasoningEffort } from "@typedance/contracts";
import { createHash } from "node:crypto";
import type { AgentHostModelRuntimeConfiguration } from "./index";
import type { ResolvedModelSettings } from "./model-settings";

export const DEEPSEEK_MODELS: ModelSelection["models"] = [
  { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", context_window: 1_048_576, reasoning_efforts: ["off", "low", "high", "max"] },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", context_window: 1_048_576, reasoning_efforts: ["off", "low", "high", "max"] },
];

/** 为一次模型调用生成预算与指纹；模型容量和产品输入预算分别管理。 */
export function modelRuntimeConfiguration(
  model: string,
  effort?: ReasoningEffort,
  providerOrigin = "https://api.deepseek.com",
): AgentHostModelRuntimeConfiguration {
  const capacity = DEEPSEEK_MODELS.find((entry) => entry.id === model)?.context_window;
  const baseUrl = providerOrigin.replace(/\/+$/, "");
  const effectiveEffort = effort ?? "high";
  return {
    contextWindow: {
      maxInputTokens: capacity ? 160_000 : 64_000,
      compactAtRatio: 0.8,
      // 覆盖工具允许的 12000 字中文正文与结构元数据，避免进入模型历史时再次截断。
      toolOutputTokens: 32_000,
      ...(capacity ? { modelContextTokens: capacity } : {}),
      reservedOutputTokens: effectiveEffort === "off" ? 8_192 : effectiveEffort === "max" ? 131_072 : 65_536,
      growthHeadroomTokens: 8_192,
    },
    modelConfigurationKey: createHash("sha256").update(JSON.stringify({ protocol: "deepseek-chat-v1", baseUrl, model, effort: effectiveEffort })).digest("hex"),
    modelOptions: { reasoningEffort: effectiveEffort, providerBaseUrl: baseUrl },
  };
}

/** 模型和服务地址属于本轮；推理强度在下一次模型调用边界读取当前保存值。 */
export async function createModelRuntimeConfiguration(
  requestedModel: string | undefined,
  resolveSettings: () => Pick<ResolvedModelSettings, "model" | "baseUrl" | "reasoningEffort"> | Promise<Pick<ResolvedModelSettings, "model" | "baseUrl" | "reasoningEffort">>,
): Promise<AgentHostModelRuntimeConfiguration> {
  const settings = await resolveSettings();
  const model = requestedModel ?? settings.model;
  const baseUrl = settings.baseUrl.replace(/\/+$/, "");
  return {
    ...modelRuntimeConfiguration(model, settings.reasoningEffort, baseUrl),
    refresh: async () => {
      const updated = await resolveSettings();
      if (updated.baseUrl.replace(/\/+$/, "") !== baseUrl) throw new Error("模型服务地址已改变，请重新开始本轮任务");
      return modelRuntimeConfiguration(model, updated.reasoningEffort, baseUrl);
    },
  };
}

export function modelSelection(model: string, effort?: ReasoningEffort): ModelSelection {
  const known = DEEPSEEK_MODELS.find((entry) => entry.id === model);
  return {
    model, reasoning_effort: known ? effort ?? "high" : null,
    models: known ? DEEPSEEK_MODELS : [...DEEPSEEK_MODELS, { id: model, name: model, context_window: null, reasoning_efforts: [] }],
  };
}
