import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  assertReleaseVersions,
  findForbiddenReleasePaths,
  releaseArtifactNames,
  createUpdateManifest,
} from "./release-lib.mjs"

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")

test("accepts one version across npm, Tauri and Cargo", () => {
  assert.equal(
    assertReleaseVersions({
      root: "0.1.0",
      desktop: "0.1.0",
      tauri: "0.1.0",
      cargo: "0.1.0",
    }),
    "0.1.0",
  )
})

test("rejects a mismatched release version", () => {
  assert.throws(
    () => assertReleaseVersions({
      root: "0.1.0",
      desktop: "0.1.0",
      tauri: "0.1.1",
      cargo: "0.1.0",
    }),
    /tauri=0\.1\.1/,
  )
})

test("rejects secrets and development state from bundle inputs", () => {
  assert.deepEqual(
    findForbiddenReleasePaths([
      "resources/plugins/resume/plugin.json",
      ".env",
      "resources/plugins/resume/langfuse.env",
      "certs/app.pfx",
      "data/typedance.sqlite",
    ]),
    [".env", "resources/plugins/resume/langfuse.env", "certs/app.pfx", "data/typedance.sqlite"],
  )
})

test("update manifest uses the signed installer for the exact published version", () => {
  const manifest = createUpdateManifest({
    version: "0.1.1", signature: "c2lnbmF0dXJl\n", notes: "- 修复问题\n", publishedAt: "2026-10-20T00:00:00Z", repository: "example/typedance-releases",
  })
  assert.equal(manifest.pub_date, "2026-10-20T00:00:00.000Z")
  assert.equal(manifest.notes, "- 修复问题")
  assert.deepEqual(manifest.platforms, {
    "windows-x86_64": {
      signature: "c2lnbmF0dXJl",
      url: "https://github.com/example/typedance-releases/releases/download/v0.1.1/TypeDance_0.1.1_x64-setup.exe",
    },
  })
})

test("rejects missing signatures and unsafe version paths", () => {
  const input = { version: "0.1.1", signature: "", notes: "", publishedAt: "2026-10-20", repository: "example/typedance-releases" }
  assert.throws(() => createUpdateManifest(input), /signature/)
  assert.throws(() => createUpdateManifest({ ...input, signature: "signature file path" }), /signature/)
  assert.throws(() => createUpdateManifest({ ...input, version: "../../other.exe" }), /version/)
  assert.throws(() => createUpdateManifest({ ...input, repository: undefined }), /public update repository/)
  assert.throws(() => createUpdateManifest({ ...input, repository: "owner/../private" }), /public update repository/)
})

test("uses stable NSIS artifact names", () => {
  assert.deepEqual(releaseArtifactNames("0.1.0"), [
    "TypeDance_0.1.0_x64-setup.exe",
    "TypeDance_0.1.0_x64-setup.exe.sha256",
    "TypeDance_0.1.0_x64-setup.exe.sig",
    "latest.json",
  ])
})

test("release Tauri config bundles only NSIS runtime inputs", () => {
  const config = JSON.parse(readFileSync(
    resolve(repositoryRoot, "apps/desktop/src-tauri/tauri.release.conf.json"),
    "utf8",
  ))

  assert.deepEqual(config.bundle.targets, ["nsis"])
  assert.deepEqual(config.bundle.externalBin, [
    "binaries/typedance-sidecar",
    "binaries/typedance-agent-host",
    "binaries/typedance-markdown-converter",
  ])
  assert.deepEqual(config.bundle.resources, {
    "resources/ms-playwright/": "ms-playwright/",
    "resources/speech-runtime/": "speech-runtime/",
    "../../../plugins/": "plugins/",
  })
  assert.equal(config.bundle.windows.nsis.installMode, "currentUser")
  assert.equal(config.bundle.createUpdaterArtifacts, true)
  assert.equal(config.app.windows[0].visible, false)
  assert.deepEqual(findForbiddenReleasePaths(Object.keys(config.bundle.resources)), [])
})

test("release desktop uses the Windows GUI subsystem", () => {
  const main = readFileSync(
    resolve(repositoryRoot, "apps/desktop/src-tauri/src/main.rs"),
    "utf8",
  )

  assert.match(
    main,
    /#!\[cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)\]/,
  )
})

