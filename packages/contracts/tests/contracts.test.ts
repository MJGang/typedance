import { describe, expect, it } from "vitest";
import {
  agentStepSchema,
  documentClaimSchema,
  documentModuleSchema,
  documentPackSchema,
  documentSchema,
  draftVersionSchema,
  evidenceLinkSchema,
  exportArtifactSchema,
  languageSchema,
  parsedBlockSchema,
  renderProjectionSchema,
  resumePackDefinition,
  resumePackSchema,
  resumeVersionSchema,
  revisionIssueSchema,
  revisionProposalSchema,
  revisionRunSchema,
  sourceDocumentSchema,
  templateSampleContentSchema,
  templateStyleConfigSchema,
  workspaceViewSchema,
} from "../src/index";

describe("shared schemas", () => {
  it("exports language schema from the public index", () => {
    expect(languageSchema.parse("zh-CN")).toBe("zh-CN");
    expect(languageSchema.parse("en-US")).toBe("en-US");
    expect(() => languageSchema.parse("fr-FR")).toThrow();
  });
});

describe("resumeVersionSchema", () => {
  it("accepts a minimal valid resume version", () => {
    const parsed = resumeVersionSchema.parse({
      id: "resume_1",
      title: "Backend Engineer Resume",
      target_language: "en-US",
      template_id: "classic-a4",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "",
      preview_pdf_path: null,
      preview_pdf_url: null,
      created_at: "2026-05-08T08:00:00.000Z",
      updated_at: "2026-05-08T08:00:00.000Z",
    });

    expect(parsed.source_refs).toEqual([]);
    expect(parsed.accepted_edit_ids).toEqual([]);
  });
});

describe("templateSampleContentSchema", () => {
  it("validates template sample content", () => {
    const parsed = templateSampleContentSchema.parse({
      id: "sample-tech-zh",
      name: {
        "zh-CN": "Tech resume sample",
        "en-US": "Tech Resume Sample",
      },
      target_language: "zh-CN",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "Tech resume sample",
      updated_at: "2026-05-08T08:00:00.000Z",
    });

    expect(parsed.id).toBe("sample-tech-zh");
  });
});

describe("templateStyleConfigSchema", () => {
  it("validates template style config with blocks", () => {
    const parsed = templateStyleConfigSchema.parse({
      template_id: "classic-a4",
      blocks: {
        heading1: { fontSize: "24px", fontWeight: 700, color: "#1a1a1a", textAlign: "center" },
        paragraph: { fontSize: "10px", lineHeight: 1.5, color: "#334155" },
      },
      updated_at: "2026-05-08T08:00:00.000Z",
    });

    expect(parsed.template_id).toBe("classic-a4");
    expect(parsed.preset).toBe("classic");
    expect(parsed.blocks.heading1.fontSize).toBe("24px");
    expect(parsed.blocks.heading1.fontWeight).toBe(700);
    expect(parsed.updated_at).toBe("2026-05-08T08:00:00.000Z");
  });

  it("defaults blocks to an empty object", () => {
    const parsed = templateStyleConfigSchema.parse({
      template_id: "classic-a4",
      blocks: {},
      updated_at: "2026-05-08T08:00:00.000Z",
    });

    expect(parsed.blocks).toEqual({});
  });

  it("requires an updated timestamp", () => {
    expect(() =>
      templateStyleConfigSchema.parse({
        template_id: "classic-a4",
        blocks: {},
      })
    ).toThrow();
  });

  it("rejects unknown block type keys", () => {
    expect(() =>
      templateStyleConfigSchema.parse({
        template_id: "classic-a4",
        blocks: {
          unknownBlock: { fontSize: "12px" },
        },
        updated_at: "2026-05-08T08:00:00.000Z",
      })
    ).toThrow();
  });
});

