from collections.abc import Callable
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .models import Language, utc_now
from .revision_models import (
    Document,
    DraftVersion,
    EvidenceLink,
    ParsedBlock,
    RenderProjection,
    RevisionIssue,
    RevisionProposal,
    RevisionRun,
    SourceDocument,
    UserConfirmation,
    WorkspaceView,
)
from .revision_blank_guided_flow import RevisionBlankGuidedFlowService
from .revision_import_flow import RevisionImportFlowService
from .revision_render_projection import RenderProjectionError
from .revision_repository import RevisionRepository
from .revision_services import (
    DraftService,
    EvidenceService,
    IssueService,
    ProposalService,
    RenderService,
    RevisionServiceError,
    SourceService,
    WorkspaceService,
)


RepositoryDependency = Callable[[], RevisionRepository]


class CreateDocumentRequest(BaseModel):
    pack_id: str = "resume"
    title: str = Field(min_length=1)
    target_language: Language = "zh-CN"
    initial_mode: Literal[
        "import_old_resume",
        "blank_guided",
        "base_resume",
        "opportunity_variant",
    ] = "base_resume"


class CreateSourceRequest(BaseModel):
    source_type: Literal[
        "old_resume",
        "uploaded_file",
        "pasted_text",
        "manual_user_input",
        "project_material",
        "work_summary",
        "external_context",
    ]
    title: str = Field(min_length=1)
    raw_text: str | None = None
    file_path: str | None = None
    original_uri: str | None = None
    mime_type: str | None = None


class CreateRevisionRunRequest(BaseModel):
    run_type: Literal[
        "import_reconstruct",
        "blank_guided_generate",
        "quality_review",
        "issue_action",
        "module_rewrite",
        "evidence_check",
        "opportunity_calibrate",
        "review_gate",
    ]
    source_document_ids: list[str] = Field(default_factory=list)
    base_draft_id: str | None = None
    user_intent: str | None = None
    selected_module_id: str | None = None
    selected_issue_id: str | None = None
    selected_action_id: str | None = None


class RenderDraftRequest(BaseModel):
    render_profile: str | None = None


class ConfirmClaimRequest(BaseModel):
    document_id: str = Field(min_length=1)
    confirmation_type: Literal["truth_confirmed", "risk_accepted", "source_verified"] = "truth_confirmed"
    evidence_link_id: str | None = None
    issue_id: str | None = None
    note: str | None = None


