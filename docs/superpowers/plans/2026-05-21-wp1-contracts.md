# WP1 Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 TypeDance Revision Engine 的跨端事实 schema，让 `Document / Source / Draft / Issue / Proposal / Evidence / WorkspaceView / ResumePack` 成为代码层面的稳定契约，同时保留现有 `ResumeVersion` 兼容导出。

**Architecture:** `packages/contracts/src/index.ts` 将从单文件 schema 改为聚合导出入口；legacy schema 放入 `src/legacy/*`，新事实源放入 `src/revision/*`，Pack 协议放入 `src/packs/*`。所有新增 schema 先用 Vitest 锁定行为，再实现 zod schema 和类型导出，最后补一个跨对象 WorkspaceView 集成测试。

**Tech Stack:** TypeScript 5.x, zod 3.x, Vitest, pnpm workspace.

**Execution Status:** 已在 `codex/wp1-contracts` 分支完成代码落地和验证。验证命令：`corepack pnpm --filter @typedance/contracts test`、`corepack pnpm --filter @typedance/contracts build`、`corepack pnpm --filter @typedance/resume-renderer test`、`corepack pnpm --filter @typedance/web test`、`corepack pnpm --filter @typedance/resume-renderer build`、`corepack pnpm --filter @typedance/web build`。

---

## File Structure

需要创建：

- `packages/contracts/src/shared.ts`
  - 共享基础 schema：语言、时间、ID、localized text、通用 target。
- `packages/contracts/src/legacy/resume-version.ts`
  - 迁移现有 `ResumeVersion`、`PDFExport`。
- `packages/contracts/src/legacy/template-style.ts`
  - 迁移现有 template sample、block style、template style。
- `packages/contracts/src/revision/document.ts`
  - `Document`、`DocumentListItem`。
- `packages/contracts/src/revision/source.ts`
  - `SourceDocument`、`ParsedBlock`。
- `packages/contracts/src/revision/draft.ts`
  - `DraftVersion`。
- `packages/contracts/src/revision/module.ts`
  - `DocumentModule`、Resume module enum。
- `packages/contracts/src/revision/claim.ts`
  - `DocumentClaim`、claim confidence。
- `packages/contracts/src/revision/evidence.ts`
  - `EvidenceLink`、`UserConfirmation`。
- `packages/contracts/src/revision/issue.ts`
  - `RevisionIssue`、`RevisionAction`。
- `packages/contracts/src/revision/proposal.ts`
  - `RevisionProposal`、operation enum。
- `packages/contracts/src/revision/run.ts`
  - `RevisionRun`、`AgentStep`。
- `packages/contracts/src/revision/render.ts`
  - `RenderProjection`、`ExportArtifact`、layout warning。
- `packages/contracts/src/revision/workspace-view.ts`
  - `WorkspaceView` 聚合响应。
- `packages/contracts/src/packs/document-pack.ts`
  - 通用 Document Pack 协议。
- `packages/contracts/src/packs/resume-pack.ts`
  - Resume Pack 固定枚举、模块清单和 issue/action 类型。

需要修改：

- `packages/contracts/src/index.ts`
  - 改为统一导出入口，保持现有导入路径兼容。
- `packages/contracts/tests/contracts.test.ts`
  - 保留 legacy 测试，并增加 revision / pack / workspace view schema 测试。

不在本计划内：

- Python Pydantic model。
- sidecar 存储表。
- API 实现。
- 前端页面。

这些属于 WP2 之后。

---

## Task 1: Split Shared and Legacy Contracts

**Files:**
- Create: `packages/contracts/src/shared.ts`
- Create: `packages/contracts/src/legacy/resume-version.ts`
- Create: `packages/contracts/src/legacy/template-style.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

- [x] **Step 1: Create failing compatibility tests**

Replace the import block at the top of `packages/contracts/tests/contracts.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import {
  languageSchema,
  resumeVersionSchema,
  templateSampleContentSchema,
  templateStyleConfigSchema,
} from "../src/index";
```

Add this test before `describe("resumeVersionSchema", ...)`:

```ts
describe("shared schemas", () => {
  it("exports language schema from the public index", () => {
    expect(languageSchema.parse("zh-CN")).toBe("zh-CN");
    expect(languageSchema.parse("en-US")).toBe("en-US");
    expect(() => languageSchema.parse("fr-FR")).toThrow();
  });
});
```

- [x] **Step 2: Run test to verify baseline still passes or exposes missing exports**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
```

Expected:

```text
PASS if languageSchema is still exported from index.ts.
```

This step protects current public exports before moving files.

- [x] **Step 3: Create shared schema file**

Create `packages/contracts/src/shared.ts`:

```ts
import { z } from "zod";

export const languageSchema = z.enum(["zh-CN", "en-US"]);

export const isoDateTimeSchema = z.string().datetime();

export const localizedTextSchema = z.object({
  "zh-CN": z.string().min(1),
  "en-US": z.string().min(1),
});

export const revisionTargetSchema = z.object({
  document_id: z.string().min(1).optional(),
  draft_id: z.string().min(1).optional(),
  module_id: z.string().min(1).optional(),
  claim_id: z.string().min(1).optional(),
  issue_id: z.string().min(1).optional(),
  proposal_id: z.string().min(1).optional(),
  source_document_id: z.string().min(1).optional(),
  parsed_block_id: z.string().min(1).optional(),
});

export type Language = z.infer<typeof languageSchema>;
export type LocalizedText = z.infer<typeof localizedTextSchema>;
export type RevisionTarget = z.infer<typeof revisionTargetSchema>;
```

