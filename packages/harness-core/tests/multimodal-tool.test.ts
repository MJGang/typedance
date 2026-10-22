import { describe, expect, it } from "vitest";
import { createHarnessRuntime, HarnessToolOutput, type HarnessModelRequest } from "../src";

describe("generic multimodal tools", () => {
  it("passes image content to the next model turn while keeping binary data out of run events", async () => {
    const requests: HarnessModelRequest[] = [];
    const image = "data:image/png;base64,aGVsbG8=";
    const runtime = createHarnessRuntime({ model: { stream: async function* (request) {
      requests.push(request);
      if (requests.length === 1) yield { type: "tool_call", call: { id: "call", name: "camera.capture", origin: "plugin", input: {} } };
      yield { type: "final", output: {} };
    } } });
    runtime.registerPlugin({ id: "camera", name: "Camera", version: "1.0.0", module_format: "esm", scopes: ["camera"],
      skills: [{ id: "capture", name: "Capture", description: "See an image", instruction_files: [], tool_names: ["camera.capture"] }],
      agents: [{ id: "camera.agent", name: "Camera", role: "primary", skill_ids: ["capture"] }] });
    runtime.registerTool({ name: "camera.capture", origin: "plugin", handler: () => new HarnessToolOutput({ width: 10 }, [{ type: "image", image_url: image }]) });
    const run = runtime.createRun({ capability_policy: { scope_ids: ["camera"] }, user_message: "Inspect image", context: {} });
    await runtime.runAgentTurn({ runId: run.id, agentId: "camera.agent", messages: [{ role: "user", content: "Inspect image" }] });
    expect(requests[1]?.prompt.conversation.at(-1)).toMatchObject({ role: "tool", content: [
      { type: "text", text: JSON.stringify({ status: "completed", output: { width: 10 } }) }, { type: "image", image_url: image },
    ] });
    expect(JSON.stringify(runtime.events.get(run.id))).not.toContain(image);
    expect(runtime.events.get(run.id)).toContainEqual(expect.objectContaining({ type: "tool.call.completed", result: expect.objectContaining({ output: { width: 10 } }) }));
  });
});
