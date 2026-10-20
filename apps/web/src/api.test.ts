import { afterEach, describe, expect, it, vi } from "vitest"
import type { CanvasPrintSnapshot } from "@typedance/contracts"
import { getTemplateSample } from "./api"

const printSnapshot: CanvasPrintSnapshot = {
  html: '<div class="ProseMirror"><p>当前画布</p><p><br></p><h2>项目经验</h2></div>',
  page_width: 794,
  page_height: 1123,
  page_tops: [0, 1147, 2294],
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
describe("template api", () => {
  it("loads a template sample", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "sample-tech-zh",
      name: { "zh-CN": "通用技术岗样张", "en-US": "General technical sample" },
      target_language: "zh-CN",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "",
      updated_at: "2026-05-11T00:00:00.000Z",
    }))))
    await expect(getTemplateSample("sample-tech-zh")).resolves.toMatchObject({ id: "sample-tech-zh" })
  })
})

describe("exportResumePdf", () => {
  it("calls sidecar API and triggers download", async () => {
    const blobContent = "%PDF-1.4 test pdf";
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      blobContent,
      { headers: { "content-type": "application/pdf", "X-Pdf-Path": "C:/Users/test/.typedance/files/exports/resume-123.pdf" } },
    )));

    const { exportResumePdf } = await import("./api");

    // Mock document.createElement and click to prevent actual download
    const clickMock = vi.fn();
    const createElementMock = vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: clickMock,
    } as unknown as HTMLAnchorElement);
    // jsdom doesn't have URL.createObjectURL, so stub it
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:test"),
      revokeObjectURL: vi.fn(),
    });

    const result = await exportResumePdf("resume-123", "My Resume");

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/exports/pdf/resume-123",
      { method: "POST" },
    );
    expect(clickMock).toHaveBeenCalled();
    expect(result?.filePath).toBe("C:/Users/test/.typedance/files/exports/resume-123.pdf");

    createElementMock.mockRestore();
  });

  it("decodes exported file paths from response headers", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "%PDF-1.4 test pdf",
      { headers: { "content-type": "application/pdf", "X-Pdf-Path": "D:/51149/Documents/%E4%B8%AD%E6%96%87%E7%AE%80%E5%8E%86.pdf" } },
    )));

    const { exportResumePdf } = await import("./api");

    const clickMock = vi.fn();
    const createElementMock = vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: clickMock,
    } as unknown as HTMLAnchorElement);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:test"),
      revokeObjectURL: vi.fn(),
    });

    const result = await exportResumePdf("resume-123", "中文简历");

    expect(result?.filePath).toBe("D:/51149/Documents/中文简历.pdf");

    createElementMock.mockRestore();
  });
})

