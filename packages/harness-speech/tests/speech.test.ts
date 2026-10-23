import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SenseVoiceProvider, prepareSpeechAssets, verifySpeechAssets } from "../src";

const directories: string[] = [];
async function temporary() { const value = await mkdtemp(join(tmpdir(), "harness-speech-")); directories.push(value); return value; }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe("local speech lifecycle", () => {
  it("restores only the first VAD onset without repeating speech across later segments", async () => {
    const directory = await temporary();
    const modulePath = join(directory, "segments.cjs");
    await writeFile(modulePath, `
      exports.OfflineRecognizer = class { setConfig() {} createStream() { return { acceptWaveform(input) { this.input = input } } } decode() {} getResult(stream) { return { text: stream.input.samples[0].toFixed(2) + ':' + stream.input.samples.length } } };
      exports.Vad = class { constructor() { this.count = 0; this.empty = true } reset() { this.count = 0 } acceptWaveform() { if (this.count < 2) this.empty = false } isEmpty() { return this.empty } front() { return { start: this.count === 0 ? 3200 : 4000, samples: new Float32Array(512) } } pop() { this.empty = true; this.count++ } flush() {} };
    `);
    const provider = new SenseVoiceProvider({ directory, modulePath });
    try {
      const result = await provider.transcribe({ samples: Float32Array.from({ length: 10000 }, (_, i) => i / 10000), sampleRate: 16000, language: "auto" }, new AbortController().signal);
      expect(result.text).toBe("0.00:3712 0.40:512");
    } finally { await provider.dispose(); }
  });
  it("rejects unsupported origins before making network requests", async () => {
    const fetchMock = vi.fn();
    await expect(prepareSpeechAssets(await temporary(), "https://invalid.example", new AbortController().signal, () => {}, fetchMock)).rejects.toThrow("Unsupported");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not publish incomplete downloads and removes partial files", async () => {
    const directory = await temporary();
    await expect(prepareSpeechAssets(directory, "https://hf-mirror.com", new AbortController().signal, () => {},
      vi.fn().mockResolvedValue(new Response("truncated")))).rejects.toThrow("完整性");
    expect(await verifySpeechAssets(directory)).toBe(false);
    await expect(stat(join(directory, "model.int8.onnx.partial"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(directory, "model.int8.onnx"))).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("serializes inference, joins cancelled native work, and can restart after cancellation", async () => {
    const directory = await temporary();
    const modulePath = join(directory, "native.cjs");
    const marker = join(directory, "decoding");
    await writeFile(modulePath, `
      exports.OfflineRecognizer = class { setConfig() {} createStream() { return { acceptWaveform() {} } } decode() { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000) } getResult() { return { text: 'hello' } } };
      exports.Vad = class { constructor() { this.empty = true } reset() { this.empty = true } acceptWaveform(samples) { this.samples = samples; this.empty = false } isEmpty() { return this.empty } front() { return { start: 0, samples: this.samples } } pop() { this.empty = true } flush() {} };
    `);
    const provider = new SenseVoiceProvider({ directory, modulePath });
    const input = { samples: new Float32Array(16000), sampleRate: 16000, language: "auto" };
    const abort = new AbortController();
    const running = provider.transcribe(input, abort.signal);
    const rejected = expect(running).rejects.toThrow();
    await expect(provider.transcribe(input, new AbortController().signal)).rejects.toThrow("另一段录音");
    await vi.waitFor(async () => expect(await readFile(marker, "utf8")).toBe("started"));
    const cancelledAt = performance.now();
    abort.abort(); await rejected;
    expect(performance.now() - cancelledAt).toBeLessThan(2000);
    const secondAbort = new AbortController();
    const second = provider.transcribe(input, secondAbort.signal);
    const secondRejected = expect(second).rejects.toThrow();
    secondAbort.abort(); await secondRejected;
    await provider.dispose();
    await expect(provider.transcribe(input, new AbortController().signal)).rejects.toThrow("disposed");
    expect(await readFile(modulePath, "utf8")).toContain("hello");
  });
  it("rejects invalid audio and language before starting native inference", async () => {
    const provider = new SenseVoiceProvider({ directory: await temporary(), modulePath: "missing" });
    const signal = new AbortController().signal;
    for (const samples of [new Float32Array(), new Float32Array([NaN]), new Float32Array([1.01]), new Float32Array(16000 * 121)]) {
      await expect(provider.transcribe({ samples, sampleRate: 16000, language: "auto" }, signal)).rejects.toThrow("Expected");
    }
    await expect(provider.transcribe({ samples: new Float32Array(16000), sampleRate: 16000, language: "invalid" }, signal)).rejects.toThrow("language");
    await provider.dispose();
  });
});
