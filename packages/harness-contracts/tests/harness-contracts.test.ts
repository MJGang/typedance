import { describe, expect, it } from "vitest";
import {
  harnessCapabilityPolicySchema,
  harnessPluginManifestSchema,
  harnessRunEventSchema,
  harnessRunRequestSchema,
  harnessRunSchema,
} from "../src";

const timestamp = "2026-06-15T08:00:00.000Z";

describe("harness run contracts", () => {
  it("uses capability policy as the only run boundary", () => {
    const request = harnessRunRequestSchema.parse({
      capability_policy: {
        scope_ids: ["workspace:alpha"],
        plugin_ids: ["alpha.agent"],
      },
      user_message: "Inspect this workspace",
    });
    const run = harnessRunSchema.parse({
      id: "run_1",
      capability_policy: request.capability_policy,
      status: "running",
      created_at: timestamp,
      updated_at: timestamp,
    });
    const event = harnessRunEventSchema.parse({
      id: "evt_1",
      run_id: run.id,
      sequence: 0,
      created_at: timestamp,
      type: "run.started",
      capability_policy: run.capability_policy,
      input: { user_message: request.user_message },
    });

    expect(run).not.toHaveProperty(["pack", "id"].join("_"));
    expect(event.capability_policy.scope_ids).toEqual(["workspace:alpha"]);
  });

  it("defaults to an empty capability policy", () => {
    expect(harnessCapabilityPolicySchema.parse({})).toEqual({
      scope_ids: [],
      plugin_ids: [],
    });
    expect(harnessRunRequestSchema.parse({ user_message: "Hello" }).capability_policy).toEqual({
      scope_ids: [],
      plugin_ids: [],
    });
  });
});

describe("harness plugin contracts", () => {
  it("treats plugin scopes as host-defined opaque strings", () => {
    const manifest = harnessPluginManifestSchema.parse({
      id: "alpha.agent",
      name: "Alpha Agent",
      version: "0.1.0",
      module_format: "esm",
      scopes: ["workspace:alpha"],
      skills: [
        {
          id: "alpha.review",
          name: "Alpha Review",
          description: "Review workspace state.",
          tool_names: ["alpha.readWorkspace"],
        },
      ],
      agents: [
        {
          id: "alpha.primary",
          name: "Alpha Primary Agent",
          role: "primary",
          skill_ids: ["alpha.review"],
        },
      ],
    });

    expect(manifest.scopes).toEqual(["workspace:alpha"]);
  });
});
