[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$sidecarRoot = Join-Path $repositoryRoot "services\sidecar"
$releaseRoot = Join-Path $repositoryRoot "artifacts\release\python"
$venvRoot = Join-Path $releaseRoot ".venv"
$python = Join-Path $venvRoot "Scripts\python.exe"
$workRoot = Join-Path $releaseRoot "work"
$oneDirRoot = Join-Path $releaseRoot "onedir"
$oneFileRoot = Join-Path $releaseRoot "onefile"
$specPath = Join-Path $sidecarRoot "typedance-sidecar.spec"
$targetBinary = Join-Path $repositoryRoot "apps\desktop\src-tauri\binaries\typedance-sidecar-x86_64-pc-windows-msvc.exe"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath exited with code $LASTEXITCODE"
    }
}

function Stop-ProcessTree {
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
    if (($LASTEXITCODE -ne 0) -and (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $ProcessId -Force
    }
}

function Stop-StaleReleaseSidecars {
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq "typedance-sidecar.exe" -and
            $_.ExecutablePath -and
            $_.ExecutablePath.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)
        } |
        ForEach-Object { Stop-ProcessTree $_.ProcessId }
}

function Assert-SidecarHealthy {
    param(
        [Parameter(Mandatory = $true)][string]$Executable,
        [ValidateRange(1, 120)][int]$HealthTimeoutSeconds = 60
    )

    $smokeRoot = Join-Path $releaseRoot ("smoke-" + [Guid]::NewGuid().ToString("N"))
    $dataDir = Join-Path $smokeRoot "data"
    $browserPath = Join-Path $smokeRoot "browser\chrome.exe"
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { $port = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
    $random = [Security.Cryptography.RandomNumberGenerator]::Create()
    $tokenBytes = New-Object byte[] 32
    try { $random.GetBytes($tokenBytes) } finally { $random.Dispose() }
    $token = [Convert]::ToBase64String($tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $headers = @{ Authorization = "Bearer $token" }
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $browserPath) | Out-Null
    if (-not (Test-Path $browserPath)) {
        New-Item -ItemType File -Path $browserPath | Out-Null
    }
    $process = $null
    $processStarted = $false
    try {
        # Direct launch avoids an interactive shell hand-off for the packaged executable.
        # The capability belongs to this child, so the caller's environment never changes.
        $start = [Diagnostics.ProcessStartInfo]::new()
        $start.FileName = $Executable
        $start.Arguments = (@(
            "--host", "127.0.0.1",
            "--port", $port,
            "--data-dir", ('"{0}"' -f $dataDir),
            "--browser-path", ('"{0}"' -f $browserPath)
        ) -join " ")
        $start.UseShellExecute = $false
        $start.CreateNoWindow = $true
        $start.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
        $start.RedirectStandardOutput = $true
        $start.RedirectStandardError = $true
        $start.EnvironmentVariables["TYPEDANCE_LOCAL_TOKEN"] = $token
        $process = [Diagnostics.Process]::new()
        $process.StartInfo = $start
        if (-not $process.Start()) { throw "Could not start packaged Sidecar health check" }
        $processStarted = $true
        $standardOutput = $process.StandardOutput.ReadToEndAsync()
        $standardError = $process.StandardError.ReadToEndAsync()
        $stopwatch = [Diagnostics.Stopwatch]::StartNew()
        # PyInstaller one-file executables extract into a temporary directory on
        # first launch. Windows Defender can make that cold start noticeably
        # slower than subsequent launches, so allow up to one minute while
        # still failing immediately if the child exits.
        while ($stopwatch.Elapsed -lt [TimeSpan]::FromSeconds($HealthTimeoutSeconds)) {
            if ($process.HasExited) {
                throw "Sidecar exited before becoming healthy (code $($process.ExitCode))"
            }
            try { $response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -Headers $headers -TimeoutSec 1 }
            catch {
                Start-Sleep -Milliseconds 250
                continue
            }
            if ($response.status -eq "ok") {
                $rejected = $false
                try { Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -UseBasicParsing -TimeoutSec 1 | Out-Null }
                catch { $rejected = $_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 401 }
                if (-not $rejected) { throw "Packaged Sidecar accepted an unauthenticated health request" }
                return
            }
        }
        $logPath = Join-Path $dataDir "logs\sidecar.log"
        $logTail = if (Test-Path -LiteralPath $logPath) {
            (Get-Content -LiteralPath $logPath -Tail 20) -join [Environment]::NewLine
        } else {
            "No sidecar log was created"
        }
        throw "Sidecar health check timed out after $([Math]::Round($stopwatch.Elapsed.TotalSeconds, 1)) seconds`n$logTail"
    } finally {
        if ($null -ne $process) {
            if ($processStarted) {
                if (-not $process.HasExited) { Stop-ProcessTree $process.Id }
                if (-not $process.WaitForExit(5000)) { throw "Packaged Sidecar health check did not stop" }
            }
            $process.Dispose()
        }
        $resolvedSmoke = [IO.Path]::GetFullPath($smokeRoot)
        $allowedRoot = [IO.Path]::GetFullPath($releaseRoot).TrimEnd('\') + '\'
        if (-not $resolvedSmoke.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Smoke cleanup target is outside the release directory"
        }
        if (Test-Path -LiteralPath $resolvedSmoke) { Remove-Item -LiteralPath $resolvedSmoke -Recurse -Force }
    }
}

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
    throw "Sidecar release build requires Windows x64"
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is required to provision the Python 3.11 release environment"
}

Stop-StaleReleaseSidecars
if (Test-Path -LiteralPath $releaseRoot) {
    $resolvedRelease = [IO.Path]::GetFullPath($releaseRoot)
    $allowedRepository = [IO.Path]::GetFullPath($repositoryRoot).TrimEnd('\') + '\'
    if (-not $resolvedRelease.StartsWith($allowedRepository, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Release cleanup target is outside the repository"
    }
    Remove-Item -LiteralPath $releaseRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
Invoke-Checked "uv" @("venv", "--python", "3.11", $venvRoot)
Invoke-Checked "uv" @("pip", "install", "--python", $python, "$sidecarRoot[release]")

$env:TYPEDANCE_PYINSTALLER_MODE = "onedir"
Invoke-Checked $python @(
    "-m", "PyInstaller", "--noconfirm", "--clean",
    "--distpath", $oneDirRoot,
    "--workpath", (Join-Path $workRoot "onedir"),
    $specPath
)
$oneDirExecutable = Join-Path $oneDirRoot "typedance-sidecar\typedance-sidecar.exe"
Assert-SidecarHealthy $oneDirExecutable

Remove-Item Env:TYPEDANCE_PYINSTALLER_MODE -ErrorAction SilentlyContinue
Invoke-Checked $python @(
    "-m", "PyInstaller", "--noconfirm", "--clean",
    "--distpath", $oneFileRoot,
    "--workpath", (Join-Path $workRoot "onefile"),
    $specPath
)
$oneFileExecutable = Join-Path $oneFileRoot "typedance-sidecar.exe"
Assert-SidecarHealthy $oneFileExecutable

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $targetBinary) | Out-Null
Copy-Item -LiteralPath $oneFileExecutable -Destination $targetBinary -Force
if ((Get-Item -LiteralPath $targetBinary).Length -lt 10MB) {
    throw "Sidecar executable is unexpectedly small"
}
Write-Host "[build-sidecar] $targetBinary ($((Get-Item -LiteralPath $targetBinary).Length) bytes)"
