from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


Language = Literal["zh-CN", "en-US"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_doc_json() -> dict[str, Any]:
    return {"type": "doc", "content": []}


class LocalizedText(BaseModel):
    zh_cn: str = Field(alias="zh-CN")
    en_us: str = Field(alias="en-US")


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


class TemplateStyleSlot(BaseModel):
    label: LocalizedText
    class_name: str = ""
    allowed_class_groups: list[str] = Field(default_factory=list)


class TemplateStyleConfig(BaseModel):
    template_id: str = Field(min_length=1)
    slots: dict[str, TemplateStyleSlot] = Field(default_factory=dict)
    updated_at: str = Field(default_factory=utc_now)


class PdfClassPolicyGroup(BaseModel):
    label: LocalizedText
    allowlist: list[str] = Field(default_factory=list)
    blocklist: list[str] = Field(default_factory=list)


class PdfClassPolicy(BaseModel):
    allowlist: list[str] = Field(default_factory=list)
    blocklist: list[str] = Field(default_factory=list)
    groups: dict[str, PdfClassPolicyGroup] = Field(default_factory=dict)
    updated_at: str = Field(default_factory=utc_now)


class PdfClassValidationError(BaseModel):
    slot: str
    class_name: str
    reason: Literal["blocked", "not_allowed"]
