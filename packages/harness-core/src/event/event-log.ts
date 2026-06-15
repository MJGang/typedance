import { harnessRunEventSchema, type HarnessRunEvent } from "@typedance/harness-contracts";

export class HarnessEventLog {
  #events = new Map<string, HarnessRunEvent[]>();
  #subscribers = new Map<string, Set<(event: HarnessRunEvent) => void>>();

  nextSequence(runId: string): number {
    return this.get(runId).length;
  }

  append(event: HarnessRunEvent): HarnessRunEvent {
    const parsed = harnessRunEventSchema.parse(event);
    const events = this.#events.get(parsed.run_id) ?? [];
    events.push(parsed);
    this.#events.set(parsed.run_id, events);
    this.#subscribers.get(parsed.run_id)?.forEach((subscriber) => subscriber(parsed));
    return parsed;
  }

  get(runId: string): HarnessRunEvent[] {
    return [...(this.#events.get(runId) ?? [])];
  }

  stream(runId: string, options: { afterSequence?: number } = {}): AsyncIterableIterator<HarnessRunEvent> {
    const pending = this.get(runId).filter((event) => event.sequence > (options.afterSequence ?? -1));
    const waiting: Array<(value: IteratorResult<HarnessRunEvent>) => void> = [];
    let closed = false;

    const subscriber = (event: HarnessRunEvent) => {
      if (event.sequence <= (options.afterSequence ?? -1)) {
        return;
      }

      const waiter = waiting.shift();
      if (waiter) {
        waiter({ done: false, value: event });
        return;
      }
      pending.push(event);
    };

    const subscribers = this.#subscribers.get(runId) ?? new Set<(event: HarnessRunEvent) => void>();
    subscribers.add(subscriber);
    this.#subscribers.set(runId, subscribers);

    const close = () => {
      closed = true;
      subscribers.delete(subscriber);
      while (waiting.length > 0) {
        waiting.shift()?.({ done: true, value: undefined });
      }
    };

    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        if (pending.length > 0) {
          return Promise.resolve({ done: false, value: pending.shift() as HarnessRunEvent });
        }
        if (closed) {
          return Promise.resolve({ done: true, value: undefined });
        }
        return new Promise<IteratorResult<HarnessRunEvent>>((resolve) => {
          waiting.push(resolve);
        });
      },
      return() {
        close();
        return Promise.resolve({ done: true, value: undefined });
      },
      throw(error?: unknown) {
        close();
        return Promise.reject(error);
      },
    };
  }
}
