[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Executable
)

$ErrorActionPreference = "Stop"
$executablePath = (Resolve-Path -LiteralPath $Executable).Path
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
$process = Start-Process -FilePath $executablePath -PassThru
Remove-Item Env:TYPEDANCE_RELEASE_SMOKE_EXIT_AFTER_MS
$healthy = $false
try {
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    while ($stopwatch.Elapsed -lt [TimeSpan]::FromSeconds(20) -and -not $process.HasExited) {
        try {
            $sidecar = Invoke-RestMethod "http://127.0.0.1:4317/health" -TimeoutSec 1
            $agentHost = Invoke-RestMethod "http://127.0.0.1:4327/health" -TimeoutSec 1
            if ($sidecar.status -eq "ok" -and $agentHost.status -eq "ok") {
                $healthy = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $healthy) {
        throw "Release runtime did not become healthy"
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
    Write-Host "[smoke-runtime] healthy startup and managed shutdown passed"
} finally {
    if (-not $process.HasExited) {
        & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
    }
}
