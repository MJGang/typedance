import test from "node:test"
import assert from "node:assert/strict"

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
