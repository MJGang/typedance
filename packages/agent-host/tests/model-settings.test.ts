import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileModelSettings } from "../src/model-settings";
import { migrateRetiredModelId } from "../src/migrations/model-id";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("file model settings", () => {
  it("migrates retired IDs once while preserving endpoint and credentials", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-model-migrate-"));
    tempDirectories.push(dataDir);
    const settings = createFileModelSettings(dataDir, {});
    await settings.update({ model: "deepseek-v4-flash", base_url: "https://gateway.example/v1", api_key: "private-test" });
    await migrateRetiredModelId(dataDir, {});
    expect(await settings.resolve()).toMatchObject({ model: "deepseek-flash", baseUrl: "https://gateway.example/v1", apiKey: "private-test" });
    await settings.updateSelection({ model: "deepseek-v4-pro", reasoning_effort: "max" });
    await migrateRetiredModelId(dataDir, { AGENT_MODEL: "deepseek-v4-flash" });
    expect(await settings.getSelection()).toMatchObject({ model: "deepseek-v4-pro", reasoning_effort: "max" });
  });
  it("persists concrete model and reasoning selection without replacing API credentials", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-selection-"));
    tempDirectories.push(dataDir);
    const settings = createFileModelSettings(dataDir, { DEEPSEEK_MODEL: "deepseek-flash", DEEPSEEK_REASONING_EFFORT: "low" });
    expect(await settings.getSelection()).toMatchObject({ model: "deepseek-flash", reasoning_effort: "low" });
    await settings.update({ model: "deepseek-flash", base_url: "https://api.deepseek.com", api_key: "test-private" });
    await settings.updateSelection({ model: "deepseek-v4-pro", reasoning_effort: "off" });
    const reopened = createFileModelSettings(dataDir, { DEEPSEEK_MODEL: "deepseek-flash" });
    expect(await reopened.getSelection()).toMatchObject({ model: "deepseek-v4-pro", reasoning_effort: "off" });
    expect(await reopened.resolve()).toMatchObject({ model: "deepseek-v4-pro", reasoningEffort: "off", apiKey: "test-private" });
    await expect(settings.updateSelection({ model: "custom-model", reasoning_effort: "max" })).rejects.toThrow("不支持");
    expect(await settings.updateSelection({ model: "custom-model", reasoning_effort: null })).toMatchObject({ model: "custom-model", reasoning_effort: null });
  });
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
