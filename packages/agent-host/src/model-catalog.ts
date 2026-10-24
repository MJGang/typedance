import type { ModelSelection, ReasoningEffort } from "@typedance/contracts";

export const DEEPSEEK_MODELS: ModelSelection["models"] = [
  { id: "deepseek-flash", name: "DeepSeek-V4.1-Flash", context_window: 1_000_000, reasoning_efforts: ["off", "low", "high", "max"] },
  { id: "deepseek-v4-pro", name: "DeepSeek-V4-Pro", context_window: 1_000_000, reasoning_efforts: ["off", "low", "high", "max"] },
];

export function modelSelection(model: string, effort?: ReasoningEffort): ModelSelection {
  const known = DEEPSEEK_MODELS.find((entry) => entry.id === model);
  return {
    model, reasoning_effort: known ? effort ?? "high" : null,
    models: known ? DEEPSEEK_MODELS : [...DEEPSEEK_MODELS, { id: model, name: model, context_window: null, reasoning_efforts: [] }],
  };
}
