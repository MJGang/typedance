import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  modelSettingsUpdateSchema,
  type ModelSettingsResponse,
  type ModelSettingsUpdate,
} from "@typedance/contracts";

const DEFAULT_MODEL = "deepseek-flash";
const DEFAULT_BASE_URL = "https://api.deepseek.com";

type ModelConfigFile = {
  provider: "deepseek";
  model: string;
  base_url: string;
};

type ModelAuthFile = {
  api_key: string;
};

export type ResolvedModelSettings = {
  provider: "deepseek";
  model: string;
  baseUrl: string;
  apiKey: string | undefined;
};

export type ModelSettingsService = {
  get(): Promise<ModelSettingsResponse>;
  update(input: ModelSettingsUpdate): Promise<ModelSettingsResponse>;
  clearApiKey(): Promise<ModelSettingsResponse>;
  resolve(): Promise<ResolvedModelSettings>;
};

export function createFileModelSettings(
  dataDir: string,
  environment: Record<string, string | undefined> = process.env,
): ModelSettingsService {
  const settingsDir = join(dataDir, "agent-host");
  const configPath = join(settingsDir, "config.json");
  const authPath = join(settingsDir, "auth.json");

  async function resolve(): Promise<ResolvedModelSettings> {
    const config = await readConfig(configPath);
    const auth = await readAuth(authPath);
    const environmentKey = environment.TYPEDANCE_LLM_API_KEY?.trim() || environment.DEEPSEEK_API_KEY?.trim();
    return {
      provider: "deepseek",
      model: config.model,
      baseUrl: config.base_url,
      apiKey: environmentKey || auth?.api_key,
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
    async update(input) {
      const parsed = modelSettingsUpdateSchema.parse(input);
      await writeJsonAtomic(configPath, {
        provider: "deepseek",
        model: parsed.model,
        base_url: parsed.base_url,
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

async function readConfig(path: string): Promise<ModelConfigFile> {
  const value = await readOptionalJson(path);
  if (!value) {
    return { provider: "deepseek", model: DEFAULT_MODEL, base_url: DEFAULT_BASE_URL };
  }
  const record = objectRecord(value, "model config");
  if (record.provider !== "deepseek" || typeof record.model !== "string" || typeof record.base_url !== "string") {
    throw new Error("Invalid model config file");
  }
  return { provider: "deepseek", model: record.model, base_url: record.base_url };
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
