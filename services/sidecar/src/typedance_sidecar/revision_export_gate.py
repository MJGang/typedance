from collections.abc import Callable
from pathlib import Path
from uuid import uuid4

from .models import utc_now
from .pdf import render_html_to_pdf
from .revision_models import DraftVersion, ExportArtifact, RevisionIssue
from .revision_render_projection import DraftProjectionBuilder, RenderProjectionError
from .revision_repository import RevisionRepository
from .revision_services import OPEN_ISSUE_STATUSES, RevisionServiceError


PdfRenderer = Callable[[str, Path], Path]


class RevisionExportBlockedError(RevisionServiceError):
    def __init__(
        self,
        message: str,
        *,
        artifact: ExportArtifact,
        blocking_issue_ids: list[str],
        warning_issue_ids: list[str],
    ) -> None:
        super().__init__(message)
        self.artifact = artifact
        self.blocking_issue_ids = blocking_issue_ids
        self.warning_issue_ids = warning_issue_ids


class RevisionExportGateService:
    def __init__(
        self,
        repository: RevisionRepository,
        *,
        output_dir: Path | None = None,
        pdf_renderer: PdfRenderer | None = None,
        projection_builder: DraftProjectionBuilder | None = None,
    ) -> None:
        self.repository = repository
        self.output_dir = output_dir
        self.pdf_renderer = pdf_renderer or render_html_to_pdf
        self.projection_builder = projection_builder or DraftProjectionBuilder()

    def export_pdf(
        self,
        draft_id: str,
        *,
        output_path: Path | None = None,
        force_with_risk: bool = False,
    ) -> ExportArtifact:
        draft = self._require_draft(draft_id)
        document = self.repository.get_document(draft.document_id)
        if document is None:
            raise RevisionServiceError(f"Document not found: {draft.document_id}")

        blocking_issues, warning_issues = self._open_export_issues(draft.id)
        if blocking_issues:
            artifact = self._save_blocked_artifact(draft)
            raise RevisionExportBlockedError(
                "Export blocked by unresolved issues.",
                artifact=artifact,
                blocking_issue_ids=[issue.id for issue in blocking_issues],
                warning_issue_ids=[issue.id for issue in warning_issues],
            )

        if warning_issues and not force_with_risk:
            artifact = self._save_blocked_artifact(draft)
            raise RevisionExportBlockedError(
                "Export requires explicit risk acknowledgement.",
                artifact=artifact,
                blocking_issue_ids=[],
                warning_issue_ids=[issue.id for issue in warning_issues],
            )

        projection = self._projection_for_export(draft)
        html = projection.html
        if not html:
            raise RevisionServiceError(f"Draft has no renderable HTML projection: {draft.id}")

        pdf_path = self._resolve_output_path(draft.id, output_path)
        self.pdf_renderer(html, pdf_path)
        artifact = ExportArtifact(
            id=f"export_{uuid4().hex}",
            document_id=draft.document_id,
            draft_id=draft.id,
            format="pdf",
            file_path=str(pdf_path),
            review_status="forced_with_risk" if warning_issues else "passed",
            created_at=utc_now(),
        )
        saved_artifact = self.repository.save_export_artifact(artifact)
        latest_draft = self.repository.get_draft_version(draft.id) or draft
        self.repository.save_draft_version(
            latest_draft.model_copy(update={"status": "exported", "updated_at": utc_now()})
        )
        return saved_artifact

    def _require_draft(self, draft_id: str) -> DraftVersion:
        draft = self.repository.get_draft_version(draft_id)
        if draft is None:
            raise RevisionServiceError(f"Draft not found: {draft_id}")
        return draft

    def _open_export_issues(self, draft_id: str) -> tuple[list[RevisionIssue], list[RevisionIssue]]:
        issues = [
            issue
            for issue in self.repository.list_revision_issues(draft_id)
            if issue.status in OPEN_ISSUE_STATUSES
        ]
        blocking_issues = [issue for issue in issues if issue.severity == "blocking"]
        warning_issues = [issue for issue in issues if issue.severity in {"warning", "info"}]
        return blocking_issues, warning_issues

    def _projection_for_export(self, draft: DraftVersion):
        if draft.render_projection_id:
            projection = self.repository.get_render_projection(draft.render_projection_id)
            if projection is not None:
                return projection

        modules = self.repository.list_document_modules(draft.id)
        try:
            projection = self.projection_builder.build(draft, modules, render_profile="default-a4")
        except RenderProjectionError as exc:
            raise RevisionServiceError(str(exc)) from exc

        self.repository.save_render_projection(projection)
        self.repository.save_draft_version(
            draft.model_copy(update={"render_projection_id": projection.id, "updated_at": utc_now()})
        )
        return projection

    def _resolve_output_path(self, draft_id: str, output_path: Path | None) -> Path:
        if output_path is not None:
            pdf_path = output_path.expanduser()
            if pdf_path.suffix.lower() != ".pdf":
                pdf_path = pdf_path.with_suffix(".pdf")
            pdf_path.parent.mkdir(parents=True, exist_ok=True)
            return pdf_path

        output_dir = self.output_dir or (Path.home() / ".typedance" / "files" / "exports")
        output_dir.mkdir(parents=True, exist_ok=True)
        return output_dir / f"{draft_id}-{uuid4().hex}.pdf"

    def _save_blocked_artifact(self, draft: DraftVersion) -> ExportArtifact:
        artifact = ExportArtifact(
            id=f"export_{uuid4().hex}",
            document_id=draft.document_id,
            draft_id=draft.id,
            format="pdf",
            file_path=None,
            review_status="blocked",
            created_at=utc_now(),
        )
        return self.repository.save_export_artifact(artifact)
