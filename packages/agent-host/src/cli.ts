#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createHarnessRuntime } from "@typedance/harness-core";
import {
  createAgentHost,
  createAgentHostServer,
  createJsonFileAgentHostStore,
} from "./index";
import {
  createDeepSeekModelAdapter,
  DEFAULT_DEEPSEEK_FLASH_MODEL,
} from "./model/deepseek";
import { createSidecarContextProvider } from "./sidecar-context";

const env = loadEnvironment();
const port = numberEnv(env.AGENT_HOST_PORT, 4327);
const hostname = env.AGENT_HOST_HOST ?? "127.0.0.1";
const dataDir = env.TYPEDANCE_DATA_DIR || join(homedir(), ".typedance");
const storeFile = env.AGENT_HOST_STORE_FILE || join(dataDir, "agent-host", "store.json");
const model = env.DEEPSEEK_MODEL || DEFAULT_DEEPSEEK_FLASH_MODEL;
const sidecarUrl = env.TYPEDANCE_SIDECAR_URL || "http://127.0.0.1:4317";

const runtime = createHarnessRuntime({
  model: createDeepSeekModelAdapter({
    apiKey: env.DEEPSEEK_API_KEY ?? "",
    baseUrl: env.DEEPSEEK_BASE_URL,
    defaultModel: model,
    reasoningEffort: parseReasoningEffort(env.DEEPSEEK_REASONING_EFFORT),
  }),
});

registerResumeWorkbenchPlugin(runtime);

const host = createAgentHost({
  runtime,
  defaultModel: model,
  contextProvider: createSidecarContextProvider({ baseUrl: sidecarUrl }),
  store: createJsonFileAgentHostStore(storeFile),
  packs: [
    {
      id: "resume",
      capabilityPolicy: { scopeIds: ["pack:resume"] },
      primaryAgentId: "typedance.resume.primary",
    },
  ],
});

const server = createAgentHostServer({ host });
server.listen(port, hostname);
server.nodeServer.on("listening", () => {
  console.log(`TypeDance Agent Host listening on http://${hostname}:${port}`);
  console.log(`Model: ${model}`);
  console.log(`Sidecar: ${sidecarUrl}`);
});

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

async function shutdown(): Promise<void> {
  await server.close();
  process.exit(0);
}

function registerResumeWorkbenchPlugin(runtime: ReturnType<typeof createHarnessRuntime>): void {
  runtime.registerPlugin({
    id: "typedance.resume.agent",
    name: "Resume Workbench Agent",
    version: "0.1.0",
    module_format: "esm",
    scopes: ["pack:resume"],
    description: "AI capabilities for the TypeDance resume workbench.",
    instructions: [],
    skills: [
      {
        id: "typedance.resume.context",
        name: "Resume Context Grounding",
        description: "Use user-mentioned local files, local folders, and webpages as read-only context.",
        instruction_files: [],
        tool_names: ["typedance.context.read"],
      },
      {
        id: "typedance.resume.canvas",
        name: "Resume Canvas Collaboration",
        description: "Discuss and propose changes for the active resume canvas according to the selected mutation mode.",
        instruction_files: [],
        tool_names: [],
      },
    ],
    agents: [
      {
        id: "typedance.resume.primary",
        name: "Resume Workbench Primary Agent",
        role: "primary",
        description: "Helps the user improve the active resume canvas using only the allowed resume workbench capabilities.",
        skill_ids: ["typedance.resume.context", "typedance.resume.canvas"],
        allowed_tool_names: ["typedance.context.read"],
      },
    ],
    mcp_servers: [],
    permissions: [],
  });
  runtime.registerTool({
    name: "typedance.context.read",
    origin: "mcp",
    handler: async (input) => ({
      status: "available_via_agent_host_context_provider",
      context_source_id: input.context_source_id,
      target_path: input.target_path,
    }),
  });
}

function loadEnvironment(): NodeJS.ProcessEnv {
  const envFile = process.env.TYPEDANCE_ENV_FILE || findUp(".env", process.cwd());
  if (envFile) {
    for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
      const parsed = parseEnvLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
  return process.env;
}

function findUp(filename: string, startDir: string): string | undefined {
  let current = resolve(startDir);
  while (true) {
    const candidate = join(current, filename);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function parseEnvLine(line: string): [string, string] | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const index = trimmed.indexOf("=");
  if (index < 1) return undefined;
  const key = trimmed.slice(0, index).trim();
  const rawValue = trimmed.slice(index + 1).trim();
  const value = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  return [key, value];
}

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseReasoningEffort(value: string | undefined): "low" | "medium" | "high" | "max" | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "max") return value;
  return undefined;
}
