import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join, resolve as resolvePath } from "node:path";
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
import type { ModelCredentialStore } from "./model-credentials";

const DEFAULT_MODEL = "deepseek-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const settingsOperations = new Map<string, Promise<void>>();

type ModelConfigFile = {
  provider: "deepseek";
  model: string;
  base_url: string;
  reasoning_effort?: ReasoningEffort;
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
  credentials: ModelCredentialStore,
  environment: Record<string, string | undefined> = process.env,
): ModelSettingsService {
  const settingsDir = join(dataDir, "agent-host");
  const configPath = join(settingsDir, "config.json");
  const pendingPath = join(settingsDir, "settings-transaction.json");
  const operationPath = process.platform === "win32" ? resolvePath(configPath).toLowerCase() : resolvePath(configPath);
  const defaults: ModelConfigFile = {
    provider: "deepseek",
    model: environment.AGENT_MODEL?.trim() || environment.DEEPSEEK_MODEL?.trim() || environment.VITE_DEFAULT_AGENT_MODEL?.trim() || DEFAULT_MODEL,
    base_url: environment.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL,
  };
  const environmentEffort = environment.DEEPSEEK_REASONING_EFFORT ? reasoningEffortSchema.parse(environment.DEEPSEEK_REASONING_EFFORT) : undefined;

  function serial<T>(operation: () => Promise<T>): Promise<T> {
    const previous = settingsOperations.get(operationPath) ?? Promise.resolve();
    const running = previous.then(operation);
    const settled = running.then(() => {}, () => {});
    settingsOperations.set(operationPath, settled);
    void settled.then(() => {
      if (settingsOperations.get(operationPath) === settled) settingsOperations.delete(operationPath);
    });
    return running;
  }

  async function hasPendingUpdate(): Promise<boolean> {
    try { await readFile(pendingPath); return true; }
    catch (error) { if (isNodeError(error) && error.code === "ENOENT") return false; throw error; }
  }

  async function beginUpdate(): Promise<void> {
    await mkdir(settingsDir, { recursive: true });
    // 标记不含凭据；先同步到磁盘，任何半次保存或重启都不能放行不匹配的 Key。
    const handle = await open(pendingPath, "w", 0o600);
    try { await handle.writeFile('{"pending":true}\n', "utf8"); await handle.sync(); }
    finally { await handle.close(); }
  }

  async function resolveUnlocked(): Promise<ResolvedModelSettings> {
    const config = await readConfig(configPath, defaults);
    let apiKey = await hasPendingUpdate() ? undefined : await credentials.get();
    if (apiKey) {
      const current = await readConfig(configPath, defaults);
      if (current.base_url !== config.base_url || current.provider !== config.provider || await hasPendingUpdate()) apiKey = undefined;
    }
    const effort = config.reasoning_effort ?? environmentEffort;
    return {
      provider: "deepseek",
      model: config.model,
      baseUrl: config.base_url,
      apiKey,
      ...(effort !== undefined ? { reasoningEffort: effort } : {}),
    };
  }

  async function getUnlocked(): Promise<ModelSettingsResponse> {
    const settings = await resolveUnlocked();
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
    get: () => serial(getUnlocked),
    resolve: () => serial(resolveUnlocked),
    getSelection: () => serial(async () => {
      const settings = await resolveUnlocked();
      return modelSelection(settings.model, settings.reasoningEffort);
    }),
    updateSelection: (input) => serial(async () => {
      const parsed = modelSelectionUpdateSchema.parse(input);
      const selection = modelSelection(parsed.model, parsed.reasoning_effort ?? undefined);
      if (selection.reasoning_effort !== parsed.reasoning_effort) throw new Error("该模型不支持所选推理强度");
      const config = await readConfig(configPath, defaults);
      await writeJsonAtomic(configPath, { ...config, model: parsed.model, reasoning_effort: parsed.reasoning_effort ?? undefined });
      return selection;
    }),
    update: (input) => serial(async () => {
      const parsed = modelSettingsUpdateSchema.parse(input);
      if (await hasPendingUpdate() && !parsed.api_key) throw new Error("模型设置保存未完成，请重新填写 API Key 后保存，或先清除密钥。");
      const config = await readConfig(configPath, defaults);
      await beginUpdate();
      if (parsed.api_key) await credentials.set(parsed.api_key);
      await writeJsonAtomic(configPath, {
        provider: "deepseek",
        model: parsed.model,
        base_url: parsed.base_url,
        ...(config.reasoning_effort ? { reasoning_effort: config.reasoning_effort } : {}),
      } satisfies ModelConfigFile);
      await unlink(pendingPath);
      return getUnlocked();
    }),
    clearApiKey: () => serial(async () => {
      await beginUpdate();
      await credentials.clear();
      await unlink(pendingPath);
      return getUnlocked();
    }),
  };
}

function apiKeyPreview(value: string | undefined): string | null {
  if (!value) return null;
  return value.length > 4 ? `...${value.slice(-4)}` : "...****";
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
  const effort = record.reasoning_effort === undefined ? undefined : reasoningEffortSchema.parse(record.reasoning_effort);
  return { provider: "deepseek", model: record.model, base_url: record.base_url,
    ...(effort !== undefined ? { reasoning_effort: effort } : {}) };
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
  const handle = await open(temporaryPath, "w", 0o600);
  try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8"); await handle.sync(); }
  finally { await handle.close(); }
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
