import json
import os
from collections.abc import Callable, Mapping
from typing import Any, Literal

from pydantic import BaseModel, Field

from .llm_provider import build_chat_model, has_configured_llm_api_key
from .model_settings import ModelSettingsError, resolve_model_settings
from .resume_agent_outputs import ResumeRewriteOutput, RevisionProposalDraft
from .revision_agent_runtime import AgentInvocationContext
from .revision_models import RiskLevel


class ResumeRewriterRunRequest(BaseModel):
    proposal_id: str = Field(min_length=1)
    issue_id: str = Field(min_length=1)
    issue_type: str = Field(min_length=1)
    issue_title: str = Field(min_length=1)
    issue_message: str = Field(min_length=1)
    issue_reason: str = Field(min_length=1)
    target: dict[str, str] = Field(default_factory=dict)
    user_intent: str = Field(min_length=1)
    evidence_link_ids: list[str] = Field(default_factory=list)
    risk_level: RiskLevel = "medium"
    original_text: str | None = None


ResumeRewriterMode = Literal["rule", "langchain", "auto"]
ResumeRewriterRunner = Callable[[AgentInvocationContext, ResumeRewriterRunRequest], dict[str, Any]]


class ResumeRewriterRunnerConfig(BaseModel):
    mode: ResumeRewriterMode = "rule"


class RuleBasedResumeRewriterRunner:
    def __call__(
        self,
        context: AgentInvocationContext,
        request: ResumeRewriterRunRequest,
    ) -> dict[str, Any]:
        proposal = _rule_based_proposal(request)
        return _envelope(context, request, ResumeRewriteOutput(proposals=[proposal], follow_up_questions=[]))


class LangChainResumeRewriterRunner:
    def __init__(self, model_factory: Callable[[], Any] = build_chat_model) -> None:
        self.model_factory = model_factory

    def __call__(
        self,
        context: AgentInvocationContext,
        request: ResumeRewriterRunRequest,
    ) -> dict[str, Any]:
        model = self.model_factory()
        structured_model = model.with_structured_output(ResumeRewriteOutput)
        raw_output = structured_model.invoke(_messages(request))
        output = _coerce_rewrite_output(raw_output)
        return _envelope(context, request, output)


def load_resume_rewriter_runner_config(
    environ: Mapping[str, str] | None = None,
) -> ResumeRewriterRunnerConfig:
    env = environ if environ is not None else os.environ
    try:
        mode = resolve_model_settings(environ=env).agents.rewriter
    except ModelSettingsError:
        mode = env.get("TYPEDANCE_RESUME_REWRITER_MODE", "rule").strip().lower()
    if mode in {"rules", "deterministic", "local"}:
        mode = "rule"
    if mode not in {"rule", "langchain", "auto"}:
        raise ValueError(f"Unsupported resume rewriter runner mode: {mode}")
    return ResumeRewriterRunnerConfig(mode=mode)


def build_resume_rewriter_runner(
    environ: Mapping[str, str] | None = None,
    *,
    model_factory: Callable[[], Any] | None = None,
) -> ResumeRewriterRunner:
    env = environ if environ is not None else os.environ
    config = load_resume_rewriter_runner_config(env)
    if config.mode == "rule":
        return RuleBasedResumeRewriterRunner()
    if config.mode == "auto" and not has_configured_llm_api_key(env):
        return RuleBasedResumeRewriterRunner()

    factory = model_factory or (lambda: build_chat_model(environ=env))
    return LangChainResumeRewriterRunner(model_factory=factory)


def _rule_based_proposal(request: ResumeRewriterRunRequest) -> RevisionProposalDraft:
    proposed_text = _merge_text(request.original_text, request.user_intent)
    return RevisionProposalDraft(
        target=request.target,
        operation="replace_claim" if request.target.get("claim_id") else "update_field",
        before={"text": request.original_text} if request.original_text else None,
        after={"text": proposed_text},
        summary="根据补充事实改写当前问题",
        rationale="用户在问题卡中补充了局部事实，系统据此生成可确认的改稿建议。",
        evidence_link_refs=request.evidence_link_ids,
        confidence=0.86,
        risk_level=request.risk_level,
        requires_user_confirmation=False,
        related_issue_refs=[request.issue_id],
    )


def _messages(request: ResumeRewriterRunRequest) -> list[dict[str, str]]:
    context = {
        "issue": {
            "id": request.issue_id,
            "type": request.issue_type,
            "title": request.issue_title,
            "message": request.issue_message,
            "reason": request.issue_reason,
            "target": request.target,
        },
        "original_text": request.original_text,
        "user_fact": request.user_intent,
        "evidence_link_ids": request.evidence_link_ids,
        "risk_level": request.risk_level,
    }
    return [
        {
            "role": "system",
            "content": (
                "你是 TypeDance 的 ResumeRewriter。只生成 ResumeRewriteOutput 结构化结果。"
                "不要编造用户未提供的事实；数字、结果和影响范围必须来自 user_fact、证据或原文。"
                "输出 Proposal，不要直接改写最终简历。"
            ),
        },
        {
            "role": "user",
            "content": json.dumps(context, ensure_ascii=False),
        },
    ]


def _envelope(
    context: AgentInvocationContext,
    request: ResumeRewriterRunRequest,
    output: ResumeRewriteOutput,
) -> dict[str, Any]:
    return {
        "invocation_id": context.invocation_id,
        "run_id": context.run_id,
        "document_id": context.document_id,
        "pack_id": context.pack_id,
        "agent_name": context.agent_name,
        "output_type": "ResumeRewriteOutput",
        "confidence": _confidence(output),
        "warnings": [],
        "payload": output.model_dump(),
        "output_refs": [f"RevisionProposal:{request.proposal_id}"],
    }


def _coerce_rewrite_output(raw_output: Any) -> ResumeRewriteOutput:
    if isinstance(raw_output, ResumeRewriteOutput):
        return raw_output
    if isinstance(raw_output, BaseModel):
        return ResumeRewriteOutput.model_validate(raw_output.model_dump())
    return ResumeRewriteOutput.model_validate(raw_output)


def _confidence(output: ResumeRewriteOutput) -> float:
    if output.proposals:
        return output.proposals[0].confidence
    return 0


def _merge_text(original_text: str | None, user_intent: str) -> str:
    if not original_text:
        return user_intent
    separator = "" if original_text.endswith(("，", ",", "。", ".", "；", ";")) else "，"
    return f"{original_text}{separator}{user_intent}"
