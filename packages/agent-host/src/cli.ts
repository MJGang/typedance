#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { createHarnessRuntime } from "@typedance/harness-core";
import {
  createAgentHost,
  createAgentHostServer,
  createFileModelSettings,
  createSqliteAgentHostStore,
  migrateJsonStoreToSqlite,
  createHttpModelCredentialStore,
} from "./index";
import { loadExplicitEnvironment, loadLangfuseEnvironment } from "./environment";
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
import { createModelRuntimeConfiguration } from "./model-catalog";
import { requireLocalToken } from "./local-access";

async function main(): Promise<void> {
  if (process.argv.includes("--migrate-store")) {
    const dataDir = process.argv[process.argv.indexOf("--data-dir") + 1];
    if (!process.argv.includes("--data-dir") || !dataDir || !isAbsolute(dataDir)) throw new Error("Store migration requires an absolute --data-dir");
    migrateJsonStoreToSqlite(join(dataDir, "agent-host", "store.json"), join(dataDir, "agent-host", "store.sqlite"));
    console.log(JSON.stringify({ migrated: true }));
    return;
  }
  if (process.argv.includes("--speech-worker")) { runSpeechWorker(); return; }
  if (process.argv.includes("--check-speech-runtime")) {
    const runtimePackage = process.argv[process.argv.indexOf("--check-speech-runtime") + 1];
    await checkSpeechNativeRuntime(resolveSpeechRuntime(runtimePackage || (isSea() ? join(dirname(process.execPath), "speech-runtime", "package.json") : undefined)));
    console.log("Speech native runtime ready");
    return;
  }
  const env = loadExplicitEnvironment(process.env, (path) => readFileSync(path, "utf8"));
  const authToken = requireLocalToken(env.TYPEDANCE_LOCAL_TOKEN);
  if (!env.TYPEDANCE_DATA_DIR?.trim()) throw new Error("An account data directory is required");
  const credentials = createHttpModelCredentialStore({ url: env.TYPEDANCE_CREDENTIAL_URL ?? "", token: env.TYPEDANCE_CREDENTIAL_TOKEN ?? "" });
  const port = numberEnv(env.AGENT_HOST_PORT, 4327);
  const hostname = env.AGENT_HOST_HOST ?? "127.0.0.1";
  const dataDir = env.TYPEDANCE_DATA_DIR;
  const storeFile = join(dataDir, "agent-host", "store.sqlite");
  const sidecarUrl = env.TYPEDANCE_SIDECAR_URL || "http://127.0.0.1:4317";
  await migrateRetiredModelId(dataDir, env);
  const modelSettings = createFileModelSettings(dataDir, credentials, env);
  const pluginLoader = env.TYPEDANCE_PLUGIN_ROOT
    ? createResumePluginLoader(env.TYPEDANCE_PLUGIN_ROOT)
    : createResumePluginLoader();

  const telemetry = createLangfuseTelemetry(loadLangfuseEnvironment(
    env,
    join(dataDir, "agent-host", "langfuse.env"),
    (path) => readFileSync(path, "utf8"),
  ));
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
    resolveModelRuntimeConfiguration: (requestedModel) => createModelRuntimeConfiguration(requestedModel, () => modelSettings.resolve()),
    contextProvider: createSidecarContextProvider({ baseUrl: sidecarUrl, authToken }),
    resumeTools: {
      editor: createSidecarEditorService(sidecarUrl, authToken),
      pageReader: createSidecarPageReader(sidecarUrl, authToken),
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
  const server = createAgentHostServer({ host, modelSettings, speech, authToken,
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
    await server.prepareClose();
    const closed = server.close();
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
