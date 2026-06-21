import { spawnSync } from "node:child_process"
import {
  access,
  cp,
  copyFile,
  mkdir,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath, pathToFileURL } from "node:url"

import { findForbiddenReleasePaths } from "./release-lib.mjs"

const SENTINEL_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"
const TARGET_TRIPLE = "x86_64-pc-windows-msvc"
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const repositoryRoot = resolve(scriptDirectory, "..", "..")
const require = createRequire(import.meta.url)

export function createSeaConfig(main, output) {
  return {
    main,
    output,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
  }
}

export async function buildSeaBinary({ entryPoint, stagingName, binaryName, define = {} }) {
  assertBuildPlatform()
  const stagingDirectory = join(repositoryRoot, "artifacts", "release", "staging", stagingName)
  const bundledEntry = join(stagingDirectory, `${stagingName}.cjs`)
  const blobPath = join(stagingDirectory, `${stagingName}.blob`)
  const seaConfigPath = join(stagingDirectory, "sea-config.json")
  const binaryDirectory = join(repositoryRoot, "apps", "desktop", "src-tauri", "binaries")
  const binaryPath = join(binaryDirectory, `${binaryName}-${TARGET_TRIPLE}.exe`)

  await rm(stagingDirectory, { recursive: true, force: true })
  await mkdir(stagingDirectory, { recursive: true })
  await mkdir(binaryDirectory, { recursive: true })

  const esbuild = await import("esbuild")
  await esbuild.build({
    entryPoints: [entryPoint],
    outfile: bundledEntry,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node24",
    sourcemap: false,
    minify: false,
    logLevel: "info",
    define,
  })

  await writeFile(seaConfigPath, `${JSON.stringify(createSeaConfig(bundledEntry, blobPath), null, 2)}\n`, "utf8")
  run(process.execPath, ["--experimental-sea-config", seaConfigPath])
  await copyFile(process.execPath, binaryPath)
  run(await findSignTool(), ["remove", "/s", binaryPath])
  const postjectCli = join(dirname(require.resolve("postject/package.json")), "dist", "cli.js")
  run(process.execPath, [
    postjectCli,
    binaryPath,
    "NODE_SEA_BLOB",
    blobPath,
    "--sentinel-fuse",
    SENTINEL_FUSE,
  ])

  const binarySize = (await stat(binaryPath)).size
  if (binarySize < 10_000_000) {
    throw new Error(`${binaryName} SEA binary is unexpectedly small: ${binarySize} bytes`)
  }

  return { binaryPath, binarySize }
}

export async function buildAgentHost() {
  const { binaryPath, binarySize } = await buildSeaBinary({
    entryPoint: join(repositoryRoot, "packages", "agent-host", "src", "cli.ts"),
    stagingName: "agent-host",
    binaryName: "typedance-agent-host",
    define: {
      "import.meta.url": JSON.stringify(pathToFileURL(join(repositoryRoot, "packages", "agent-host", "src", "resume-plugin.ts")).href),
    },
  })
  const pluginSource = join(repositoryRoot, "plugins", "resume")
  const pluginTarget = join(repositoryRoot, "apps", "desktop", "src-tauri", "resources", "plugins", "resume")

  await rm(pluginTarget, { recursive: true, force: true })
  await mkdir(dirname(pluginTarget), { recursive: true })

  await cp(pluginSource, pluginTarget, { recursive: true })
  const pluginFiles = await listRelativeFiles(pluginTarget)
  const forbidden = findForbiddenReleasePaths(pluginFiles)
  if (forbidden.length > 0) {
    throw new Error(`Forbidden Agent Host resources: ${forbidden.join(", ")}`)
  }
  return { binaryPath, pluginTarget, binarySize }
}

function assertBuildPlatform() {
  const major = Number(process.versions.node.split(".")[0])
  if (process.platform !== "win32" || process.arch !== "x64" || major !== 24) {
    throw new Error(`Agent Host SEA requires Windows x64 and Node.js 24; received ${process.platform}/${process.arch} Node ${process.versions.node}`)
  }
}

async function findSignTool() {
  const kitsBin = "C:\\Program Files (x86)\\Windows Kits\\10\\bin"
  const versions = (await readdir(kitsBin, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^\d+\.\d+/.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
  for (const version of versions) {
    const candidate = join(kitsBin, version, "x64", "signtool.exe")
    try {
      await access(candidate)
      return candidate
    } catch {
      // Continue to the next Windows SDK.
    }
  }
  throw new Error("Windows SDK signtool.exe was not found")
}

async function listRelativeFiles(root) {
  const files = []
  async function visit(directory, prefix) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await visit(join(directory, entry.name), relative)
      else files.push(relative)
    }
  }
  await visit(root, "")
  return files
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    stdio: "inherit",
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`)
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false

if (invokedAsScript) {
  buildAgentHost()
    .then(({ binaryPath, binarySize }) => {
      console.log(`[build-agent-host] ${binaryPath} (${binarySize} bytes)`)
    })
    .catch((error) => {
      console.error(`[build-agent-host] ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    })
}
