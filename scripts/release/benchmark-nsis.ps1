[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$releaseRoot = Join-Path $repositoryRoot "artifacts\release"
$bundleRoot = Join-Path $repositoryRoot "apps\desktop\src-tauri\target\release\bundle\nsis"
$results = [System.Collections.Generic.List[object]]::new()
$overridePath = Join-Path $releaseRoot "nsis-benchmark-config.json"

Set-Location $repositoryRoot
try {
    foreach ($compression in @("lzma", "zlib")) {
        $override = @{ bundle = @{ windows = @{ nsis = @{ compression = $compression } } } }
        [IO.File]::WriteAllText($overridePath, (ConvertTo-Json $override -Depth 5), [Text.UTF8Encoding]::new($false))
        $stopwatch = [Diagnostics.Stopwatch]::StartNew()
        & corepack pnpm --filter @typedance/desktop exec tauri bundle --ci `
            --config src-tauri/tauri.release.conf.json --config $overridePath --bundles nsis
        if ($LASTEXITCODE -ne 0) {
            throw "NSIS $compression benchmark failed with code $LASTEXITCODE"
        }
        $stopwatch.Stop()
        $installers = @(Get-ChildItem -LiteralPath $bundleRoot -Filter "*.exe" -File)
        if ($installers.Count -ne 1) {
            throw "Expected exactly one benchmark installer, found $($installers.Count)"
        }
        $results.Add([pscustomobject]@{
            compression = $compression
            seconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
            installer_bytes = $installers[0].Length
        })
        Write-Host "[nsis-benchmark] $compression $($results[$results.Count - 1].seconds)s $($installers[0].Length) bytes"
    }
    [IO.File]::WriteAllText(
        (Join-Path $releaseRoot "nsis-benchmark.json"),
        (ConvertTo-Json -InputObject $results.ToArray() -Depth 3),
        [Text.UTF8Encoding]::new($false)
    )
    if ($env:GITHUB_STEP_SUMMARY) {
        $summary = "### NSIS compression benchmark`n`n| Compression | Seconds | Installer bytes |`n| --- | ---: | ---: |`n"
        $results | ForEach-Object {
            $summary += "| $($_.compression) | $($_.seconds) | $($_.installer_bytes) |`n"
        }
        [IO.File]::AppendAllText($env:GITHUB_STEP_SUMMARY, $summary, [Text.UTF8Encoding]::new($false))
    }
} finally {
    Remove-Item -LiteralPath $overridePath -Force -ErrorAction SilentlyContinue
}
