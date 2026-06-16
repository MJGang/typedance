import { describe, expect, it } from "vitest";
import { createHarnessRuntime } from "../src";

describe("harness activity runtime facade", () => {
  it("emits plan, artifact patch, evidence, and subagent activity events", () => {
    const runtime = createHarnessRuntime();
    const run = runtime.createRun({
      user_message: "Improve artifact",
    });

    runtime.updatePlan(run.id, [
      { id: "plan_1", title: "Read current context", status: "completed" },
      { id: "plan_2", title: "Generate a proposed change", status: "in_progress" },
    ]);
    runtime.proposeArtifactPatch(run.id, {
      artifactId: "artifact_1",
      patchId: "patch_1",
      summary: "Add supporting evidence.",
      diff: "- Managed system work\n+ Managed system work with measurable impact",
    });
    runtime.applyArtifactPatch(run.id, {
      artifactId: "artifact_1",
      patchId: "patch_1",
    });
    runtime.addEvidence(run.id, {
      evidenceId: "evidence_1",
      target: { artifact_id: "artifact_1" },
      summary: "User confirmed this claim is accurate.",
    });
    runtime.startSubagent(run.id, {
      subagentId: "subagent_1",
      name: "Evidence Verifier",
    });
    runtime.completeSubagent(run.id, {
      subagentId: "subagent_1",
      status: "completed",
      summary: "Evidence check completed.",
    });

    expect(runtime.getEvents(run.id).map((event) => event.type)).toEqual([
      "run.started",
      "plan.updated",
      "artifact.patch.proposed",
      "artifact.patch.applied",
      "evidence.added",
      "subagent.started",
      "subagent.completed",
    ]);
  });
});
