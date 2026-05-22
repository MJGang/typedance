import re
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field

from .resume_agent_outputs import DocumentClaimDraft, DocumentModuleDraft, StructuredResumeOutput
from .revision_agent_runtime import AgentInvocationContext
from .revision_models import ParsedBlock


SECTION_ALIASES: list[tuple[tuple[str, ...], str, str]] = [
    (("工作经历", "工作经验", "实习经历", "任职经历"), "WorkExperience", "工作经历"),
    (("项目经历", "项目经验", "项目"), "ProjectExperience", "项目经历"),
    (("专业技能", "相关技能", "技能", "技能清单"), "CoreSkills", "专业技能"),
    (("教育经历", "教育背景", "学历"), "Education", "教育经历"),
    (("自我评价", "个人评价", "个人总结"), "SelfEvaluation", "自我评价"),
    (("求职意向", "职业意向"), "JobIntent", "求职意向"),
]
CONTACT_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
CONTACT_PHONE_RE = re.compile(r"(?:\+?86[- ]?)?1[3-9]\d{9}")
DATE_RANGE_RE = re.compile(r"\d{4}[./-]\d{1,2}\s*[-至]\s*(?:\d{4}[./-]\d{1,2}|至今|现在)")


@dataclass
class StructuredSection:
    module_type: str
    title: str
    blocks: list[ParsedBlock]


class ResumeStructurerRunRequest(BaseModel):
    document_title: str = Field(min_length=1)
    pack_id: str = Field(min_length=1)
    parsed_blocks: list[ParsedBlock] = Field(default_factory=list)


ResumeStructurerRunner = Callable[[AgentInvocationContext, ResumeStructurerRunRequest], dict[str, Any]]


class RuleBasedResumeStructurerRunner:
    def __call__(
        self,
        context: AgentInvocationContext,
        request: ResumeStructurerRunRequest,
    ) -> dict[str, Any]:
        modules = _build_module_drafts(request)
        claims = _build_claim_drafts(modules, request.parsed_blocks)
        output = StructuredResumeOutput(
            modules=modules,
            claims=claims,
            unresolved_blocks=[],
            structure_warnings=[],
        )
        return {
            "invocation_id": context.invocation_id,
            "run_id": context.run_id,
            "document_id": context.document_id,
            "pack_id": context.pack_id,
            "agent_name": context.agent_name,
            "output_type": "StructuredResumeOutput",
            "confidence": 0.86,
            "warnings": [],
            "payload": output.model_dump(),
            "output_refs": [],
        }


def _build_module_drafts(request: ResumeStructurerRunRequest) -> list[DocumentModuleDraft]:
    modules = [
        DocumentModuleDraft(
            temp_id="module_basic_info",
            type="BasicInfo",
            title="基本信息",
            order=0,
            visibility="visible",
            status="needs_confirmation",
            data=_basic_info_data(request.document_title, request.parsed_blocks),
            source_block_refs=[block.id for block in request.parsed_blocks if block.type == "contact"],
            confidence=0.82,
        )
    ]

    sections = _sections(request.parsed_blocks)
    for index, section in enumerate(sections, start=1):
        modules.append(
            DocumentModuleDraft(
                temp_id=f"module_{index}_{section.module_type}",
                type=section.module_type,
                title=section.title,
                order=index,
                visibility="visible",
                status="needs_review" if section.module_type != "CoreSkills" else "needs_confirmation",
                data=_module_data(section),
                source_block_refs=[block.id for block in section.blocks],
                confidence=0.8,
            )
        )

    if len(modules) == 1:
        imported_blocks = [block for block in request.parsed_blocks if block.type != "contact"]
        modules.append(
            DocumentModuleDraft(
                temp_id="module_imported_content",
                type="ImportedContent",
                title="导入内容",
                order=1,
                visibility="visible",
                status="needs_review",
                data={"items": [block.text for block in imported_blocks]},
                source_block_refs=[block.id for block in imported_blocks],
                confidence=0.68,
            )
        )

    return modules


