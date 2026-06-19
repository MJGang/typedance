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

function parseEnvLine(line: string): [string, string] | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const index = trimmed.indexOf("=");
  if (index < 1) return undefined;
  const key = trimmed.slice(0, index).trim();
  const rawValue = trimmed.slice(index + 1).trim();
  return [key, rawValue.replace(/^(['"])(.*)\1$/, "$2")];
}
