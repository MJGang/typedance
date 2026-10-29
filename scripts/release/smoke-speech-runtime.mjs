import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import { createServer } from "node:net"
import { createServer as createHttpServer } from "node:http"
import { randomBytes } from "node:crypto"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

const { values } = parseArgs({ options: { host: { type: "string" }, "data-dir": { type: "string", default: "artifacts/speech-smoke-data" } } })
assert.ok(values.host, "--host must point to the packaged Agent Host executable")
const reservation = createServer()
await new Promise((done) => reservation.listen(0, "127.0.0.1", done))
const port = reservation.address().port
await new Promise((done) => reservation.close(done))
const localToken = randomBytes(32).toString("hex")
const credentialToken = randomBytes(32).toString("hex")
const broker = createHttpServer((request, response) => {
  response.setHeader("cache-control", "no-store")
  if (request.headers.authorization !== `Bearer ${credentialToken}`) {
    response.writeHead(401).end(); return
  }
  if (request.method !== "GET" || request.url !== "/secrets/model-api-key") {
    response.writeHead(404).end(); return
  }
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ value: null }))
})
await new Promise((done) => broker.listen(0, "127.0.0.1", done))
const child = spawn(resolve(values.host), [], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"], env: {
  ...process.env, AGENT_HOST_PORT: String(port), TYPEDANCE_DATA_DIR: resolve(values["data-dir"]),
  TYPEDANCE_LOCAL_TOKEN: localToken,
  TYPEDANCE_CREDENTIAL_URL: `http://127.0.0.1:${broker.address().port}`,
  TYPEDANCE_CREDENTIAL_TOKEN: credentialToken,
} })
let errors = ""
child.stderr.on("data", (chunk) => { errors = (errors + chunk.toString()).slice(-2000) })
let exited = false
const exit = new Promise((done) => child.once("exit", () => { exited = true; done() }))
child.once("error", (error) => { errors = error.message; exited = true })
const base = `http://127.0.0.1:${port}`
const pause = (ms) => new Promise((done) => setTimeout(done, ms))
const headers = { "content-type": "application/json", authorization: `Bearer ${localToken}` }
async function request(path, method = "GET", value) {
  const response = await fetch(`${base}${path}`, { method, headers, body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(100_000) })
  const result = await response.json()
  assert.ok(response.ok, `${method} ${path}: HTTP ${response.status} ${JSON.stringify(result)}`)
  return result
}
function pcm16(wav) {
  assert.equal(wav.toString("ascii", 0, 4), "RIFF")
  let format = false
  for (let i = 12; i + 8 <= wav.length;) {
    const size = wav.readUInt32LE(i + 4)
    if (wav.toString("ascii", i, i + 4) === "fmt ") {
      assert.equal(wav.readUInt16LE(i + 8), 1); assert.equal(wav.readUInt16LE(i + 10), 1)
      assert.equal(wav.readUInt32LE(i + 12), 16000); assert.equal(wav.readUInt16LE(i + 22), 16); format = true
    }
    if (wav.toString("ascii", i, i + 4) === "data") { assert.ok(format); return wav.subarray(i + 8, i + 8 + size) }
    i += 8 + size + size % 2
  }
  throw new Error("Missing PCM16 WAV fixture data")
}
async function transcribe(bytes) { return (await request("/speech/transcribe", "POST", { audio: bytes.toString("base64") })).text }
function generatedSamples(make, count = 32000) {
  const bytes = Buffer.alloc(count * 2)
  for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.round(make(i) * 32767), i * 2)
  return bytes
}
try {
  for (let attempt = 0; ; attempt++) {
    if (exited) throw new Error(`Packaged speech host exited: ${errors}`)
    try { if ((await fetch(`${base}/health`, { headers, signal: AbortSignal.timeout(1000) })).ok) break } catch {}
    assert.ok(attempt < 100, "Packaged speech host startup timeout"); await pause(100)
  }
  await request("/speech/settings", "PUT", { language: "zh", download_origin: "https://huggingface.co" })
  await request("/speech/prepare", "POST")
  const deadline = Date.now() + 5 * 60_000
  let reported = -1
  while (true) {
    const state = await request("/speech/settings")
    assert.notEqual(state.phase, "failed", state.error)
    if (state.phase === "ready") break
    const percent = Math.floor(state.completed_bytes / state.total_bytes * 10) * 10
    if (percent !== reported) { reported = percent; console.log(`[speech-smoke] verified model preparation ${percent}%`) }
    assert.ok(Date.now() < deadline, "Speech model preparation timeout"); await pause(250)
  }
  const clear = pcm16(await readFile(new URL("../../packages/harness-speech/tests/fixtures/hello-zh.wav", import.meta.url)))
  const quiet = Buffer.from(clear)
  for (let i = 0; i < quiet.length; i += 2) quiet.writeInt16LE(Math.round(quiet.readInt16LE(i) * .03), i)
  for (const [name, audio] of [["clear short speech", clear], ["quiet short speech", quiet], ["repeated short speech", quiet]]) {
    const text = await transcribe(audio)
    assert.equal(text.replace(/[^\p{Script=Han}]/gu, ""), "你好呀", `${name}: ${text}`)
    console.log(`[speech-smoke] ${name} passed`)
  }
  let seed = 12345
  const controls = [
    ["silence", Buffer.alloc(64000)],
    ["stationary noise", generatedSamples(() => { seed = (1664525 * seed + 1013904223) >>> 0; return (seed / 4294967296 - .5) * .2 })],
    ["tone", generatedSamples((i) => .1 * Math.sin(i * 2 * Math.PI * 440 / 16000))],
    ["DC offset", generatedSamples(() => .1)],
    ["isolated clicks", generatedSamples((i) => i % 8000 === 0 ? .9 : 0)],
  ]
  for (const [name, audio] of controls) { assert.equal(await transcribe(audio), "", name); console.log(`[speech-smoke] ${name} rejected`) }
  assert.ok((await fetch(`${base}/health`, { headers })).ok)
  console.log("[speech-smoke] packaged native inference, short speech, repetition and noise controls passed")
} finally {
  try {
    if (!exited) {
      child.kill()
      let timer
      try {
        await Promise.race([exit, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Speech smoke host did not exit")), 10_000) })])
      } finally { clearTimeout(timer) }
    }
  } finally {
    await new Promise((done) => { broker.close(done); broker.closeAllConnections() })
  }
}
