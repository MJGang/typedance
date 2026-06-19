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
    $chromium = Get-ChildItem -LiteralPath $installDirectory -Recurse -Filter "chrome.exe" -File |
        Select-Object -First 1
    if (-not $chromium) {
        throw "Bundled Chromium was not installed"
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $sentinel) | Out-Null
    Set-Content -LiteralPath $sentinel -Encoding utf8 -Value "preserve-user-data"
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
}

if (-not (Test-Path -LiteralPath $sentinel)) {
    throw "Uninstaller removed user application data"
}
Remove-Item -LiteralPath $sentinel -Force
Write-Host "[smoke-installer] install, runtime, uninstall and data preservation passed"
