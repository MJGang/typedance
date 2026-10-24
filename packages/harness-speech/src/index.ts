import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import { spawn, type ChildProcess } from "node:child_process";
import { validateSpeechInput, type HarnessSpeechInput, type HarnessSpeechProvider, type HarnessTranscript } from "@typedance/harness-core";

// Revision-pinned upstream SenseVoiceSmall and Silero artifacts; origins only change transport.
export const senseVoiceAssets = [
  { name: "model.int8.onnx", path: "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/model.int8.onnx", bytes: 239233841, sha256: "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51" },
  { name: "tokens.txt", path: "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/2365baeacb507f821a0c8120fcee3d484dba7a07/tokens.txt", bytes: 315894, sha256: "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc" },
  { name: "silero_vad.onnx", path: "csukuangfj/vad/resolve/fba88cd2e921609e7675c3aaf51e0b9b295da4bc/silero_vad.onnx", bytes: 1807522, sha256: "a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28" },
] as const;
export const speechLanguages = ["auto", "zh", "en", "yue", "ja", "ko"] as const;
export const speechDownloadOrigins = ["https://hf-mirror.com", "https://huggingface.co"] as const;

export async function verifySpeechAssets(directory: string): Promise<boolean> {
  for (const asset of senseVoiceAssets) {
    try {
      const path = join(directory, asset.name);
      if ((await stat(path)).size !== asset.bytes) return false;
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (hash.digest("hex") !== asset.sha256) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  return true;
}

export async function prepareSpeechAssets(directory: string, origin: string, signal: AbortSignal,
  progress: (completed: number, total: number) => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  if (!(speechDownloadOrigins as readonly string[]).includes(origin)) throw new Error("Unsupported model download origin");
  await mkdir(directory, { recursive: true });
  const total = senseVoiceAssets.reduce((sum, asset) => sum + asset.bytes, 0);
  let completed = 0;
  for (const asset of senseVoiceAssets) {
    signal.throwIfAborted();
    const path = join(directory, asset.name);
    // Each completed file is independently reusable after cancellation or a failed later file.
    let cached = false;
    try {
      if ((await stat(path)).size === asset.bytes) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(path)) { signal.throwIfAborted(); hash.update(chunk); }
        cached = hash.digest("hex") === asset.sha256;
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (cached) { completed += asset.bytes; progress(completed, total); continue; }
    const temporary = `${path}.partial`;
    try {
      const response = await fetchImpl(`${origin}/${asset.path}`, { signal });
      if (!response.ok || !response.body) throw new Error(`模型下载失败（HTTP ${response.status}），请在设置中重试或更换下载源`);
      const hash = createHash("sha256");
      let received = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > asset.bytes) { callback(new Error("模型文件大小超出预期")); return; }
        hash.update(chunk); progress(completed + received, total); callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(temporary), { signal });
      if (received !== asset.bytes || hash.digest("hex") !== asset.sha256) throw new Error("模型文件完整性校验失败，请重试下载");
      await rename(temporary, path);
      completed += asset.bytes;
    } finally { await rm(temporary, { force: true }); }
  }
}

type NativeOptions = { directory: string; modulePath: string; workerCommand?: { executable: string; args: string[] } };

export function resolveSpeechRuntime(packagePath?: string): string {
  return createRequire(packagePath ?? import.meta.url).resolve("sherpa-onnx-node");
}

export async function checkSpeechNativeRuntime(modulePath: string): Promise<void> {
  const worker = new Worker('const { parentPort, workerData } = require("node:worker_threads"); const native = require(workerData); if (typeof native.OfflineRecognizer !== "function" || typeof native.Vad !== "function") throw new Error("Invalid speech native runtime"); parentPort.postMessage("ready");', { eval: true, workerData: modulePath });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Speech native runtime startup timed out")), 15_000);
      worker.once("message", () => { clearTimeout(timer); resolve(); });
      worker.once("error", (error) => { clearTimeout(timer); reject(error); });
      worker.once("exit", () => { clearTimeout(timer); reject(new Error("Speech native runtime exited before readiness")); });
    });
  } finally { await worker.terminate(); }
}

export class SpeechBusyError extends Error {
  constructor() { super("语音识别正在处理另一段录音，请稍后重试"); }
}

/** Entry for executable hosts: inference children receive all configuration over private IPC. */
export function runSpeechWorker(): void {
  new Function("require", speechProcessSource)(createRequire(process.execPath));
}

/** Native inference lives in a reclaimable OS process; cancellation kills and joins it. */
export class SenseVoiceProvider implements HarnessSpeechProvider {
  readonly id = "sensevoice-small";
  readonly languages = speechLanguages;
  #worker?: { child: ChildProcess; ready: boolean; stderr: string };
  #busy = false;
  #disposed = false;
  #idle?: ReturnType<typeof setTimeout>;
  constructor(private readonly options: NativeOptions) {}

