import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isSea } from "node:sea";
import { fileURLToPath } from "node:url";
import { SenseVoiceProvider, SpeechBusyError, prepareSpeechAssets, verifySpeechAssets, senseVoiceAssets, resolveSpeechRuntime } from "@typedance/harness-speech";
import { speechPreferencesSchema, type SpeechPreferences, type SpeechStatus } from "@typedance/contracts";
import { HttpError } from "./local-access";

export class LocalSpeechService {
  #directory: string;
  #configPath: string;
  #state: SpeechStatus = { language: "auto", download_origin: "https://hf-mirror.com", phase: "checking", completed_bytes: 0,
    total_bytes: senseVoiceAssets.reduce((sum, asset) => sum + asset.bytes, 0) };
  #initial: Promise<void>;
  #preparing?: { abort: AbortController; done: Promise<void> };
  #provider?: SenseVoiceProvider;
  #disposed = false;
  #configuring = false;
  constructor(dataDir: string) {
    this.#directory = join(dataDir, "speech", "sensevoice-small-int8");
    this.#configPath = join(dataDir, "agent-host", "speech.json");
    this.#initial = this.#initialize();
  }
  async #initialize() {
    try {
      try { this.#state = { ...this.#state, ...speechPreferencesSchema.parse(JSON.parse(await readFile(this.#configPath, "utf8"))) }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      this.#state.phase = await verifySpeechAssets(this.#directory) ? "ready" : "unprepared";
    } catch (error) { this.#state.phase = "failed"; this.#state.error = error instanceof Error ? error.message : "语音模型检查失败"; }
  }
  async status(): Promise<SpeechStatus> { await this.#initial; return { ...this.#state }; }
  async configure(value: SpeechPreferences): Promise<SpeechStatus> {
    await this.#initial;
    if (this.#preparing) throw new HttpError(409, "请先取消模型下载再修改设置");
    if (this.#configuring) throw new HttpError(409, "语音设置正在保存，请稍后重试");
    const preferences = speechPreferencesSchema.parse(value);
    this.#configuring = true;
    try {
      await mkdir(dirname(this.#configPath), { recursive: true });
      const temporary = `${this.#configPath}.tmp`;
      await writeFile(temporary, JSON.stringify(preferences), { mode: 0o600 }); await rename(temporary, this.#configPath);
      this.#state = { ...this.#state, ...preferences };
    } finally { this.#configuring = false; }
    return this.status();
  }
  async prepare(): Promise<SpeechStatus> {
    await this.#initial;
    if (this.#disposed) throw new Error("Speech service disposed");
    if (this.#configuring) throw new HttpError(409, "语音设置正在保存，请稍后重试");
    if (this.#state.phase === "ready" || this.#preparing) return this.status();
    const abort = new AbortController();
    this.#state = { ...this.#state, phase: "downloading", completed_bytes: 0, error: undefined };
    const done = prepareSpeechAssets(this.#directory, this.#state.download_origin, AbortSignal.any([abort.signal, AbortSignal.timeout(20 * 60_000)]),
      (completed, total) => { this.#state.completed_bytes = completed; this.#state.total_bytes = total; })
      .then(() => { this.#state.phase = "ready"; })
      .catch((error: unknown) => { this.#state.phase = abort.signal.aborted ? "unprepared" : "failed";
        this.#state.error = abort.signal.aborted ? undefined : error instanceof Error ? error.message : "模型下载失败"; })
      .finally(() => { if (this.#preparing?.abort === abort) this.#preparing = undefined; });
    this.#preparing = { abort, done };
    return this.status();
  }
  async cancelPreparation() { this.#preparing?.abort.abort(); await this.#preparing?.done; return this.status(); }
  async transcribe(value: unknown, signal: AbortSignal) {
    await this.#initial;
    if (this.#disposed || this.#state.phase !== "ready") throw new HttpError(409, "请先在设置 → 语音输入中下载本地模型");
    const body = value as { audio?: unknown };
    if (typeof body?.audio !== "string" || body.audio.length > 5_120_000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.audio)) throw new HttpError(400, "无效的录音数据");
    const bytes = Buffer.from(body.audio, "base64");
    if (bytes.length === 0 || bytes.length % 2 !== 0 || bytes.length > 16000 * 120 * 2) throw new HttpError(400, "录音须为 120 秒以内的 16 kHz 单声道 PCM16");
    const samples = Float32Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readInt16LE(i * 2) / 32768);
    if (!this.#provider) {
      this.#provider = new SenseVoiceProvider({ directory: this.#directory, modulePath: resolveSpeechRuntime(isSea() ? join(dirname(process.execPath), "speech-runtime", "package.json") : undefined),
        workerCommand: { executable: process.execPath, args: isSea() ? ["--speech-worker"] : [...process.execArgv, fileURLToPath(new URL("./cli.ts", import.meta.url)), "--speech-worker"] } });
    }
    try { return await this.#provider.transcribe({ samples, sampleRate: 16000, language: this.#state.language }, signal); }
    catch (error) { if (error instanceof SpeechBusyError) throw new HttpError(409, error.message); throw error; }
  }
  async dispose() { this.#disposed = true; await this.cancelPreparation(); await this.#provider?.dispose(); }
}