def _build_claim_drafts(
    modules: list[DocumentModuleDraft],
    parsed_blocks: list[ParsedBlock],
) -> list[DocumentClaimDraft]:
    block_by_text = {block.text.lstrip("-*•· ").strip(): block for block in parsed_blocks}
    claims: list[DocumentClaimDraft] = []
    for module in modules:
        if module.type == "BasicInfo":
            continue

        for text in _claim_texts(module):
            block = block_by_text.get(text)
            claims.append(
                DocumentClaimDraft(
                    module_temp_id=module.temp_id,
                    text=text,
                    claim_type=_claim_type(module.type),
                    source_block_refs=[block.id] if block else [],
                    confidence="supported" if block else "inferred",
                )
            )

    return claims


def _basic_info_data(document_title: str, blocks: list[ParsedBlock]) -> dict[str, object]:
    text = "\n".join(block.text for block in blocks)
    name = next(
        (
            block.text
            for block in blocks
            if block.type == "paragraph"
            and len(block.text) <= 12
            and _section_for(block.text) is None
        ),
        document_title,
    )
    return {
        "name": name,
        "headline": "候选人简历",
        "phone": _first_match(CONTACT_PHONE_RE, text),
        "email": _first_match(CONTACT_EMAIL_RE, text),
    }


def _first_match(pattern: re.Pattern[str], text: str) -> str | None:
    match = pattern.search(text)
    return match.group(0) if match else None


def _sections(blocks: list[ParsedBlock]) -> list[StructuredSection]:
    sections: list[StructuredSection] = []
    current: StructuredSection | None = None
    for block in blocks:
        section = _section_for(block.text)
        if section is not None:
            current = StructuredSection(module_type=section[0], title=section[1], blocks=[])
            sections.append(current)
            continue
        if block.type == "contact":
            continue
        if current is not None:
            current.blocks.append(block)

    return [section for section in sections if section.blocks]


def _section_for(text: str) -> tuple[str, str] | None:
    normalized = text.strip().rstrip(":：")
    for aliases, module_type, title in SECTION_ALIASES:
        if normalized in aliases:
            return module_type, title
    return None


def _module_data(section: StructuredSection) -> dict[str, object]:
    if section.module_type == "CoreSkills":
        skills = [
            skill
            for block in section.blocks
            for skill in re.split(r"[、,，;\s]+", block.text)
            if skill
        ]
        return {"items": skills}

    return {"items": _experience_items(section.blocks)}


def _experience_items(blocks: list[ParsedBlock]) -> list[dict[str, object]]:
    items: list[dict[str, object]] = []
    current: dict[str, object] | None = None

    for block in blocks:
        text = block.text.lstrip("-*•·").strip()
        if not text:
            continue

        if current is None or _looks_like_item_heading(text):
            current = _item_from_heading(text)
            items.append(current)
            continue

        bullets = current.setdefault("bullets", [])
        if isinstance(bullets, list):
            bullets.append(text)

    return items


def _looks_like_item_heading(text: str) -> bool:
    return bool(DATE_RANGE_RE.search(text) or " / " in text or len(text) <= 18)


def _item_from_heading(text: str) -> dict[str, object]:
    parts = [part.strip() for part in text.split("/") if part.strip()]
    if len(parts) >= 3:
        return {"role": parts[0], "company": parts[1], "time_range": parts[2], "bullets": []}
    if len(parts) == 2:
        return {"title": parts[0], "organization": parts[1], "bullets": []}
    return {"title": text, "bullets": []}


def _claim_texts(module: DocumentModuleDraft) -> list[str]:
    texts: list[str] = []
    items = module.data.get("items")
    if not isinstance(items, list):
        return texts

    for item in items:
        if isinstance(item, str):
            texts.append(item)
            continue
        if not isinstance(item, dict):
            continue
        for key in ("title", "role", "company", "organization", "description"):
            value = item.get(key)
            if isinstance(value, str) and value:
                texts.append(value)
        bullets = item.get("bullets")
        if isinstance(bullets, list):
            texts.extend(bullet for bullet in bullets if isinstance(bullet, str) and bullet)

    return texts


def _claim_type(module_type: str) -> str:
    return {
        "CoreSkills": "skill",
        "Education": "education",
        "SelfEvaluation": "summary",
        "JobIntent": "intent",
    }.get(module_type, "responsibility")
