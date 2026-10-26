import type { ModelSelection, ReasoningEffort } from "@typedance/contracts";
import { createHash } from "node:crypto";
import type { AgentHostModelRuntimeConfiguration } from "./index";

export const DEEPSEEK_MODELS: ModelSelection["models"] = [
  { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", context_window: 1_048_576, reasoning_efforts: ["off", "low", "high", "max"] },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", context_window: 1_048_576, reasoning_efforts: ["off", "low", "high", "max"] },
];

/** 在每轮开始时固定实际模型配置；模型容量和产品输入预算分别管理。 */
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
      ...(capacity ? { modelContextTokens: capacity } : {}),
      reservedOutputTokens: effectiveEffort === "off" ? 8_192 : effectiveEffort === "max" ? 131_072 : 65_536,
      growthHeadroomTokens: 8_192,
    },
    modelConfigurationKey: createHash("sha256").update(JSON.stringify({ protocol: "deepseek-chat-v1", baseUrl, model, effort: effectiveEffort })).digest("hex"),
    modelOptions: { reasoningEffort: effectiveEffort, providerBaseUrl: baseUrl },
  };
}

export function modelSelection(model: string, effort?: ReasoningEffort): ModelSelection {
  const known = DEEPSEEK_MODELS.find((entry) => entry.id === model);
  return {
    model, reasoning_effort: known ? effort ?? "high" : null,
    models: known ? DEEPSEEK_MODELS : [...DEEPSEEK_MODELS, { id: model, name: model, context_window: null, reasoning_efforts: [] }],
  };
}
