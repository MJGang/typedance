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

$subsystem = Get-WindowsExecutableSubsystem -Path $executablePath
if ($subsystem -ne 2) {
    throw "Release desktop must use the Windows GUI subsystem (2), found $subsystem"
}

$releaseProcessNames = @(
    "typedance_desktop.exe",
    "typedance-sidecar.exe",
    "typedance-agent-host.exe"
)
$existing = Get-CimInstance Win32_Process | Where-Object { $_.Name -in $releaseProcessNames }
if ($existing) {
    throw "TypeDance release processes are already running: $($existing.ProcessId -join ', ')"
}

$env:TYPEDANCE_RELEASE_SMOKE_EXIT_AFTER_MS = "10000"
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
            $documents = Invoke-WebRequest `
                "http://127.0.0.1:4317/documents" `
                -Headers @{ Origin = $tauriOrigin } `
                -UseBasicParsing `
                -TimeoutSec 1
            $allowedOrigin = [string]$documents.Headers["Access-Control-Allow-Origin"]
            if (
                $sidecar.status -eq "ok" -and
                $agentHost.status -eq "ok" -and
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
    if (-not $process.WaitForExit(30000)) {
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
    Write-Host "[smoke-runtime] GUI subsystem, packaged CORS, healthy startup and managed shutdown passed"
} finally {
    if (-not $process.HasExited) {
        & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
    }
}
