[CmdletBinding()]
param(
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseRoot = Join-Path $repositoryRoot "artifacts\release"
$tauriRoot = Join-Path $repositoryRoot "apps\desktop\src-tauri"
$bundleRoot = Join-Path $tauriRoot "target\release\bundle\nsis"

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )

    Write-Host "[release] $FilePath $($Arguments -join ' ')"
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath exited with code $LASTEXITCODE"
    }
}

function Read-ReleaseVersion {
    $rootPackage = Get-Content (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
    $desktopPackage = Get-Content (Join-Path $repositoryRoot "apps\desktop\package.json") -Raw | ConvertFrom-Json
    $tauriConfig = Get-Content (Join-Path $tauriRoot "tauri.conf.json") -Raw | ConvertFrom-Json
    $cargoToml = Get-Content (Join-Path $tauriRoot "Cargo.toml") -Raw
    $cargoMatch = [regex]::Match($cargoToml, '(?m)^version\s*=\s*"([^"]+)"')
    if (-not $cargoMatch.Success) {
        throw "Unable to read Cargo package version"
    }

    $versions = @(
        $rootPackage.version,
        $desktopPackage.version,
        $tauriConfig.version,
        $cargoMatch.Groups[1].Value
    )
    if (($versions | Select-Object -Unique).Count -ne 1) {
        throw "Release versions must match: $($versions -join ', ')"
    }
    return $versions[0]
}

function Assert-NoForbiddenReleaseInputs {
    $roots = @(
        (Join-Path $tauriRoot "resources\ms-playwright"),
        (Join-Path $repositoryRoot "plugins")
    )
    $forbidden = Get-ChildItem $roots -Recurse -Force -File | Where-Object {
        $_.Name -match '^\.env(?:\.|$)' -or
        $_.Extension -match '^\.(pem|pfx|p12|key)$' -or
        $_.Name -eq 'typedance.sqlite' -or
        $_.FullName -match '[\\/]\.git[\\/]'
    }
    if ($forbidden) {
        throw "Forbidden files found in release inputs: $($forbidden.FullName -join ', ')"
    }
}

if ($env:PROCESSOR_ARCHITECTURE -ne "AMD64") {
    throw "Windows x64 is required to build the NSIS release"
}
if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
    throw "uv is required to provision the Python 3.11 release environment"
}

Set-Location $repositoryRoot
$version = Read-ReleaseVersion
Write-Host "[release] Building TypeDance $version for Windows x64"

Invoke-Checked "corepack" @("pnpm", "release:test")
if (-not $SkipTests) {
    Invoke-Checked "corepack" @("pnpm", "test")
}
Invoke-Checked "corepack" @("pnpm", "build")
Invoke-Checked "node" @("scripts/release/build-agent-host.mjs")
Invoke-Checked "node" @("scripts/release/build-markdown-converter.mjs")
Invoke-Checked "powershell" @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "scripts/release/build-sidecar.ps1"
)

$releasePython = Join-Path $releaseRoot "python\.venv\Scripts\python.exe"
Invoke-Checked $releasePython @(
    "apps/desktop/scripts/download-chromium.py",
    "--output", "apps/desktop/src-tauri/resources/ms-playwright"
)
Assert-NoForbiddenReleaseInputs
Invoke-Checked "cargo" @(
    "test", "--manifest-path", "apps/desktop/src-tauri/Cargo.toml", "--lib"
)

if (Test-Path -LiteralPath $bundleRoot) {
    $resolvedBundleRoot = (Resolve-Path -LiteralPath $bundleRoot).Path
    $resolvedTauriRoot = (Resolve-Path -LiteralPath $tauriRoot).Path
    if (-not $resolvedBundleRoot.StartsWith($resolvedTauriRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clean bundle path outside Tauri target: $resolvedBundleRoot"
    }
    Remove-Item -LiteralPath $resolvedBundleRoot -Recurse -Force
}

Invoke-Checked "corepack" @(
    "pnpm", "--filter", "@typedance/desktop", "exec", "tauri", "build",
    "--config", "src-tauri/tauri.release.conf.json",
    "--bundles", "nsis"
)
Invoke-Checked "powershell" @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "scripts/release/smoke-release-runtime.ps1",
    "-Executable", "apps/desktop/src-tauri/target/release/typedance_desktop.exe"
)

$installers = @(Get-ChildItem -LiteralPath $bundleRoot -Filter "*.exe" -File)
if ($installers.Count -ne 1) {
    throw "Expected exactly one NSIS installer, found $($installers.Count)"
}
New-Item -ItemType Directory -Force -Path $releaseRoot | Out-Null
$artifactName = "TypeDance_${version}_x64-setup.exe"
$artifactPath = Join-Path $releaseRoot $artifactName
Copy-Item -LiteralPath $installers[0].FullName -Destination $artifactPath -Force

$hash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
$hashPath = "$artifactPath.sha256"
Set-Content -LiteralPath $hashPath -Encoding ascii -NoNewline -Value "$hash  $artifactName`n"

Write-Host "[release] Installer: $artifactPath"
Write-Host "[release] SHA256:   $hashPath"