- [x] **Step 4: Move ResumeVersion legacy schema**

Create `packages/contracts/src/legacy/resume-version.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema, languageSchema } from "../shared";

export const resumeVersionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  job_target_id: z.string().nullable().optional(),
  target_language: languageSchema,
  template_id: z.string().min(1),
  doc_json: z.record(z.unknown()),
  plain_text_snapshot: z.string(),
  preview_pdf_path: z.string().nullable().optional(),
  preview_pdf_url: z.string().nullable().optional(),
  source_refs: z.array(z.string()).default([]),
  accepted_edit_ids: z.array(z.string()).default([]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const pdfExportSchema = z.object({
  id: z.string().min(1),
  resume_version_id: z.string().min(1),
  review_gate_result_id: z.string().nullable().optional(),
  file_path: z.string().min(1),
  language: languageSchema,
  layout_profile: z.enum(["single-page-a4", "multi-page-a4"]).default("single-page-a4"),
  layout_status: z.enum(["ready", "overflow", "render_failed"]),
  created_at: isoDateTimeSchema,
});

export type ResumeVersion = z.infer<typeof resumeVersionSchema>;
export type PDFExport = z.infer<typeof pdfExportSchema>;
```

- [x] **Step 5: Move template style legacy schema**

Create `packages/contracts/src/legacy/template-style.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema, languageSchema, localizedTextSchema } from "../shared";

export const templateSampleContentSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  target_language: languageSchema,
  doc_json: z.record(z.unknown()),
  plain_text_snapshot: z.string(),
  updated_at: isoDateTimeSchema,
});

export const blockTypeSchema = z.enum([
  "heading1",
  "heading2",
  "heading3",
  "paragraph",
  "bulletList",
  "orderedList",
]);

export const borderBottomSchema = z.object({
  style: z.enum(["none", "solid", "double"]).default("none"),
  width: z.string().optional(),
  color: z.string().optional(),
});

export const blockStyleSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.string().optional(),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).optional(),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.string().optional(),
  textTransform: z.enum(["none", "uppercase", "capitalize"]).optional(),
  color: z.string().optional(),
  backgroundColor: z.string().optional(),
  textAlign: z.enum(["left", "center", "right"]).optional(),
  marginTop: z.string().optional(),
  marginBottom: z.string().optional(),
  borderBottom: borderBottomSchema.optional(),
  listStyleType: z.enum(["disc", "circle", "square", "decimal", "none"]).optional(),
  paddingLeft: z.string().optional(),
});

export const templateStyleConfigSchema = z.object({
  template_id: z.string().min(1),
  name: z.string().optional(),
  preset: z.string().default("classic"),
  blocks: z.record(blockTypeSchema, blockStyleSchema),
  updated_at: isoDateTimeSchema,
});

export type TemplateSampleContent = z.infer<typeof templateSampleContentSchema>;
export type TemplateStyleConfig = z.infer<typeof templateStyleConfigSchema>;
export type BlockStyle = z.infer<typeof blockStyleSchema>;
export type BlockType = z.infer<typeof blockTypeSchema>;
```

- [x] **Step 6: Replace public index with re-exports**

Replace `packages/contracts/src/index.ts` with:

```ts
export * from "./shared";
export * from "./legacy/resume-version";
export * from "./legacy/template-style";
```

- [x] **Step 7: Run compatibility tests**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
```

Expected:

```text
PASS packages/contracts/tests/contracts.test.ts
```

- [x] **Step 8: Run contracts build**

Run:

```bash
corepack pnpm --filter @typedance/contracts build
```

Expected:

```text
No TypeScript errors.
```

- [x] **Step 9: Commit**

```bash
git add packages/contracts/src packages/contracts/tests/contracts.test.ts
git commit -m "refactor(contracts): 拆分 legacy 契约导出"
```

---

## Task 2: Add Document and Source Schemas

**Files:**
- Create: `packages/contracts/src/revision/document.ts`
- Create: `packages/contracts/src/revision/source.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

- [x] **Step 1: Write failing tests for Document and Source**

Append to `packages/contracts/tests/contracts.test.ts`:

```ts
import {
  documentSchema,
  parsedBlockSchema,
  sourceDocumentSchema,
} from "../src/index";

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
```

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
```

Expected:

```text
FAIL because documentSchema, sourceDocumentSchema, and parsedBlockSchema are not exported.
```

- [x] **Step 3: Implement document schema**

Create `packages/contracts/src/revision/document.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema, languageSchema } from "../shared";

export const documentStatusSchema = z.enum(["active", "archived"]);

