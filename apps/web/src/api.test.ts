import { describe, expect, it, vi } from "vitest"
import { getTemplateSample } from "./api"

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
  it("loads a revision workspace view", async () => {
    const payload = {
      document: {
        id: "doc_1",
        pack_id: "resume",
        title: "张三的简历",
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
      run_status: {
        run_id: "run_1",
        status: "completed",
      },
      coach_summary: {
        summary: "还有 1 个问题建议处理后再导出。",
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

  it("imports an old resume through document source run and workspace view", async () => {
    const responses = [
      {
        id: "doc_import",
        pack_id: "resume",
        title: "旧简历重构",
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
        parse_status: "parsed",
        created_at: "2026-05-21T08:00:00.000Z",
      },
      {
        id: "run_import",
        document_id: "doc_import",
        pack_id: "resume",
        run_type: "import_reconstruct",
        status: "completed",
        source_document_ids: ["src_import"],
        target_draft_id: "draft_import",
        created_at: "2026-05-21T08:00:00.000Z",
        updated_at: "2026-05-21T08:00:00.000Z",
      },
      {
        document: {
          id: "doc_import",
          pack_id: "resume",
          title: "旧简历重构",
          status: "active",
          target_language: "zh-CN",
          current_draft_id: "draft_import",
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
        current_draft: {
          id: "draft_import",
          document_id: "doc_import",
          run_id: "run_import",
          pack_id: "resume",
          status: "in_review",
          summary: "基于旧简历生成的结构化草稿",
          applied_proposal_ids: [],
          unresolved_issue_ids: [],
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
        modules: [],
        claims: [],
        issues: [],
        proposals: [],
        evidence: [],
        source_summaries: [],
        quality_gate: { status: "ready", blocking_issue_ids: [], warning_issue_ids: [] },
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
    const workspace = await importOldResume({
      title: "旧简历重构",
      raw_text: "项目经历\n负责订单系统重构",
    })

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
      "http://127.0.0.1:4317/documents/doc_import/revision-runs",
      expect.objectContaining({ method: "POST" }),
    )
    expect(requestBody(2)).toMatchObject({
      run_type: "import_reconstruct",
      source_document_ids: ["src_import"],
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:4317/documents/doc_import/workspace-view",
    )
    expect(workspace.document.current_draft_id).toBe("draft_import")
  })

  it("starts a blank guided resume through manual source and workspace view", async () => {
    const responses = [
      {
        id: "doc_guided",
        pack_id: "resume",
        title: "新简历",
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
        parse_status: "parsed",
        created_at: "2026-05-21T08:00:00.000Z",
      },
      {
        id: "run_guided",
        document_id: "doc_guided",
        pack_id: "resume",
        run_type: "blank_guided_generate",
        status: "completed",
        source_document_ids: ["src_guided"],
        target_draft_id: "draft_guided",
        created_at: "2026-05-21T08:00:00.000Z",
        updated_at: "2026-05-21T08:00:00.000Z",
      },
      {
        document: {
          id: "doc_guided",
          pack_id: "resume",
          title: "新简历",
          status: "active",
          target_language: "zh-CN",
          current_draft_id: "draft_guided",
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
        current_draft: {
          id: "draft_guided",
          document_id: "doc_guided",
          run_id: "run_guided",
          pack_id: "resume",
          status: "in_review",
          summary: "基于引导信息生成的基础简历初稿",
          applied_proposal_ids: [],
          unresolved_issue_ids: [],
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
    expect(requestBody(2)).toMatchObject({
      run_type: "blank_guided_generate",
      source_document_ids: ["src_guided"],
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "http://127.0.0.1:4317/documents/doc_guided/workspace-view",
    )
    expect(workspace.document.current_draft_id).toBe("draft_guided")
  })

  it("runs a revision quality review", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "run_review",
      document_id: "doc_1",
      pack_id: "resume",
      run_type: "quality_review",
      status: "completed",
      source_document_ids: [],
      base_draft_id: "draft_1",
      target_draft_id: "draft_1",
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    }))))

    const { runRevisionQualityReview } = await import("./api")
    const run = await runRevisionQualityReview("doc_1", "draft_1")

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/documents/doc_1/revision-runs",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          run_type: "quality_review",
          base_draft_id: "draft_1",
          user_intent: "运行基础质量检查",
        }),
      },
    )
    expect(run.status).toBe("completed")
  })

  it("calibrates an opportunity from external context", async () => {
    const responses = [
      {
        id: "src_opp",
        document_id: "doc_1",
        source_type: "external_context",
        title: "前端岗位",
        mime_type: "text/plain",
        raw_text: "要求：React、TypeScript",
        parse_status: "parsed",
        created_at: "2026-05-21T08:00:00.000Z",
      },
      {
        id: "run_opp",
        document_id: "doc_1",
        pack_id: "resume",
        run_type: "opportunity_calibrate",
        status: "completed",
        source_document_ids: ["src_opp"],
        base_draft_id: "draft_1",
        target_draft_id: "draft_opp",
        created_at: "2026-05-21T08:00:00.000Z",
        updated_at: "2026-05-21T08:00:00.000Z",
      },
      {
        document: {
          id: "doc_1",
          pack_id: "resume",
          title: "基础简历",
          status: "active",
          target_language: "zh-CN",
          current_draft_id: "draft_opp",
          created_at: "2026-05-21T08:00:00.000Z",
          updated_at: "2026-05-21T08:00:00.000Z",
        },
        current_draft: {
          id: "draft_opp",
          document_id: "doc_1",
          run_id: "run_opp",
          pack_id: "resume",
          status: "in_review",
          summary: "前端岗位岗位版本",
          applied_proposal_ids: [],
          unresolved_issue_ids: [],
          variant_type: "opportunity",
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

    const { calibrateRevisionOpportunity } = await import("./api")
    const workspace = await calibrateRevisionOpportunity("doc_1", "draft_1", {
      title: "前端岗位",
      raw_text: "要求：React、TypeScript",
    })

    expect(requestBody(0)).toMatchObject({
      source_type: "external_context",
      title: "前端岗位",
    })
    expect(requestBody(1)).toMatchObject({
      run_type: "opportunity_calibrate",
      base_draft_id: "draft_1",
      source_document_ids: ["src_opp"],
    })
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "http://127.0.0.1:4317/documents/doc_1/workspace-view",
    )
    expect(workspace.current_draft?.variant_type).toBe("opportunity")
  })

  it("exports a revision draft PDF through the export gate", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      "%PDF-1.4 revision pdf",
      {
        headers: {
          "content-type": "application/pdf",
          "X-Pdf-Path": "D:/exports/%E5%BC%A0%E4%B8%89.pdf",
          "X-Export-Artifact-Id": "export_1",
          "X-Export-Review-Status": "forced_with_risk",
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
      createObjectURL: vi.fn().mockReturnValue("blob:revision"),
      revokeObjectURL: vi.fn(),
    })

    const { exportRevisionDraftPdf } = await import("./api")
    const result = await exportRevisionDraftPdf("draft_1", "张三", { forceWithRisk: true })

    expect(fetch).toHaveBeenCalledWith(
      "http://127.0.0.1:4317/drafts/draft_1/export/pdf",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force_with_risk: true }),
      },
    )
    expect(clickMock).toHaveBeenCalled()
    expect(result).toMatchObject({
      artifactId: "export_1",
      reviewStatus: "forced_with_risk",
      filePath: "D:/exports/张三.pdf",
    })

    createElementMock.mockRestore()
  })
})
