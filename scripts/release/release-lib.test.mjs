import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  assertReleaseVersions,
  findForbiddenReleasePaths,
  releaseArtifactNames,
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
      "certs/app.pfx",
      "data/typedance.sqlite",
    ]),
    [".env", "certs/app.pfx", "data/typedance.sqlite"],
  )
})

test("uses stable NSIS artifact names", () => {
  assert.deepEqual(releaseArtifactNames("0.1.0"), [
    "TypeDance_0.1.0_x64-setup.exe",
    "TypeDance_0.1.0_x64-setup.exe.sha256",
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
  ])
  assert.deepEqual(config.bundle.resources, {
    "resources/ms-playwright/": "ms-playwright/",
    "../../../plugins/": "plugins/",
  })
  assert.equal(config.bundle.windows.nsis.installMode, "currentUser")
  assert.equal(config.app.windows[0].visible, false)
  assert.deepEqual(findForbiddenReleasePaths(Object.keys(config.bundle.resources)), [])
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
