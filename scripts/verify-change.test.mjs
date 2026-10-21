import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { after, test } from "node:test"
import { createPlan, runChecks } from "./verify-change.mjs"

const temporaryRoot = mkdtempSync(join(tmpdir(), "typedance-verify-"))
after(() => {
  assert.equal(dirname(temporaryRoot), resolve(tmpdir()))
  assert.ok(basename(temporaryRoot).startsWith("typedance-verify-"))
  rmSync(temporaryRoot, { recursive: true, force: true })
})

function repository(name) {
  const cwd = join(temporaryRoot, name)
  mkdirSync(cwd)
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true })
  git("init", "-q")
  git("config", "user.name", "Verification Test")
  git("config", "user.email", "verification@example.invalid")
  git("config", "core.autocrlf", "false")
  writeFileSync(join(cwd, "README.md"), "Initial documentation\n")
  git("add", "README.md")
  git("commit", "-qm", "initial")
  const base = git("rev-parse", "HEAD").trim()
  return { cwd, git, base }
}

test("docs stay lightweight; committed deletions and renames retain code verification", () => {
  const { cwd, git, base } = repository("history")
  writeFileSync(join(cwd, "README.md"), "Updated documentation\n")
  git("commit", "-qam", "docs")
  assert.equal(createPlan({ cwd, base, head: "HEAD" }).runtime, false)
  writeFileSync(join(cwd, "module.js"), "export const value = 1\n")
  git("add", "module.js")
  git("commit", "-qm", "code")
  const codeBase = git("rev-parse", "HEAD").trim()
  mkdirSync(join(cwd, "docs"))
  git("mv", "module.js", "docs/module.md")
  git("commit", "-qm", "rename")
  const plan = createPlan({ cwd, base: codeBase, head: "HEAD" })
  assert.equal(plan.runtime, true)
  assert.ok(plan.files.includes("module.js"))
  git("rm", "docs/module.md")
  git("commit", "-qm", "delete")
  assert.equal(createPlan({ cwd, base: codeBase, head: "HEAD" }).runtime, true)
})

test("local scope includes staged, unstaged and untracked files; explicit head excludes them", () => {
  const { cwd, git, base } = repository("working-tree")
  writeFileSync(join(cwd, "staged.ts"), "export const staged = true\n")
  git("add", "staged.ts")
  writeFileSync(join(cwd, "README.md"), "Local documentation\n")
  writeFileSync(join(cwd, "unknown.fixture"), "Unknown files must not bypass verification\n")
  const plan = createPlan({ cwd, base })
  assert.equal(plan.runtime, true)
  assert.deepEqual(plan.files, ["README.md", "staged.ts", "unknown.fixture"])
  assert.equal(createPlan({ cwd, base, head: "HEAD" }).runtime, false)
})

test("plugin prompts trigger runtime checks even though they are Markdown", () => {
  const { cwd, base } = repository("prompt")
  mkdirSync(join(cwd, "plugins"))
  writeFileSync(join(cwd, "plugins/prompt.md"), "Changed model behavior\n")
  assert.equal(createPlan({ cwd, base }).runtime, true)
})

test("unstaged reversions cannot hide staged code or staged whitespace errors", () => {
  const { cwd, git } = repository("staged-reversion")
  writeFileSync(join(cwd, "module.js"), "export const value = 1\n")
  git("add", "module.js")
  git("commit", "-qm", "code")
  const base = git("rev-parse", "HEAD").trim()
  writeFileSync(join(cwd, "module.js"), "export const value = 2  \n")
  git("add", "module.js")
  writeFileSync(join(cwd, "module.js"), "export const value = 1\n")
  const plan = createPlan({ cwd, base })
  assert.equal(plan.runtime, true)
  assert.ok(plan.files.includes("module.js"))
  assert.throws(() => runChecks(plan.checks.filter(({ command }) => command === "git"), { cwd }), /failed/)
})

test("verification stops on the first failed check", () => {
  let executed = 0
  assert.throws(() => runChecks([
    { command: "node", args: ["first"] },
    { command: "node", args: ["must-not-run"] },
  ], { execute: () => { executed++; return { status: 7 } } }), /failed \(7\)/)
  assert.equal(executed, 1)
})

test("CLI rejects missing or invalid refs rather than reporting a successful empty change", () => {
  const script = fileURLToPath(new URL("./verify-change.mjs", import.meta.url))
  for (const args of [[], ["--base", "--plan"], ["--base", "missing-ref", "--plan"], ["--unknown"]]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", windowsHide: true })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /verify:change/)
  }
})
