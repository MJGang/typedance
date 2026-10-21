import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")

test("manual release validation cannot publish over an existing version", () => {
  const workflow = readFileSync(join(root, ".github/workflows/release-windows.yml"), "utf8")
  const publishSteps = workflow.split(/\r?\n      - /).filter(step => /gh release create/.test(step))
  assert.equal(publishSteps.length, 1)
  assert.match(publishSteps[0], /if: github\.event_name == 'push' && startsWith\(github\.ref, 'refs\/tags\/v'\)/)
})

test("release commands preserve failures and record both successful and failed phase timings", { skip: process.platform !== "win32" }, t => {
  const directory = mkdtempSync(join(tmpdir(), "typedance-release-timing-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const probe = join(directory, "probe.ps1")
  writeFileSync(probe, `param([string]$Source, [string]$OutputDirectory)
$ErrorActionPreference = "Stop"
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq "Invoke-Checked" }, $true)
Invoke-Expression $definition.Extent.Text
$releaseRoot = $OutputDirectory
$releaseTimings = [System.Collections.Generic.List[object]]::new()
function Invoke-Probe { param([string]$Code) $global:LASTEXITCODE = [int]$Code }
Invoke-Checked -FilePath "Invoke-Probe" -Arguments @("0")
$failed = $false
try { Invoke-Checked -FilePath "Invoke-Probe" -Arguments @("23") } catch {
  if ($_.Exception.Message -notmatch "exited with code 23") { throw }
  $failed = $true
}
if (-not $failed) { throw "Failed release command was accepted" }
`, "utf8")
  const result = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", probe,
    "-Source", join(root, "scripts/release-windows.ps1"), "-OutputDirectory", directory],
  { encoding: "utf8", windowsHide: true })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  const timings = JSON.parse(readFileSync(join(directory, "timings.json"), "utf8"))
  assert.deepEqual(timings.map(phase => phase.exit_code), [0, 23])
  assert.ok(timings.every(phase => phase.seconds >= 0))
})
