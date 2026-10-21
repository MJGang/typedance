import { execFileSync, spawnSync } from "node:child_process"
import { appendFileSync, mkdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url))

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true })
}

function splitPaths(output) {
  return output.split("\0").filter(Boolean)
}

export function createPlan({ base, head, cwd = repositoryRoot }) {
  const baseCommit = git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], cwd).trim()
  const headCommit = git(["rev-parse", "--verify", "--end-of-options", `${head ?? "HEAD"}^{commit}`], cwd).trim()
  const range = `${baseCommit}...${headCommit}`
  const paths = splitPaths(git(["diff", "--name-only", "--no-renames", "-z", range, "--"], cwd))
  const checks = [{ command: "git", args: ["diff", "--check", range, "--"] }]
  if (head === undefined) {
    paths.push(...splitPaths(git(["diff", "--name-only", "--no-renames", "-z", "--cached", "--"], cwd)))
    paths.push(...splitPaths(git(["diff", "--name-only", "--no-renames", "-z", "--"], cwd)))
    paths.push(...splitPaths(git(["ls-files", "--others", "--exclude-standard", "-z"], cwd)))
    checks.push({ command: "git", args: ["diff", "--check", "--cached", "--"] })
    checks.push({ command: "git", args: ["diff", "--check", "--"] })
  }
  const files = [...new Set(paths)].sort()
  const runtime = files.some((file) => !isEngineeringDocument(file))
  checks.push({ command: "node", args: ["--test", "scripts/verify-change.test.mjs"] })
  if (runtime) {
    for (const script of ["build", "test", "release:test"]) {
      checks.push({ command: "corepack", args: ["pnpm", script] })
    }
  }
  return { base: baseCommit, head: headCommit, includesWorkingTree: head === undefined, files, runtime, checks }
}

function isEngineeringDocument(file) {
  return /(^|\/)AGENTS\.md$/.test(file)
    || /(^|\/)README(?:\.[^/]+)?\.md$/.test(file)
    || /^docs\/.*\.(md|txt)$/.test(file)
    || file === ".github/pull_request_template.md"
    || file.startsWith(".agents/skills/typedance-delivery/")
    || /^scripts\/verify-change(?:\.test)?\.mjs$/.test(file)
}

export function runChecks(checks, { cwd = repositoryRoot, execute = spawnSync } = {}) {
  const environment = { ...process.env }
  if (process.platform === "win32") {
    const temporaryDirectory = join(cwd, "node_modules", ".cache", "typedance-verify", "tmp")
    mkdirSync(temporaryDirectory, { recursive: true })
    environment.TEMP = temporaryDirectory
    environment.TMP = temporaryDirectory
  }
  const spawnOptions = { cwd, stdio: "inherit", windowsHide: true, env: environment }
  for (const { command, args } of checks) {
    console.log(`[verify:change] ${command} ${args.join(" ")}`)
    // Only fixed Corepack commands need cmd.exe on Windows; Git refs never enter a shell.
    const windowsCorepack = process.platform === "win32" && command === "corepack"
    const result = windowsCorepack
      ? execute(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", [command, ...args].join(" ")], spawnOptions)
      : execute(command, args, spawnOptions)
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.signal ?? result.status})`)
  }
}

function main(args) {
  const options = {}
  let planOnly = false
  let githubOutput
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === "--plan") planOnly = true
    else if (["--base", "--head", "--github-output"].includes(argument)) {
      const value = args[++index]
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`)
      if (argument === "--github-output") githubOutput = value
      else options[argument.slice(2)] = value
    } else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!options.base) throw new Error("Usage: node scripts/verify-change.mjs --base <target-ref> [--head <commit>] [--plan] [--github-output <path>]")
  const plan = createPlan(options)
  console.log(JSON.stringify(plan, null, 2))
  if (githubOutput) appendFileSync(githubOutput, `runtime=${plan.runtime}\n`, "utf8")
  if (!planOnly) runChecks(plan.checks)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(`[verify:change] ${error.message}`)
    process.exitCode = 1
  }
}
