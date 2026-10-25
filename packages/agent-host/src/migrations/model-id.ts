import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** 启动时执行一次数据迁移；模型目录和适配器不保留退役 ID 的兼容分支。 */
export async function migrateRetiredModelId(dataDir: string, environment: Record<string, string | undefined>): Promise<void> {
  const directory = join(dataDir, "agent-host");
  const marker = join(directory, "migrations", "model-id-v4.1.json");
  if (await optionalJson(marker)) return;
  const path = join(directory, "config.json");
  const config = await optionalJson(path);
  const model = config?.model ?? environment.AGENT_MODEL?.trim() ?? environment.DEEPSEEK_MODEL?.trim() ?? environment.VITE_DEFAULT_AGENT_MODEL?.trim();
  if (model === "deepseek-v4-flash" || model === "deepseek-v4-flash-vision-exp") {
    await mkdir(directory, { recursive: true });
    const temporary = `${path}.migration.tmp`;
    await writeFile(temporary, JSON.stringify({ provider: "deepseek", base_url: environment.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com", ...config, model: "deepseek-flash" }, null, 2) + "\n", { mode: 0o600 });
    await rename(temporary, path);
  }
  await mkdir(join(directory, "migrations"), { recursive: true });
  await writeFile(marker, JSON.stringify({ completed: true }) + "\n");
}

async function optionalJson(path: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
