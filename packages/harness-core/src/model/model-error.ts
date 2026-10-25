/** Provider adapters classify transport failures; Core decides the bounded retry lifecycle. */
export class HarnessModelError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly retryAfterMs?: number) { super(message); }
}

export function waitForModelRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal.reason); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, delayMs);
    signal.addEventListener("abort", abort, { once: true });
  });
}
