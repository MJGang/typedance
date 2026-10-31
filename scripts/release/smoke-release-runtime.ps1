[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [Parameter(Mandatory = $true)][string]$TokenGenerator,
    [switch]$ServicesOnly
)

$ErrorActionPreference = "Stop"
$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$TokenGenerator = (Resolve-Path -LiteralPath $TokenGenerator).Path
$runtimeDirectory = Split-Path -Parent $executablePath
$smokeRoot = Join-Path ([IO.Path]::GetTempPath()) ("typedance-release-smoke-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $smokeRoot | Out-Null

function Get-WindowsExecutableSubsystem {
    param([Parameter(Mandatory = $true)][string]$Path)
    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 96 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) { throw "Release executable is not a valid Windows PE file: $Path" }
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
    if ($peOffset -lt 0 -or ($peOffset + 94) -gt $bytes.Length) { throw "Release executable has an invalid PE header offset: $Path" }
    return [BitConverter]::ToUInt16($bytes, $peOffset + 92)
}

function New-PrivateToken {
    # 使用与桌面账号启动相同的 Rust 实现，不能另造一套合规令牌掩盖回归。
    $token = (& $TokenGenerator | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Desktop capability generator failed" }
    if ($token -cnotmatch '^[A-Za-z0-9_-]{32,512}$') {
        throw "Desktop capability generator violated the local service token contract"
    }
    return $token
}

function Get-FreeLoopbackPort {
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { return $listener.LocalEndpoint.Port } finally { $listener.Stop() }
}

function ConvertTo-WindowsArgument {
    param([AllowEmptyString()][string]$Value)
    # ProcessStartInfo does not invoke a shell. Quote using the Windows argv rules.
    return '"' + [Regex]::Replace([Regex]::Replace($Value, '(\\*)"', '$1$1\"'), '(\\+)$', '$1$1') + '"'
}

function Start-IsolatedSmokeProcess {
    param([string]$FilePath, [string[]]$Arguments = @(), [hashtable]$Environment = @{}, [switch]$ShowWindow)
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $FilePath
    $info.Arguments = (($Arguments | ForEach-Object { ConvertTo-WindowsArgument $_ }) -join " ")
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = if ($ShowWindow) { [Diagnostics.ProcessWindowStyle]::Normal } else { [Diagnostics.ProcessWindowStyle]::Hidden }
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.EnvironmentVariables.Clear()
    foreach ($name in @("APPDATA", "COMSPEC", "LOCALAPPDATA", "NUMBER_OF_PROCESSORS", "PATH", "PATHEXT", "PROCESSOR_ARCHITECTURE", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)", "PROGRAMW6432", "SYSTEMDRIVE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR")) {
        $value = [Environment]::GetEnvironmentVariable($name)
        if ($null -ne $value) { $info.EnvironmentVariables[$name] = $value }
    }
    foreach ($name in $Environment.Keys) { $info.EnvironmentVariables[$name] = [string]$Environment[$name] }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    if (-not $process.Start()) { throw "Could not start smoke process: $FilePath" }
    return [PSCustomObject]@{ Process = $process; Output = $process.StandardOutput.ReadToEndAsync(); Error = $process.StandardError.ReadToEndAsync() }
}

function Stop-SmokeProcessTree {
    param([Diagnostics.Process]$Target)
    if ($Target.HasExited) { return }
    # Capture taskkill's stderr through ProcessStartInfo. A descendant can exit
    # between enumeration and taskkill; only a still-running target is a failure.
    $killer = Start-IsolatedSmokeProcess -FilePath (Join-Path $env:SYSTEMROOT 'System32\taskkill.exe') -Arguments @('/PID', "$($Target.Id)", '/T', '/F')
    try {
        if (-not $killer.Process.WaitForExit(10000)) { throw "Smoke process tree cleanup timed out" }
        if (-not $Target.WaitForExit(10000)) { throw "Smoke child process did not stop: $(Read-SmokeOutput $killer.Error)" }
    } finally {
        if (-not $killer.Process.HasExited) { $killer.Process.Kill() }
        $killer.Process.Dispose()
    }
}

function Stop-SmokeProcess {
    param($Handle)
    if ($null -ne $Handle) { Stop-SmokeProcessTree $Handle.Process }
}

function Get-SmokeChildren {
    param([Diagnostics.Process]$Parent)
    Get-CimInstance Win32_Process -Filter "ParentProcessId = $($Parent.Id)" |
        Where-Object { $_.CreationDate.ToUniversalTime() -ge $Parent.StartTime.ToUniversalTime() }
}

function Wait-SmokeChildrenExit {
    param([Diagnostics.Process]$Parent, [ValidateRange(1, 20)][int]$TimeoutSeconds = 10)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    do {
        $left = @(Get-SmokeChildren $Parent)
        if (-not $left.Count) { return }
        if ($watch.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
            $names = ($left | ForEach-Object { "$($_.Name) ($($_.ProcessId))" }) -join ', '
            throw "Desktop left child processes after shutdown: $names"
        }
        Start-Sleep -Milliseconds 100
    } while ($true)
}

function Read-SmokeOutput {
    param($ReadTask)
    if (-not $ReadTask.Wait(10000)) { throw "Smoke output pipe remained open after its process exited" }
    return $ReadTask.GetAwaiter().GetResult()
}

function Assert-Unauthorized {
    param([string]$Uri, [string]$Token)
    $headers = @{}
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    $rejected = $false
    try { Invoke-WebRequest $Uri -Headers $headers -UseBasicParsing -TimeoutSec 3 | Out-Null }
    catch { $rejected = $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401 }
    if (-not $rejected) { throw "Packaged service did not reject the missing or wrong account capability" }
}

function Wait-ServiceHealth {
    param($Handle, [string]$Url, [string]$Token)
    $name = Split-Path -Leaf $Handle.Process.StartInfo.FileName
    Write-Host "[smoke-runtime] waiting for $name at $Url"
    $lastResponse = "no response"
    $watch = [Diagnostics.Stopwatch]::StartNew()
    while ($watch.Elapsed -lt [TimeSpan]::FromSeconds(90)) {
        if ($Handle.Process.HasExited) { throw "Packaged $name exited before health check (exit $($Handle.Process.ExitCode)): $(Read-SmokeOutput $Handle.Error)" }
        try {
            $response = Invoke-RestMethod "$Url/health" -Headers @{ Authorization = "Bearer $Token" } -TimeoutSec 1
            if ($response.status -eq "ok") { return }
            $lastResponse = "unexpected health status"
        } catch {
            $lastResponse = if ($_.Exception.Response) { "HTTP $([int]$_.Exception.Response.StatusCode)" } else { "connection unavailable" }
            Start-Sleep -Milliseconds 250
        }
    }
    throw "Packaged $name health check timed out at $Url ($lastResponse)"
}

function Invoke-MarkdownImportSmoke {
    param([string]$Origin, [string]$SidecarUrl, [string]$Token)
    Add-Type -AssemblyName System.Net.Http
    $headers = @{ Origin = $Origin; Authorization = "Bearer $Token" }
    $documentResponse = Invoke-WebRequest "$SidecarUrl/documents" -Method Post -Headers $headers -ContentType "application/json" -Body (@{
        title = "Release Markdown smoke $PID"; pack_id = "resume"; target_language = "zh-CN"; initial_mode = "import_old_resume"
    } | ConvertTo-Json) -UseBasicParsing -TimeoutSec 5
    $document = $documentResponse.Content | ConvertFrom-Json
    $documentId = [string]$document.id
    if (-not $documentId) { throw "Release runtime did not create a smoke document" }
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.UseProxy = $false
    $httpClient = [Net.Http.HttpClient]::new($handler)
    $httpClient.Timeout = [TimeSpan]::FromSeconds(45)
    try {
        $markdown = "# Release Smoke Resume`n`n- Imported from the packaged Markdown converter`n"
        $multipart = [Net.Http.MultipartFormDataContent]::new()
        $fileContent = [Net.Http.ByteArrayContent]::new([Text.Encoding]::UTF8.GetBytes($markdown))
        $fileContent.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new("text/markdown")
        $multipart.Add($fileContent, "file", "release-smoke.md")
        $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Post, "$SidecarUrl/documents/$documentId/sources/import-file")
        $request.Headers.Add("Origin", $Origin)
        $request.Headers.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $Token)
        $request.Content = $multipart
        $response = $httpClient.SendAsync($request).GetAwaiter().GetResult()
        $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ($response.StatusCode -ne [Net.HttpStatusCode]::Created) { throw "Packaged Markdown import failed with $($response.StatusCode): $responseBody" }
        $allowedOrigins = [Collections.Generic.IEnumerable[string]]$null
        if (-not $response.Headers.TryGetValues("Access-Control-Allow-Origin", [ref]$allowedOrigins) -or ($allowedOrigins | Select-Object -First 1) -ne $Origin) {
            throw "Packaged Markdown import returned an unexpected CORS origin"
        }
        $source = $responseBody | ConvertFrom-Json
        $workspace = Invoke-RestMethod "$SidecarUrl/documents/$documentId/workspace-view" -Headers $headers -TimeoutSec 5
        if ($workspace.source_resume_canvas.old_resume_source_id -ne $source.id -or ($workspace.source_resume_canvas.doc_json | ConvertTo-Json -Depth 30) -notmatch "Release Smoke Resume") {
            throw "Packaged Markdown import did not initialize source_resume_canvas with the imported content"
        }
    } finally {
        $httpClient.Dispose()
        Invoke-WebRequest "$SidecarUrl/documents/$documentId" -Method Delete -Headers $headers -UseBasicParsing -TimeoutSec 5 | Out-Null
    }
}

