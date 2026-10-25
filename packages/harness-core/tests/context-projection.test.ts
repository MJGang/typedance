import { describe, expect, it } from "vitest";
import { harnessModelMessageSchema } from "@typedance/harness-contracts";
import type { HarnessModelMessage, HarnessPromptSection } from "@typedance/harness-contracts";
import { projectContextSnapshots } from "../src/model/context-projection";
import { estimateMessageTokens, retainUserMessages } from "../src/model/context-window";

const section = (source: string, content: string): HarnessPromptSection => ({ slot: "contextual", source, content });

describe("append-only context projection", () => {
  it("keeps the complete consumed prefix and appends only changed sources", () => {
    const initial = projectContextSnapshots([{ role: "user", content: "review" }], [section("canvas", "revision 1"), section("reference", "large stable document")]);
    const history: HarnessModelMessage[] = [...initial, { role: "assistant", content: "read", reasoningContent: "reasoning" }, { role: "user", content: "continue" }];
    expect(projectContextSnapshots(history, [section("reference", "large stable document"), section("canvas", "revision 1")])).toEqual(history);
    const updated = projectContextSnapshots(history, [section("canvas", "revision 2"), section("reference", "large stable document")]);
    expect(updated.slice(0, history.length)).toEqual(history);
    expect(updated.slice(history.length)).toEqual([expect.objectContaining({ role: "user", internal: "context", contextSource: "canvas", content: expect.stringContaining("revision 2") })]);
    expect(history).toHaveLength(initial.length + 2);
  });

  it("records clearing once, and re-adds a source even when its content matches an older snapshot", () => {
    const initial = projectContextSnapshots([], [section("file", "content")]);
    const cleared = projectContextSnapshots(initial, []);
    expect(cleared.at(-1)).toMatchObject({ contextSource: "file", content: expect.stringContaining("has been removed") });
    expect(projectContextSnapshots(cleared, [])).toEqual(cleared);
    expect(projectContextSnapshots(cleared, [section("file", "content")])).toHaveLength(3);
  });

  it("preserves every contribution with the same source and restores projection metadata through the contract", () => {
    const projected = projectContextSnapshots([], [section("system", "first"), section("system", "second")]);
    expect(projected[0].content).toContain("first\n\nsecond");
    expect(harnessModelMessageSchema.parse(projected[0])).toEqual(projected[0]);
    expect(retainUserMessages([...projected, { role: "user", content: "actual user request" }], 100)).toEqual([{ role: "user", content: "actual user request" }]);
  });

  it("retains reasoning in the message contract and includes it in the context budget", () => {
    const message = { role: "assistant" as const, content: "answer", reasoningContent: "thinking ".repeat(1000) };
    expect(harnessModelMessageSchema.parse(message)).toEqual(message);
    expect(estimateMessageTokens(message)).toBeGreaterThan(estimateMessageTokens({ role: "assistant", content: "answer" }) + 2000);
  });
});
