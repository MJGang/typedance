# WP6 Resume Agent 输出契约实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Resume Pack 的核心 Agent 建立 Pydantic 输出契约，让真实模型接入前先拥有可校验的结构化边界。

**Architecture:** 新增 `resume_agent_outputs.py`，定义 Parser、Structurer、Reviewer、Rewriter、Evidence Verifier、Opportunity Calibrator、Render Planner、Coach Narrator 的输出模型，并提供注册函数接入 WP5 `AgentSchemaRegistry`。本工作包只定义输出契约，不调用模型、不生成真实内容、不写数据库。

**Tech Stack:** Python 3.14 runtime, Pydantic v2, pytest.

---

## File Structure

新增：

- `services/sidecar/src/typedance_sidecar/resume_agent_outputs.py`
  - Resume Agent 输出模型和 registry 注册函数。
- `services/sidecar/tests/test_resume_agent_outputs.py`
  - 输出模型和注册验证。

修改：

- `docs/README.md`
  - 登记 WP6 计划。

## Task 1: Parser and Structurer Outputs

- [ ] 定义 `ParsedBlockDraft`。
- [ ] 定义 `ParsedDocumentOutput`。
- [ ] 定义 `DocumentModuleDraft`。
- [ ] 定义 `DocumentClaimDraft`。
- [ ] 定义 `StructuredResumeOutput`。

## Task 2: Reviewer and Rewriter Outputs

- [ ] 定义 `RevisionTarget`。
- [ ] 定义 `RevisionActionTemplate`。
- [ ] 定义 `RevisionIssueDraft`。
- [ ] 定义 `QualitySummary` 和 `ResumeReviewOutput`。
- [ ] 定义 `UserInputRequest`、`RevisionProposalDraft` 和 `ResumeRewriteOutput`。

## Task 3: Evidence, Opportunity, Render, Coach Outputs

- [ ] 定义 `EvidenceLinkDraft`、`ClaimConfidenceUpdate`、`EvidenceVerificationOutput`。
- [ ] 定义 `OpportunityRequirement`、`MatchSummary`、`DraftVariantPlan`、`OpportunityCalibrationOutput`。
- [ ] 定义 `LayoutWarning`、`RenderProjectionDraft`、`RenderPlanOutput`。
- [ ] 定义 `ContextualAction`、`CoachNarrationOutput`。

## Task 4: Registry and Tests

- [ ] 实现 `resume_agent_output_schemas()`。
- [ ] 实现 `register_resume_agent_output_schemas(registry)`。
- [ ] 测试每个 output type 都能注册。
- [ ] 测试 `AgentSchemaRegistry` 能验证典型 Parser / Reviewer / Rewriter / Coach 输出。
- [ ] 测试非法 confidence 被 schema 拒绝。
- [ ] 运行：

```bash
corepack pnpm --filter @typedance/sidecar test -- tests/test_resume_agent_outputs.py
corepack pnpm --filter @typedance/sidecar test
corepack pnpm test
```

## Completion

提交：

```bash
git add docs/README.md docs/superpowers/plans/2026-05-21-wp6-resume-agent-outputs.md services/sidecar/src/typedance_sidecar/resume_agent_outputs.py services/sidecar/tests/test_resume_agent_outputs.py
git commit -m "feat(sidecar): 新增 Resume Agent 输出契约"
```
