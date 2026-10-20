import { readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createUpdateManifest } from "./release-lib.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"))
const artifacts = resolve(process.argv[2] ?? resolve(root, "artifacts/release"))
const installer = resolve(artifacts, `TypeDance_${version}_x64-setup.exe`)
if (!statSync(installer).isFile() || statSync(installer).size === 0) {
  throw new Error("Updater installer is missing or empty")
}
const manifest = createUpdateManifest({
  version,
  signature: readFileSync(`${installer}.sig`, "utf8"),
  notes: readFileSync(resolve(root, "docs/release-notes.md"), "utf8"),
  publishedAt: new Date().toISOString(),
  repository: process.env.TYPEDANCE_UPDATE_REPOSITORY,
})
const destination = resolve(artifacts, "latest.json")
writeFileSync(destination, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
console.log(`[release] Update manifest: ${destination}`)
