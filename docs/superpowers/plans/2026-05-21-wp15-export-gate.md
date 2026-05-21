# WP15 Export Gate 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Revision Workspace 的导出从“直接下载 PDF”升级为“导出前门禁”：检查当前 Draft、打开的问题卡、渲染投影和用户风险确认，成功导出时写入可追溯 `ExportArtifact`。

**Architecture:** 后端新增 `RevisionExportGateService`，消费 Draft、Issue、RenderProjection 并输出 PDF。阻塞问题会阻止导出并记录 blocked artifact；提醒问题需要显式 `force_with_risk` 才能导出，并记录 `forced_with_risk`。前端新增导出门禁弹窗，不把导出藏成普通下载按钮。

## Files

- `services/sidecar/src/typedance_sidecar/pdf.py`
  - 新增从 Revision RenderProjection HTML 直接生成 PDF 的 helper。
- `services/sidecar/src/typedance_sidecar/revision_export_gate.py`
  - 新增导出门禁服务。
- `services/sidecar/src/typedance_sidecar/revision_api.py`
  - 新增 `POST /drafts/{draft_id}/export/pdf`。
- `services/sidecar/src/typedance_sidecar/main.py`
  - 将导出目录注入 Revision API，并暴露导出相关响应头。
- `services/sidecar/tests/test_revision_export_gate.py`
  - 覆盖通过、阻塞、带风险导出。
- `services/sidecar/tests/test_revision_api.py`
  - 覆盖 Revision Draft PDF 导出接口。
- `services/sidecar/tests/test_pdf_export.py`
  - 覆盖 HTML 投影导出 PDF helper。
- `apps/web/src/api.ts`
  - 新增 `exportRevisionDraftPdf()`。
- `apps/web/src/features/revision/ExportGateModal.tsx`
  - 新增导出门禁弹窗。
- `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
  - 新增导出入口。
- `apps/web/src/features/revision/*.test.tsx`
  - 覆盖导出门禁交互。
- `docs/README.md`
  - 登记 WP15 计划。

## Task 1: 后端导出门禁

- [ ] 新增 `RevisionExportGateService.export_pdf(draft_id, force_with_risk, output_path)`。
- [ ] 打开 blocking issue 时阻止导出，保存 `ExportArtifact(review_status="blocked")`。
- [ ] 打开 warning/info issue 且未显式确认风险时阻止导出。
- [ ] 显式确认风险时允许导出，保存 `ExportArtifact(review_status="forced_with_risk")`。
- [ ] 无打开问题时保存 `ExportArtifact(review_status="passed")`。
- [ ] 没有 RenderProjection 时基于 Draft 自动补建默认 A4 投影。

## Task 2: Revision API 导出接口

- [ ] 新增 `POST /drafts/{draft_id}/export/pdf`。
- [ ] 支持 `output_path` 和 `force_with_risk`。
- [ ] 成功返回 PDF 文件，并通过响应头返回文件路径、artifact id 和 review status。
- [ ] 门禁失败返回 409 和具体 issue id。

## Task 3: 前端导出门禁体验

- [ ] `api.ts` 新增 `exportRevisionDraftPdf()`。
- [ ] Revision Workspace 顶部新增导出入口。
- [ ] 导出前展示门禁弹窗：阻塞问题、建议问题、风险说明和导出动作。
- [ ] 阻塞状态禁止导出；建议状态允许用户显式带风险导出。

## Verification

- [ ] `pytest services/sidecar/tests/test_revision_export_gate.py services/sidecar/tests/test_revision_api.py services/sidecar/tests/test_pdf_export.py -q`
- [ ] `corepack pnpm --filter @typedance/web test`
- [ ] `corepack pnpm --filter @typedance/web build`
- [ ] `corepack pnpm test`

## Commit

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp15-export-gate.md services/sidecar/src/typedance_sidecar/pdf.py services/sidecar/src/typedance_sidecar/revision_export_gate.py services/sidecar/src/typedance_sidecar/revision_api.py services/sidecar/src/typedance_sidecar/main.py services/sidecar/tests/test_revision_export_gate.py services/sidecar/tests/test_revision_api.py services/sidecar/tests/test_pdf_export.py apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/features/revision/ExportGateModal.tsx apps/web/src/features/revision/ExportGateModal.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
git commit -m "feat(revision): 新增导出门禁流程"
```
