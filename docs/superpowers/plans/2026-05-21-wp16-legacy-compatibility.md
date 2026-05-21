# WP16 Legacy Compatibility 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让旧 `ResumeVersion` 资产继续可用，同时把它明确降级为兼容投影，不能再定义新 Revision Workspace 的事实源。

**Architecture:** 新增 `LegacyResumeAdapterService`，读取旧 `ResumeVersion`、旧模板样式和旧 PDF/HTML 渲染链路，生成新的 `Document + DraftVersion + DocumentModule + Claim + Evidence + RenderProjection`。前端保留旧编辑器入口，同时在旧简历卡片菜单提供“用新工作台打开”，让用户可以进入 AI-native 工作台。

## Files

- `services/sidecar/src/typedance_sidecar/revision_legacy_adapter.py`
  - 新增旧简历到 Revision Workspace 的兼容投影服务。
- `services/sidecar/src/typedance_sidecar/main.py`
  - 新增 `POST /legacy/resume-versions/{resume_id}/revision-document`。
- `services/sidecar/tests/test_revision_legacy_adapter.py`
  - 覆盖旧简历投影、旧简历更新后创建新 Draft。
- `services/sidecar/tests/test_resume_versions.py`
  - 覆盖 legacy API 到 Revision Workspace 的集成路径。
- `apps/web/src/api.ts`
  - 新增 `projectLegacyResumeToRevisionWorkspace()`。
- `apps/web/src/features/home/HomePage.tsx`
  - 旧简历卡片菜单接入新工作台投影入口。
- `apps/web/src/features/home/ResumeCard.tsx`
  - 新增“用新工作台打开”菜单项。
- `apps/web/src/features/home/ResumeCard.test.tsx`
  - 覆盖旧简历投影入口。
- `docs/README.md`
  - 登记 WP16 计划。

## Task 1: Legacy ResumeVersion Projection

- [x] 读取旧 `ResumeVersion` 和旧模板样式。
- [x] 生成稳定的 legacy Document id。
- [x] 旧内容变更时生成新的 Draft id，避免旧投影被覆盖。
- [x] 保留原始旧简历文本为 `SourceDocument`。
- [x] 从旧内容生成 BasicInfo / LegacyContent 模块、Claim 和 Evidence。
- [x] 使用旧 renderer 生成 `RenderProjection.html`，并保留原 `doc_json` 为投影。

## Task 2: Legacy API

- [x] 新增 legacy projection API。
- [x] 返回完整 `WorkspaceView`，让前端不再自行拼接兼容对象。
- [x] 找不到旧简历时返回明确 404。

## Task 3: Web Entry

- [x] 旧简历卡片保留打开旧编辑器的默认点击行为。
- [x] 菜单新增“用新工作台打开”。
- [x] 点击后调用 projection API 并进入 `/revision/:documentId`。

## Verification

- [x] `pytest services/sidecar/tests/test_revision_legacy_adapter.py services/sidecar/tests/test_resume_versions.py -q`
- [x] `corepack pnpm --filter @typedance/web test`
- [x] `corepack pnpm --filter @typedance/web build`
- [x] `corepack pnpm test`

## Commit

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp16-legacy-compatibility.md services/sidecar/src/typedance_sidecar/revision_legacy_adapter.py services/sidecar/src/typedance_sidecar/main.py services/sidecar/tests/test_revision_legacy_adapter.py services/sidecar/tests/test_resume_versions.py apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/features/home/HomePage.tsx apps/web/src/features/home/ResumeCard.tsx apps/web/src/features/home/ResumeCard.test.tsx
git commit -m "feat(revision): 新增旧简历兼容投影"
```
