# WP10 Revision Workspace Web 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Web 前端新增 AI-native Revision Workspace 的只读入口，开始消费 WP8/WP9 的 `WorkspaceView`。

**Architecture:** 先扩展 `apps/web/src/api.ts` 支持 Revision API，再新增 `RevisionWorkspacePage`。页面主数据来自 `WorkspaceView`，不是聊天框，也不直接拼 Agent 输出；布局采用大屏双栏、小屏单栏，左侧为草稿/模块视图，右侧为 coach summary、可执行动作、问题和建议列表。

**Tech Stack:** React, React Router, TypeScript, shadcn/ui, Tailwind CSS, Vitest.

---

## File Structure

新增：

- `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
  - AI-native 工作台只读入口。
- `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
  - 页面状态与渲染测试。

修改：

- `apps/web/src/api.ts`
  - Revision API client。
- `apps/web/src/api.test.ts`
  - Revision API client 测试。
- `apps/web/src/router.tsx`
  - 新增 `/revision/:documentId` 路由。
- `docs/README.md`
  - 登记 WP10 计划。

## Task 1: API Client

- [x] 新增 `createRevisionDocument()`。
- [x] 新增 `getRevisionWorkspaceView()`。
- [x] 新增 `renderRevisionDraft()`。
- [x] 新增 `acceptRevisionDraft()`。
- [x] 新增 `dismissRevisionIssue()`。
- [x] 新增 `acceptRevisionProposal()` / `rejectRevisionProposal()`。
- [x] 新增 `confirmRevisionClaim()` / `confirmEvidenceLink()`。

## Task 2: Page

- [x] 用 `useEffect` 拉取 WorkspaceView，并按 React 官方建议在 cleanup 中忽略过期请求。
- [x] 显示 loading / error / empty states。
- [x] 左侧显示 render projection 或模块列表。
- [x] 右侧显示 coach summary、quality gate、available actions、issues、proposals。
- [x] 小屏自动单栏，不强行三栏。

## Task 3: Tests

- [x] 测试 API client URL、method、schema parse。
- [x] 测试页面 loading 后渲染 WorkspaceView。
- [x] 测试 action 按钮调用对应 API 并刷新。
- [x] 运行：

```bash
corepack pnpm --filter @typedance/web test
corepack pnpm test
```

## Completion

提交：

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp10-revision-workspace-web.md apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/router.tsx apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
git commit -m "feat(web): 新增 Revision Workspace 入口"
```
