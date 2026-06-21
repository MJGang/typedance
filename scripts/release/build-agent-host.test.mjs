import test from "node:test"
import assert from "node:assert/strict"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSeaConfig } from "./build-agent-host.mjs"

test("creates a Node 24 SEA config for one CommonJS entry", () => {
  assert.deepEqual(
    createSeaConfig("C:/staging/agent-host.cjs", "C:/staging/agent-host.blob"),
    {
      main: "C:/staging/agent-host.cjs",
      output: "C:/staging/agent-host.blob",
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
  )
})

test("Markdown converter entry bundles as CommonJS for Node SEA", async () => {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
  const esbuild = await import("esbuild")

  const result = await esbuild.build({
    entryPoints: [resolve(repositoryRoot, "packages/resume-markdown/src/cli.js")],
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    write: false,
    logLevel: "silent",
  })

  assert.equal(result.outputFiles.length, 1)
  assert.match(result.outputFiles[0].text, /Expected JSON payload with markdown or blocks/)
})