test("JavaScript and Rust Tauri runtimes stay on the same release line", () => {
  const desktopPackage = JSON.parse(readFileSync(
    resolve(repositoryRoot, "apps/desktop/package.json"),
    "utf8",
  ))
  const webPackage = JSON.parse(readFileSync(
    resolve(repositoryRoot, "apps/web/package.json"),
    "utf8",
  ))
  const cargoToml = readFileSync(
    resolve(repositoryRoot, "apps/desktop/src-tauri/Cargo.toml"),
    "utf8",
  )
  const rustVersion = cargoToml.match(/tauri = \{ version = "=(\d+\.\d+)\./)?.[1]
  const desktopVersion = desktopPackage.dependencies["@tauri-apps/api"].match(/^(\d+\.\d+)\./)?.[1]
  const webVersion = webPackage.dependencies["@tauri-apps/api"].match(/^(\d+\.\d+)\./)?.[1]

  assert.equal(desktopVersion, rustVersion)
  assert.equal(webVersion, rustVersion)
})

test("root release commands use the checked-in PowerShell pipeline", () => {
  const packageJson = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"))
  const releaseScript = readFileSync(
    resolve(repositoryRoot, "scripts/release-windows.ps1"),
    "utf8",
  )

  assert.equal(
    packageJson.scripts.release,
    "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-windows.ps1",
  )
  assert.match(packageJson.scripts["release:smoke"], /smoke-installer\.ps1$/)
  assert.match(packageJson.scripts["release:publish"], /publish-release\.ps1$/)
  assert.match(releaseScript, /tauri\.release\.conf\.json/)
  assert.match(releaseScript, /--bundles", "nsis"/)
  assert.match(releaseScript, /Assert-NoForbiddenReleaseInputs/)
  assert.match(releaseScript, /build-markdown-converter\.mjs/)
  assert.doesNotMatch(releaseScript, /Get-Content[^\r\n]*\.env/i)
})

test("release runtime smoke checks the GUI subsystem and packaged Tauri CORS", () => {
  const smokeScript = readFileSync(
    resolve(repositoryRoot, "scripts/release/smoke-release-runtime.ps1"),
    "utf8",
  )

  assert.match(smokeScript, /Get-WindowsExecutableSubsystem/)
  assert.match(smokeScript, /http:\/\/tauri\.localhost/)
  assert.match(smokeScript, /Access-Control-Allow-Origin/)
  assert.match(smokeScript, /sources\/import-file/)
  assert.match(smokeScript, /MultipartFormDataContent/)
  assert.match(smokeScript, /source_resume_canvas/)
  assert.match(smokeScript, /StatusCode[^\r\n]*Created/)
  assert.match(smokeScript, /\$agentHostUrl\/settings\/model/)
  assert.match(smokeScript, /Access-Control-Request-Method[^\r\n]*PUT/)
  assert.match(smokeScript, /Invoke-FreshDesktopSmoke/)
  assert.match(smokeScript, /Assert-FreshLoginGate/)
  assert.match(smokeScript, /TYPEDANCE_ACCOUNT_DATA_DIR/)
  assert.match(smokeScript, /Assert-Unauthorized/)
  assert.doesNotMatch(smokeScript, /127\.0\.0\.1:(?:4317|4327)/)
})

test("tag workflow builds through pnpm release without application secrets", () => {
  const workflow = readFileSync(
    resolve(repositoryRoot, ".github/workflows/release-windows.yml"),
    "utf8",
  )

  assert.match(workflow, /tags:\s*\r?\n\s*- "v\*"/)
  assert.match(workflow, /contents: write/)
  assert.match(workflow, /vars\.TYPEDANCE_UPDATE_REPOSITORY/)
  assert.match(workflow, /GH_TOKEN: \$\{\{ github\.token \}\}/)
  assert.doesNotMatch(workflow, /TYPEDANCE_RELEASE_TOKEN/)
  assert.match(workflow, /run: pnpm release/)
  assert.match(workflow, /gh release create/)
  assert.doesNotMatch(workflow, /DEEPSEEK|API_KEY|\.env(?:\.|\s|$)/i)
})