export const documentSchema = z.object({
  id: z.string().min(1),
  pack_id: z.string().min(1),
  title: z.string().min(1),
  status: documentStatusSchema,
  target_language: languageSchema,
  current_draft_id: z.string().nullable().optional(),
  accepted_draft_id: z.string().nullable().optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const documentListItemSchema = documentSchema.pick({
  id: true,
  pack_id: true,
  title: true,
  status: true,
  target_language: true,
  current_draft_id: true,
  updated_at: true,
}).extend({
  quality_state: z.enum(["unknown", "needs_review", "ready", "blocked"]).optional(),
});

export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type Document = z.infer<typeof documentSchema>;
export type DocumentListItem = z.infer<typeof documentListItemSchema>;
```

- [x] **Step 4: Implement source schema**

Create `packages/contracts/src/revision/source.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const sourceTypeSchema = z.enum([
  "old_resume",
  "uploaded_file",
  "pasted_text",
  "manual_user_input",
  "project_material",
  "work_summary",
  "external_context",
]);

export const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  source_type: sourceTypeSchema,
  title: z.string().min(1),
  mime_type: z.string().optional(),
  original_uri: z.string().optional(),
  raw_text: z.string().optional(),
  file_path: z.string().optional(),
  parse_status: z.enum(["pending", "parsed", "failed"]),
  created_at: isoDateTimeSchema,
});

export const parsedBlockSchema = z.object({
  id: z.string().min(1),
  source_document_id: z.string().min(1),
  type: z.enum(["heading", "paragraph", "list", "table", "contact", "date_range", "unknown"]),
  text: z.string(),
  order: z.number().int().nonnegative(),
  page: z.number().int().positive().optional(),
  source_span: z.record(z.unknown()).default({}),
});

export const sourceDocumentSummarySchema = sourceDocumentSchema.pick({
  id: true,
  document_id: true,
  source_type: true,
  title: true,
  parse_status: true,
  created_at: true,
});

export type SourceType = z.infer<typeof sourceTypeSchema>;
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type ParsedBlock = z.infer<typeof parsedBlockSchema>;
export type SourceDocumentSummary = z.infer<typeof sourceDocumentSummarySchema>;
```

- [x] **Step 5: Export revision schemas**

Update `packages/contracts/src/index.ts`:

```ts
export * from "./shared";
export * from "./legacy/resume-version";
export * from "./legacy/template-style";
export * from "./revision/document";
export * from "./revision/source";
```

- [x] **Step 6: Run tests and build**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
corepack pnpm --filter @typedance/contracts build
```

Expected:

```text
PASS contracts tests.
No TypeScript errors.
```

- [x] **Step 7: Commit**

```bash
git add packages/contracts/src packages/contracts/tests/contracts.test.ts
git commit -m "feat(contracts): 新增文档与来源契约"
```

---

## Task 3: Add Module, Claim, Evidence, Issue, and Proposal Schemas

**Files:**
- Create: `packages/contracts/src/revision/module.ts`
- Create: `packages/contracts/src/revision/claim.ts`
- Create: `packages/contracts/src/revision/evidence.ts`
- Create: `packages/contracts/src/revision/issue.ts`
- Create: `packages/contracts/src/revision/proposal.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

- [x] **Step 1: Write failing tests for core revision objects**

Append to `packages/contracts/tests/contracts.test.ts`:

```ts
import {
  documentClaimSchema,
  documentModuleSchema,
  evidenceLinkSchema,
  revisionIssueSchema,
  revisionProposalSchema,
} from "../src/index";

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
```

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
```

Expected:

```text
FAIL because core revision schemas are not exported.
```

- [x] **Step 3: Implement module schema**

Create `packages/contracts/src/revision/module.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const resumeModuleTypeSchema = z.enum([
  "BasicInfo",
  "CareerSummary",
  "JobIntent",
  "CoreSkills",
  "WorkExperience",
  "ProjectExperience",
  "Education",
  "InternshipExperience",
  "Certificates",
  "Awards",
  "Portfolio",
  "SelfEvaluation",
  "CustomModule",
]);

export const documentModuleStatusSchema = z.enum([
  "clean",
  "needs_review",
  "needs_confirmation",
  "weak",
  "hidden",
]);

export const documentModuleSchema = z.object({
  id: z.string().min(1),
  draft_id: z.string().min(1),
  pack_id: z.string().min(1),
  type: resumeModuleTypeSchema.or(z.string().min(1)),
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
  visibility: z.enum(["visible", "hidden"]),
  status: documentModuleStatusSchema,
  data: z.record(z.unknown()),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type ResumeModuleType = z.infer<typeof resumeModuleTypeSchema>;
export type DocumentModuleStatus = z.infer<typeof documentModuleStatusSchema>;
export type DocumentModule = z.infer<typeof documentModuleSchema>;
```

- [x] **Step 4: Implement claim schema**

Create `packages/contracts/src/revision/claim.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const claimConfidenceSchema = z.enum([
  "supported",
  "user_confirmed",
  "inferred",
  "unsupported",
]);

export const claimTypeSchema = z.enum([
  "responsibility",
  "achievement",
  "skill",
  "summary",
  "education",
  "certificate",
  "intent",
  "custom",
]);

export const documentClaimSchema = z.object({
  id: z.string().min(1),
  draft_id: z.string().min(1),
  module_id: z.string().min(1),
  item_id: z.string().optional(),
  text: z.string().min(1),
  claim_type: claimTypeSchema.or(z.string().min(1)),
  confidence: claimConfidenceSchema,
  risk_flags: z.array(z.string()).default([]),
  source_span_refs: z.array(z.string()).default([]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type ClaimConfidence = z.infer<typeof claimConfidenceSchema>;
export type ClaimType = z.infer<typeof claimTypeSchema>;
export type DocumentClaim = z.infer<typeof documentClaimSchema>;
```

