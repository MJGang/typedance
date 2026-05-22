import re
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, Field

from .resume_agent_outputs import ParsedBlockDraft, ParsedDocumentOutput
from .revision_agent_runtime import AgentInvocationContext


CONTACT_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
CONTACT_PHONE_RE = re.compile(r"(?:\+?86[- ]?)?1[3-9]\d{9}")
DATE_RANGE_RE = re.compile(r"\d{4}[./-]\d{1,2}\s*[-至]\s*(?:\d{4}[./-]\d{1,2}|至今|现在)")

SECTION_ALIASES: list[tuple[tuple[str, ...], str, str]] = [
    (("工作经历", "工作经验", "实习经历", "任职经历"), "WorkExperience", "工作经历"),
    (("项目经历", "项目经验", "项目"), "ProjectExperience", "项目经历"),
    (("专业技能", "相关技能", "技能", "技能清单"), "CoreSkills", "专业技能"),
    (("教育经历", "教育背景", "学历"), "Education", "教育经历"),
    (("自我评价", "个人评价", "个人总结"), "SelfEvaluation", "自我评价"),
    (("求职意向", "职业意向"), "JobIntent", "求职意向"),
]


class ResumeParserRunRequest(BaseModel):
    source_document_id: str = Field(min_length=1)
    raw_text: str | None = None


ResumeParserRunner = Callable[[AgentInvocationContext, ResumeParserRunRequest], dict[str, Any]]


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
