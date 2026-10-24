import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  modelSettingsUpdateSchema,
  modelSelectionUpdateSchema,
  reasoningEffortSchema,
  type ModelSelection,
  type ReasoningEffort,
  type ModelSettingsResponse,
  type ModelSettingsUpdate,
} from "@typedance/contracts";
import { modelSelection } from "./model-catalog";

const DEFAULT_MODEL = "deepseek-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

type ModelConfigFile = {
  provider: "deepseek";
  model: string;
  base_url: string;
  reasoning_effort?: ReasoningEffort;
};

type ModelAuthFile = {
  api_key: string;
};

export type ResolvedModelSettings = {
  provider: "deepseek";
  model: string;
  baseUrl: string;
  apiKey: string | undefined;
  reasoningEffort?: ReasoningEffort;
};

export type ModelSettingsService = {
  get(): Promise<ModelSettingsResponse>;
  update(input: ModelSettingsUpdate): Promise<ModelSettingsResponse>;
  clearApiKey(): Promise<ModelSettingsResponse>;
  resolve(): Promise<ResolvedModelSettings>;
  getSelection(): Promise<ModelSelection>;
  updateSelection(input: { model: string; reasoning_effort: ReasoningEffort | null }): Promise<ModelSelection>;
};

export function createFileModelSettings(
  dataDir: string,
  environment: Record<string, string | undefined> = process.env,
): ModelSettingsService {
  const settingsDir = join(dataDir, "agent-host");
  const configPath = join(settingsDir, "config.json");
  const authPath = join(settingsDir, "auth.json");
  const defaults: ModelConfigFile = {
    provider: "deepseek",
    model: environment.AGENT_MODEL?.trim() || environment.DEEPSEEK_MODEL?.trim() || environment.VITE_DEFAULT_AGENT_MODEL?.trim() || DEFAULT_MODEL,
    base_url: environment.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL,
    ...(environment.DEEPSEEK_REASONING_EFFORT ? { reasoning_effort: reasoningEffortSchema.parse(environment.DEEPSEEK_REASONING_EFFORT) } : {}),
  };

  async function resolve(): Promise<ResolvedModelSettings> {
    const config = await readConfig(configPath, defaults);
    const auth = await readAuth(authPath);
    const environmentKey = environment.TYPEDANCE_LLM_API_KEY?.trim() || environment.DEEPSEEK_API_KEY?.trim();
    return {
      provider: "deepseek",
      model: config.model,
      baseUrl: config.base_url,
      apiKey: environmentKey || auth?.api_key,
      ...(config.reasoning_effort ? { reasoningEffort: config.reasoning_effort } : {}),
    };
  }

  async function get(): Promise<ModelSettingsResponse> {
    const settings = await resolve();
    return {
      provider: settings.provider,
      model: settings.model,
      base_url: settings.baseUrl,
      api_key: {
        configured: Boolean(settings.apiKey),
        preview: apiKeyPreview(settings.apiKey),
      },
    };
  }

  return {
    get,
    resolve,
    async getSelection() {
      const settings = await resolve();
      return modelSelection(settings.model, settings.reasoningEffort);
    },
    async updateSelection(input) {
      const parsed = modelSelectionUpdateSchema.parse(input);
      const selection = modelSelection(parsed.model, parsed.reasoning_effort ?? undefined);
      if (selection.reasoning_effort !== parsed.reasoning_effort) throw new Error("该模型不支持所选推理强度");
      const config = await readConfig(configPath, defaults);
      await writeJsonAtomic(configPath, { ...config, model: parsed.model, reasoning_effort: parsed.reasoning_effort ?? undefined });
      return selection;
    },
    async update(input) {
      const parsed = modelSettingsUpdateSchema.parse(input);
      const config = await readConfig(configPath, defaults);
      await writeJsonAtomic(configPath, {
        provider: "deepseek",
        model: parsed.model,
        base_url: parsed.base_url,
        ...(config.reasoning_effort ? { reasoning_effort: config.reasoning_effort } : {}),
      } satisfies ModelConfigFile);
      if (parsed.api_key) {
        await writeJsonAtomic(authPath, { api_key: parsed.api_key } satisfies ModelAuthFile);
      }
      return get();
    },
    async clearApiKey() {
      await rm(authPath, { force: true });
      return get();
    },
  };
}

function apiKeyPreview(value: string | undefined): string | null {
  return value ? `...${value.slice(-4)}` : null;
}

async function readConfig(path: string, defaults: ModelConfigFile): Promise<ModelConfigFile> {
  const value = await readOptionalJson(path);
  if (!value) {
    return defaults;
  }
  const record = objectRecord(value, "model config");
  if (record.provider !== "deepseek" || typeof record.model !== "string" || typeof record.base_url !== "string") {
    throw new Error("Invalid model config file");
  }
  return { provider: "deepseek", model: record.model, base_url: record.base_url,
    ...(record.reasoning_effort !== undefined ? { reasoning_effort: reasoningEffortSchema.parse(record.reasoning_effort) } : {}) };
}

async function readAuth(path: string): Promise<ModelAuthFile | undefined> {
  const value = await readOptionalJson(path);
  if (!value) return undefined;
  const record = objectRecord(value, "model auth");
  if (typeof record.api_key !== "string" || !record.api_key.trim()) {
    throw new Error("Invalid model auth file");
  }
  return { api_key: record.api_key };
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${label} file`);
  }
  return value as Record<string, unknown>;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