def create_revision_router(
    repository_dependency: RepositoryDependency,
) -> APIRouter:
    router = APIRouter(tags=["revision"])

    def repository(repo: RevisionRepository = Depends(repository_dependency)) -> RevisionRepository:
        return repo

    def require_document(repo: RevisionRepository, document_id: str) -> Document:
        document = repo.get_document(document_id)
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found")
        return document

    def require_draft(repo: RevisionRepository, draft_id: str) -> DraftVersion:
        draft = repo.get_draft_version(draft_id)
        if draft is None:
            raise HTTPException(status_code=404, detail="Draft not found")
        return draft

    def require_proposal(repo: RevisionRepository, proposal_id: str) -> RevisionProposal:
        proposal = repo.get_revision_proposal(proposal_id)
        if proposal is None:
            raise HTTPException(status_code=404, detail="Proposal not found")
        return proposal

    def require_run(repo: RevisionRepository, run_id: str) -> RevisionRun:
        run = repo.get_revision_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Revision run not found")
        return run

    @router.post("/documents", response_model=Document, status_code=201)
    def create_document(
        payload: CreateDocumentRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> Document:
        now = utc_now()
        document = Document(
            id=f"doc_{uuid4().hex}",
            pack_id=payload.pack_id,
            title=payload.title,
            status="active",
            target_language=payload.target_language,
            created_at=now,
            updated_at=now,
        )
        return repo.save_document(document)

    @router.get("/documents", response_model=list[Document])
    def list_documents(repo: RevisionRepository = Depends(repository)) -> list[Document]:
        return repo.list_documents()

    @router.get("/documents/{document_id}", response_model=Document)
    def get_document(
        document_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> Document:
        return require_document(repo, document_id)

    @router.post("/documents/{document_id}/sources", response_model=SourceDocument, status_code=201)
    def create_source(
        document_id: str,
        payload: CreateSourceRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> SourceDocument:
        require_document(repo, document_id)
        source = SourceDocument(
            id=f"src_{uuid4().hex}",
            document_id=document_id,
            source_type=payload.source_type,
            title=payload.title,
            mime_type=payload.mime_type,
            original_uri=payload.original_uri,
            raw_text=payload.raw_text,
            file_path=payload.file_path,
            parse_status="pending",
            created_at=utc_now(),
        )
        return SourceService(repo).save_source(source)

    @router.get("/documents/{document_id}/sources", response_model=list[SourceDocument])
    def list_sources(
        document_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> list[SourceDocument]:
        require_document(repo, document_id)
        return SourceService(repo).list_sources(document_id)

    @router.get("/sources/{source_id}/parsed-blocks", response_model=list[ParsedBlock])
    def list_parsed_blocks(
        source_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> list[ParsedBlock]:
        return SourceService(repo).list_parsed_blocks(source_id)

    @router.post("/documents/{document_id}/revision-runs", response_model=RevisionRun, status_code=201)
    def create_revision_run(
        document_id: str,
        payload: CreateRevisionRunRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> RevisionRun:
        document = require_document(repo, document_id)
        now = utc_now()
        run = RevisionRun(
            id=f"run_{uuid4().hex}",
            document_id=document_id,
            pack_id=document.pack_id,
            run_type=payload.run_type,
            status="created",
            source_document_ids=payload.source_document_ids,
            base_draft_id=payload.base_draft_id,
            user_intent=payload.user_intent,
            selected_module_id=payload.selected_module_id,
            selected_issue_id=payload.selected_issue_id,
            selected_action_id=payload.selected_action_id,
            created_at=now,
            updated_at=now,
        )
        saved_run = repo.save_revision_run(run)
        try:
            if saved_run.run_type == "import_reconstruct":
                return RevisionImportFlowService(repo).run_import_reconstruct(document_id, saved_run.id)
            if saved_run.run_type == "blank_guided_generate":
                return RevisionBlankGuidedFlowService(repo).run_blank_guided_generate(document_id, saved_run.id)
            return saved_run
        except RevisionServiceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.get("/revision-runs/{run_id}", response_model=RevisionRun)
    def get_revision_run(
        run_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> RevisionRun:
        return require_run(repo, run_id)

    @router.get("/documents/{document_id}/workspace-view", response_model=WorkspaceView)
    def get_workspace_view(
        document_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> WorkspaceView:
        try:
            return WorkspaceService(repo).get_workspace_view(document_id)
        except RevisionServiceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/documents/{document_id}/drafts", response_model=list[DraftVersion])
    def list_drafts(
        document_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> list[DraftVersion]:
        require_document(repo, document_id)
        return repo.list_draft_versions(document_id)

    @router.get("/drafts/{draft_id}", response_model=DraftVersion)
    def get_draft(
        draft_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> DraftVersion:
        return require_draft(repo, draft_id)

    @router.post("/drafts/{draft_id}/render", response_model=RenderProjection, status_code=201)
    def render_draft(
        draft_id: str,
        payload: RenderDraftRequest | None = None,
        repo: RevisionRepository = Depends(repository),
    ) -> RenderProjection:
        try:
            return RenderService(repo).build_projection_for_draft(
                draft_id,
                render_profile=payload.render_profile if payload else None,
            )
        except RevisionServiceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except RenderProjectionError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/drafts/{draft_id}/accept", response_model=DraftVersion)
    def accept_draft(
        draft_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> DraftVersion:
        try:
            return DraftService(repo).accept_draft(draft_id)
        except RevisionServiceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/drafts/{draft_id}/issues", response_model=list[RevisionIssue])
    def list_issues(
        draft_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> list[RevisionIssue]:
        require_draft(repo, draft_id)
        return IssueService(repo).list_issues(draft_id)

    @router.post("/issues/{issue_id}/dismiss", response_model=RevisionIssue)
    def dismiss_issue(
        issue_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> RevisionIssue:
        try:
            return IssueService(repo).dismiss_issue(issue_id)
        except RevisionServiceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/proposals/{proposal_id}", response_model=RevisionProposal)
    def get_proposal(
        proposal_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> RevisionProposal:
        return require_proposal(repo, proposal_id)

    @router.post("/proposals/{proposal_id}/accept", response_model=RevisionProposal)
    def accept_proposal(
        proposal_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> RevisionProposal:
        try:
            return ProposalService(repo).accept_proposal(proposal_id)
        except RevisionServiceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/proposals/{proposal_id}/reject", response_model=RevisionProposal)
    def reject_proposal(
        proposal_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> RevisionProposal:
        try:
            return ProposalService(repo).reject_proposal(proposal_id)
        except RevisionServiceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/claims/{claim_id}/confirm", response_model=UserConfirmation, status_code=201)
    def confirm_claim(
        claim_id: str,
        payload: ConfirmClaimRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> UserConfirmation:
        return EvidenceService(repo).confirm_claim(
            payload.document_id,
            claim_id,
            confirmation_type=payload.confirmation_type,
            evidence_link_id=payload.evidence_link_id,
            issue_id=payload.issue_id,
            note=payload.note,
        )

    @router.post("/evidence-links/{evidence_link_id}/confirm", response_model=EvidenceLink)
    def confirm_evidence_link(
        evidence_link_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> EvidenceLink:
        try:
            return EvidenceService(repo).confirm_evidence_link(evidence_link_id)
        except RevisionServiceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    return router
