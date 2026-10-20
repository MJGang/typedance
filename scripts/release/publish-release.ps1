[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$package = Get-Content (Join-Path $repositoryRoot "package.json") -Raw | ConvertFrom-Json
$version = $package.version
$tag = "v$version"
$artifact = Join-Path $repositoryRoot "artifacts\release\TypeDance_${version}_x64-setup.exe"
$checksum = "$artifact.sha256"
$signature = "$artifact.sig"
$manifest = Join-Path $repositoryRoot "artifacts\release\latest.json"
$updateRepository = $env:TYPEDANCE_UPDATE_REPOSITORY

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) is required to publish a release"
}
if ($updateRepository -notmatch '^[A-Za-z0-9][A-Za-z0-9_.-]*/[A-Za-z0-9][A-Za-z0-9_.-]*$') {
    throw "Set TYPEDANCE_UPDATE_REPOSITORY to the public update repository before publishing."
}
if (@($artifact, $checksum, $signature, $manifest | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -gt 0) {
    throw "Release artifacts are missing. Run pnpm release first."
}

$metadata = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$expectedDownload = "https://github.com/$updateRepository/releases/download/$tag/TypeDance_${version}_x64-setup.exe"
if ($metadata.version -ne $version -or $metadata.platforms.'windows-x86_64'.url -ne $expectedDownload) {
    throw "The manifest version or repository differs from the release target. Rebuild before publishing."
}
$publicRepository = & gh repo view $updateRepository --json isPrivate --jq '.isPrivate'
if ($LASTEXITCODE -ne 0 -or $publicRepository -ne "false") {
    throw "The update repository must be public and accessible."
}
& gh release create $tag $artifact $checksum $signature $manifest --repo $updateRepository --notes-file (Join-Path $repositoryRoot "docs\release-notes.md") --title "TypeDance $version"
if ($LASTEXITCODE -ne 0) {
    throw "gh release create failed with code $LASTEXITCODE"
}