describe("revision document schemas", () => {
  it("validates a document project", () => {
    const parsed = documentSchema.parse({
      id: "doc_1",
      pack_id: "resume",
      title: "张三基础简历",
      status: "active",
      target_language: "zh-CN",
      current_draft_id: "draft_1",
      accepted_draft_id: null,
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    });

    expect(parsed.pack_id).toBe("resume");
    expect(parsed.status).toBe("active");
  });

  it("validates source document and parsed block", () => {
    const source = sourceDocumentSchema.parse({
      id: "src_1",
      document_id: "doc_1",
      source_type: "old_resume",
      title: "旧简历.pdf",
      mime_type: "application/pdf",
      raw_text: "项目经历...",
      parse_status: "parsed",
      created_at: "2026-05-21T08:00:00.000Z",
    });

    const block = parsedBlockSchema.parse({
      id: "blk_1",
      source_document_id: source.id,
      type: "paragraph",
      text: "负责订单系统重构",
      order: 1,
      page: 1,
      source_span: { start: 0, end: 8 },
    });

    expect(source.source_type).toBe("old_resume");
    expect(block.text).toContain("订单系统");
  });
});

describe("revision core object schemas", () => {
  it("validates module, claim, evidence, issue, and proposal", () => {
    const module = documentModuleSchema.parse({
      id: "mod_1",
      draft_id: "draft_1",
      pack_id: "resume",
      type: "ProjectExperience",
      title: "项目经历",
      order: 1,
      visibility: "visible",
      status: "needs_review",
      data: { items: [] },
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    });

    const claim = documentClaimSchema.parse({
      id: "claim_1",
      draft_id: "draft_1",
      module_id: module.id,
      text: "负责订单系统重构，提升稳定性",
      claim_type: "achievement",
      confidence: "inferred",
      risk_flags: ["missing_metric"],
      source_span_refs: ["blk_1"],
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    });

    const evidence = evidenceLinkSchema.parse({
      id: "ev_1",
      document_id: "doc_1",
      source_document_id: "src_1",
      claim_id: claim.id,
      support_level: "partial",
      extracted_text: "订单系统重构",
      confidence: 0.72,
      user_confirmed: false,
      created_at: "2026-05-21T08:00:00.000Z",
    });

    const issue = revisionIssueSchema.parse({
      id: "issue_1",
      run_id: "run_1",
      document_id: "doc_1",
      draft_id: "draft_1",
      module_id: module.id,
      claim_id: claim.id,
      type: "missing_result",
      severity: "warning",
      title: "缺少结果",
      message: "这条经历看不出结果。",
      reason: "HR 难以判断影响范围。",
      evidence_link_ids: [evidence.id],
      actions: [
        {
          id: "act_1",
          label: "补充结果",
          action_type: "request_user_input",
        },
      ],
      status: "open",
      created_by_agent: "ResumeReviewer",
      created_at: "2026-05-21T08:00:00.000Z",
    });

    const proposal = revisionProposalSchema.parse({
      id: "prop_1",
      run_id: "run_1",
      document_id: "doc_1",
      draft_id: "draft_1",
      target: { claim_id: claim.id },
      operation: "replace_claim",
      original_snapshot: { text: claim.text },
      proposed_snapshot: { text: "主导订单系统重构，降低核心链路故障率" },
      summary: "让表达更结果导向",
      rationale: "原文只描述动作，没有体现影响。",
      related_issue_ids: [issue.id],
      evidence_link_ids: [evidence.id],
      confidence: 0.8,
      risk_level: "medium",
      requires_user_confirmation: true,
      status: "pending",
      created_by_agent: "ResumeRewriter",
      created_at: "2026-05-21T08:00:00.000Z",
    });

    expect(proposal.requires_user_confirmation).toBe(true);
  });
});

