import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const powershell = process.env.SystemRoot ? join(process.env.SystemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe") : "powershell"

test("runtime smoke isolates child environment, preserves argv and checks private HTTP capability", { skip: process.platform !== "win32" }, t => {
  const directory = mkdtempSync(join(tmpdir(), "typedance-smoke-probe-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const probe = join(directory, "probe.ps1")
  writeFileSync(probe, String.raw`param([string]$Source, [string]$Node)
$ErrorActionPreference = "Stop"
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @("ConvertTo-WindowsArgument", "Start-IsolatedSmokeProcess", "Stop-SmokeProcess", "Read-SmokeOutput", "New-PrivateToken", "Get-FreeLoopbackPort", "Assert-Unauthorized", "Wait-ServiceHealth")) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  if (-not $definition) { throw "Missing smoke function" }
  Invoke-Expression $definition.Extent.Text
}
$env:DEEPSEEK_API_KEY = "inherited-test-key-must-not-reach-child"
$env:TYPEDANCE_LOGTO_ENDPOINT = "https://must-not-reach-child.invalid"
Write-Output "Runtime probe: child arguments and isolated environment"
$expected = @("path with spaces", 'literal"quote', 'C:\trailing\', '$() does not execute', ([string]::Join([char]10, @('first line', 'second line'))))
$code = 'process.stdout.write(JSON.stringify({args:process.argv.slice(1),leaked:!!process.env.DEEPSEEK_API_KEY||!!process.env.TYPEDANCE_LOGTO_ENDPOINT,private:process.env.TYPEDANCE_TEST_MARKER}))'
$child = Start-IsolatedSmokeProcess -FilePath $Node -Arguments (@("--eval", $code, "--") + $expected) -Environment @{ TYPEDANCE_TEST_MARKER = "present" }
try {
  if (-not $child.Process.WaitForExit(10000) -or $child.Process.ExitCode -ne 0) { throw "Argument probe failed" }
  $result = $child.Output.GetAwaiter().GetResult() | ConvertFrom-Json
  if ($result.leaked -or $result.private -ne "present") { throw "Child environment isolation failed" }
  if (($result.args | ConvertTo-Json -Compress) -ne ($expected | ConvertTo-Json -Compress)) { throw "Windows argv quoting changed literal input" }
} finally { Stop-SmokeProcess $child }
$token = New-PrivateToken
$port = Get-FreeLoopbackPort
Write-Output "Runtime probe: private health and capability rejection"
$serverCode = 'const http=require("node:http");const token=process.env.TYPEDANCE_LOCAL_TOKEN;const server=http.createServer((q,s)=>{s.setHeader("Content-Type","application/json");s.writeHead(q.headers.authorization==="Bearer "+token?200:401);s.end(JSON.stringify({status:"ok"}));});server.listen(Number(process.env.TYPEDANCE_TEST_PORT),"127.0.0.1");'
$server = Start-IsolatedSmokeProcess -FilePath $Node -Arguments @("--eval", $serverCode) -Environment @{ TYPEDANCE_LOCAL_TOKEN = $token; TYPEDANCE_TEST_PORT = $port }
try {
  $url = "http://127.0.0.1:$port"
  Wait-ServiceHealth -Handle $server -Url $url -Token $token
  Assert-Unauthorized -Uri "$url/health"
  Assert-Unauthorized -Uri "$url/health" -Token (New-PrivateToken)
  $detected = $false
  try { Assert-Unauthorized -Uri "$url/health" -Token $token } catch { $detected = $true }
  if (-not $detected) { throw "Unauthorized assertion accepted a successful request" }
} finally { Stop-SmokeProcess $server }
Write-Output "Runtime probe: listener cleanup"
$connection = [Net.Sockets.TcpClient]::new()
$refused = $false
try { $connection.Connect([Net.IPAddress]::Loopback, $port) }
catch {
  $failure = $_.Exception.GetBaseException()
  if ($failure -isnot [Net.Sockets.SocketException] -or $failure.SocketErrorCode -ne [Net.Sockets.SocketError]::ConnectionRefused) { throw }
  $refused = $true
} finally { $connection.Dispose() }
if (-not $refused) { throw "Smoke probe leaked its listener" }
Write-Output "Runtime probe passed"
`, "utf8")
  const result = spawnSync(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", probe, "-Source", join(root, "scripts/release/smoke-release-runtime.ps1"), "-Node", process.execPath], { encoding: "utf8", windowsHide: true, timeout: 45_000 })
  assert.equal(result.status, 0, `${result.error?.message ?? ""}\nSignal: ${result.signal ?? "none"}\n${result.stdout}\n${result.stderr}`)
})

test("Sidecar build health probe rejects an unauthenticated service and restores caller environment", { skip: process.platform !== "win32" }, t => {
  const directory = mkdtempSync(join(tmpdir(), "typedance-sidecar-smoke-probe-"))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const probe = join(directory, "probe.ps1")
  writeFileSync(probe, String.raw`param([string]$Source, [string]$OutputDirectory)
$ErrorActionPreference = "Stop"
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($name in @("Assert-SidecarHealthy", "Stop-ProcessTree")) {
  $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
  Invoke-Expression $definition.Extent.Text
}
$releaseRoot = $OutputDirectory
$binary = Join-Path $OutputDirectory "sidecar health probe.exe"
Add-Type -OutputAssembly $binary -OutputType ConsoleApplication -TypeDefinition @'
using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
public static class Probe {
  public static void Main(string[] args) {
    int port = 0;
    for (int i = 0; i < args.Length - 1; i++) if (args[i] == "--port") port = int.Parse(args[i + 1]);
    string expected = "Bearer " + Environment.GetEnvironmentVariable("TYPEDANCE_LOCAL_TOKEN");
    if (expected.Length < 40 || port == 4317 || port == 0) Environment.Exit(12);
    if (!System.Text.RegularExpressions.Regex.IsMatch(expected.Substring(7), "^[A-Za-z0-9_-]{32,}$")) Environment.Exit(13);
    var listener = new TcpListener(IPAddress.Loopback, port); listener.Start();
    while (true) using (var client = listener.AcceptTcpClient()) {
      var stream = client.GetStream();
      var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
      bool authorized = false; string line;
      while (!string.IsNullOrEmpty(line = reader.ReadLine())) if (line == "Authorization: " + expected) authorized = true;
      bool publicEndpoint = Environment.GetEnvironmentVariable("TYPEDANCE_TEST_PUBLIC_HEALTH") == "true";
      string body = "{\"status\":\"ok\"}";
      byte[] response = Encoding.ASCII.GetBytes("HTTP/1.1 " + ((authorized || publicEndpoint) ? "200 OK" : "401 Unauthorized") + "\r\nContent-Type: application/json\r\nContent-Length: " + body.Length + "\r\nConnection: close\r\n\r\n" + body);
      stream.Write(response, 0, response.Length);
    }
  }
}
'@
$env:TYPEDANCE_LOCAL_TOKEN = "caller-sentinel"
Write-Output "Probe compiled; checking private health"
Assert-SidecarHealthy -Executable $binary -HealthTimeoutSeconds 8
if ($env:TYPEDANCE_LOCAL_TOKEN -ne "caller-sentinel") { throw "Build smoke did not restore caller environment" }
$env:TYPEDANCE_TEST_PUBLIC_HEALTH = "true"
$detected = $false
Write-Output "Checking rejection of public health"
try { Assert-SidecarHealthy -Executable $binary -HealthTimeoutSeconds 8 } catch {
  if ($_.Exception.Message -notmatch "unauthenticated health") { throw }
  $detected = $true
}
if (-not $detected) { throw "Build smoke accepted a public unauthenticated service" }
$startFailed = $false
try { Assert-SidecarHealthy -Executable (Join-Path $OutputDirectory "missing-sidecar.exe") -HealthTimeoutSeconds 1 }
catch { $startFailed = $true }
if (-not $startFailed) { throw "Build smoke accepted a missing executable" }
if (Get-ChildItem -LiteralPath $OutputDirectory -Directory -Filter "smoke-*") { throw "Build smoke left temporary data after failure" }
if ($env:TYPEDANCE_LOCAL_TOKEN -ne "caller-sentinel") { throw "Failed build smoke changed caller environment" }
`, "utf8")
  const result = spawnSync(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", probe, "-Source", join(root, "scripts/release/build-sidecar.ps1"), "-OutputDirectory", directory], { encoding: "utf8", windowsHide: true, timeout: 45_000 })
  assert.equal(result.status, 0, `${result.error?.message ?? ""}\n${result.stdout}\n${result.stderr}`)
})
