import {
  harnessPluginManifestSchema,
  type HarnessCapabilityPolicy,
  type HarnessPluginManifest,
} from "@typedance/harness-contracts";

export type HarnessCapabilityPolicyInput = {
  scopeIds?: string[];
  pluginIds?: string[];
};

export type HarnessResolvedCapabilityPolicy = {
  scopeIds: string[];
  pluginIds: string[];
};

export function normalizeCapabilityPolicy(input: HarnessCapabilityPolicyInput = {}): HarnessResolvedCapabilityPolicy {
  return {
    scopeIds: [...new Set(input.scopeIds ?? [])],
    pluginIds: [...new Set(input.pluginIds ?? [])],
  };
}

export function normalizeContractCapabilityPolicy(input: HarnessCapabilityPolicy): HarnessResolvedCapabilityPolicy {
  return normalizeCapabilityPolicy({
    scopeIds: input.scope_ids,
    pluginIds: input.plugin_ids,
  });
}

export class HarnessPluginRegistry {
  #plugins = new Map<string, HarnessPluginManifest>();

  register(input: HarnessPluginManifest): HarnessPluginManifest {
    const manifest = harnessPluginManifestSchema.parse(input);
    this.#plugins.set(manifest.id, manifest);
    return manifest;
  }

  resolveForPolicy(input: HarnessCapabilityPolicyInput = {}): HarnessPluginManifest[] {
    const policy = normalizeCapabilityPolicy(input);
    if (policy.pluginIds.length > 0) {
      const allowedPluginIds = new Set(policy.pluginIds);
      return [...this.#plugins.values()].filter((plugin) => allowedPluginIds.has(plugin.id));
    }

    if (policy.scopeIds.length === 0) {
      return [];
    }

    const allowedScopeIds = new Set(policy.scopeIds);
    return [...this.#plugins.values()].filter((plugin) => plugin.scopes.some((scope) => allowedScopeIds.has(scope)));
  }
}