describe("revision api", () => {
  it("duplicates a revision document without sending a request body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "doc_copy",
      pack_id: "resume",
      title: "技术简历 副本",
      template_id: "custom-a4",
      status: "active",
      target_language: "zh-CN",
      current_draft_id: null,
      accepted_draft_id: null,
      created_at: "2026-10-20T08:00:00.000Z",
      updated_at: "2026-10-20T08:00:00.000Z",
    }), { status: 201 })))

    const { duplicateRevisionDocument } = await import("./api")
    const duplicate = await duplicateRevisionDocument("doc_original")

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/documents/doc_original/duplicate",
      { method: "POST" },
    )
    expect(duplicate).toMatchObject({ id: "doc_copy", title: "技术简历 副本", template_id: "custom-a4" })
    expect(duplicate.current_draft_id).toBeUndefined()
  })

  it("rejects an invalid duplicate document response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "doc_copy" }))))
    const { duplicateRevisionDocument } = await import("./api")

    await expect(duplicateRevisionDocument("doc_original")).rejects.toThrow()
  })

  it("surfaces the sidecar error when duplication fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ detail: "Document not found" }), { status: 404 },
    )))
    const { duplicateRevisionDocument } = await import("./api")

    await expect(duplicateRevisionDocument("missing")).rejects.toThrow("Document not found")
  })

  it("lists revision documents for the workspace dashboard", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      {
        id: "doc_1",
        pack_id: "resume",
        title: "旧简历重构",
        status: "active",
        target_language: "zh-CN",
        current_draft_id: "draft_1",
        updated_at: "2026-05-26T08:00:00.000Z",
        quality_state: "needs_review",
      },
    ]))))

    const { listRevisionDocuments } = await import("./api")
    const documents = await listRevisionDocuments()

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4317/documents")
    expect(documents).toHaveLength(1)
    expect(documents[0]).toMatchObject({
      id: "doc_1",
      title: "旧简历重构",
      quality_state: "needs_review",
    })
  })

  it("loads a revision workspace view", async () => {
    const payload = {
      document: {
        id: "doc_1",
        pack_id: "resume",
        title: "张三的简历",
        template_id: "classic-a4",
        status: "active",
        target_language: "zh-CN",
        current_draft_id: "draft_1",
        created_at: "2026-05-21T08:00:00.000Z",
        updated_at: "2026-05-21T08:00:00.000Z",
      },
      current_draft: {
        id: "draft_1",
        document_id: "doc_1",
        run_id: "run_1",
        pack_id: "resume",
        status: "in_review",
        summary: "结构化草稿",
        applied_proposal_ids: [],
        unresolved_issue_ids: ["issue_1"],
        created_at: "2026-05-21T08:00:00.000Z",
        updated_at: "2026-05-21T08:00:00.000Z",
      },
      modules: [],
      claims: [],
      issues: [],
      proposals: [],
      evidence: [],
      source_summaries: [],
      quality_gate: {
        status: "needs_review",
        blocking_issue_ids: [],
        warning_issue_ids: ["issue_1"],
      },
      coach_summary: {
        summary: "还有 1 个问题建议处理。",
        next_action_ids: ["act_1"],
      },
      available_actions: [
        {
          id: "act_1",
          label: "接受修改",
          action_type: "accept_proposal",
          target: { claim_id: "claim_1" },
        },
      ],
    }

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload))))

    const { getRevisionWorkspaceView } = await import("./api")
    const view = await getRevisionWorkspaceView("doc_1")

    expect(fetch).toHaveBeenCalledWith("http://127.0.0.1:4317/documents/doc_1/workspace-view")
    expect(view.document.id).toBe("doc_1")
    expect(view.available_actions[0].action_type).toBe("accept_proposal")
  })

  it("updates a revision document title", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "doc_1",
      pack_id: "resume",
      title: "前端负责人简历",
      template_id: "classic-a4",
      status: "active",
      target_language: "zh-CN",
      current_draft_id: "draft_1",
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:05:00.000Z",
    }))))

    const { updateRevisionDocument } = await import("./api")
    const document = await updateRevisionDocument("doc_1", { title: "前端负责人简历" })

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/documents/doc_1",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "前端负责人简历" }),
      },
    )
    expect(document.title).toBe("前端负责人简历")
  })

  it("renders a revision draft with a profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "render_1",
      draft_id: "draft_1",
      render_profile: "default-a4",
      html: "<article></article>",
      doc_json: { type: "doc", content: [] },
      layout_warnings: [],
      created_at: "2026-05-21T08:00:00.000Z",
    }))))

    const { renderRevisionDraft } = await import("./api")
    const projection = await renderRevisionDraft("draft_1", "default-a4")

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/drafts/draft_1/render",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ render_profile: "default-a4" }),
      },
    )
    expect(projection.id).toBe("render_1")
  })

  it("saves source resume canvas document json", async () => {
    const responsePayload = {
      id: "canvas_1",
      document_id: "doc_1",
      old_resume_source_id: "src_old",
      version: 1,
      source_snapshot_hash: "sha256:seed",
      doc_json: {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "更新正文" }] }],
      },
      node_map: [],
      module_anchors: [],
      created_at: "2026-05-28T08:00:00.000Z",
      updated_at: "2026-05-28T08:01:00.000Z",
    }
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(responsePayload))))

    const { saveSourceResumeCanvas } = await import("./api")
    const canvas = await saveSourceResumeCanvas("doc_1", {
      type: "doc",
      content: [{ type: "paragraph" }],
    })

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/documents/doc_1/source-resume-canvas",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          doc_json: {
            type: "doc",
            content: [{ type: "paragraph" }],
          },
        }),
      },
    )
    expect(canvas.id).toBe("canvas_1")
    expect(canvas.doc_json).toEqual(responsePayload.doc_json)
  })

  it("reports the server reason when a source canvas save is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ detail: "Duplicate canvasNodeId: node_1" }),
      { status: 400, headers: { "content-type": "application/json" } },
    )))

    const { saveSourceResumeCanvas } = await import("./api")
    await expect(saveSourceResumeCanvas("doc_1", { type: "doc", content: [] }))
      .rejects.toThrow("Duplicate canvasNodeId: node_1")
  })

  it("accepts a revision proposal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "prop_1",
      run_id: "run_1",
      document_id: "doc_1",
      draft_id: "draft_1",
      target: { claim_id: "claim_1" },
      operation: "replace_claim",
      proposed_snapshot: { text: "更好的表达" },
      summary: "改成结果导向表达",
      rationale: "原文只有动作。",
      related_issue_ids: ["issue_1"],
      evidence_link_ids: [],
      confidence: 0.8,
      risk_level: "medium",
      requires_user_confirmation: true,
      status: "applied",
      created_by_agent: "ResumeRewriter",
      created_at: "2026-05-21T08:00:00.000Z",
    }))))

    const { acceptRevisionProposal } = await import("./api")
    const proposal = await acceptRevisionProposal("prop_1")

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/proposals/prop_1/accept",
      { method: "POST" },
    )
    expect(proposal.status).toBe("applied")
  })

  it("imports an old resume through document source and opens the workspace view", async () => {
    const responses = [
      {
        id: "doc_import",
        pack_id: "resume",
        title: "旧简历重构",
        template_id: "classic-a4",
        status: "active",
        target_language: "zh-CN",
        current_draft_id: null,
        accepted_draft_id: null,
        created_at: "2026-05-21T08:00:00.000Z",
        updated_at: "2026-05-21T08:00:00.000Z",
      },
      {
        id: "src_import",
        document_id: "doc_import",
        source_type: "old_resume",
        title: "旧简历",
        mime_type: "text/plain",
        raw_text: "项目经历\n负责订单系统重构",
        parse_status: "recognized",
        created_at: "2026-05-21T08:00:00.000Z",
      },
      {
        document: {
          id: "doc_import",
          pack_id: "resume",
          title: "旧简历重构",
          template_id: "classic-a4",
          status: "active",
          target_language: "zh-CN",
          current_draft_id: null,
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
        source_resume_canvas: {
          id: "canvas_import",
          document_id: "doc_import",
          old_resume_source_id: "src_import",
          version: 1,
          source_snapshot_hash: "sha256:import",
          doc_json: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "项目经历" }],
              },
            ],
          },
          node_map: [],
          module_anchors: [],
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
        modules: [],
        claims: [],
        issues: [],
        proposals: [],
        evidence: [],
        source_summaries: [],
        quality_gate: { status: "unknown", blocking_issue_ids: [], warning_issue_ids: [] },
        available_actions: [],
      },
    ]
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responses.shift())))
    vi.stubGlobal("fetch", fetchMock)
    const requestBody = (callIndex: number) => {
      const init = (fetchMock.mock.calls[callIndex] as unknown as [string, RequestInit?])[1]
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body")
      return JSON.parse(init.body)
    }

    const { importOldResume } = await import("./api")
    const progressSteps: string[] = []
    const workspace = await importOldResume({
      title: "旧简历重构",
      raw_text: "项目经历\n负责订单系统重构",
    }, (step) => progressSteps.push(step))

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "http://127.0.0.1:4317/documents",
      expect.objectContaining({ method: "POST" }),
    )
    expect(requestBody(0)).toMatchObject({
      title: "旧简历重构",
      initial_mode: "import_old_resume",
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:4317/documents/doc_import/sources",
      expect.objectContaining({ method: "POST" }),
    )
    expect(requestBody(1)).toMatchObject({
      source_type: "old_resume",
      raw_text: "项目经历\n负责订单系统重构",
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:4317/documents/doc_import/workspace-view",
    )
    expect(workspace.document.current_draft_id).toBeUndefined()
    expect(workspace.current_draft).toBeUndefined()
    expect(workspace.source_resume_canvas?.id).toBe("canvas_import")
    expect(progressSteps).toEqual([
      "create_document",
      "save_source",
      "load_workspace",
    ])
  })

  it("imports an old resume file through upload source and opens the workspace view", async () => {
    const responses = [
      {
        id: "doc_import",
        pack_id: "resume",
        title: "旧简历重构",
        template_id: "classic-a4",
        status: "active",
        target_language: "zh-CN",
        current_draft_id: null,
        accepted_draft_id: null,
        created_at: "2026-05-21T08:00:00.000Z",
        updated_at: "2026-05-21T08:00:00.000Z",
      },
      {
        id: "src_import",
        document_id: "doc_import",
        source_type: "old_resume",
        title: "resume.md",
        mime_type: "text/markdown",
        original_uri: "resume.md",
        raw_text: "项目经历\n负责订单系统重构",
        file_path: "C:/Users/test/.typedance/files/sources/doc_import/resume.md",
        parse_status: "pending",
        created_at: "2026-05-21T08:00:00.000Z",
      },
      {
        document: {
          id: "doc_import",
          pack_id: "resume",
          title: "旧简历重构",
          template_id: "classic-a4",
          status: "active",
          target_language: "zh-CN",
          current_draft_id: null,
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
        source_resume_canvas: {
          id: "canvas_import",
          document_id: "doc_import",
          old_resume_source_id: "src_import",
          version: 1,
          source_snapshot_hash: "sha256:import",
          doc_json: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "项目经历" }],
              },
            ],
          },
          node_map: [],
          module_anchors: [],
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
        modules: [],
        claims: [],
        issues: [],
        proposals: [],
        evidence: [],
        source_summaries: [],
        quality_gate: { status: "unknown", blocking_issue_ids: [], warning_issue_ids: [] },
        available_actions: [],
      },
    ]
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responses.shift())))
    vi.stubGlobal("fetch", fetchMock)
    const file = new File(["项目经历\n负责订单系统重构"], "resume.md", { type: "text/markdown" })

    const { importOldResume } = await import("./api")
    const progressSteps: string[] = []
    const workspace = await importOldResume({
      title: "旧简历重构",
      file,
    }, (step) => progressSteps.push(step))

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "http://127.0.0.1:4317/documents/doc_import/sources/import-file",
      expect.objectContaining({ method: "POST" }),
    )
    const uploadInit = (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]
    const uploadBody = uploadInit.body
    expect(uploadBody).toBeInstanceOf(FormData)
    expect((uploadBody as FormData).get("file")).toBe(file)
    expect(workspace.document.current_draft_id).toBeUndefined()
    expect(workspace.current_draft).toBeUndefined()
    expect(workspace.source_resume_canvas?.id).toBe("canvas_import")
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:4317/documents/doc_import/workspace-view",
    )
    expect(progressSteps).toEqual([
      "create_document",
      "save_source",
      "load_workspace",
    ])
  })

  it("starts a blank guided resume through manual source and workspace view", async () => {
    const responses = [
      {
        id: "doc_guided",
        pack_id: "resume",
        title: "新简历",
        template_id: "classic-a4",
        status: "active",
        target_language: "zh-CN",
        current_draft_id: null,
        accepted_draft_id: null,
        created_at: "2026-05-21T08:00:00.000Z",
        updated_at: "2026-05-21T08:00:00.000Z",
      },
      {
        id: "src_guided",
        document_id: "doc_guided",
        source_type: "manual_user_input",
        title: "空白引导信息",
        mime_type: "text/plain",
        raw_text: "姓名: 张三\n目标方向: 前端工程师",
        parse_status: "recognized",
        created_at: "2026-05-21T08:00:00.000Z",
      },
      {
        document: {
          id: "doc_guided",
          pack_id: "resume",
          title: "新简历",
          template_id: "classic-a4",
          status: "active",
          target_language: "zh-CN",
          current_draft_id: null,
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
        modules: [],
        claims: [],
        issues: [],
        proposals: [],
        evidence: [],
        source_summaries: [],
        quality_gate: { status: "needs_review", blocking_issue_ids: [], warning_issue_ids: [] },
        available_actions: [],
      },
    ]
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(responses.shift())))
    vi.stubGlobal("fetch", fetchMock)
    const requestBody = (callIndex: number) => {
      const init = (fetchMock.mock.calls[callIndex] as unknown as [string, RequestInit?])[1]
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body")
      return JSON.parse(init.body)
    }

    const { startBlankGuidedResume } = await import("./api")
    const workspace = await startBlankGuidedResume({
      title: "新简历",
      name: "张三",
      target_role: "前端工程师",
      skills: "Vue3、TypeScript",
    })

    expect(requestBody(0)).toMatchObject({
      title: "新简历",
      initial_mode: "blank_guided",
    })
    expect(requestBody(1)).toMatchObject({
      source_type: "manual_user_input",
      raw_text: "姓名: 张三\n目标方向: 前端工程师\n技能: Vue3、TypeScript",
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:4317/documents/doc_guided/workspace-view",
    )
    expect(workspace.document.current_draft_id).toBeUndefined()
  })

  it("exports a canvas PDF with its measured print snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "%PDF-1.4 revision pdf",
      {
        headers: {
          "content-type": "application/pdf",
          "X-Pdf-Path": "D:/exports/%E5%BC%A0%E4%B8%89.pdf",
          "X-Export-Artifact-Id": "export_1",
        },
      },
    )))
    const writable = {
      write: vi.fn(),
      close: vi.fn(),
    }
    const showSaveFilePicker = vi.fn(async () => ({
      name: "自选保存位置.pdf",
      createWritable: vi.fn(async () => writable),
    }))
    vi.stubGlobal("showSaveFilePicker", showSaveFilePicker)

    const { exportCanvasPdf } = await import("./api")
    const result = await exportCanvasPdf("doc_1", "张三", { printSnapshot })

    expect(showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: "resume-张三.pdf",
      types: [
        { description: "PDF", accept: { "application/pdf": [".pdf"] } },
      ],
    })
    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/documents/doc_1/canvas-export/pdf",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          print_snapshot: printSnapshot,
        }),
      },
    )
    expect(writable.write).toHaveBeenCalled()
    expect(writable.close).toHaveBeenCalled()
    expect(result).toMatchObject({
      artifactId: "export_1",
      fileName: "自选保存位置.pdf",
      filePath: "D:/exports/张三.pdf",
      format: "pdf",
    })
  })

  it("exports canvas HTML with the same measured print snapshot", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "<!doctype html><html><body>当前画布</body></html>",
      {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "X-Html-Path": "D:/exports/%E5%BC%A0%E4%B8%89.html",
          "X-Export-Artifact-Id": "export_html_1",
        },
      },
    )))
    const clickMock = vi.fn()
    const createElementMock = vi.spyOn(document, "createElement").mockReturnValue({
      href: "",
      download: "",
      click: clickMock,
    } as unknown as HTMLAnchorElement)
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:revision-html"),
      revokeObjectURL: vi.fn(),
    })

    const { exportCanvasHtml } = await import("./api")
    const result = await exportCanvasHtml("doc_1", "张三", { printSnapshot })

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/documents/doc_1/canvas-export/html",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          print_snapshot: printSnapshot,
        }),
      },
    )
    expect(clickMock).toHaveBeenCalled()
    expect(result).toMatchObject({
      artifactId: "export_html_1",
      filePath: "D:/exports/张三.html",
      format: "html",
    })

    createElementMock.mockRestore()
  })
})
