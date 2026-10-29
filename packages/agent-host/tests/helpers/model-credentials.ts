import { createFileModelSettings as createSettings } from "../../src/model-settings";
import type { ModelCredentialStore } from "../../src/model-credentials";

export function memoryCredentials(initial?: string): ModelCredentialStore {
  let value = initial;
  return { async get() { return value; }, async set(next) { value = next; }, async clear() { value = undefined; } };
}

const stores = new Map<string, ModelCredentialStore>();
export function credentialsFor(directory: string): ModelCredentialStore {
  let store = stores.get(directory);
  if (!store) { store = memoryCredentials(); stores.set(directory, store); }
  return store;
}

export function createFileModelSettings(directory: string, environment: Record<string, string | undefined> = {}) {
  return createSettings(directory, credentialsFor(directory), environment);
}