- [x] **Step 5: Implement evidence schema**

Create `packages/contracts/src/revision/evidence.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const supportLevelSchema = z.enum([
  "direct",
  "partial",
  "inferred",
  "contradicted",
  "none",
]);

export const evidenceLinkSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  source_document_id: z.string().min(1),
  claim_id: z.string().optional(),
  support_level: supportLevelSchema,
  extracted_text: z.string().optional(),
  normalized_fact: z.string().optional(),
  confidence: z.number().min(0).max(1),
  user_confirmed: z.boolean(),
  created_at: isoDateTimeSchema,
});

export const userConfirmationSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  claim_id: z.string().optional(),
  evidence_link_id: z.string().optional(),
  issue_id: z.string().optional(),
  confirmation_type: z.enum(["truth_confirmed", "risk_accepted", "source_verified"]),
  note: z.string().optional(),
  created_at: isoDateTimeSchema,
});

export type SupportLevel = z.infer<typeof supportLevelSchema>;
export type EvidenceLink = z.infer<typeof evidenceLinkSchema>;
export type UserConfirmation = z.infer<typeof userConfirmationSchema>;
```

- [x] **Step 6: Implement issue schema**

Create `packages/contracts/src/revision/issue.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema, revisionTargetSchema } from "../shared";

export const resumeIssueTypeSchema = z.enum([
  "missing_info",
  "vague_expression",
  "missing_result",
  "missing_evidence",
  "timeline_conflict",
  "skill_without_support",
  "duplicate_content",
  "too_long",
  "tone_inconsistent",
  "hr_unfriendly",
  "overclaim_risk",
  "layout_risk",
]);

export const revisionActionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  action_type: z.enum([
    "accept_proposal",
    "reject_proposal",
    "request_user_input",
    "make_more_conservative",
    "make_more_specific",
    "view_source",
    "dismiss_issue",
    "confirm_claim",
  ]),
  target: revisionTargetSchema.optional(),
});

export const revisionIssueSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  document_id: z.string().min(1),
  draft_id: z.string().optional(),
  module_id: z.string().optional(),
  item_id: z.string().optional(),
  claim_id: z.string().optional(),
  type: resumeIssueTypeSchema.or(z.string().min(1)),
  severity: z.enum(["info", "warning", "blocking"]),
  title: z.string().min(1),
  message: z.string().min(1),
  reason: z.string().min(1),
  original_text: z.string().optional(),
  proposed_text: z.string().optional(),
  evidence_link_ids: z.array(z.string()).default([]),
  actions: z.array(revisionActionSchema).default([]),
  status: z.enum(["open", "resolved", "dismissed", "accepted", "needs_user_input"]),
  created_by_agent: z.string().min(1),
  created_at: isoDateTimeSchema,
});

export type ResumeIssueType = z.infer<typeof resumeIssueTypeSchema>;
export type RevisionAction = z.infer<typeof revisionActionSchema>;
export type RevisionIssue = z.infer<typeof revisionIssueSchema>;
```

- [x] **Step 7: Implement proposal schema**

Create `packages/contracts/src/revision/proposal.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema, revisionTargetSchema } from "../shared";

export const revisionOperationSchema = z.enum([
  "replace_claim",
  "insert_claim",
  "remove_claim",
  "rewrite_module",
  "reorder_module",
  "hide_module",
  "update_field",
]);

export const revisionProposalSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  document_id: z.string().min(1),
  draft_id: z.string().optional(),
  target: revisionTargetSchema,
  operation: revisionOperationSchema,
  original_snapshot: z.unknown().optional(),
  proposed_snapshot: z.unknown(),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  related_issue_ids: z.array(z.string()).default([]),
  evidence_link_ids: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  risk_level: z.enum(["low", "medium", "high"]),
  requires_user_confirmation: z.boolean(),
  status: z.enum(["pending", "applied", "rejected", "edited", "superseded"]),
  created_by_agent: z.string().min(1),
  created_at: isoDateTimeSchema,
});

export type RevisionOperation = z.infer<typeof revisionOperationSchema>;
export type RevisionProposal = z.infer<typeof revisionProposalSchema>;
```

- [x] **Step 8: Export core revision schemas**

Update `packages/contracts/src/index.ts`:

```ts
export * from "./shared";
export * from "./legacy/resume-version";
export * from "./legacy/template-style";
export * from "./revision/document";
export * from "./revision/source";
export * from "./revision/module";
export * from "./revision/claim";
export * from "./revision/evidence";
export * from "./revision/issue";
export * from "./revision/proposal";
```