function Find-RuntimeFile {
    param([string]$Name)
    $files = @(Get-ChildItem -LiteralPath $runtimeDirectory -Recurse -File -Filter $Name)
    if ($files.Count -ne 1) { throw "Expected one packaged $Name under the executable directory" }
    return $files[0].FullName
}

function Invoke-PackagedServicesSmoke {
    $sidecar = $null; $hostProcess = $null; $broker = $null
    $data = Join-Path $smokeRoot "service-profile"
    $token = New-PrivateToken
    $brokerToken = New-PrivateToken
    $sidecarPort = Get-FreeLoopbackPort
    $hostPort = Get-FreeLoopbackPort
    $brokerPort = Get-FreeLoopbackPort
    while ($hostPort -eq $sidecarPort) { $hostPort = Get-FreeLoopbackPort }
    while ($brokerPort -in @($sidecarPort, $hostPort)) { $brokerPort = Get-FreeLoopbackPort }
    $sidecarUrl = "http://127.0.0.1:$sidecarPort"
    $agentHostUrl = "http://127.0.0.1:$hostPort"
    $brokerUrl = "http://127.0.0.1:$brokerPort"
    $sidecarBinary = Find-RuntimeFile "typedance-sidecar.exe"
    $hostBinary = Find-RuntimeFile "typedance-agent-host.exe"
    $converter = Find-RuntimeFile "typedance-markdown-converter.exe"
    $manifestPath = Find-RuntimeFile "chromium-manifest.json"
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    $browser = Join-Path (Split-Path -Parent $manifestPath) $manifest.chromiumExecutable
    if (-not (Test-Path -LiteralPath $browser -PathType Leaf)) { throw "Bundled Chromium executable was not found" }
    $pluginRoot = Join-Path (Split-Path -Parent (Split-Path -Parent $manifestPath)) "plugins"
    if (-not (Test-Path -LiteralPath (Join-Path $pluginRoot "resume\plugin.json"))) { throw "Bundled resume plugin was not found" }
    New-Item -ItemType Directory -Path (Join-Path $data "agent-host") -Force | Out-Null
    # Preserve the existing per-profile Langfuse-loading check, using only dummy smoke credentials.
    [IO.File]::WriteAllText((Join-Path $data "agent-host\langfuse.env"), "LANGFUSE_ENABLED=true`nLANGFUSE_BASE_URL=http://127.0.0.1:1`nLANGFUSE_PUBLIC_KEY=pk-smoke`nLANGFUSE_SECRET_KEY=sk-smoke`nLANGFUSE_CAPTURE_CONTENT=false`n", [Text.UTF8Encoding]::new($false))
    # This broker exists only in this verification script, holds no keys, and grants no login identity.
    $brokerScript = @'
const http = require('node:http');
const { timingSafeEqual } = require('node:crypto');
const token = process.env.TYPEDANCE_SMOKE_CREDENTIAL_TOKEN;
if (!token || token.length < 32) throw new Error('Private smoke capability is required');
const port = Number(process.env.TYPEDANCE_SMOKE_CREDENTIAL_PORT);
const server = http.createServer((request, response) => {
  const supplied = Buffer.from(request.headers.authorization || '');
  const expected = Buffer.from('Bearer ' + token);
  response.setHeader('Cache-Control', 'no-store');
  if (request.headers.host !== '127.0.0.1:' + port || request.headers.origin || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    response.writeHead(401).end(); return;
  }
  if (request.method !== 'GET' || request.url !== '/secrets/model-api-key') { response.writeHead(405).end(); return; }
  response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ value: null }));
});
server.listen(port, '127.0.0.1');
process.on('SIGTERM', () => server.close(() => process.exit(0)));
'@
    try {
        $node = if ($env:TYPEDANCE_NODE_BINARY) { $env:TYPEDANCE_NODE_BINARY } else { "node" }
        $broker = Start-IsolatedSmokeProcess -FilePath $node -Arguments @("--eval", $brokerScript) -Environment @{
            TYPEDANCE_SMOKE_CREDENTIAL_TOKEN = $brokerToken; TYPEDANCE_SMOKE_CREDENTIAL_PORT = $brokerPort
        }
        $sidecar = Start-IsolatedSmokeProcess -FilePath $sidecarBinary -Arguments @("--host", "127.0.0.1", "--port", "$sidecarPort", "--data-dir", $data, "--browser-path", $browser, "--markdown-converter-path", $converter) -Environment @{ TYPEDANCE_LOCAL_TOKEN = $token }
        Wait-ServiceHealth -Handle $sidecar -Url $sidecarUrl -Token $token
        $hostProcess = Start-IsolatedSmokeProcess -FilePath $hostBinary -Environment @{
            AGENT_HOST_HOST = "127.0.0.1"; AGENT_HOST_PORT = $hostPort; TYPEDANCE_DATA_DIR = $data
            TYPEDANCE_LOCAL_TOKEN = $token; TYPEDANCE_SIDECAR_URL = $sidecarUrl; TYPEDANCE_PLUGIN_ROOT = $pluginRoot
            TYPEDANCE_CREDENTIAL_URL = $brokerUrl; TYPEDANCE_CREDENTIAL_TOKEN = $brokerToken
        }
        Wait-ServiceHealth -Handle $hostProcess -Url $agentHostUrl -Token $token
        foreach ($url in @($sidecarUrl, $agentHostUrl)) {
            Assert-Unauthorized -Uri "$url/health"
            Assert-Unauthorized -Uri "$url/health" -Token (New-PrivateToken)
        }
        Assert-Unauthorized -Uri "$brokerUrl/secrets/model-api-key" -Token $token
        $tauriOrigin = "http://tauri.localhost"
        $preflight = Invoke-WebRequest "$agentHostUrl/settings/model" -Method Options -Headers @{
            Origin = $tauriOrigin; "Access-Control-Request-Method" = "PUT"; "Access-Control-Request-Headers" = "content-type,authorization"
        } -UseBasicParsing -TimeoutSec 3
        $methods = @([string]$preflight.Headers["Access-Control-Allow-Methods"] -split ",")
        $allowedHeaders = @([string]$preflight.Headers["Access-Control-Allow-Headers"] -split ",")
        if ($preflight.StatusCode -ne 204 -or $methods.Trim() -notcontains "PUT" -or $allowedHeaders.Trim() -notcontains "authorization") { throw "Packaged Agent Host rejected authenticated Tauri CORS preflight" }
        $settings = Invoke-RestMethod "$agentHostUrl/settings/model" -Headers @{ Origin = $tauriOrigin; Authorization = "Bearer $token" } -TimeoutSec 5
        if ($settings.api_key.configured -ne $false) { throw "Isolated runtime inherited a model API key or returned invalid credential state" }
        $documents = Invoke-WebRequest "$sidecarUrl/documents" -Headers @{ Origin = $tauriOrigin; Authorization = "Bearer $token" } -UseBasicParsing -TimeoutSec 3
        if ($documents.Headers["Access-Control-Allow-Origin"] -ne $tauriOrigin) { throw "Packaged Sidecar rejected Tauri CORS" }
        Invoke-MarkdownImportSmoke -Origin $tauriOrigin -SidecarUrl $sidecarUrl -Token $token
        $closed = Invoke-RestMethod "$agentHostUrl/account/prepare-close" -Method Post -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 20
        if (-not $closed.ok) { throw "Packaged Agent Host did not complete prepare-close" }
    } finally {
        try { Stop-SmokeProcess $hostProcess }
        finally { try { Stop-SmokeProcess $sidecar } finally { Stop-SmokeProcess $broker } }
    }
    if (-not (Read-SmokeOutput $hostProcess.Output).Contains("Langfuse: enabled")) { throw "Packaged Agent Host did not load isolated per-profile Langfuse settings" }
    foreach ($port in @($sidecarPort, $hostPort, $brokerPort)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { throw "Packaged service smoke left a listening port" }
    }
    Write-Host "[smoke-runtime] private packaged services, Tauri CORS, Markdown import, profile credentials and prepare-close passed"
    Write-Host "[smoke-runtime] per-profile Langfuse configuration loaded without AI or cloud calls"
}