describe("revision run and workspace schemas", () => {
  it("validates run, draft, render projection, export artifact, and workspace view", () => {
    const run = revisionRunSchema.parse({
      id: "run_1",
      document_id: "doc_1",
      pack_id: "resume",
      run_type: "import_reconstruct",
      status: "completed",
      source_document_ids: ["src_1"],
      target_draft_id: "draft_1",
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    });

    const step = agentStepSchema.parse({
      id: "step_1",
      run_id: run.id,
      agent_name: "ResumeReviewer",
      status: "completed",
      input_refs: ["draft_1"],
      output_refs: ["issue_1"],
      started_at: "2026-05-21T08:00:00.000Z",
      finished_at: "2026-05-21T08:00:01.000Z",
    });

    const draft = draftVersionSchema.parse({
      id: "draft_1",
      document_id: "doc_1",
      run_id: run.id,
      pack_id: "resume",
      status: "in_review",
      summary: "新版基础简历草稿",
      applied_proposal_ids: [],
      unresolved_issue_ids: ["issue_1"],
      render_projection_id: "render_1",
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    });

    const render = renderProjectionSchema.parse({
      id: "render_1",
      draft_id: draft.id,
      render_profile: "default-a4",
      html: "<article></article>",
      doc_json: { type: "doc", content: [] },
      layout_warnings: [],
      created_at: "2026-05-21T08:00:00.000Z",
    });

    const artifact = exportArtifactSchema.parse({
      id: "export_1",
      document_id: "doc_1",
      draft_id: draft.id,
      format: "pdf",
      file_path: "resume.pdf",
      review_status: "passed",
      created_at: "2026-05-21T08:00:00.000Z",
    });

    const workspace = workspaceViewSchema.parse({
      document: {
        id: "doc_1",
        pack_id: "resume",
        title: "张三基础简历",
        status: "active",
        target_language: "zh-CN",
        current_draft_id: draft.id,
        accepted_draft_id: null,
        created_at: "2026-05-21T08:00:00.000Z",
        updated_at: "2026-05-21T08:00:00.000Z",
      },
      current_draft: draft,
      modules: [],
      claims: [],
      issues: [],
      proposals: [],
      evidence: [],
      source_summaries: [],
      render_projection: render,
      quality_gate: {
        status: "needs_review",
        blocking_issue_ids: [],
        warning_issue_ids: ["issue_1"],
      },
      run_status: {
        run_id: run.id,
        status: run.status,
        current_step: step.agent_name,
      },
      coach_summary: {
        summary: "这份简历已经生成，可以先处理 1 个问题。",
        next_action_ids: [],
      },
      available_actions: [],
    });

    expect(workspace.current_draft?.id).toBe(draft.id);
    expect(artifact.review_status).toBe("passed");
  });
});

describe("document pack schemas", () => {
  it("validates the resume pack definition", () => {
    const parsed = resumePackSchema.parse(resumePackDefinition);

    expect(parsed.id).toBe("resume");
    expect(parsed.modules.map((item) => item.type)).toContain("WorkExperience");
    expect(parsed.issue_types.map((item) => item.type)).toContain("missing_evidence");
    expect(parsed.actions.map((item) => item.action_type)).toContain("make_more_conservative");
  });

  it("validates a generic document pack", () => {
    const parsed = documentPackSchema.parse(resumePackDefinition);
    expect(parsed.agent_contracts.map((item) => item.agent_name)).toContain("ResumeReviewer");
  });
});

describe("AI-native contract guardrails", () => {
  it("does not require doc_json on DraftVersion", () => {
    const parsed = draftVersionSchema.parse({
      id: "draft_guardrail",
      document_id: "doc_1",
      run_id: "run_1",
      pack_id: "resume",
      status: "generated",
      summary: "结构化草稿",
      applied_proposal_ids: [],
      unresolved_issue_ids: [],
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    });

    expect(parsed).not.toHaveProperty("doc_json");
  });

  it("requires RevisionProposal to carry a structured target and proposed snapshot", () => {
    expect(() =>
      revisionProposalSchema.parse({
        id: "prop_bad",
        run_id: "run_1",
        document_id: "doc_1",
        operation: "replace_claim",
        summary: "bad proposal",
        rationale: "missing target and snapshot",
        confidence: 0.5,
        risk_level: "low",
        requires_user_confirmation: false,
        status: "pending",
        created_by_agent: "ResumeRewriter",
        created_at: "2026-05-21T08:00:00.000Z",
      })
    ).toThrow();
  });

  it("keeps legacy ResumeVersion available but separate from DraftVersion", () => {
    const legacy = resumeVersionSchema.parse({
      id: "resume_legacy",
      title: "Legacy Resume",
      target_language: "zh-CN",
      template_id: "classic-a4",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "",
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    });

    const draft = draftVersionSchema.parse({
      id: "draft_new",
      document_id: "doc_1",
      run_id: "run_1",
      pack_id: "resume",
      status: "generated",
      summary: "New draft",
      created_at: "2026-05-21T08:00:00.000Z",
      updated_at: "2026-05-21T08:00:00.000Z",
    });

    expect(legacy.doc_json).toEqual({ type: "doc", content: [] });
    expect(draft.id).toBe("draft_new");
  });
});
