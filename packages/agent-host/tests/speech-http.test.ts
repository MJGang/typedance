import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarnessRuntime } from "@typedance/harness-core";
import { createAgentHost, createAgentHostServer, type AgentHostHttpServer } from "../src";
import { LocalSpeechService } from "../src/speech";

const native = vi.hoisted(() => ({ transcribe: vi.fn(), dispose: vi.fn(), verified: vi.fn().mockResolvedValue(true) }));
vi.mock("@typedance/harness-speech", () => ({
  senseVoiceAssets: [{ bytes: 100 }], verifySpeechAssets: native.verified, prepareSpeechAssets: vi.fn(), resolveSpeechRuntime: () => "native",
  SpeechBusyError: class extends Error {},
  SenseVoiceProvider: class { transcribe = native.transcribe; dispose = native.dispose },
}));
let server: AgentHostHttpServer, speech: LocalSpeechService, directory: string;
afterEach(async () => { await speech?.dispose(); await server?.close(); if (directory) await rm(directory, { recursive: true, force: true }); vi.clearAllMocks(); });
async function start() {
  directory = await mkdtemp(join(tmpdir(), "speech-http-"));
  speech = new LocalSpeechService(directory);
  server = createAgentHostServer({ host: createAgentHost({ runtime: createHarnessRuntime(), packs: [] }), speech, authToken: "a".repeat(32) });
  server.listen(); await once(server.nodeServer, "listening");
  return { url: server.url, headers: { authorization: `Bearer ${"a".repeat(32)}`, "content-type": "application/json" } };
}
describe("speech HTTP ownership", () => {
  it("accepts the entire 120 second recording without exhausting the validation stack", async () => {
    const { url, headers } = await start();
    native.transcribe.mockResolvedValue({ text: "完整录音", audioSeconds: 120 });
    const audio = Buffer.alloc(16000 * 120 * 2).toString("base64");
    const response = await fetch(`${url}/speech/transcribe`, { method: "POST", headers, body: JSON.stringify({ audio }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ text: "完整录音" });
    expect(native.transcribe.mock.calls[0][0].samples.length).toBe(16000 * 120);
  });
  it("protects speech endpoints and persists explicit language preferences", async () => {
    const { url, headers } = await start();
    expect((await fetch(`${url}/speech/settings`)).status).toBe(401);
    expect((await fetch(`${url}/speech/settings`, { headers: { ...headers, origin: "https://untrusted.example" } })).status).toBe(403);
    const response = await fetch(`${url}/speech/settings`, { method: "PUT", headers, body: JSON.stringify({ language: "zh", download_origin: "https://huggingface.co" }) });
    expect(await response.json()).toMatchObject({ phase: "ready", language: "zh" });
    const restored = new LocalSpeechService(directory);
    expect(await restored.status()).toMatchObject({ language: "zh", download_origin: "https://huggingface.co" });
    await restored.dispose();
  });
  it("decodes PCM explicitly and rejects malformed recording data before native inference", async () => {
    const { url, headers } = await start();
    native.transcribe.mockResolvedValue({ text: "你好", audioSeconds: 0.000125 });
    const response = await fetch(`${url}/speech/transcribe`, { method: "POST", headers, body: JSON.stringify({ audio: Buffer.from([0, 128, 255, 127]).toString("base64") }) });
    expect(await response.json()).toMatchObject({ text: "你好" });
    expect(Array.from(native.transcribe.mock.calls[0][0].samples)).toEqual([-1, 32767 / 32768]);
    for (const audio of ["!!", "AA==", "", "AA=A", "AAAA====", "AB==", " AAAA"]) expect((await fetch(`${url}/speech/transcribe`, { method: "POST", headers, body: JSON.stringify({ audio }) })).status).toBe(400);
    expect(native.transcribe).toHaveBeenCalledOnce();
  });
  it("aborts local transcription when the caller disconnects", async () => {
    const { url, headers } = await start();
    let accepted!: () => void;
    const admission = new Promise<void>((resolve) => { accepted = resolve; });
    let observed: AbortSignal | undefined;
    native.transcribe.mockImplementation((_input, signal: AbortSignal) => new Promise((_resolve, reject) => {
      observed = signal; accepted(); signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }));
    const abort = new AbortController();
    const pending = fetch(`${url}/speech/transcribe`, { method: "POST", headers, body: JSON.stringify({ audio: "AAAAAA==" }), signal: abort.signal });
    const rejected = expect(pending).rejects.toThrow();
    await admission; abort.abort(); await rejected;
    await vi.waitFor(() => expect(observed?.aborted).toBe(true));
  });
  it("aborts native inference before acknowledging account closure and admits no new transcription", async () => {
    const { url, headers } = await start();
    let accepted!: () => void;
    const admission = new Promise<void>((resolve) => { accepted = resolve; });
    let observed: AbortSignal | undefined;
    native.transcribe.mockImplementation((_input, signal: AbortSignal) => new Promise((_resolve, reject) => {
      observed = signal; accepted(); signal.addEventListener("abort", () => reject(new Error("account closed")), { once: true });
    }));
    const pending = fetch(`${url}/speech/transcribe`, { method: "POST", headers, body: JSON.stringify({ audio: "AAAAAA==" }) }).catch(() => undefined);
    await admission;
    const closed = await fetch(`${url}/account/prepare-close`, { method: "POST", headers });
    expect(closed.status).toBe(200);
    expect(observed?.aborted).toBe(true);
    expect(native.dispose).toHaveBeenCalledOnce();
    await pending;
    expect((await fetch(`${url}/speech/transcribe`, { method: "POST", headers, body: JSON.stringify({ audio: "AAAAAA==" }) })).status).toBe(409);
    expect(native.transcribe).toHaveBeenCalledOnce();
  });
});
