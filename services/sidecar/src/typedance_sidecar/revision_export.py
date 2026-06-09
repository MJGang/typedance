from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

from .models import ResumeVersion, TemplateStyleConfig, utc_now
from .pdf import PdfPageMargin, render_html_to_pdf, render_resume_html
from .revision_models import Document, DraftVersion, ExportArtifact
from .revision_repository import RevisionRepository
from .revision_services import RevisionServiceError


PdfRenderer = Callable[[str, Path, PdfPageMargin | None], Path]
RevisionExportFormat = Literal["pdf", "html"]


class RevisionExportService:
    def __init__(
        self,
        repository: RevisionRepository,
        *,
        output_dir: Path | None = None,
        pdf_renderer: PdfRenderer | None = None,
    ) -> None:
        self.repository = repository
        self.output_dir = output_dir
        self.pdf_renderer = pdf_renderer or render_html_to_pdf

    def export_pdf(
        self,
        document_id: str,
        *,
        output_path: Path | None = None,
        source_doc_json: dict[str, Any] | None = None,
        page_margins: dict[str, Any] | None = None,
        template_style: TemplateStyleConfig | None = None,
    ) -> ExportArtifact:
        return self.export_document(
            document_id,
            "pdf",
            output_path=output_path,
            source_doc_json=source_doc_json,
            page_margins=page_margins,
            template_style=template_style,
        )

    def export_html(
        self,
        document_id: str,
        *,
        output_path: Path | None = None,
        source_doc_json: dict[str, Any] | None = None,
        page_margins: dict[str, Any] | None = None,
        template_style: TemplateStyleConfig | None = None,
    ) -> ExportArtifact:
        return self.export_document(
            document_id,
            "html",
            output_path=output_path,
            source_doc_json=source_doc_json,
            page_margins=page_margins,
            template_style=template_style,
        )

    def export_document(
        self,
        document_id: str,
        export_format: RevisionExportFormat,
        *,
        output_path: Path | None = None,
        source_doc_json: dict[str, Any] | None = None,
        page_margins: dict[str, Any] | None = None,
        template_style: TemplateStyleConfig | None = None,
    ) -> ExportArtifact:
        document = self._require_document(document_id)
        draft = self._current_draft(document)
        doc_json = source_doc_json or self._source_canvas_doc_json(document.id)
        pdf_page_margin = self._pdf_page_margin(page_margins)
        html = self._render_html(
            document,
            doc_json,
            template_style,
            html_page_margin=pdf_page_margin,
        )

        export_path = self._resolve_output_path(document.id, export_format, output_path)
        if export_format == "pdf":
            self.pdf_renderer(html, export_path, pdf_page_margin)
        else:
            export_path.parent.mkdir(parents=True, exist_ok=True)
            export_path.write_text(html, encoding="utf-8")
        artifact = ExportArtifact(
            id=f"export_{uuid4().hex}",
            document_id=document.id,
            draft_id=draft.id if draft is not None else None,
            format=export_format,
            file_path=str(export_path),
            status="succeeded",
            created_at=utc_now(),
        )
        return self.repository.save_export_artifact(artifact)

    def _require_document(self, document_id: str) -> Document:
        document = self.repository.get_document(document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {document_id}")
        return document

    def _current_draft(self, document: Document) -> DraftVersion | None:
        if document.current_draft_id is not None:
            draft = self.repository.get_draft_version(document.current_draft_id)
            if draft is not None:
                return draft

        drafts = self.repository.list_draft_versions(document.id)
        if drafts:
            return drafts[-1]
        return None

    def _source_canvas_doc_json(self, document_id: str) -> dict[str, Any]:
        canvas = self.repository.get_source_resume_canvas(document_id)
        if canvas is None:
            raise RevisionServiceError(f"Document has no exportable canvas: {document_id}")
        return canvas.doc_json

    def _render_html(
        self,
        document: Document,
        doc_json: dict[str, Any],
        template_style: TemplateStyleConfig | None,
        *,
        html_page_margin: PdfPageMargin | None,
    ) -> str:
        resume = ResumeVersion(
            id=f"revision_export_{document.id}",
            title=document.title,
            target_language=document.target_language,
            template_id=template_style.template_id if template_style is not None else "classic-a4",
            doc_json=doc_json,
            plain_text_snapshot="",
            created_at=utc_now(),
            updated_at=utc_now(),
        )
        return render_resume_html(resume, template_style, html_page_margin=html_page_margin)

    def _resolve_output_path(
        self,
        document_id: str,
        export_format: RevisionExportFormat,
        output_path: Path | None,
    ) -> Path:
        suffix = f".{export_format}"
        if output_path is not None:
            export_path = output_path.expanduser()
            if export_path.suffix.lower() != suffix:
                export_path = export_path.with_suffix(suffix)
            export_path.parent.mkdir(parents=True, exist_ok=True)
            return export_path

        output_dir = self.output_dir or (Path.home() / ".typedance" / "files" / "exports")
        output_dir.mkdir(parents=True, exist_ok=True)
        return output_dir / f"{document_id}-{uuid4().hex}{suffix}"

    def _pdf_page_margin(self, page_margins: dict[str, Any] | None) -> PdfPageMargin | None:
        if page_margins is None:
            return None

        resolved: PdfPageMargin = {}
        for key in ("top", "bottom", "left", "right"):
            value = page_margins.get(key)
            if isinstance(value, int | float) and value >= 0:
                resolved[key] = f"{round(value)}px"
        return resolved if len(resolved) == 4 else None
