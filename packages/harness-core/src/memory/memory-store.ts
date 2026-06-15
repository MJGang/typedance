export type HarnessMemoryScope = "run" | "workspace" | "user" | "global";

export type HarnessMemoryRecord = {
  id: string;
  scope: HarnessMemoryScope;
  key: string;
  value: unknown;
  summary: string;
  updatedAt: string;
};

export class HarnessMemoryStore {
  #memories = new Map<string, HarnessMemoryRecord>();
  #nextId = 1;
  #now: () => Date;

  constructor(now: () => Date) {
    this.#now = now;
  }

  remember(input: {
    scope: HarnessMemoryScope;
    key: string;
    value: unknown;
    summary: string;
  }): HarnessMemoryRecord {
    const memoryKey = this.#key(input.scope, input.key);
    const existing = this.#memories.get(memoryKey);
    const record: HarnessMemoryRecord = {
      id: existing?.id ?? `memory_${this.#nextId++}`,
      scope: input.scope,
      key: input.key,
      value: input.value,
      summary: input.summary,
      updatedAt: this.#now().toISOString(),
    };
    this.#memories.set(memoryKey, record);
    return record;
  }

  recall(input: { scope: HarnessMemoryScope; key: string }): HarnessMemoryRecord | undefined {
    return this.#memories.get(this.#key(input.scope, input.key));
  }

  list(scope?: HarnessMemoryScope): HarnessMemoryRecord[] {
    const records = [...this.#memories.values()];
    return scope ? records.filter((record) => record.scope === scope) : records;
  }

  #key(scope: HarnessMemoryScope, key: string): string {
    return `${scope}:${key}`;
  }
}
