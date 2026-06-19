import test from "node:test"
import assert from "node:assert/strict"

import {
  assertReleaseVersions,
  findForbiddenReleasePaths,
  releaseArtifactNames,
} from "./release-lib.mjs"

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