function Invoke-UnconfiguredDesktopSmoke {
    if ((Get-WindowsExecutableSubsystem $executablePath) -ne 2) { throw "Release desktop must use the Windows GUI subsystem (2)" }
    $desktop = $null
    $desktopFailure = $null
    $desktopData = Join-Path $smokeRoot "unconfigured-account-data"
    try {
        $desktop = Start-IsolatedSmokeProcess -FilePath $executablePath -ShowWindow -Environment @{
            TYPEDANCE_ACCOUNT_DATA_DIR = $desktopData
            TYPEDANCE_RELEASE_SMOKE_EXIT_AFTER_MS = "12000"
            WEBVIEW2_USER_DATA_FOLDER = (Join-Path $smokeRoot "webview-data")
        }
        $watch = [Diagnostics.Stopwatch]::StartNew()
        $guiSeen = $false
        while (-not $desktop.Process.HasExited -and $watch.Elapsed -lt [TimeSpan]::FromSeconds(35)) {
            $desktop.Process.Refresh()
            if ($desktop.Process.MainWindowHandle -ne [IntPtr]::Zero) { $guiSeen = $true }
            $children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $desktop.Process.Id -and $_.Name -in @("typedance-sidecar.exe", "typedance-agent-host.exe", "typedance-markdown-converter.exe") })
            if ($children.Count) { throw "Unconfigured desktop started a business service before login" }
            Start-Sleep -Milliseconds 150
        }
        if (-not $guiSeen) { throw "Unconfigured desktop did not create its GUI window" }
        if (-not $desktop.Process.HasExited -or $desktop.Process.ExitCode -ne 0) { throw "Unconfigured desktop did not complete clean automatic shutdown" }
        Write-Host "[smoke-runtime] desktop exited cleanly; waiting for WebView process shutdown"
        Wait-SmokeChildrenExit $desktop.Process
        $diagnostics = Read-SmokeOutput $desktop.Error
        if (-not $diagnostics.Contains("Account startup gate: unconfigured")) { throw "Desktop did not confirm the real unconfigured account gate" }
        if (Test-Path -LiteralPath (Join-Path $desktopData "profiles")) { throw "Unconfigured desktop created account business storage" }
    } catch {
        $desktopFailure = $_
        throw
    } finally {
        try {
            Stop-SmokeProcess $desktop
            if ($null -ne $desktop) {
                # Never terminate a reused PID or a process outside this smoke.
                foreach ($child in @(Get-SmokeChildren $desktop.Process)) {
                    $target = $null
                    try {
                        $target = [Diagnostics.Process]::GetProcessById($child.ProcessId)
                        if ([Math]::Abs(($target.StartTime.ToUniversalTime() - $child.CreationDate.ToUniversalTime()).TotalMilliseconds) -ge 1) { throw "Smoke child identity changed before cleanup" }
                        Stop-SmokeProcessTree $target
                    } catch [ArgumentException] {
                        # The enumerated child has already finished its natural shutdown.
                    } finally { if ($null -ne $target) { $target.Dispose() } }
                }
            }
        } catch {
            if ($null -eq $desktopFailure) { throw }
            Write-Warning "Desktop smoke cleanup also failed: $($_.Exception.Message)"
        }
    }
    Write-Host "[smoke-runtime] unconfigured GUI, login gate and clean managed shutdown passed"
}

$releaseProcessNames = @("typedance_desktop.exe", "typedance-sidecar.exe", "typedance-agent-host.exe", "typedance-markdown-converter.exe")
try {
    $existing = @(Get-CimInstance Win32_Process | Where-Object { $_.Name -in $releaseProcessNames })
    if ($existing.Count) { throw "TypeDance processes are already running; smoke will not interfere with a user session" }
    Invoke-PackagedServicesSmoke
    if (-not $ServicesOnly) { Invoke-UnconfiguredDesktopSmoke }
} finally {
    $resolvedSmoke = [IO.Path]::GetFullPath($smokeRoot)
    $allowedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $resolvedSmoke.StartsWith($allowedTemp, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path -Leaf $resolvedSmoke) -notlike "typedance-release-smoke-*") {
        throw "Smoke cleanup target is outside the dedicated temporary directory"
    }
    if (Test-Path -LiteralPath $resolvedSmoke) { Remove-Item -LiteralPath $resolvedSmoke -Recurse -Force }
}
