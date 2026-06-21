[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Executable
)

$ErrorActionPreference = "Stop"
$executablePath = (Resolve-Path -LiteralPath $Executable).Path

function Get-WindowsExecutableSubsystem {
    param([Parameter(Mandatory = $true)][string]$Path)

    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 96 -or $bytes[0] -ne 0x4D -or $bytes[1] -ne 0x5A) {
        throw "Release executable is not a valid Windows PE file: $Path"
    }
    $peOffset = [BitConverter]::ToInt32($bytes, 0x3C)
    if ($peOffset -lt 0 -or ($peOffset + 94) -gt $bytes.Length) {
        throw "Release executable has an invalid PE header offset: $Path"
    }
    return [BitConverter]::ToUInt16($bytes, $peOffset + 92)
}

function Invoke-MarkdownImportSmoke {
    param([Parameter(Mandatory = $true)][string]$Origin)

    Add-Type -AssemblyName System.Net.Http
    $documentResponse = Invoke-WebRequest `
        "http://127.0.0.1:4317/documents" `
        -Method Post `
        -Headers @{ Origin = $Origin } `
        -ContentType "application/json" `
        -Body (@{
            title = "Release Markdown smoke $PID"
            pack_id = "resume"
            target_language = "zh-CN"
            initial_mode = "import_old_resume"
        } | ConvertTo-Json) `
        -UseBasicParsing `
        -TimeoutSec 5
    $document = $documentResponse.Content | ConvertFrom-Json
    $documentId = [string]$document.id
    if (-not $documentId) {
        throw "Release runtime did not create a smoke document"
    }

    $temporaryMarkdown = Join-Path $env:TEMP "typedance-release-smoke-$PID.md"
    $httpClient = [System.Net.Http.HttpClient]::new()
    try {
        Set-Content -LiteralPath $temporaryMarkdown -Encoding utf8 -Value @"
# Release Smoke Resume

- Imported from the packaged Markdown converter
"@
        $multipart = [System.Net.Http.MultipartFormDataContent]::new()
        $fileContent = [System.Net.Http.ByteArrayContent]::new(
            [IO.File]::ReadAllBytes($temporaryMarkdown)
        )
        $fileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new("text/markdown")
        $multipart.Add($fileContent, "file", "release-smoke.md")
        $request = [System.Net.Http.HttpRequestMessage]::new(
            [System.Net.Http.HttpMethod]::Post,
            "http://127.0.0.1:4317/documents/$documentId/sources/import-file"
        )
        $request.Headers.Add("Origin", $Origin)
        $request.Content = $multipart
        $response = $httpClient.SendAsync($request).GetAwaiter().GetResult()
        $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if ($response.StatusCode -ne [Net.HttpStatusCode]::Created) {
            throw "Packaged Markdown import failed with $($response.StatusCode): $responseBody"
        }
        $allowedOrigins = [System.Collections.Generic.IEnumerable[string]]$null
        if (-not $response.Headers.TryGetValues("Access-Control-Allow-Origin", [ref]$allowedOrigins)) {
            throw "Packaged Markdown import response has no Access-Control-Allow-Origin header"
        }
        if (($allowedOrigins | Select-Object -First 1) -ne $Origin) {
            throw "Packaged Markdown import returned an unexpected CORS origin"
        }
        $source = $responseBody | ConvertFrom-Json
        $workspace = Invoke-RestMethod `
            "http://127.0.0.1:4317/documents/$documentId/workspace-view" `
            -Headers @{ Origin = $Origin } `
            -TimeoutSec 5
        if ($workspace.source_resume_canvas.old_resume_source_id -ne $source.id) {
            throw "Packaged Markdown import did not initialize source_resume_canvas"
        }
    } finally {
        $httpClient.Dispose()
        Remove-Item -LiteralPath $temporaryMarkdown -Force -ErrorAction SilentlyContinue
        Invoke-WebRequest `
            "http://127.0.0.1:4317/documents/$documentId" `
            -Method Delete `
            -Headers @{ Origin = $Origin } `
            -UseBasicParsing `
            -TimeoutSec 5 | Out-Null
    }
}

$subsystem = Get-WindowsExecutableSubsystem -Path $executablePath
if ($subsystem -ne 2) {
    throw "Release desktop must use the Windows GUI subsystem (2), found $subsystem"
}

$releaseProcessNames = @(
    "typedance_desktop.exe",
    "typedance-sidecar.exe",
    "typedance-agent-host.exe",
    "typedance-markdown-converter.exe"
)
$existing = Get-CimInstance Win32_Process | Where-Object { $_.Name -in $releaseProcessNames }
if ($existing) {
    throw "TypeDance release processes are already running: $($existing.ProcessId -join ', ')"
}

$env:TYPEDANCE_RELEASE_SMOKE_EXIT_AFTER_MS = "30000"
$process = Start-Process -FilePath $executablePath -PassThru -WindowStyle Hidden
Remove-Item Env:TYPEDANCE_RELEASE_SMOKE_EXIT_AFTER_MS
$healthy = $false
$tauriOrigin = "http://tauri.localhost"
try {
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    while ($stopwatch.Elapsed -lt [TimeSpan]::FromSeconds(20) -and -not $process.HasExited) {
        try {
            $sidecar = Invoke-RestMethod "http://127.0.0.1:4317/health" -TimeoutSec 1
            $agentHost = Invoke-RestMethod "http://127.0.0.1:4327/health" -TimeoutSec 1
            $agentPreflight = Invoke-WebRequest `
                "http://127.0.0.1:4327/settings/model" `
                -Method Options `
                -Headers @{
                    Origin = $tauriOrigin
                    "Access-Control-Request-Method" = "PUT"
                    "Access-Control-Request-Headers" = "content-type"
                } `
                -UseBasicParsing `
                -TimeoutSec 1
            $documents = Invoke-WebRequest `
                "http://127.0.0.1:4317/documents" `
                -Headers @{ Origin = $tauriOrigin } `
                -UseBasicParsing `
                -TimeoutSec 1
            $allowedOrigin = [string]$documents.Headers["Access-Control-Allow-Origin"]
            $agentMethods = @([string]$agentPreflight.Headers["Access-Control-Allow-Methods"] -split ",")
            if (
                $sidecar.status -eq "ok" -and
                $agentHost.status -eq "ok" -and
                $agentPreflight.StatusCode -eq 204 -and
                $agentMethods.Trim() -contains "PUT" -and
                $documents.StatusCode -eq 200 -and
                $allowedOrigin -eq $tauriOrigin
            ) {
                $healthy = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $healthy) {
        throw "Release runtime did not become healthy with Access-Control-Allow-Origin: $tauriOrigin"
    }
    Invoke-MarkdownImportSmoke -Origin $tauriOrigin
    if (-not $process.WaitForExit(45000)) {
        throw "Release runtime did not complete managed shutdown"
    }
    if ($process.ExitCode -ne 0) {
        throw "Release runtime exited with code $($process.ExitCode)"
    }
    Start-Sleep -Seconds 3
    $remaining = Get-CimInstance Win32_Process | Where-Object { $_.Name -in $releaseProcessNames }
    if ($remaining) {
        throw "Release runtime left child processes: $($remaining.ProcessId -join ', ')"
    }
    Write-Host "[smoke-runtime] GUI subsystem, packaged CORS, Markdown import and managed shutdown passed"
} finally {
    if (-not $process.HasExited) {
        & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
    }
}