- [x] **Step 9: Run tests and build**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
corepack pnpm --filter @typedance/contracts build
```

Expected:

```text
PASS contracts tests.
No TypeScript errors.
```

- [x] **Step 10: Commit**

```bash
git add packages/contracts/src packages/contracts/tests/contracts.test.ts
git commit -m "feat(contracts): 新增修订核心对象契约"
```

---

## Task 4: Add Run, Draft, Render, and WorkspaceView Schemas

**Files:**
- Create: `packages/contracts/src/revision/run.ts`
- Create: `packages/contracts/src/revision/draft.ts`
- Create: `packages/contracts/src/revision/render.ts`
- Create: `packages/contracts/src/revision/workspace-view.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

- [x] **Step 1: Write failing tests for WorkspaceView**

Append to `packages/contracts/tests/contracts.test.ts`:

```ts
import {
  agentStepSchema,
  draftVersionSchema,
  exportArtifactSchema,
  renderProjectionSchema,
  revisionRunSchema,
  workspaceViewSchema,
} from "../src/index";

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
```

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
```

Expected:

```text
FAIL because run, draft, render, and workspace schemas are not exported.
```

- [x] **Step 3: Implement RevisionRun and AgentStep**

Create `packages/contracts/src/revision/run.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const revisionRunTypeSchema = z.enum([
  "import_reconstruct",
  "blank_guided_generate",
  "quality_review",
  "issue_action",
  "module_rewrite",
  "evidence_check",
  "opportunity_calibrate",
  "review_gate",
]);

export const revisionRunStatusSchema = z.enum([
  "created",
  "parsing",
  "understanding",
  "planning",
  "generating",
  "verifying",
  "building_tasks",
  "awaiting_user_confirmation",
  "ready_for_review",
  "completed",
  "failed_retryable",
  "failed_final",
  "canceled",
]);

export const revisionRunSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  pack_id: z.string().min(1),
  run_type: revisionRunTypeSchema,
  status: revisionRunStatusSchema,
  source_document_ids: z.array(z.string()).default([]),
  base_draft_id: z.string().optional(),
  target_draft_id: z.string().optional(),
  user_intent: z.string().optional(),
  selected_module_id: z.string().optional(),
  selected_issue_id: z.string().optional(),
  selected_action_id: z.string().optional(),
  output_summary: z.string().optional(),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export const agentStepSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  agent_name: z.string().min(1),
  status: z.enum([
    "pending",
    "running",
    "completed",
    "failed_schema",
    "failed_tool",
    "failed_model",
    "failed_policy",
    "skipped",
  ]),
  input_refs: z.array(z.string()).default([]),
  output_refs: z.array(z.string()).default([]),
  error: z.record(z.unknown()).optional(),
  started_at: isoDateTimeSchema.optional(),
  finished_at: isoDateTimeSchema.optional(),
});

export type RevisionRunType = z.infer<typeof revisionRunTypeSchema>;
export type RevisionRunStatus = z.infer<typeof revisionRunStatusSchema>;
export type RevisionRun = z.infer<typeof revisionRunSchema>;
export type AgentStep = z.infer<typeof agentStepSchema>;
```

- [x] **Step 4: Implement DraftVersion**

Create `packages/contracts/src/revision/draft.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const draftVersionStatusSchema = z.enum(["generated", "in_review", "accepted", "exported"]);

export const draftVersionSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  run_id: z.string().min(1),
  pack_id: z.string().min(1),
  status: draftVersionStatusSchema,
  summary: z.string(),
  applied_proposal_ids: z.array(z.string()).default([]),
  unresolved_issue_ids: z.array(z.string()).default([]),
  render_projection_id: z.string().optional(),
  variant_type: z.enum(["base", "opportunity"]).default("base"),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type DraftVersionStatus = z.infer<typeof draftVersionStatusSchema>;
export type DraftVersion = z.infer<typeof draftVersionSchema>;
```

- [x] **Step 5: Implement render and export schemas**

Create `packages/contracts/src/revision/render.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const layoutWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "blocking"]),
  target_module_id: z.string().optional(),
});

export const renderProjectionSchema = z.object({
  id: z.string().min(1),
  draft_id: z.string().min(1),
  render_profile: z.string().min(1),
  html: z.string().optional(),
  doc_json: z.unknown().optional(),
  layout_warnings: z.array(layoutWarningSchema).default([]),
  created_at: isoDateTimeSchema,
});

export const exportArtifactSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  draft_id: z.string().min(1),
  format: z.enum(["pdf", "html", "markdown", "docx"]),
  file_path: z.string().optional(),
  review_status: z.enum(["passed", "forced_with_risk", "blocked"]),
  created_at: isoDateTimeSchema,
});

export type LayoutWarning = z.infer<typeof layoutWarningSchema>;
export type RenderProjection = z.infer<typeof renderProjectionSchema>;
export type ExportArtifact = z.infer<typeof exportArtifactSchema>;
```

- [x] **Step 6: Implement WorkspaceView**

Create `packages/contracts/src/revision/workspace-view.ts`:

```ts
import { z } from "zod";
import { revisionTargetSchema } from "../shared";
import { documentSchema } from "./document";
import { documentClaimSchema } from "./claim";
import { documentModuleSchema } from "./module";
import { draftVersionSchema } from "./draft";
import { evidenceLinkSchema } from "./evidence";
import { renderProjectionSchema } from "./render";
import { revisionActionSchema, revisionIssueSchema } from "./issue";
import { revisionProposalSchema } from "./proposal";
import { revisionRunStatusSchema } from "./run";
import { sourceDocumentSummarySchema } from "./source";

