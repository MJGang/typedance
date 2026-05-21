# WP17 Test System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用测试和少量服务层策略保护 Revision Engine 不退化成富文本编辑器加 AI 聊天框。

**Architecture:** 新增集中式 AI-native guardrail 测试，覆盖 Agent 输出信封、Proposal 应用、Draft 接受策略和 WorkspaceView 完整性。服务层只补齐测试暴露出的最小策略：接受 Proposal 时更新结构化 Claim，接受 Draft 时阻止未确认强主张进入 accepted 状态。

**Tech Stack:** Python 3.14, Pydantic v2, SQLite, pytest, Vitest.

---

## File Structure

- `services/sidecar/tests/test_revision_ai_native_guardrails.py`
  - 新增 sidecar 防退化测试。
- `services/sidecar/src/typedance_sidecar/revision_services.py`
  - 补齐 Proposal 应用和 Draft 接受策略。
- `docs/superpowers/plans/2026-05-21-wp17-test-system.md`
  - 本实施计划。
- `docs/README.md`
  - 登记 WP17 计划。

## Task 1: Agent Output Guardrail

- [x] 写测试：Agent runner 返回普通字符串时，`AgentRuntime` 必须记录 `failed_schema`，不能把自然语言直接当结构化输出。
- [x] 运行测试，确认失败或确认已有 runtime 行为被测试锁住。
- [x] 若失败原因不是 schema guardrail，则修正测试或 runtime。

## Task 2: Proposal Application Guardrail

- [x] 写测试：接受 `replace_claim` Proposal 后，目标 `DocumentClaim.text` 必须变成 `proposed_snapshot.text`。
- [x] 写测试：接受 `replace_claim` Proposal 后，目标 Module item 必须同步更新，旧 `RenderProjection` 必须失效。
- [x] 写测试：Draft 必须记录 `applied_proposal_ids`，相关 Issue 必须关闭。
- [x] 运行测试，确认当前服务层没有真正更新 Claim。
- [x] 实现 `ProposalService` 的 `replace_claim` 应用逻辑。

## Task 3: Strong Claim Acceptance Guardrail

- [x] 写测试：`achievement` Claim 在缺少直接证据或用户确认时，`DraftService.accept_draft()` 必须阻止接受。
- [x] 写测试：同一 Claim 在有 `direct` evidence 或 `user_confirmed` evidence 后可以接受。
- [x] 运行测试，确认当前服务层没有阻止未确认强主张。
- [x] 实现 Draft 接受前的强主张策略检查。

## Task 4: WorkspaceView Completeness Guardrail

- [x] 写测试：WorkspaceView 必须同时暴露 Issue、Proposal、Evidence 和可执行动作。
- [x] 运行测试，确认聚合视图保持 AI-native 工作台所需对象。

## Verification

- [x] `pytest services/sidecar/tests/test_revision_ai_native_guardrails.py -q`
- [x] `pytest services/sidecar/tests/test_revision_services.py services/sidecar/tests/test_revision_agent_runtime.py -q`
- [x] `corepack pnpm --filter @typedance/contracts test`
- [x] `corepack pnpm --filter @typedance/web test`
- [x] `corepack pnpm test`
- [x] `corepack pnpm --filter @typedance/web build`

## Commit

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp17-test-system.md services/sidecar/src/typedance_sidecar/revision_services.py services/sidecar/tests/test_revision_ai_native_guardrails.py
git commit -m "test(revision): 补充 AI-native 防退化测试"
```
