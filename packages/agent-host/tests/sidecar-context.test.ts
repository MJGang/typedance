import { describe, expect, it, vi } from "vitest";
import { createSidecarContextProvider } from "../src/sidecar-context";

describe("sidecar context provider", () => {
  it("keeps long editor contents out of replayed workspace references across revisions", async () => {
    const provider = createSidecarContextProvider({ authToken: "test-sidecar-account-token-0123456789", fetch: vi.fn() });
    const base = { document_id: "doc", editor_session_id: "session", canvas_version: 1,
      doc_json: { type: "doc", content: [] }, plain_text: "旧正文".repeat(10000) };
    const before = await provider.loadContext({ workspaceId: "doc", mentions: [], editorSnapshot: { ...base, content_revision: 1 } });
    const after = await provider.loadContext({ workspaceId: "doc", mentions: [], editorSnapshot: { ...base, plain_text: "最新正文", content_revision: 2 } });
    expect(before[0].content.length).toBeLessThan(1500);
    expect(before[0].content).not.toContain("旧正文");
    expect(after[0].content).not.toContain("最新正文");
    expect(after[0].content).toContain("content_revision: 2");
    expect(before[0].content).toContain("after compaction or recovery");
    expect(before[0].content).not.toContain("current source of truth");
  });

  it("identifies the current editor session so local revision resets are not confused with saved document rollback", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = createSidecarContextProvider({ authToken: "test-sidecar-account-token-0123456789", fetch: fetchMock });
    const context = await provider.loadContext({ workspaceId: "doc_1", mentions: [], editorSnapshot: {
      document_id: "doc_1", editor_session_id: "new-editor-session", content_revision: 0, canvas_version: 3,
      doc_json: { type: "doc", content: [] }, plain_text: "已保存的最新正文",
    } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(context[0].content).toContain("editor_session_id: new-editor-session");
    expect(context[0].content).toContain("canvas_version: 3");
    expect(context[0].content).toContain("content_revision: 0");
    expect(context[0].content).not.toContain("已保存的最新正文");
    expect(context[0].content).toContain("text_characters_at_send: 8");
    expect(context[0].content).toContain("not document content or proof of the latest state");
  });
  it("formats the current workspace canvas as primary model context", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      document: {
        id: "doc_1",
        pack_id: "resume",
        title: "刚铭俊",
        template_id: "classic-a4",
        status: "active",
        target_language: "zh-CN",
        created_at: "2026-06-16T08:00:00.000Z",
        updated_at: "2026-06-16T08:00:00.000Z",
      },
      modules: [],
      claims: [],
      issues: [],
      proposals: [],
      evidence: [],
      source_summaries: [],
      source_resume_canvas: {
        id: "canvas_1",
        document_id: "doc_1",
        old_resume_source_id: "src_1",
        version: 1,
        source_snapshot_hash: "sha256:seed",
        doc_json: {
          type: "doc",
          content: [
            { type: "heading", content: [{ type: "text", text: "刚铭俊" }] },
            { type: "paragraph", content: [{ type: "text", text: "前端技术负责人 / 前端架构师 / AI 应用开发" }] },
          ],
        },
        node_map: [],
        module_anchors: [],
        created_at: "2026-06-16T08:00:00.000Z",
        updated_at: "2026-06-16T08:00:00.000Z",
      },
      quality_gate: {
        status: "needs_review",
        blocking_issue_ids: [],
        warning_issue_ids: [],
      },
      available_actions: [],
    }), { status: 200 }));
    const provider = createSidecarContextProvider({ authToken: "test-sidecar-account-token-0123456789",
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const context = await provider.loadContext({ workspaceId: "doc_1", mentions: [] });

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4317/documents/doc_1/workspace-view", expect.objectContaining({ signal: undefined, redirect: "error", cache: "no-store" }));
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer test-sidecar-account-token-0123456789");
    expect(context[0]?.content).toContain("Current active resume canvas");
    expect(context[0]?.content).toContain("刚铭俊");
    expect(context[0]?.content).toContain("前端技术负责人 / 前端架构师 / AI 应用开发");
  });

  it("returns explicit no-canvas context instead of silently omitting current document evidence", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "Document not found" }), { status: 404 }));
    const provider = createSidecarContextProvider({ authToken: "test-sidecar-account-token-0123456789",
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const context = await provider.loadContext({ workspaceId: "doc_missing", mentions: [] });

    expect(context[0]?.content).toContain("Current active resume canvas: unavailable");
    expect(context[0]?.content).toContain("document_id: doc_missing");
    expect(context[0]?.content).toContain("Do not summarize, score, or rewrite the current document");
  });
});
