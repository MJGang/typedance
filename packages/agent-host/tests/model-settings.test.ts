import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileModelSettings, credentialsFor, memoryCredentials } from "./helpers/model-credentials";
import { createFileModelSettings as createSettingsWithCredentials } from "../src/model-settings";
import { migrateRetiredModelId } from "../src/migrations/model-id";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("file model settings", () => {
  it("keeps a partially saved key unavailable after restarting and requires an explicit key to recover", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-model-transaction-"));
    tempDirectories.push(dataDir);
    const configPath = join(dataDir, "agent-host", "config.json");
    const markerPath = join(dataDir, "agent-host", "settings-transaction.json");
    const vault = memoryCredentials();
    let failConfigWrite = false;
    const credentials = { ...vault, async set(value: string) {
      await vault.set(value);
      if (failConfigWrite) { await rm(configPath); await mkdir(configPath); }
    } };
    const settings = createSettingsWithCredentials(dataDir, credentials, {});
    await settings.update({ model: "deepseek-flash", base_url: "https://original.example/v1", api_key: "old-private-credential" });
    const originalConfig = await readFile(configPath, "utf8");
    failConfigWrite = true;
    await expect(settings.update({ model: "deepseek-flash", base_url: "https://replacement.example/v1", api_key: "new-private-credential" })).rejects.toThrow();
    expect(await vault.get()).toBe("new-private-credential");
    expect(await readFile(markerPath, "utf8")).not.toMatch(/old-private-credential|new-private-credential/);
    await rm(configPath, { recursive: true });
    await writeFile(configPath, originalConfig);

    const reopened = createSettingsWithCredentials(dataDir, credentials, {});
    expect(await reopened.resolve()).toMatchObject({ baseUrl: "https://original.example/v1", apiKey: undefined });
    expect((await reopened.get()).api_key).toEqual({ configured: false, preview: null });
    await reopened.updateSelection({ model: "deepseek-flash", reasoning_effort: "high" });
    expect((await reopened.resolve()).apiKey).toBeUndefined();
    await expect(reopened.update({ model: "deepseek-flash", base_url: "https://replacement.example/v1" })).rejects.toThrow("重新填写 API Key");
    failConfigWrite = false;
    await reopened.update({ model: "deepseek-flash", base_url: "https://replacement.example/v1", api_key: "recovered-private-credential" });
    expect(await reopened.resolve()).toMatchObject({ baseUrl: "https://replacement.example/v1", apiKey: "recovered-private-credential" });
    await expect(readFile(markerPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(configPath, "utf8")).not.toContain("private-credential");
  });

  it("keeps a failed credential deletion unavailable through restart until deletion succeeds", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-model-clear-failure-"));
    tempDirectories.push(dataDir);
    const vault = memoryCredentials();
    let rejectClear = true;
    const credentials = { ...vault, async clear() {
      if (rejectClear) throw new Error("credential store unavailable");
      await vault.clear();
    } };
    const settings = createSettingsWithCredentials(dataDir, credentials, {});
    await settings.update({ model: "deepseek-flash", base_url: "https://original.example/v1", api_key: "private-clear-test" });
    await expect(settings.clearApiKey()).rejects.toThrow("credential store unavailable");
    expect(await vault.get()).toBe("private-clear-test");
    const reopened = createSettingsWithCredentials(dataDir, credentials, {});
    expect(await reopened.resolve()).toMatchObject({ baseUrl: "https://original.example/v1", apiKey: undefined });
    rejectClear = false;
    expect((await reopened.clearApiKey()).api_key.configured).toBe(false);
    expect(await vault.get()).toBeUndefined();
  });

  it("serializes cross-instance reads and selection changes behind a pending credential write", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-model-concurrent-save-"));
    tempDirectories.push(dataDir);
    const vault = memoryCredentials();
    let pause = false;
    let entered!: () => void;
    let release!: () => void;
    const writing = new Promise<void>((resolve) => { entered = resolve; });
    const released = new Promise<void>((resolve) => { release = resolve; });
    const credentials = { ...vault, async set(value: string) {
      await vault.set(value);
      if (pause) { entered(); await released; }
    } };
    const settings = createSettingsWithCredentials(dataDir, credentials, {});
    await settings.update({ model: "deepseek-flash", base_url: "https://original.example/v1", api_key: "original-private" });
    pause = true;
    const saving = settings.update({ model: "deepseek-flash", base_url: "https://replacement.example/v1", api_key: "replacement-private" });
    await writing;
    const reopened = createSettingsWithCredentials(dataDir, credentials, {});
    let readFinished = false;
    const reading = reopened.resolve().then((value) => { readFinished = true; return value; });
    const selecting = reopened.updateSelection({ model: "deepseek-flash", reasoning_effort: "high" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const wasBlocked = !readFinished;
    release();
    const [, resolved] = await Promise.all([saving, reading, selecting]);
    expect(wasBlocked).toBe(true);
    expect(resolved).toMatchObject({ baseUrl: "https://replacement.example/v1", apiKey: "replacement-private" });
    expect(await reopened.getSelection()).toMatchObject({ reasoning_effort: "high" });
    expect(await reopened.resolve()).toMatchObject({ baseUrl: "https://replacement.example/v1", apiKey: "replacement-private" });
  });

  it("does not touch a credential if the persistent save barrier cannot be created", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-model-marker-failure-"));
    tempDirectories.push(dataDir);
    const markerPath = join(dataDir, "agent-host", "settings-transaction.json");
    const vault = memoryCredentials("original-private");
    let writes = 0;
    const credentials = { ...vault, async set(value: string) { writes++; await vault.set(value); } };
    await mkdir(markerPath, { recursive: true });
    const settings = createSettingsWithCredentials(dataDir, credentials, {});
    await expect(settings.update({ model: "deepseek-flash", base_url: "https://replacement.example/v1", api_key: "replacement-private" })).rejects.toThrow();
    expect(writes).toBe(0);
    expect(await vault.get()).toBe("original-private");
  });

  it("applies the environment reasoning default to an existing config until an explicit choice is saved", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-reasoning-default-"));
    tempDirectories.push(dataDir);
    await createFileModelSettings(dataDir, {}).update({ model: "deepseek-flash", base_url: "https://api.deepseek.com" });
    const settings = createFileModelSettings(dataDir, { DEEPSEEK_REASONING_EFFORT: "low" });
    expect(await settings.getSelection()).toMatchObject({ reasoning_effort: "low" });
    expect(await settings.resolve()).toMatchObject({ reasoningEffort: "low" });
    await settings.update({ model: "deepseek-flash", base_url: "https://api.deepseek.com" });
    expect(JSON.parse(await readFile(join(dataDir, "agent-host", "config.json"), "utf8"))).not.toHaveProperty("reasoning_effort");
    expect(await createFileModelSettings(dataDir, { DEEPSEEK_REASONING_EFFORT: "high" }).getSelection()).toMatchObject({ reasoning_effort: "high" });
    await settings.updateSelection({ model: "deepseek-flash", reasoning_effort: "max" });
    expect(await settings.resolve()).toMatchObject({ reasoningEffort: "max" });
  });
  it("keeps the environment reasoning default when migrating an environment-only retired model", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-migrated-default-"));
    tempDirectories.push(dataDir);
    const environment = { AGENT_MODEL: "deepseek-v4-flash", DEEPSEEK_REASONING_EFFORT: "low" };
    await migrateRetiredModelId(dataDir, environment);
    expect(await createFileModelSettings(dataDir, environment).getSelection()).toMatchObject({ model: "deepseek-flash", reasoning_effort: "low" });
  });
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
  it("stores the key only in the injected credential store and never returns it", async () => {
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
    await expect(readFile(join(dataDir, "agent-host", "auth.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await credentialsFor(dataDir).get()).toBe("sk-secret-a9f2");
  });

  it("never inherits an environment key or an old shared auth file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-no-shared-key-"));
    tempDirectories.push(dataDir);
    await mkdir(join(dataDir, "agent-host"), { recursive: true });
    await writeFile(join(dataDir, "agent-host", "auth.json"), JSON.stringify({ api_key: "old-shared-secret" }));
    const settings = createFileModelSettings(dataDir, { DEEPSEEK_API_KEY: "environment-secret", TYPEDANCE_LLM_API_KEY: "another-secret" });
    expect((await settings.resolve()).apiKey).toBeUndefined();
    expect((await settings.get()).api_key).toEqual({ configured: false, preview: null });
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

  it("does not reveal an entire short key through its preview", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "typedance-short-key-"));
    tempDirectories.push(dataDir);
    const settings = createFileModelSettings(dataDir, {});
    await settings.update({ model: "deepseek-flash", base_url: "https://api.deepseek.com", api_key: "tiny" });
    expect((await settings.get()).api_key).toEqual({ configured: true, preview: "...****" });
    expect(JSON.stringify(await settings.get())).not.toContain("tiny");
  });
});
