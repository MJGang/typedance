#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHarnessRuntime } from "@typedance/harness-core";
import {
  createAgentHost,
  createAgentHostServer,
  createFileModelSettings,
  createSqliteAgentHostStore,
  migrateJsonStoreToSqlite,
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
import { createSidecarEditorService } from "./editor-service";
import { createSidecarPageReader } from "./resume-tools";
import { createLangfuseTelemetry } from "./observability/langfuse";
import { LocalSpeechService } from "./speech";
import { checkSpeechNativeRuntime, resolveSpeechRuntime, runSpeechWorker } from "@typedance/harness-speech";
import { isSea } from "node:sea";
import { dirname } from "node:path";
import { JsonFileHarnessCheckpointStore } from "./checkpoint-store";
import { migrateRetiredModelId } from "./migrations/model-id";
import { modelRuntimeConfiguration } from "./model-catalog";

async function main(): Promise<void> {
  if (process.argv.includes("--speech-worker")) { runSpeechWorker(); return; }
  if (process.argv.includes("--check-speech-runtime")) {
    const runtimePackage = process.argv[process.argv.indexOf("--check-speech-runtime") + 1];
    await checkSpeechNativeRuntime(resolveSpeechRuntime(runtimePackage || (isSea() ? join(dirname(process.execPath), "speech-runtime", "package.json") : undefined)));
    console.log("Speech native runtime ready");
    return;
  }
  const env = loadExplicitEnvironment(process.env, (path) => readFileSync(path, "utf8"));
  const port = numberEnv(env.AGENT_HOST_PORT, 4327);
  const hostname = env.AGENT_HOST_HOST ?? "127.0.0.1";
  const dataDir = env.TYPEDANCE_DATA_DIR || join(homedir(), ".typedance");
  const storeFile = env.AGENT_HOST_DATABASE_FILE || join(dataDir, "agent-host", "store.sqlite");
  const sidecarUrl = env.TYPEDANCE_SIDECAR_URL || "http://127.0.0.1:4317";
  await migrateRetiredModelId(dataDir, env);
  migrateJsonStoreToSqlite(env.AGENT_HOST_STORE_FILE || join(dataDir, "agent-host", "store.json"), storeFile);
  const modelSettings = createFileModelSettings(dataDir, env);
  const pluginLoader = env.TYPEDANCE_PLUGIN_ROOT
    ? createResumePluginLoader(env.TYPEDANCE_PLUGIN_ROOT)
    : createResumePluginLoader();

  const telemetry = createLangfuseTelemetry(env);
  const runtime = createHarnessRuntime({
    checkpointStore: new JsonFileHarnessCheckpointStore(join(dataDir, "agent-host", "checkpoints")),
    observer: telemetry?.observer,
    skillContentLoader: pluginLoader.createSkillContentLoader(),
    model: createDeepSeekModelAdapter({
      resolveSettings: async () => {
        const settings = await modelSettings.resolve();
        return {
          apiKey: settings.apiKey,
          baseUrl: settings.baseUrl,
          defaultModel: settings.model,
          reasoningEffort: settings.reasoningEffort,
        };
      },
    }),
  });

  await registerResumeWorkbenchPlugin(runtime, pluginLoader);
  const host = createAgentHost({
    runtime,
    resolveModelRuntimeConfiguration: async (requestedModel) => {
      const settings = await modelSettings.resolve();
      return modelRuntimeConfiguration(requestedModel ?? settings.model, settings.reasoningEffort, settings.baseUrl);
    },
    contextProvider: createSidecarContextProvider({ baseUrl: sidecarUrl }),
    resumeTools: {
      editor: createSidecarEditorService(sidecarUrl),
      pageReader: createSidecarPageReader(sidecarUrl),
      supportsImages: async (requestedModel) => (requestedModel || (await modelSettings.resolve()).model) === "deepseek-flash",
    },
    store: createSqliteAgentHostStore(storeFile),
    packs: [
      {
        id: "resume",
        capabilityPolicy: { scopeIds: ["pack:resume"] },
        primaryAgentId: RESUME_PRIMARY_AGENT_ID,
      },
    ],
  });

  const speech = new LocalSpeechService(dataDir);
  const server = createAgentHostServer({ host, modelSettings, speech,
    ...(env.TYPEDANCE_WEB_ORIGIN?.trim() ? { allowedOrigins: [env.TYPEDANCE_WEB_ORIGIN.trim()] } : {}) });
  server.listen(port, hostname);
  server.nodeServer.on("listening", () => {
    console.log(`TypeDance Agent Host listening on http://${hostname}:${port}`);
    console.log(`Sidecar: ${sidecarUrl}`);
    console.log(`Langfuse: ${telemetry ? "enabled" : "disabled"}`);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const closed = server.close();
    server.nodeServer.closeAllConnections();
    await speech.dispose();
    try {
      await telemetry?.shutdown();
    } catch {
      console.warn("Langfuse 退出上报失败。");
    }
    await closed;
    host.store.close();
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
