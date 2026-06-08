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
MARKDOWN_HEADING_RE = re.compile(r"^\s*#{1,6}\s+(.+?)\s*#*\s*$")
MARKDOWN_LIST_MARKER_RE = re.compile(r"^\s*(?:[-*+•·]|\d+[.)])\s+")
MARKDOWN_QUOTE_RE = re.compile(r"^\s*>+\s*")
MARKDOWN_THEMATIC_BREAK_RE = re.compile(r"^\s*([-*_])(?:\s*\1){2,}\s*$")

SECTION_ALIASES: list[tuple[tuple[str, ...], str, str]] = [
    (("工作经历", "工作经验", "实习经历", "任职经历"), "WorkExperience", "工作经历"),
    (("项目经历", "项目经验", "项目"), "ProjectExperience", "项目经历"),
    (("核心能力", "专业技能", "职业技能", "相关技能", "技能", "技能清单"), "CoreSkills", "专业技能"),
    (("教育经历", "教育背景", "学历"), "Education", "教育经历"),
    (("自我评价", "个人评价", "个人总结"), "SelfEvaluation", "自我评价"),
    (("求职意向", "职业意向"), "JobIntent", "求职意向"),
]


class ResumeParserRunRequest(BaseModel):
    source_document_id: str = Field(min_length=1)
    source_canvas_id: str = Field(min_length=1)
    source_canvas_version: int = Field(ge=1)
    source_canvas_doc_json: dict[str, Any]


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
            blocks=_parse_blocks(request),
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
        output = _restore_source_canvas_spans(output, _parse_blocks(request))
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
        "source_canvas_id": request.source_canvas_id,
        "source_canvas_version": request.source_canvas_version,
        "source_canvas_doc_json": request.source_canvas_doc_json,
    }
    return [
        {
            "role": "system",
            "content": (
                "你是 TypeDance 的 SourceParser。只输出 ParsedDocumentOutput 结构化结果。"
                f"{structured_output_system_instruction(ParsedDocumentOutput)}"
                "source_canvas_doc_json 是唯一的简历正文来源，不要使用或推测其他来源。"
                "遇到带 attrs.canvasNodeId 的节点时，必须把它写入 source_span.canvas_node_id；"
                "遇到 attrs.sourceBlockId 时，必须把它写入 source_span.source_block_id。"
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


def _restore_source_canvas_spans(
    output: ParsedDocumentOutput,
    canonical_blocks: list[ParsedBlockDraft],
) -> ParsedDocumentOutput:
    canonical_by_order = sorted(canonical_blocks, key=lambda block: block.order)
    used_indexes: set[int] = set()
    restored_blocks: list[ParsedBlockDraft] = []

    for block in output.blocks:
        canonical_index = _matching_canonical_index(block, canonical_by_order, used_indexes)
        if canonical_index is None:
            restored_blocks.append(block)
            continue
        used_indexes.add(canonical_index)
        canonical_span = canonical_by_order[canonical_index].source_span
        restored_blocks.append(
            block.model_copy(update={"source_span": {**block.source_span, **canonical_span}})
        )

    return output.model_copy(update={"blocks": restored_blocks})


def _matching_canonical_index(
    block: ParsedBlockDraft,
    canonical_blocks: list[ParsedBlockDraft],
    used_indexes: set[int],
) -> int | None:
    if (
        block.order < len(canonical_blocks)
        and block.order not in used_indexes
        and _normalize_block_text(block.text) == _normalize_block_text(canonical_blocks[block.order].text)
    ):
        return block.order

    block_text = _normalize_block_text(block.text)
    for index, canonical in enumerate(canonical_blocks):
        if index in used_indexes:
            continue
        if _normalize_block_text(canonical.text) == block_text:
            return index
    return None


def _parse_blocks(request: ResumeParserRunRequest) -> list[ParsedBlockDraft]:
    blocks: list[ParsedBlockDraft] = []

    def append_block(
        node: dict[str, Any],
        block_type: str,
        text: str,
        *,
        fallback_attrs: Any = None,
    ) -> None:
        normalized_text = text.strip()
        if not normalized_text:
            return
        attrs = _merged_attrs(fallback_attrs, node.get("attrs"))
        source_span: dict[str, Any] = {
            "source_canvas_id": request.source_canvas_id,
            "source_canvas_version": request.source_canvas_version,
        }
        canvas_node_id = attrs.get("canvasNodeId")
        source_block_id = attrs.get("sourceBlockId")
        if isinstance(canvas_node_id, str) and canvas_node_id:
            source_span["canvas_node_id"] = canvas_node_id
        if isinstance(source_block_id, str) and source_block_id:
            source_span["source_block_id"] = source_block_id
        blocks.append(
            ParsedBlockDraft(
                type=block_type,
                text=normalized_text,
                order=len(blocks),
                source_span=source_span,
                confidence=0.9,
            )
        )

    def visit(
        value: Any,
        *,
        inside_list_item: bool = False,
        inherited_attrs: Any = None,
    ) -> None:
        if isinstance(value, list):
            for item in value:
                visit(
                    item,
                    inside_list_item=inside_list_item,
                    inherited_attrs=inherited_attrs,
                )
            return
        if not isinstance(value, dict):
            return

        node_type = value.get("type")
        content = value.get("content")
        if node_type == "listItem":
            append_block(value, "list", _list_item_text(value), fallback_attrs=inherited_attrs)
            if isinstance(content, list):
                for child in content:
                    if isinstance(child, dict) and child.get("type") not in {"paragraph", "heading"}:
                        visit(
                            child,
                            inside_list_item=True,
                            inherited_attrs=inherited_attrs,
                        )
            return
        if node_type == "heading":
            append_block(value, "heading", _extract_text(value), fallback_attrs=inherited_attrs)
            return
        if node_type == "paragraph" and not inside_list_item:
            append_block(
                value,
                _block_type(_extract_text(value)),
                _extract_text(value),
                fallback_attrs=inherited_attrs,
            )
            return
        if node_type == "tableCell":
            cell_attrs = _merged_attrs(inherited_attrs, value.get("attrs"))
            if isinstance(content, list):
                for child in content:
                    visit(
                        child,
                        inside_list_item=inside_list_item,
                        inherited_attrs=cell_attrs,
                    )
            return

        if isinstance(content, list):
            for child in content:
                visit(child, inside_list_item=inside_list_item, inherited_attrs=inherited_attrs)

    visit(request.source_canvas_doc_json)
    return blocks


def _merged_attrs(fallback_attrs: Any, node_attrs: Any) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    if isinstance(fallback_attrs, dict):
        merged.update(fallback_attrs)
    if isinstance(node_attrs, dict):
        merged.update(node_attrs)
    return merged


def _list_item_text(value: dict[str, Any]) -> str:
    content = value.get("content")
    if not isinstance(content, list):
        return _extract_text(value)
    direct_text = "".join(
        _extract_text(child)
        for child in content
        if isinstance(child, dict) and child.get("type") in {"paragraph", "heading"}
    )
    return direct_text or _extract_text(value)


def _extract_text(value: Any) -> str:
    if isinstance(value, list):
        return "".join(_extract_text(item) for item in value)
    if not isinstance(value, dict):
        return ""

    text = value.get("text")
    content = value.get("content")
    content_text = _extract_text(content) if isinstance(content, list) else ""
    if isinstance(text, str):
        return text + content_text
    return content_text


def _block_type(text: str) -> str:
    if MARKDOWN_HEADING_RE.match(text):
        return "heading"
    if _section_for(text) is not None:
        return "heading"
    if CONTACT_EMAIL_RE.search(text) or CONTACT_PHONE_RE.search(text):
        return "contact"
    if DATE_RANGE_RE.search(text):
        return "date_range"
    if MARKDOWN_THEMATIC_BREAK_RE.match(text):
        return "paragraph"
    if text.startswith(("-", "*", "•", "·")):
        return "list"
    return "paragraph"


def _normalize_block_text(text: str) -> str:
    heading_match = MARKDOWN_HEADING_RE.match(text)
    normalized = heading_match.group(1) if heading_match else text
    normalized = MARKDOWN_QUOTE_RE.sub("", normalized)
    normalized = MARKDOWN_LIST_MARKER_RE.sub("", normalized)
    normalized = normalized.replace("**", "").replace("__", "")
    return re.sub(r"\s+", "", normalized)


def _section_for(text: str) -> tuple[str, str] | None:
    heading_match = MARKDOWN_HEADING_RE.match(text)
    normalized = (heading_match.group(1) if heading_match else text).strip().rstrip(":：")
    for aliases, module_type, title in SECTION_ALIASES:
        if normalized in aliases:
            return module_type, title
    return None
