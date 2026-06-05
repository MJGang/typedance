import json
from hashlib import sha1

from .db import ResumeRepository, TemplateStyleRepository
from .models import ResumeVersion, utc_now
from .pdf import render_resume_html, resume_lines_for_pdf
from .revision_models import (
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    EvidenceLink,
    RenderProjection,
    RevisionRun,
    SourceDocument,
)
from .revision_repository import RevisionRepository
from .revision_services import RevisionServiceError


class LegacyResumeAdapterService:
    def __init__(
        self,
        revision_repository: RevisionRepository,
        resume_repository: ResumeRepository,
        template_style_repository: TemplateStyleRepository,
    ) -> None:
        self.revision_repository = revision_repository
        self.resume_repository = resume_repository
        self.template_style_repository = template_style_repository

    def project_resume_version(self, resume_id: str) -> Document:
        resume = self.resume_repository.get(resume_id)
        if resume is None:
            raise RevisionServiceError(f"Legacy resume not found: {resume_id}")

        suffix = self._projection_suffix(resume)
        now = utc_now()
        document_id = f"doc_legacy_{resume.id}"
        run_id = f"run_legacy_{resume.id}_{suffix}"
        source_id = f"src_legacy_{resume.id}_{suffix}"
        draft_id = f"draft_legacy_{resume.id}_{suffix}"
        render_id = f"render_legacy_{resume.id}_{suffix}"

        document = Document(
            id=document_id,
            pack_id="resume",
            title=resume.title,
            status="active",
            target_language=resume.target_language,
            current_draft_id=draft_id,
            accepted_draft_id=draft_id,
            created_at=resume.created_at,
            updated_at=now,
        )
        self.revision_repository.save_document(document)

        source = SourceDocument(
            id=source_id,
            document_id=document.id,
            source_type="old_resume",
            title="旧编辑器简历",
            mime_type="application/vnd.typedance.legacy-resume",
            raw_text=resume.plain_text_snapshot or "\n".join(resume_lines_for_pdf(resume)),
            parse_status="recognized",
            created_at=now,
        )
        self.revision_repository.save_source_document(source)

        run = RevisionRun(
            id=run_id,
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="import_reconstruct",
            status="completed",
            source_document_ids=[source.id],
            target_draft_id=draft_id,
            user_intent="从旧编辑器简历生成兼容投影",
            output_summary="旧 ResumeVersion 已投影为 Revision Draft，原始 doc_json 仅作为渲染投影保留。",
            created_at=now,
            updated_at=now,
        )
        self.revision_repository.save_revision_run(run)

        draft = DraftVersion(
            id=draft_id,
            document_id=document.id,
            run_id=run.id,
            pack_id=document.pack_id,
            status="accepted",
            summary="旧简历兼容投影",
            render_projection_id=render_id,
            variant_type="base",
            created_at=now,
            updated_at=now,
        )
        self.revision_repository.save_draft_version(draft)

        modules = self._modules_from_legacy_resume(resume, suffix, draft.id, now)
        for module in modules:
            self.revision_repository.save_document_module(module)

        content_module = next((module for module in modules if module.type == "LegacyContent"), None)
        if content_module is not None:
            for index, line in enumerate(self._content_lines(resume)):
                claim = DocumentClaim(
                    id=f"claim_legacy_{resume.id}_{suffix}_{index}",
                    draft_id=draft.id,
                    module_id=content_module.id,
                    text=line,
                    claim_type="summary",
                    confidence="user_confirmed",
                    item_id=f"legacy_line_{index}",
                    created_at=now,
                    updated_at=now,
                )
                self.revision_repository.save_document_claim(claim)
                self.revision_repository.save_evidence_link(
                    EvidenceLink(
                        id=f"ev_legacy_{resume.id}_{suffix}_{index}",
                        document_id=document.id,
                        source_document_id=source.id,
                        claim_id=claim.id,
                        support_level="direct",
                        confidence=1.0,
                        user_confirmed=True,
                        extracted_text=line,
                        normalized_fact=line,
                        created_at=now,
                    )
                )

        style = self.template_style_repository.get(resume.template_id) if resume.template_id else None
        projection = RenderProjection(
            id=render_id,
            draft_id=draft.id,
            render_profile=f"legacy-{resume.template_id}",
            html=render_resume_html(resume, style),
            doc_json=resume.doc_json,
            layout_warnings=[
                {
                    "code": "legacy_projection",
                    "message": "该预览来自旧编辑器兼容投影，后续改稿应进入结构化 Draft。",
                    "severity": "info",
                }
            ],
            created_at=now,
        )
        self.revision_repository.save_render_projection(projection)
        return document

    def _projection_suffix(self, resume: ResumeVersion) -> str:
        doc_json = json.dumps(resume.doc_json, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        value = ":".join(
            [
                resume.id,
                resume.updated_at,
                resume.template_id,
                resume.title,
                resume.plain_text_snapshot,
                doc_json,
            ]
        )
        return sha1(value.encode("utf-8")).hexdigest()[:10]

    def _modules_from_legacy_resume(
        self,
        resume: ResumeVersion,
        suffix: str,
        draft_id: str,
        now: str,
    ) -> list[DocumentModule]:
        lines = resume_lines_for_pdf(resume)
        name = lines[0] if lines else resume.title
        headline = lines[1] if len(lines) > 1 else ""
        return [
            DocumentModule(
                id=f"mod_legacy_basic_{resume.id}_{suffix}",
                draft_id=draft_id,
                pack_id="resume",
                type="BasicInfo",
                title="基本信息",
                order=0,
                visibility="visible",
                status="needs_review",
                data={"name": name, "headline": headline},
                created_at=now,
                updated_at=now,
            ),
            DocumentModule(
                id=f"mod_legacy_content_{resume.id}_{suffix}",
                draft_id=draft_id,
                pack_id="resume",
                type="LegacyContent",
                title="旧简历内容",
                order=1,
                visibility="visible",
                status="needs_review",
                data={"items": self._content_lines(resume)},
                created_at=now,
                updated_at=now,
            ),
        ]

    def _content_lines(self, resume: ResumeVersion) -> list[str]:
        lines = resume_lines_for_pdf(resume)
        return [line for line in lines[2:] if line] or [resume.plain_text_snapshot or resume.title]
