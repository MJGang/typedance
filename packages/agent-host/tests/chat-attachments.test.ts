import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createHarnessRuntime, type HarnessModelRequest } from "@typedance/harness-core";
import { createAgentHost, createJsonFileAgentHostStore } from "../src";
import { createResumePluginLoader, registerResumeWorkbenchPlugin } from "../src/resume-plugin";
import type { HarnessAttachment } from "@typedance/contracts";

const attachment: HarnessAttachment = { id: "file_1", name: "提示词.md", mime_type: "text/markdown", size: 12, content: { type: "text", text: "项目使用 PostgreSQL" } };

describe("chat attachments", () => {
  it("persists attachment content and delivers it with subsequent conversation history to the model", async () => {
    const directory = mkdtempSync(join(tmpdir(), "typedance-attachments-"));
    const requests: HarnessModelRequest[] = [];
    const loader = createResumePluginLoader();
    const runtime = createHarnessRuntime({ skillContentLoader: loader.createSkillContentLoader(), model: { async *stream(request) {
      requests.push(request); yield { type: "assistant_delta", messageId: "answer", delta: "已读取" }; yield { type: "final", output: {} };
    } } });
    await registerResumeWorkbenchPlugin(runtime, loader);
    try {
      const file = join(directory, "store.json");
      const host = createAgentHost({ runtime, store: createJsonFileAgentHostStore(file), packs: [{ id: "resume", capabilityPolicy: { scopeIds: ["pack:resume"] }, primaryAgentId: "resume.primary" }] });
      const conversation = host.createConversation("doc_1");
      await host.waitForRun(host.startConversationRun("doc_1", conversation.id, { message: { content: "阅读附件", attachments: [attachment] } }).id);
      expect(requests[0].prompt.conversation[0].content).toEqual([{ type: "text", text: "阅读附件" }, { type: "text", text: "附件：提示词.md\n项目使用 PostgreSQL" }]);
      expect(createJsonFileAgentHostStore(file).listMessages(conversation.id)[0].attachments).toEqual([attachment]);
      await host.waitForRun(host.startConversationRun("doc_1", conversation.id, { message: { content: "附件中提到了什么数据库？" } }).id);
      expect(JSON.stringify(requests[1].prompt.conversation)).toContain("PostgreSQL");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  it("rejects malformed images and attachment overflow before recording messages", () => {
    const host = createAgentHost({ runtime: createHarnessRuntime(), packs: [{ id: "resume", capabilityPolicy: {}, primaryAgentId: "resume.primary" }] });
    const conversation = host.createConversation("doc_1");
    for (const attachments of [Array.from({ length: 7 }, (_, id) => ({ ...attachment, id: String(id) })),
      [{ ...attachment, content: { type: "image", image_url: "data:image/png;base64,eA==" } }]]) {
      expect(() => host.startConversationRun("doc_1", conversation.id, { message: { content: "读取", attachments: attachments as HarnessAttachment[] } })).toThrow();
    }
    expect(host.listMessages(conversation.id)).toEqual([]);
  });
});
