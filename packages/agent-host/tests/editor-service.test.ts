import { describe, expect, it, vi } from "vitest";
import { createSidecarEditorService } from "../src/editor-service";
import type { EditorSnapshot } from "@typedance/contracts";

describe("editor service projections", () => {
  it("requests only chosen capability schemas and preserves targeted inspection options", async () => {
    const catalog = { revision: "current", scope: "current_document", units: {},
      operations: [{ id: "text.replace", title: "替换", description: "精确替换", effect: "content", parameters: { type: "object" } }] };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(catalog)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ view: "detail", nodes: [{ path: [1], text: "最新正文" }] })));
    const service = createSidecarEditorService("http://127.0.0.1:5517", fetchMock);
    const signal = new AbortController().signal;
    expect(await service.catalog(signal, ["text.replace", "page.margins"])).toEqual(catalog);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:5517/editor/capabilities?operation_ids=text.replace&operation_ids=page.margins");
    const snapshot: EditorSnapshot = { document_id: "document", editor_session_id: "session", canvas_version: 1,
      content_revision: 2, doc_json: { type: "doc", content: [] }, plain_text: "最新正文" };
    const options = { view: "detail" as const, paths: [[1]], text_limit: 12000 };
    await service.inspect(snapshot, signal, options);
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({ doc_json: snapshot.doc_json, options });
  });
});