export const qualityGateResultSchema = z.object({
  status: z.enum(["unknown", "needs_review", "ready", "blocked"]),
  blocking_issue_ids: z.array(z.string()).default([]),
  warning_issue_ids: z.array(z.string()).default([]),
});

export const revisionRunStatusSummarySchema = z.object({
  run_id: z.string().min(1),
  status: revisionRunStatusSchema,
  current_step: z.string().optional(),
});

export const coachSummarySchema = z.object({
  summary: z.string(),
  next_action_ids: z.array(z.string()).default([]),
});

export const contextualActionSchema = revisionActionSchema.extend({
  target: revisionTargetSchema.optional(),
});

export const workspaceViewSchema = z.object({
  document: documentSchema,
  current_draft: draftVersionSchema.optional(),
  modules: z.array(documentModuleSchema).default([]),
  claims: z.array(documentClaimSchema).default([]),
  issues: z.array(revisionIssueSchema).default([]),
  proposals: z.array(revisionProposalSchema).default([]),
  evidence: z.array(evidenceLinkSchema).default([]),
  source_summaries: z.array(sourceDocumentSummarySchema).default([]),
  render_projection: renderProjectionSchema.optional(),
  quality_gate: qualityGateResultSchema.optional(),
  run_status: revisionRunStatusSummarySchema.optional(),
  coach_summary: coachSummarySchema.optional(),
  available_actions: z.array(contextualActionSchema).default([]),
});

export type QualityGateResult = z.infer<typeof qualityGateResultSchema>;
export type RevisionRunStatusSummary = z.infer<typeof revisionRunStatusSummarySchema>;
export type CoachSummary = z.infer<typeof coachSummarySchema>;
export type ContextualAction = z.infer<typeof contextualActionSchema>;
export type WorkspaceView = z.infer<typeof workspaceViewSchema>;
```

- [x] **Step 7: Export run, draft, render, workspace schemas**

Update `packages/contracts/src/index.ts`:

```ts
export * from "./shared";
export * from "./legacy/resume-version";
export * from "./legacy/template-style";
export * from "./revision/document";
export * from "./revision/source";
export * from "./revision/module";
export * from "./revision/claim";
export * from "./revision/evidence";
export * from "./revision/issue";
export * from "./revision/proposal";
export * from "./revision/run";
export * from "./revision/draft";
export * from "./revision/render";
export * from "./revision/workspace-view";
```

- [x] **Step 8: Run tests and build**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
corepack pnpm --filter @typedance/contracts build
```

Expected:

```text
PASS contracts tests.
No TypeScript errors.
```

- [x] **Step 9: Commit**

```bash
git add packages/contracts/src packages/contracts/tests/contracts.test.ts
git commit -m "feat(contracts): 新增运行草稿与工作台契约"
```

---

## Task 5: Add Document Pack and Resume Pack Schemas

**Files:**
- Create: `packages/contracts/src/packs/document-pack.ts`
- Create: `packages/contracts/src/packs/resume-pack.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

- [x] **Step 1: Write failing tests for pack schemas**

Append to `packages/contracts/tests/contracts.test.ts`:

```ts
import {
  documentPackSchema,
  resumePackDefinition,
  resumePackSchema,
} from "../src/index";

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
```

- [x] **Step 2: Run tests to verify failure**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
```

Expected:

```text
FAIL because documentPackSchema, resumePackSchema, and resumePackDefinition are not exported.
```

- [x] **Step 3: Implement generic DocumentPack schema**

Create `packages/contracts/src/packs/document-pack.ts`:

```ts
import { z } from "zod";

export const moduleSpecSchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1),
  required: z.boolean().default(false),
  repeatable: z.boolean().default(false),
  default_visibility: z.enum(["visible", "hidden"]).default("visible"),
});

export const issueTypeSpecSchema = z.object({
  type: z.string().min(1),
  default_severity: z.enum(["info", "warning", "blocking"]),
  title: z.string().min(1),
});

export const actionSpecSchema = z.object({
  action_type: z.string().min(1),
  label: z.string().min(1),
  creates_run_type: z.string().optional(),
});

export const qualityRuleSchema = z.object({
  id: z.string().min(1),
  description: z.string().min(1),
  severity: z.enum(["info", "warning", "blocking"]),
});

export const evidenceRuleSchema = z.object({
  id: z.string().min(1),
  claim_type: z.string().min(1),
  requires_evidence: z.boolean(),
  requires_user_confirmation_when_missing: z.boolean(),
});

export const agentContractSchema = z.object({
  agent_name: z.string().min(1),
  input_schema: z.string().min(1),
  output_schema: z.string().min(1),
});

export const renderMappingSchema = z.object({
  default_profile: z.string().min(1),
  supported_profiles: z.array(z.string()).default([]),
});

export const documentPackSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  modules: z.array(moduleSpecSchema),
  issue_types: z.array(issueTypeSpecSchema),
  actions: z.array(actionSpecSchema),
  quality_rules: z.array(qualityRuleSchema),
  evidence_rules: z.array(evidenceRuleSchema),
  agent_contracts: z.array(agentContractSchema),
  render_mapping: renderMappingSchema,
});

export type ModuleSpec = z.infer<typeof moduleSpecSchema>;
export type IssueTypeSpec = z.infer<typeof issueTypeSpecSchema>;
export type ActionSpec = z.infer<typeof actionSpecSchema>;
export type QualityRule = z.infer<typeof qualityRuleSchema>;
export type EvidenceRule = z.infer<typeof evidenceRuleSchema>;
export type AgentContract = z.infer<typeof agentContractSchema>;
export type RenderMapping = z.infer<typeof renderMappingSchema>;
export type DocumentPack = z.infer<typeof documentPackSchema>;
```

