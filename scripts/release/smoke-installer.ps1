[CmdletBinding()]
param(
    [string]$Installer
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $Installer) {
    $version = (Get-Content (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json).version
    $Installer = Join-Path $repositoryRoot "artifacts\release\TypeDance_${version}_x64-setup.exe"
}
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$uninstallRoot = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"

function Find-TypeDanceInstallation {
    Get-ItemProperty "$uninstallRoot\*" -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -eq "TypeDance" } |
        Select-Object -First 1
}

$existing = Find-TypeDanceInstallation
if ($existing) {
    throw "TypeDance is already installed. Installer smoke test will not overwrite an existing user installation."
}

$installation = $null
$sentinel = Join-Path $env:APPDATA "app.typedance.desktop\release-smoke-$PID.sentinel"
$langfuseConfig = Join-Path $env:APPDATA "app.typedance.desktop\agent-host\langfuse.env"
$langfuseConfigCreated = $false
try {
    $installerProcess = Start-Process -FilePath $installerPath -ArgumentList "/S" -PassThru -Wait
    if ($installerProcess.ExitCode -ne 0) {
        throw "NSIS installer exited with code $($installerProcess.ExitCode)"
    }
    $installation = Find-TypeDanceInstallation
    if (-not $installation) {
        throw "TypeDance uninstall registration was not created"
    }

    $displayIcon = [string]$installation.DisplayIcon
    $installedExecutable = $displayIcon.Trim('"').Split(',')[0]
    if (-not (Test-Path -LiteralPath $installedExecutable)) {
        throw "Installed TypeDance executable was not found: $installedExecutable"
    }
    $installDirectory = Split-Path -Parent $installedExecutable
    $speechHost = Join-Path $installDirectory "typedance-agent-host.exe"
    $speechCheck = Start-Process -FilePath $speechHost -ArgumentList "--check-speech-runtime" -WindowStyle Hidden -PassThru -Wait
    if ($speechCheck.ExitCode -ne 0) {
        throw "Installed speech native runtime failed to load (exit $($speechCheck.ExitCode))"
    }
    & node (Join-Path $repositoryRoot "scripts\release\smoke-speech-runtime.mjs") --host $speechHost
    if ($LASTEXITCODE -ne 0) {
        throw "Installed speech recognition smoke test failed (exit $LASTEXITCODE)"
    }
    $chromium = Get-ChildItem -LiteralPath $installDirectory -Recurse -Filter "chrome.exe" -File |
        Select-Object -First 1
    if (-not $chromium) {
        throw "Bundled Chromium was not installed"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $sentinel) | Out-Null
    Set-Content -LiteralPath $sentinel -Encoding utf8 -Value "preserve-user-data"
    if (Test-Path -LiteralPath $langfuseConfig) {
        throw "Installer smoke will not overwrite an existing Langfuse configuration"
    }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $langfuseConfig) | Out-Null
    [IO.File]::WriteAllText($langfuseConfig, @"
LANGFUSE_ENABLED=true
LANGFUSE_BASE_URL=http://127.0.0.1:1
LANGFUSE_PUBLIC_KEY=pk-smoke
LANGFUSE_SECRET_KEY=sk-smoke
LANGFUSE_CAPTURE_CONTENT=false
"@, [Text.UTF8Encoding]::new($false))
    $langfuseConfigCreated = $true
    $smokeArguments = @(
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", (Join-Path $PSScriptRoot "smoke-release-runtime.ps1"),
        "-Executable", $installedExecutable
    )
    & powershell @smokeArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Installed runtime smoke test failed with code $LASTEXITCODE"
    }
    $agentHostLog = Join-Path $env:APPDATA "app.typedance.desktop\logs\agent-host.log"
    if (-not (Test-Path -LiteralPath $agentHostLog) -or
        -not ([IO.File]::ReadAllText($agentHostLog).Contains("Langfuse: enabled"))) {
        throw "Installed Agent Host did not load the per-user Langfuse configuration"
    }
    Write-Host "[smoke-installer] per-user Langfuse configuration loaded without cloud requests"
} finally {
    if ($installation) {
        $uninstallString = [string]$installation.UninstallString
        if ($uninstallString -match '^"([^"]+)"') {
            $uninstaller = $Matches[1]
        } else {
            $uninstaller = $uninstallString.Split(' ')[0]
        }
        if (Test-Path -LiteralPath $uninstaller) {
            Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait | Out-Null
        }
    }
    if ($langfuseConfigCreated -and (Test-Path -LiteralPath $langfuseConfig)) {
        Remove-Item -LiteralPath $langfuseConfig -Force
    }
}

if (-not (Test-Path -LiteralPath $sentinel)) {
    throw "Uninstaller removed user application data"
}
Remove-Item -LiteralPath $sentinel -Force
Write-Host "[smoke-installer] install, runtime, uninstall and data preservation passed"
