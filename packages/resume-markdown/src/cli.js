#!/usr/bin/env node
import { stdin as input, stdout, stderr } from "node:process"
import { markdownBlockToResumeDocNodes, markdownToResumeDocJson } from "./index.js"

async function readStdin() {
  input.setEncoding("utf8")
  let body = ""
  for await (const chunk of input) {
    body += chunk
  }
  return body
}

function fail(message) {
  stderr.write(`${message}\n`)
  process.exitCode = 1
}

try {
  const body = await readStdin()
  const payload = body.trim() ? JSON.parse(body) : {}

  if (typeof payload.markdown === "string") {
    stdout.write(`${JSON.stringify({ docJson: markdownToResumeDocJson(payload.markdown) })}\n`)
  } else if (Array.isArray(payload.blocks)) {
    stdout.write(`${JSON.stringify({
      blocks: payload.blocks.map((block) => ({
        id: block.id,
        nodes: markdownBlockToResumeDocNodes(block.text ?? "", {
          fallbackType: block.fallbackType,
          attrs: block.attrs,
        }),
      })),
    })}\n`)
  } else {
    fail("Expected JSON payload with markdown or blocks")
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
}
