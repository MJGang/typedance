import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import type { HarnessRuntime } from "@typedance/harness-core";
import { HarnessPluginFileLoader } from "@typedance/harness-core";

export const RESUME_PLUGIN_DIRECTORY = "resume";
export const RESUME_PRIMARY_AGENT_ID = "resume.primary";

export function createResumePluginLoader(
  pluginRootOrSearchStart: string = fileURLToPath(import.meta.url)
): HarnessPluginFileLoader {
  return new HarnessPluginFileLoader(findPluginsRoot(pluginRootOrSearchStart));
}

export async function registerResumeWorkbenchPlugin(
  runtime: HarnessRuntime,
  loader: HarnessPluginFileLoader
): Promise<void> {
  runtime.registerPlugin(await loader.loadPlugin(RESUME_PLUGIN_DIRECTORY));
}

function findPluginsRoot(startDir: string): string {
  let current = resolve(startDir);
  if (existsSync(join(current, RESUME_PLUGIN_DIRECTORY, "plugin.json"))) {
    return current;
  }

  while (true) {
    const candidate = join(current, "plugins");
    if (isDirectory(candidate) && existsSync(join(candidate, RESUME_PLUGIN_DIRECTORY, "plugin.json"))) {
      return candidate;
    }

    const parent = resolve(current, "..");
    if (parent === current) {
      throw new Error(`Unable to locate ${join("plugins", RESUME_PLUGIN_DIRECTORY, "plugin.json")} from ${startDir}`);
    }
    current = parent;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}
