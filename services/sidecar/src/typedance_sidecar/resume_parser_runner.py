import json
import os
import re
from collections.abc import Callable, Mapping
from typing import Any, Literal

from pydantic import BaseModel, Field

from .llm_provider import (
    build_chat_model,
    has_configured_llm_api_key,
    structured_output_system_instruction,
    with_typedance_structured_output,
)
from .model_settings import ModelSettingsError, resolve_model_settings
from .resume_agent_outputs import ParsedBlockDraft, ParsedDocumentOutput
from .revision_agent_runtime import AgentInvocationContext


CONTACT_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
CONTACT_PHONE_RE = re.compile(r"(?:\+?86[- ]?)?1[3-9]\d{9}")
DATE_RANGE_RE = re.compile(r"\d{4}[./-]\d{1,2}\s*[-至]\s*(?:\d{4}[./-]\d{1,2}|至今|现在)")

SECTION_ALIASES: list[tuple[tuple[str, ...], str, str]] = [
    (("工作经历", "工作经验", "实习经历", "任职经历"), "WorkExperience", "工作经历"),
    (("项目经历", "项目经验", "项目"), "ProjectExperience", "项目经历"),
    (("专业技能", "职业技能", "相关技能", "技能", "技能清单"), "CoreSkills", "专业技能"),
    (("教育经历", "教育背景", "学历"), "Education", "教育经历"),
    (("自我评价", "个人评价", "个人总结"), "SelfEvaluation", "自我评价"),
    (("求职意向", "职业意向"), "JobIntent", "求职意向"),
]


class ResumeParserRunRequest(BaseModel):
    source_document_id: str = Field(min_length=1)
    raw_text: str | None = None


ResumeParserMode = Literal["rule", "langchain", "auto"]
ResumeParserRunner = Callable[[AgentInvocationContext, ResumeParserRunRequest], dict[str, Any]]


class ResumeParserRunnerConfig(BaseModel):
    mode: ResumeParserMode = "rule"


class RuleBasedResumeParserRunner:
    def __call__(
        self,
        context: AgentInvocationContext,
        request: ResumeParserRunRequest,
    ) -> dict[str, Any]:
        output = ParsedDocumentOutput(
            source_document_id=request.source_document_id,
            blocks=_parse_blocks(request.raw_text),
            detected_language="zh-CN",
            parse_warnings=[],
        )
        return {
            "invocation_id": context.invocation_id,
            "run_id": context.run_id,
            "document_id": context.document_id,
            "pack_id": context.pack_id,
            "agent_name": context.agent_name,
            "output_type": "ParsedDocumentOutput",
            "confidence": 0.9,
            "warnings": [],
            "payload": output.model_dump(),
            "output_refs": [],
        }


class LangChainResumeParserRunner:
    def __init__(self, model_factory: Callable[[], Any] = build_chat_model) -> None:
        self.model_factory = model_factory

    def __call__(
        self,
        context: AgentInvocationContext,
        request: ResumeParserRunRequest,
    ) -> dict[str, Any]:
        model = self.model_factory()
        structured_model = with_typedance_structured_output(model, ParsedDocumentOutput)
        raw_output = structured_model.invoke(_messages(context, request))
        output = _coerce_parser_output(raw_output)
        return {
            "invocation_id": context.invocation_id,
            "run_id": context.run_id,
            "document_id": context.document_id,
            "pack_id": context.pack_id,
            "agent_name": context.agent_name,
            "output_type": "ParsedDocumentOutput",
            "confidence": 0.9,
            "warnings": [],
            "payload": output.model_dump(),
            "output_refs": [],
        }


def load_resume_parser_runner_config(
    environ: Mapping[str, str] | None = None,
) -> ResumeParserRunnerConfig:
    env = environ if environ is not None else os.environ
    try:
        mode = resolve_model_settings(environ=env).agents.parser
    except ModelSettingsError:
        mode = env.get("TYPEDANCE_RESUME_PARSER_MODE", "rule").strip().lower()
    if mode in {"rules", "deterministic", "local"}:
        mode = "rule"
    if mode not in {"rule", "langchain", "auto"}:
        raise ValueError(f"Unsupported resume parser runner mode: {mode}")
    return ResumeParserRunnerConfig(mode=mode)


def build_resume_parser_runner(
    environ: Mapping[str, str] | None = None,
    *,
    model_factory: Callable[[], Any] | None = None,
) -> ResumeParserRunner:
    env = environ if environ is not None else os.environ
    config = load_resume_parser_runner_config(env)
    if config.mode == "rule":
        return RuleBasedResumeParserRunner()
    if config.mode == "auto" and not has_configured_llm_api_key(env):
        return RuleBasedResumeParserRunner()

    factory = model_factory or (lambda: build_chat_model(environ=env))
    return LangChainResumeParserRunner(model_factory=factory)


def _messages(
    context: AgentInvocationContext,
    request: ResumeParserRunRequest,
) -> list[dict[str, str]]:
    payload = {
        "run_type": "import_reconstruct",
        "document_id": context.document_id,
        "source_document_id": request.source_document_id,
        "raw_text": request.raw_text,
    }
    return [
        {
            "role": "system",
            "content": (
                "你是 TypeDance 的 SourceParser。只输出 ParsedDocumentOutput 结构化结果。"
                f"{structured_output_system_instruction(ParsedDocumentOutput)}"
                "你只负责解析和切块，不要重写、润色、补充用户经历。"
                "保留原文顺序，并为每个 block 标注 type、text、order、source_span 和 confidence。"
            ),
        },
        {
            "role": "user",
            "content": json.dumps(payload, ensure_ascii=False),
        },
    ]


def _coerce_parser_output(raw_output: Any) -> ParsedDocumentOutput:
    if isinstance(raw_output, ParsedDocumentOutput):
        return raw_output
    if isinstance(raw_output, BaseModel):
        return ParsedDocumentOutput.model_validate(raw_output.model_dump())
    return ParsedDocumentOutput.model_validate(raw_output)


def _parse_blocks(raw_text: str | None) -> list[ParsedBlockDraft]:
    lines = [line.strip() for line in (raw_text or "").splitlines() if line.strip()]
    return [
        ParsedBlockDraft(
            type=_block_type(line),
            text=line,
            order=index,
            source_span={"line": index},
            confidence=0.9,
        )
        for index, line in enumerate(lines)
    ]


def _block_type(text: str) -> str:
    if _section_for(text) is not None:
        return "heading"
    if CONTACT_EMAIL_RE.search(text) or CONTACT_PHONE_RE.search(text):
        return "contact"
    if DATE_RANGE_RE.search(text):
        return "date_range"
    if text.startswith(("-", "*", "•", "·")):
        return "list"
    return "paragraph"


def _section_for(text: str) -> tuple[str, str] | None:
    normalized = text.strip().rstrip(":：")
    for aliases, module_type, title in SECTION_ALIASES:
        if normalized in aliases:
            return module_type, title
    return None
