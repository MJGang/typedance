/** Stop awaiting work promptly without leaving abort listeners behind. */
export function withRunSignal<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(work).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function* cancellableStream<T>(source: AsyncIterable<T>, signal: AbortSignal): AsyncIterable<T> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    while (true) {
      const item = await withRunSignal(iterator.next(), signal);
      signal.throwIfAborted();
      if (item.done) return;
      yield item.value;
    }
  } finally {
    // An adapter that ignores cancellation must not keep the run waiting on return().
    void iterator.return?.().catch(() => undefined);
  }
}
