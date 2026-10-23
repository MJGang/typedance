/** Transcription is independent of agent runs. Audio is transient and never enters run history. */
export type HarnessSpeechInput = {
  samples: Float32Array;
  sampleRate: number;
  language: string;
};

export type HarnessTranscript = { text: string; audioSeconds: number };

export interface HarnessSpeechProvider {
  readonly id: string;
  readonly languages: readonly string[];
  transcribe(input: HarnessSpeechInput, signal: AbortSignal): Promise<HarnessTranscript>;
  dispose(): Promise<void>;
}

export function validateSpeechInput(input: HarnessSpeechInput): void {
  if (input.sampleRate !== 16000 || input.samples.length === 0 || input.samples.length > 16000 * 120
    || input.samples.some((sample) => !Number.isFinite(sample) || Math.abs(sample) > 1)) {
    throw new Error("Expected nonempty 16 kHz mono audio up to 120 seconds with finite samples in [-1, 1]");
  }
}
