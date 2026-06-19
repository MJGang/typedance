import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileModelSettings } from "../src/model-settings";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("file model settings", () => {
  it("stores auth separately and never returns the full API key", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-model-settings-"));
    tempDirectories.push(dataDir);
    const settings = createFileModelSettings(dataDir, {});

    await settings.update({
      model: "deepseek-v4-flash",
      base_url: "https://api.deepseek.com",
      api_key: "sk-secret-a9f2",
    });

    expect(await settings.get()).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      base_url: "https://api.deepseek.com",
      api_key: { configured: true, preview: "...a9f2" },
    });
    expect(await settings.resolve()).toEqual({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      apiKey: "sk-secret-a9f2",
    });
    expect(await readFile(join(dataDir, "agent-host", "config.json"), "utf8")).not.toContain("sk-secret-a9f2");
    expect(await readFile(join(dataDir, "agent-host", "auth.json"), "utf8")).toContain("sk-secret-a9f2");
  });

  it("clears the persisted API key without resetting model configuration", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-model-settings-"));
    tempDirectories.push(dataDir);
    const settings = createFileModelSettings(dataDir, {});
    await settings.update({
      model: "deepseek-chat",
      base_url: "https://example.com/v1",
      api_key: "sk-remove-me",
    });

    await settings.clearApiKey();

    expect(await settings.get()).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
      base_url: "https://example.com/v1",
      api_key: { configured: false, preview: null },
    });
  });
});
