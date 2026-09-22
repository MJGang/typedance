from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, StringConstraints


Language = Literal["zh-CN", "en-US"]
NonEmptyString = Annotated[str, StringConstraints(min_length=1)]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_doc_json() -> dict[str, Any]:
    return {"type": "doc", "content": []}


class LocalizedText(BaseModel):
    zh_cn: NonEmptyString = Field(alias="zh-CN")
    en_us: NonEmptyString = Field(alias="en-US")


class ResumeVersionCreate(BaseModel):
    title: str = Field(min_length=1)
    target_language: Language = "zh-CN"
    template_id: str = "classic-a4"
    doc_json: dict[str, Any] = Field(default_factory=default_doc_json)
    plain_text_snapshot: str = ""


class ResumeVersionUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    target_language: Language | None = None
    template_id: str | None = Field(default=None, min_length=1)
    doc_json: dict[str, Any] | None = None
    plain_text_snapshot: str | None = None


class ResumeVersion(BaseModel):
    id: str
    title: str
    job_target_id: str | None = None
    target_language: Language
    template_id: str
    doc_json: dict[str, Any]
    plain_text_snapshot: str
    preview_pdf_path: str | None = None
    preview_pdf_url: str | None = None
    source_refs: list[str] = Field(default_factory=list)
    accepted_edit_ids: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str

    @classmethod
    def new(cls, payload: ResumeVersionCreate) -> "ResumeVersion":
        now = utc_now()
        return cls(id=f"resume_{uuid4().hex}", created_at=now, updated_at=now, **payload.model_dump())

    def apply_update(self, payload: ResumeVersionUpdate) -> "ResumeVersion":
        changes = payload.model_dump(exclude_unset=True)
        return self.model_copy(update={**changes, "updated_at": utc_now()})


class TemplateSampleContent(BaseModel):
    id: str = Field(min_length=1)
    name: LocalizedText
    target_language: Language = "zh-CN"
    doc_json: dict[str, Any] = Field(default_factory=default_doc_json)
    plain_text_snapshot: str = ""
    updated_at: str = Field(default_factory=utc_now)


Heading2DecorationStyle = Literal["minimal-line", "accent-wash", "dot-ribbon"]


class TextBlockStyle(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    font_family: str | None = Field(default=None, alias="fontFamily")
    font_size: str | None = Field(default=None, alias="fontSize")
    font_weight: Literal[400, 500, 600, 700] | None = Field(default=None, alias="fontWeight")
    line_height: float | None = Field(default=None, alias="lineHeight", gt=0)
    letter_spacing: str | None = Field(default=None, alias="letterSpacing")
    text_transform: Literal["none", "uppercase", "capitalize"] | None = Field(default=None, alias="textTransform")
    color: str | None = None
    text_align: Literal["left", "center", "right"] | None = Field(default=None, alias="textAlign")
    margin_top: str | None = Field(default=None, alias="marginTop")
    margin_bottom: str | None = Field(default=None, alias="marginBottom")
    list_style_type: Literal["disc", "circle", "square", "decimal", "none"] | None = Field(default=None, alias="listStyleType")
    padding_left: str | None = Field(default=None, alias="paddingLeft")


class BorderBottomStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")

    style: Literal["none", "solid", "double"] = "none"
    width: str | None = None
    color: str | None = None


class BlockStyle(TextBlockStyle):
    """普通块样式；H2 使用不含背景和边框字段的专用模型。"""

    background_color: str | None = Field(default=None, alias="backgroundColor")
    border_bottom: BorderBottomStyle | None = Field(default=None, alias="borderBottom")


class Heading2BlockStyle(TextBlockStyle):
    decoration_style: Heading2DecorationStyle = Field(alias="decorationStyle")


class ThemeStyle(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    accent_color: str = Field(alias="accentColor", pattern=r"^#[0-9A-Fa-f]{6}$")


class TemplateBlocks(BaseModel):
    model_config = ConfigDict(extra="forbid")

    heading1: BlockStyle
    heading2: Heading2BlockStyle
    heading3: BlockStyle
    paragraph: BlockStyle
    bulletList: BlockStyle
    orderedList: BlockStyle


class TemplateStyleConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    template_id: str = Field(min_length=1)
    name: str | None = None
    preset: str
    theme: ThemeStyle
    blocks: TemplateBlocks
    updated_at: str