- [x] **Step 4: Implement ResumePack schema and definition**

Create `packages/contracts/src/packs/resume-pack.ts`:

```ts
import { z } from "zod";
import { documentPackSchema } from "./document-pack";

export const resumePackSchema = documentPackSchema.extend({
  id: z.literal("resume"),
});

export const resumePackDefinition = {
  id: "resume",
  version: "0.1.0",
  modules: [
    { type: "BasicInfo", title: "基本信息", required: true, repeatable: false, default_visibility: "visible" },
    { type: "CareerSummary", title: "职业摘要", required: false, repeatable: false, default_visibility: "visible" },
    { type: "JobIntent", title: "求职意向", required: false, repeatable: false, default_visibility: "hidden" },
    { type: "CoreSkills", title: "核心技能", required: false, repeatable: false, default_visibility: "visible" },
    { type: "WorkExperience", title: "工作经历", required: false, repeatable: true, default_visibility: "visible" },
    { type: "ProjectExperience", title: "项目经历", required: false, repeatable: true, default_visibility: "visible" },
    { type: "Education", title: "教育经历", required: false, repeatable: true, default_visibility: "visible" },
    { type: "InternshipExperience", title: "实习经历", required: false, repeatable: true, default_visibility: "visible" },
    { type: "Certificates", title: "证书", required: false, repeatable: true, default_visibility: "visible" },
    { type: "Awards", title: "荣誉奖项", required: false, repeatable: true, default_visibility: "visible" },
    { type: "Portfolio", title: "作品链接", required: false, repeatable: true, default_visibility: "visible" },
    { type: "SelfEvaluation", title: "自我评价", required: false, repeatable: false, default_visibility: "hidden" },
    { type: "CustomModule", title: "自定义模块", required: false, repeatable: true, default_visibility: "visible" },
  ],
  issue_types: [
    { type: "missing_info", default_severity: "warning", title: "信息缺失" },
    { type: "vague_expression", default_severity: "warning", title: "表达空泛" },
    { type: "missing_result", default_severity: "warning", title: "缺少结果" },
    { type: "missing_evidence", default_severity: "blocking", title: "缺少证据" },
    { type: "timeline_conflict", default_severity: "blocking", title: "时间线异常" },
    { type: "skill_without_support", default_severity: "warning", title: "技能缺少经历支撑" },
    { type: "duplicate_content", default_severity: "info", title: "内容重复" },
    { type: "too_long", default_severity: "warning", title: "篇幅过长" },
    { type: "tone_inconsistent", default_severity: "info", title: "语言风格不统一" },
    { type: "hr_unfriendly", default_severity: "warning", title: "HR 阅读不友好" },
    { type: "overclaim_risk", default_severity: "blocking", title: "夸大风险" },
    { type: "layout_risk", default_severity: "warning", title: "排版风险" },
  ],
  actions: [
    { action_type: "accept_proposal", label: "接受修改" },
    { action_type: "reject_proposal", label: "保留原文" },
    { action_type: "request_user_input", label: "补充事实", creates_run_type: "issue_action" },
    { action_type: "make_more_conservative", label: "改得更保守", creates_run_type: "issue_action" },
    { action_type: "make_more_specific", label: "改得更具体", creates_run_type: "issue_action" },
    { action_type: "view_source", label: "查看来源" },
    { action_type: "dismiss_issue", label: "忽略问题" },
    { action_type: "confirm_claim", label: "确认真实" },
  ],
  quality_rules: [
    { id: "resume_contact_required", description: "简历必须包含姓名和至少一种联系方式。", severity: "blocking" },
    { id: "resume_strong_claim_evidence", description: "强成果主张必须有关联证据或用户确认。", severity: "blocking" },
    { id: "resume_vague_expression", description: "核心经历不应只有空泛职责描述。", severity: "warning" },
  ],
  evidence_rules: [
    { id: "achievement_requires_evidence", claim_type: "achievement", requires_evidence: true, requires_user_confirmation_when_missing: true },
    { id: "skill_prefers_evidence", claim_type: "skill", requires_evidence: true, requires_user_confirmation_when_missing: false },
    { id: "summary_requires_support", claim_type: "summary", requires_evidence: true, requires_user_confirmation_when_missing: true },
  ],
  agent_contracts: [
    { agent_name: "ParserAgent", input_schema: "SourceDocument", output_schema: "ParsedDocumentOutput" },
    { agent_name: "ResumeStructurer", input_schema: "ParsedBlock[]", output_schema: "StructuredResumeOutput" },
    { agent_name: "ResumeReviewer", input_schema: "DraftVersion", output_schema: "ResumeReviewOutput" },
    { agent_name: "ResumeRewriter", input_schema: "RevisionIssue", output_schema: "ResumeRewriteOutput" },
    { agent_name: "EvidenceVerifier", input_schema: "DocumentClaim[]", output_schema: "EvidenceVerificationOutput" },
    { agent_name: "OpportunityCalibrator", input_schema: "OpportunityContext", output_schema: "OpportunityCalibrationOutput" },
    { agent_name: "RenderPlanner", input_schema: "DraftVersion", output_schema: "RenderPlanOutput" },
    { agent_name: "CoachNarrator", input_schema: "WorkspaceView", output_schema: "CoachNarrationOutput" },
  ],
  render_mapping: {
    default_profile: "default-a4",
    supported_profiles: ["default-a4", "compact-a4", "ats"],
  },
} satisfies z.input<typeof resumePackSchema>;

export type ResumePack = z.infer<typeof resumePackSchema>;
```

