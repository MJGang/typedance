from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

from typedance_sidecar.models import TemplateStyleConfig
from typedance_sidecar.revision_export import RevisionExportService
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import (
    EvidenceService,
    InvalidSourceResumeCanvasError,
    IssueService,
    ProposalService,
    RenderService,
    RevisionServiceError,
    WorkspaceService,
)


RepositoryFactory = Callable[[], RevisionRepository]


def dump_model(model: Any) -> dict[str, Any]:
    return model.model_dump(mode="json")


class ResumeMcpTools:
    """Business-only Resume Pack tools exposed to the TS Harness through MCP."""

    def __init__(
        self,
        repository_factory: RepositoryFactory,
        *,
        export_dir_factory: Callable[[], Path] | None = None,
    ) -> None:
        self.repository_factory = repository_factory
        self.export_dir_factory = export_dir_factory or (lambda: Path.home() / ".typedance" / "files" / "exports")

    def get_document(self, document_id: str) -> dict[str, Any]:
        document = self.repository_factory().get_document(document_id)
        if document is None:
            raise ValueError(f"Document not found: {document_id}")
        return dump_model(document)

    def get_workspace_view(self, document_id: str) -> dict[str, Any]:
        try:
            return dump_model(WorkspaceService(self.repository_factory()).get_workspace_view(document_id))
        except RevisionServiceError as exc:
            raise ValueError(str(exc)) from exc

    def save_source_resume_canvas(self, document_id: str, doc_json: dict[str, Any]) -> dict[str, Any]:
        try:
            return dump_model(
                WorkspaceService(self.repository_factory()).save_source_resume_canvas_document(
                    document_id,
                    doc_json,
                )
            )
        except (InvalidSourceResumeCanvasError, RevisionServiceError) as exc:
            raise ValueError(str(exc)) from exc

    def accept_proposal(self, proposal_id: str) -> dict[str, Any]:
        try:
            return dump_model(ProposalService(self.repository_factory()).accept_proposal(proposal_id))
        except RevisionServiceError as exc:
            raise ValueError(str(exc)) from exc

    def reject_proposal(self, proposal_id: str) -> dict[str, Any]:
        try:
            return dump_model(ProposalService(self.repository_factory()).reject_proposal(proposal_id))
        except RevisionServiceError as exc:
            raise ValueError(str(exc)) from exc

    def dismiss_issue(self, issue_id: str) -> dict[str, Any]:
        try:
            return dump_model(IssueService(self.repository_factory()).dismiss_issue(issue_id))
        except RevisionServiceError as exc:
            raise ValueError(str(exc)) from exc

    def confirm_claim(
        self,
        document_id: str,
        claim_id: str,
        *,
        confirmation_type: Literal["truth_confirmed", "risk_accepted", "source_verified"] = "truth_confirmed",
        evidence_link_id: str | None = None,
        issue_id: str | None = None,
        note: str | None = None,
    ) -> dict[str, Any]:
        return dump_model(
            EvidenceService(self.repository_factory()).confirm_claim(
                document_id,
                claim_id,
                confirmation_type=confirmation_type,
                evidence_link_id=evidence_link_id,
                issue_id=issue_id,
                note=note,
            )
        )

    def confirm_evidence_link(self, evidence_link_id: str) -> dict[str, Any]:
        try:
            return dump_model(EvidenceService(self.repository_factory()).confirm_evidence_link(evidence_link_id))
        except RevisionServiceError as exc:
            raise ValueError(str(exc)) from exc

    def render_draft(self, draft_id: str, render_profile: str | None = None) -> dict[str, Any]:
        try:
            return dump_model(
                RenderService(self.repository_factory()).build_projection_for_draft(
                    draft_id,
                    render_profile=render_profile,
                )
            )
        except RevisionServiceError as exc:
            raise ValueError(str(exc)) from exc

    def export_document(
        self,
        document_id: str,
        export_format: Literal["pdf", "html"],
        *,
        output_path: str | None = None,
        source_doc_json: dict[str, Any] | None = None,
        page_margins: dict[str, float] | None = None,
        template_style: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        try:
            artifact = RevisionExportService(
                self.repository_factory(),
                output_dir=self.export_dir_factory(),
            ).export_document(
                document_id,
                export_format,
                output_path=Path(output_path) if output_path else None,
                source_doc_json=source_doc_json,
                page_margins=page_margins,
                template_style=TemplateStyleConfig.model_validate(template_style) if template_style else None,
            )
            return dump_model(artifact)
        except RevisionServiceError as exc:
            raise ValueError(str(exc)) from exc