  async transcribe(input: HarnessSpeechInput, caller: AbortSignal): Promise<HarnessTranscript> {
    validateSpeechInput(input);
    if (!this.languages.includes(input.language as typeof speechLanguages[number])) throw new Error("Unsupported speech language");
    caller.throwIfAborted();
    if (this.#disposed) throw new Error("Speech provider disposed");
    if (this.#busy) throw new SpeechBusyError();
    this.#busy = true;
    clearTimeout(this.#idle);
    const signal = AbortSignal.any([caller, AbortSignal.timeout(90_000)]);
    try {
      const worker = this.#worker ??= this.#start();
      const child = worker.child;
      const result = await new Promise<HarnessTranscript>((resolve, reject) => {
        const cleanup = () => { child.off("message", message); child.off("error", fail); child.off("exit", exit); signal.removeEventListener("abort", abort); };
        const fail = (error: Error) => { cleanup(); reject(error); };
        const exit = () => fail(new Error(`语音识别进程已退出，请重试${worker.stderr ? `：${worker.stderr}` : ""}`));
        const abort = () => fail(signal.reason instanceof Error ? signal.reason : new Error("语音识别已取消"));
        const send = (value: object) => child.send(value, (error) => { if (error) fail(error); });
        const message = (value: { type?: string; text?: unknown; error?: string }) => {
          if (value.type === "ready") { worker.ready = true; send({ type: "transcribe", input }); return; }
          if (typeof value.text !== "string" || value.text.length > 120_000) { fail(new Error(value.error || "语音识别返回了无效结果")); return; }
          cleanup(); resolve({ text: value.text, audioSeconds: input.samples.length / input.sampleRate });
        };
        child.on("message", message); child.once("error", fail); child.once("exit", exit);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) { abort(); return; }
        send(worker.ready ? { type: "transcribe", input } : { type: "initialize", options: { directory: this.options.directory, modulePath: this.options.modulePath } });
      });
      this.#idle = setTimeout(() => { void this.#stop(); }, 60_000);
      this.#idle.unref();
      return result;
    } catch (error) { await this.#stop(); throw error; }
    finally { this.#busy = false; }
  }
  #start() {
    const command = this.options.workerCommand ?? { executable: process.execPath, args: ["--eval", speechProcessSource] };
    const child = spawn(command.executable, command.args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe", "ipc"], serialization: "advanced" });
    const worker = { child, ready: false, stderr: "" };
    child.stderr?.on("data", (chunk: Buffer) => { worker.stderr = `${worker.stderr}${chunk.toString("utf8")}`.slice(-2000); });
    child.on("error", () => {});
    child.once("exit", () => { if (this.#worker === worker) this.#worker = undefined; });
    return worker;
  }
  async #stop() {
    const worker = this.#worker;
    this.#worker = undefined;
    if (!worker?.child.pid || worker.child.exitCode !== null || worker.child.signalCode !== null) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("语音识别进程未能退出")), 10_000);
      worker.child.once("exit", () => { clearTimeout(timer); resolve(); });
      worker.child.kill("SIGKILL");
    });
  }
  async dispose() { this.#disposed = true; clearTimeout(this.#idle); await this.#stop(); }
}

// Plain JavaScript is isolated from bundler transforms and native module resolution in SEA.
const speechProcessSource = String.raw`
process.once("disconnect", () => process.exit(0));
process.once("message", (initial) => {
  if (initial.type !== "initialize") throw new Error("Expected speech worker initialization");
  const workerData = initial.options;
  const parentPort = {
    postMessage: (value) => process.send(value),
    on: (_event, listener) => process.on("message", (message) => { if (message.type === "transcribe") listener(message.input); }),
  };
  const { join: pathJoin } = require("node:path");
  const sherpa = require(workerData.modulePath);
  const config = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { senseVoice: { model: pathJoin(workerData.directory, "model.int8.onnx"), language: "auto", useInverseTextNormalization: 1 },
      tokens: pathJoin(workerData.directory, "tokens.txt"), numThreads: 2, provider: "cpu", debug: 0 },
  };
  const recognizer = new sherpa.OfflineRecognizer(config);
  const detector = new sherpa.Vad({ sileroVad: { model: pathJoin(workerData.directory, "silero_vad.onnx"), threshold: 0.5,
    minSilenceDuration: 0.5, minSpeechDuration: 0.2, maxSpeechDuration: 20, windowSize: 512 }, sampleRate: 16000, numThreads: 1, provider: "cpu", debug: 0 }, 22);
  parentPort.on("message", (input) => {
    try {
      config.modelConfig.senseVoice.language = input.language;
      recognizer.setConfig(config); detector.reset();
      const texts = [];
      let firstSegment = true;
      const drain = () => {
        while (!detector.isEmpty()) {
          const segment = detector.front(false);
          const from = firstSegment ? Math.max(0, segment.start - 3200) : segment.start;
          firstSegment = false;
          const speech = input.samples.slice(from, Math.min(input.samples.length, segment.start + segment.samples.length));
          const stream = recognizer.createStream();
          stream.acceptWaveform({ samples: speech, sampleRate: 16000 });
          recognizer.decode(stream); texts.push(recognizer.getResult(stream).text.trim()); detector.pop();
        }
      };
      for (let i = 0; i < input.samples.length; i += 512) { detector.acceptWaveform(input.samples.subarray(i, i + 512)); drain(); }
      detector.flush(); drain(); parentPort.postMessage({ text: texts.filter(Boolean).join(" ").trim() });
    } catch (error) { parentPort.postMessage({ error: error instanceof Error ? error.message : "Local recognition failed" }); }
  });
  process.send({ type: "ready" });
});
`;