- [x] **Step 5: Export pack schemas**

Update `packages/contracts/src/index.ts`:

```ts
export * from "./shared";
export * from "./legacy/resume-version";
export * from "./legacy/template-style";
export * from "./revision/document";
export * from "./revision/source";
export * from "./revision/module";
export * from "./revision/claim";
export * from "./revision/evidence";
export * from "./revision/issue";
export * from "./revision/proposal";
export * from "./revision/run";
export * from "./revision/draft";
export * from "./revision/render";
export * from "./revision/workspace-view";
export * from "./packs/document-pack";
export * from "./packs/resume-pack";
```

- [x] **Step 6: Run tests and build**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
corepack pnpm --filter @typedance/contracts build
```

Expected:

```text
PASS contracts tests.
No TypeScript errors.
```

- [x] **Step 7: Commit**

```bash
git add packages/contracts/src packages/contracts/tests/contracts.test.ts
git commit -m "feat(contracts): 新增文档包与简历包契约"
```

---

## Task 6: Add Regression Tests for AI-native Guardrails

**Files:**
- Modify: `packages/contracts/tests/contracts.test.ts`
- Modify: `docs/product/target-work-package-map.md`

- [x] **Step 1: Add guardrail tests**

Append to `packages/contracts/tests/contracts.test.ts`:

```ts
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
```

- [x] **Step 2: Run tests**

Run:

```bash
corepack pnpm --filter @typedance/contracts test
```

Expected:

```text
PASS all contracts tests.
```

- [x] **Step 3: Run repo-level tests that depend on contracts**

Run:

```bash
corepack pnpm --filter @typedance/resume-renderer test
corepack pnpm --filter @typedance/web test
```

Expected:

```text
PASS resume-renderer tests.
PASS web tests.
```

- [x] **Step 4: Update target work package map with implementation status note**

In `docs/product/target-work-package-map.md`, under `## 2. WP1 Contracts`, append:

```md
实现入口：

- `packages/contracts/src/shared.ts`
- `packages/contracts/src/legacy/*`
- `packages/contracts/src/revision/*`
- `packages/contracts/src/packs/*`

完成后，`ResumeVersion` 应只作为 legacy projection 保留；新系统的事实源从 `Document`、`DraftVersion`、`RevisionIssue`、`RevisionProposal`、`EvidenceLink` 和 `WorkspaceView` 开始。
```

- [x] **Step 5: Run final build**

Run:

```bash
corepack pnpm --filter @typedance/contracts build
corepack pnpm --filter @typedance/resume-renderer build
corepack pnpm --filter @typedance/web build
```

Expected:

```text
No TypeScript build errors.
```

- [x] **Step 6: Commit**

```bash
git add packages/contracts/src packages/contracts/tests/contracts.test.ts docs/product/target-work-package-map.md
git commit -m "test(contracts): 补充 AI-native 契约防退化测试"
```

---

## Self-Review

**Spec coverage:**

- WP1 要求的 `Document`、`SourceDocument`、`ParsedBlock`、`DraftVersion`、`DocumentModule`、`DocumentClaim`、`EvidenceLink`、`RevisionIssue`、`RevisionProposal`、`RevisionRun`、`AgentStep`、`RenderProjection`、`WorkspaceView`、`ExportArtifact`、`DocumentPack`、`ResumePack` 均有任务覆盖。
- `ResumeVersion` 作为 legacy projection 保留在 Task 1 和 Task 6。
- TypeScript zod schema 和类型导出由每个任务中的测试与 build 覆盖。
- Python Pydantic model 不在本计划内，明确留给 WP2/WP3 之后。

**Placeholder scan:**

- 本计划不包含 `TBD`、`TODO`、`implement later`。
- 每个代码修改步骤都给出具体代码。
- 每个测试步骤都给出命令和期望结果。

**Type consistency:**

- `WorkspaceView` 使用前面任务定义的 `Document`、`DraftVersion`、`DocumentModule`、`DocumentClaim`、`RevisionIssue`、`RevisionProposal`、`EvidenceLink`、`RenderProjection`。
- `revisionTargetSchema` 在 `shared.ts` 中定义，并被 `RevisionIssue`、`RevisionProposal`、`WorkspaceView` 复用。
- `resumePackDefinition` 的 action type 与 `revisionActionSchema` 中的常用动作保持一致。
