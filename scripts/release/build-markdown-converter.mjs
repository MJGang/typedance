import { dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { buildSeaBinary } from "./build-agent-host.mjs"

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, "..", "..")

export function buildMarkdownConverter() {
  return buildSeaBinary({
    entryPoint: join(repositoryRoot, "packages", "resume-markdown", "src", "cli.js"),
    stagingName: "markdown-converter",
    binaryName: "typedance-markdown-converter",
  })
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false

if (invokedAsScript) {
  buildMarkdownConverter()
    .then(({ binaryPath, binarySize }) => {
      console.log(`[build-markdown-converter] ${binaryPath} (${binarySize} bytes)`)
    })
    .catch((error) => {
      console.error(`[build-markdown-converter] ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    })
}
