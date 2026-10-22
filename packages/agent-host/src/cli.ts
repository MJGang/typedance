#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHarnessRuntime } from "@typedance/harness-core";
import {
  createAgentHost,
  createAgentHostServer,
  createFileModelSettings,
  createJsonFileAgentHostStore,
} from "./index";
import { loadExplicitEnvironment } from "./environment";
import {
  createDeepSeekModelAdapter,
} from "./model/deepseek";
import {
  createResumePluginLoader,
  registerResumeWorkbenchPlugin,
  RESUME_PRIMARY_AGENT_ID,
} from "./resume-plugin";
import { createSidecarContextProvider } from "./sidecar-context";
import { createSidecarTextEditPreviewer } from "./text-edit";
import { createSidecarPageReader } from "./resume-tools";
import { createLangfuseTelemetry } from "./observability/langfuse";

async function main(): Promise<void> {
  const env = loadExplicitEnvironment(process.env, (path) => readFileSync(path, "utf8"));
  const port = numberEnv(env.AGENT_HOST_PORT, 4327);
  const hostname = env.AGENT_HOST_HOST ?? "127.0.0.1";
  const dataDir = env.TYPEDANCE_DATA_DIR || join(homedir(), ".typedance");
  const storeFile = env.AGENT_HOST_STORE_FILE || join(dataDir, "agent-host", "store.json");
  const model = env.AGENT_MODEL?.trim() || env.DEEPSEEK_MODEL?.trim() || env.VITE_DEFAULT_AGENT_MODEL?.trim() || undefined;
  const sidecarUrl = env.TYPEDANCE_SIDECAR_URL || "http://127.0.0.1:4317";
  const modelSettings = createFileModelSettings(dataDir, env);
  const pluginLoader = env.TYPEDANCE_PLUGIN_ROOT
    ? createResumePluginLoader(env.TYPEDANCE_PLUGIN_ROOT)
    : createResumePluginLoader();

  const telemetry = createLangfuseTelemetry(env);
  const runtime = createHarnessRuntime({
    observer: telemetry?.observer,
    skillContentLoader: pluginLoader.createSkillContentLoader(),
    model: createDeepSeekModelAdapter({
      resolveSettings: async () => {
        const settings = await modelSettings.resolve();
        return {
          apiKey: settings.apiKey,
          baseUrl: env.DEEPSEEK_BASE_URL?.trim() || settings.baseUrl,
          defaultModel: model || settings.model,
        };
      },
      reasoningEffort: parseReasoningEffort(env.DEEPSEEK_REASONING_EFFORT),
    }),
  });

  await registerResumeWorkbenchPlugin(runtime, pluginLoader);
  const host = createAgentHost({
    runtime,
    defaultModel: model,
    contextProvider: createSidecarContextProvider({ baseUrl: sidecarUrl }),
    resumeTools: {
      textEditPreviewer: createSidecarTextEditPreviewer(sidecarUrl),
      pageReader: createSidecarPageReader(sidecarUrl),
      supportsImages: async (requestedModel) => (requestedModel || model || (await modelSettings.resolve()).model) === "deepseek-flash",
    },
    store: createJsonFileAgentHostStore(storeFile),
    packs: [
      {
        id: "resume",
        capabilityPolicy: { scopeIds: ["pack:resume"] },
        primaryAgentId: RESUME_PRIMARY_AGENT_ID,
      },
    ],
  });

  const server = createAgentHostServer({ host, modelSettings });
  server.listen(port, hostname);
  server.nodeServer.on("listening", () => {
    console.log(`TypeDance Agent Host listening on http://${hostname}:${port}`);
    console.log(`Model: ${model}`);
    console.log(`Sidecar: ${sidecarUrl}`);
    console.log(`Langfuse: ${telemetry ? "enabled" : "disabled"}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const closed = server.close();
    server.nodeServer.closeAllConnections();
    try {
      await telemetry?.shutdown();
    } catch {
      console.warn("Langfuse 退出上报失败。");
    }
    await closed;
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function numberEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseReasoningEffort(value: string | undefined): "low" | "medium" | "high" | "max" | undefined {
  if (value === "low" || value === "medium" || value === "high" || value === "max") return value;
  return undefined;
}
