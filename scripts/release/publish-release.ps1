[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$package = Get-Content (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
$version = $package.version
$tag = "v$version"
$artifact = Join-Path $repositoryRoot "artifacts\release\TypeDance_${version}_x64-setup.exe"
$checksum = "$artifact.sha256"

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is required to publish a release"
}
if (-not (Test-Path -LiteralPath $artifact) -or -not (Test-Path -LiteralPath $checksum)) {
    throw "Release artifacts are missing. Run pnpm release first."
}

& gh release create $tag $artifact $checksum --generate-notes --title "TypeDance $version"
if ($LASTEXITCODE -ne 0) {
    throw "gh release create failed with code $LASTEXITCODE"
}
