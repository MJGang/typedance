import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { harnessPluginManifestSchema, type HarnessPluginManifest } from "@typedance/harness-contracts";
import type { HarnessSkillContentLoader, HarnessSkillContentLoaderInput } from "../skill/skill-registry";

export class HarnessPluginFileLoader {
  #pluginDirsById = new Map<string, string>();
  #rootDir: string;

  constructor(rootDir: string) {
    this.#rootDir = resolve(rootDir);
  }

  async loadPlugin(directoryName: string): Promise<HarnessPluginManifest> {
    const pluginDir = resolve(this.#rootDir, directoryName);
    this.#assertInsideRoot(pluginDir);
    const manifest = harnessPluginManifestSchema.parse(
      JSON.parse(await readFile(resolve(pluginDir, "plugin.json"), "utf8"))
    );
    this.#pluginDirsById.set(manifest.id, pluginDir);
    return manifest;
  }

  createSkillContentLoader(): HarnessSkillContentLoader {
    return {
      readText: (input) => this.#readSkillText(input),
    };
  }

  async #readSkillText(input: HarnessSkillContentLoaderInput): Promise<string> {
    const pluginDir = this.#pluginDirsById.get(input.pluginId);
    if (!pluginDir) {
      throw new Error(`Unknown plugin directory for ${input.pluginId}`);
    }

    const targetPath = resolve(pluginDir, input.path);
    this.#assertInsidePlugin(pluginDir, targetPath);
    return readFile(targetPath, "utf8");
  }

  #assertInsideRoot(path: string): void {
    if (!isInside(this.#rootDir, path)) {
      throw new Error("Plugin path must stay inside plugin root");
    }
  }

  #assertInsidePlugin(pluginDir: string, path: string): void {
    if (!isInside(pluginDir, path)) {
      throw new Error("Skill instruction path must stay inside plugin directory");
    }
  }
}

function isInside(parent: string, child: string): boolean {
  const normalizedParent = parent.endsWith(sep) ? parent : `${parent}${sep}`;
  return child === parent || child.startsWith(normalizedParent);
}
