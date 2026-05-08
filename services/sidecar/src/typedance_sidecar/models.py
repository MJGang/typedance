from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


Language = Literal["zh-CN", "en-US"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class ResumeVersionCreate(BaseModel):
    title: str = Field(min_length=1)
    target_language: Language = "zh-CN"
    template_id: str = "classic-a4"
    doc_json: dict[str, Any] = Field(default_factory=lambda: {"type": "doc", "content": []})
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
