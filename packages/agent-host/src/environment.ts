export function loadExplicitEnvironment(
  source: NodeJS.ProcessEnv,
  readFile: (path: string) => string,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  const envFile = source.TYPEDANCE_ENV_FILE?.trim();
  if (!envFile) return environment;

  for (const line of readFile(envFile).split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (environment[key] === undefined) environment[key] = value;
  }
  return environment;
}

const LANGFUSE_KEYS = new Set([
  "LANGFUSE_ENABLED",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_CAPTURE_CONTENT",
  "LANGFUSE_TRACING_ENVIRONMENT",
  "LANGFUSE_RELEASE",
]);

/** Read only observability settings from the user's application data directory. */
export function loadLangfuseEnvironment(
  source: NodeJS.ProcessEnv,
  configPath: string,
  readFile: (path: string) => string,
  warn: (message: string) => void = console.warn,
): NodeJS.ProcessEnv {
  const environment = { ...source };
  let content: string;
  try {
    content = readFile(configPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
      warn("无法读取本机 Langfuse 配置；Agent 将继续运行，请检查配置文件的读取权限。");
    }
    return environment;
  }
  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (LANGFUSE_KEYS.has(key) && environment[key] === undefined) environment[key] = value;
  }
  return environment;
}

function parseEnvLine(line: string): [string, string] | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const index = trimmed.indexOf("=");
  if (index < 1) return undefined;
  const key = trimmed.slice(0, index).trim();
  const rawValue = trimmed.slice(index + 1).trim();
  return [key, rawValue.replace(/^(['"])(.*)\1$/, "$2")];
}
