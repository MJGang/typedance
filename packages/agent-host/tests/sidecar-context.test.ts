import { describe, expect, it, vi } from "vitest";
import { createSidecarContextProvider } from "../src/sidecar-context";

describe("sidecar context provider", () => {
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
    const provider = createSidecarContextProvider({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const context = await provider.loadWorkspaceContext?.({ workspaceId: "doc_1", mentions: [] });

    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:4317/documents/doc_1/workspace-view");
    expect(context).toContain("Current active resume canvas");
    expect(context).toContain("刚铭俊");
    expect(context).toContain("前端技术负责人 / 前端架构师 / AI 应用开发");
  });

  it("returns explicit no-canvas context instead of silently omitting current document evidence", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "Document not found" }), { status: 404 }));
    const provider = createSidecarContextProvider({
      baseUrl: "http://127.0.0.1:4317",
      fetch: fetchMock as unknown as typeof fetch,
    });

    const context = await provider.loadWorkspaceContext?.({ workspaceId: "doc_missing", mentions: [] });

    expect(context).toContain("Current active resume canvas: unavailable");
    expect(context).toContain("document_id: doc_missing");
    expect(context).toContain("Do not summarize, score, or rewrite the current document");
  });
});
