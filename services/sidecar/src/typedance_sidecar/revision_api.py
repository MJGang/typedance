from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field, field_validator

from .import_resume_file_text import ImportResumeFileError, extract_import_resume_file_text
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
    SourceResumeCanvas,
    UserConfirmation,
    WorkspaceView,
)
from .revision_blank_guided_flow import RevisionBlankGuidedFlowService
from .revision_export_gate import RevisionExportBlockedError, RevisionExportGateService
from .revision_import_flow import RevisionImportFlowService
from .revision_issue_action import RevisionIssueActionService
from .revision_opportunity_calibration import RevisionOpportunityCalibrationService
from .revision_quality_review import RevisionQualityReviewService
from .revision_render_projection import RenderProjectionError
from .revision_repository import RevisionRepository
from .revision_services import (
    DraftService,
    EvidenceService,
    InvalidSourceResumeCanvasError,
    IssueService,
    ProposalService,
    RenderService,
    RevisionServiceError,
    SourceService,
    WorkspaceService,
)
from .source_canvas_initializer import SourceCanvasInitializationError, SourceCanvasInitializer


RepositoryDependency = Callable[[], RevisionRepository]
ExportDirDependency = Callable[[], Path]
SourceDirDependency = Callable[[], Path]
MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024
CANVAS_SOURCE_TYPES = {"old_resume", "uploaded_file", "pasted_text"}


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


class UpdateDocumentRequest(BaseModel):
    title: str = Field(min_length=1)

    @field_validator("title", mode="after")
    @classmethod
    def validate_title(cls, title: str) -> str:
        trimmed = title.strip()
        if not trimmed:
            raise ValueError("title must not be blank")
        return trimmed


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


class SaveSourceResumeCanvasRequest(BaseModel):
    doc_json: dict[str, Any]

    @field_validator("doc_json", mode="after")
    @classmethod
    def validate_doc_json(cls, doc_json: dict[str, Any]) -> dict[str, Any]:
        if doc_json.get("type") != "doc":
            raise ValueError("doc_json.type must be 'doc'")
        if not isinstance(doc_json.get("content"), list):
            raise ValueError("doc_json.content must be a list")
        return doc_json


class ExportDraftPdfRequest(BaseModel):
    output_path: str | None = None
    force_with_risk: bool = False


class ConfirmClaimRequest(BaseModel):
    document_id: str = Field(min_length=1)
    confirmation_type: Literal["truth_confirmed", "risk_accepted", "source_verified"] = "truth_confirmed"
    evidence_link_id: str | None = None
    issue_id: str | None = None
    note: str | None = None


def create_revision_router(
    repository_dependency: RepositoryDependency,
    export_dir_dependency: ExportDirDependency | None = None,
    source_dir_dependency: SourceDirDependency | None = None,
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

    def export_dir() -> Path:
        if export_dir_dependency is not None:
            return export_dir_dependency()
        return Path.home() / ".typedance" / "files" / "exports"

    def source_dir() -> Path:
        if source_dir_dependency is not None:
            return source_dir_dependency()
        return Path.home() / ".typedance" / "files" / "sources"

    def path_header_value(path: Path) -> str:
        return quote(str(path), safe=":/\\")

    def save_initialized_source(repo: RevisionRepository, source: SourceDocument) -> SourceDocument:
        try:
            canvas = SourceCanvasInitializer().initialize(source)
        except SourceCanvasInitializationError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        initialized_source = source.model_copy(
            update={
                "parse_status": "initialized",
                "metadata": {
                    **source.metadata,
                    "initializer_adapter": _initializer_adapter_name(source),
                },
            }
        )
        return repo.save_initialized_source_resume_canvas(initialized_source, canvas)

    def _run_import_reconstruct_background(
        repository_dependency: RepositoryDependency,
        document_id: str,
        run_id: str,
    ) -> None:
        repo = repository_dependency()
        try:
            RevisionImportFlowService(repo).run_import_reconstruct(document_id, run_id)
        except RevisionServiceError:
            return

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

    @router.patch("/documents/{document_id}", response_model=Document)
    def update_document(
        document_id: str,
        payload: UpdateDocumentRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> Document:
        document = require_document(repo, document_id)
        return repo.save_document(document.model_copy(update={
            "title": payload.title,
            "updated_at": utc_now(),
        }))

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
            metadata={},
            created_at=utc_now(),
        )
        if payload.source_type not in CANVAS_SOURCE_TYPES:
            return SourceService(repo).save_source(source)
        return save_initialized_source(repo, source)

    @router.post("/documents/{document_id}/sources/import-file", response_model=SourceDocument, status_code=201)
    async def create_import_file_source(
        document_id: str,
        file: UploadFile = File(...),
        repo: RevisionRepository = Depends(repository),
    ) -> SourceDocument:
        require_document(repo, document_id)
        filename = _safe_upload_filename(file.filename or "resume")
        data = await file.read()
        if not data:
            raise HTTPException(status_code=400, detail="Import file is empty")
        if len(data) > MAX_IMPORT_FILE_BYTES:
            raise HTTPException(status_code=413, detail="Import file is too large")
        try:
            raw_text = extract_import_resume_file_text(
                data,
                filename=filename,
                mime_type=file.content_type,
            )
        except ImportResumeFileError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        file_path = _save_import_source_file(source_dir(), document_id, filename, data)
        extension = Path(filename).suffix.lower().lstrip(".")
        source = SourceDocument(
            id=f"src_{uuid4().hex}",
            document_id=document_id,
            source_type="old_resume",
            title=filename,
            mime_type=file.content_type,
            original_uri=file.filename,
            raw_text=raw_text,
            file_path=str(file_path),
            parse_status="pending",
            metadata={
                "import_extension": extension,
                "import_filename": filename,
                "extraction_adapter": "sharepoint-to-text"
                if extension in {"pdf", "docx", "doc"}
                else "text-decode",
            },
            created_at=utc_now(),
        )
        return save_initialized_source(repo, source)

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
        background_tasks: BackgroundTasks,
        repo: RevisionRepository = Depends(repository),
    ) -> RevisionRun:
        document = require_document(repo, document_id)
        source_canvas = (
            repo.get_source_resume_canvas(document_id)
            if payload.run_type == "import_reconstruct"
            else None
        )
        if payload.run_type == "import_reconstruct" and source_canvas is None:
            raise HTTPException(status_code=400, detail="Source resume canvas is not initialized")

        now = utc_now()
        run = RevisionRun(
            id=f"run_{uuid4().hex}",
            document_id=document_id,
            pack_id=document.pack_id,
            run_type=payload.run_type,
            status="recognizing" if payload.run_type == "import_reconstruct" else "created",
            source_document_ids=payload.source_document_ids,
            input_source_canvas_id=source_canvas.id if source_canvas else None,
            input_source_canvas_version=source_canvas.version if source_canvas else None,
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
                background_tasks.add_task(
                    _run_import_reconstruct_background,
                    repository_dependency,
                    document_id,
                    saved_run.id,
                )
                return saved_run
            if saved_run.run_type == "blank_guided_generate":
                return RevisionBlankGuidedFlowService(repo).run_blank_guided_generate(document_id, saved_run.id)
            if saved_run.run_type == "quality_review":
                return RevisionQualityReviewService(repo).run_quality_review(document_id, saved_run.id)
            if saved_run.run_type == "issue_action":
                return RevisionIssueActionService(repo).run_issue_action(document_id, saved_run.id)
            if saved_run.run_type == "opportunity_calibrate":
                return RevisionOpportunityCalibrationService(repo).run_opportunity_calibrate(document_id, saved_run.id)
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

    @router.put("/documents/{document_id}/source-resume-canvas", response_model=SourceResumeCanvas)
    def save_source_resume_canvas(
        document_id: str,
        payload: SaveSourceResumeCanvasRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> SourceResumeCanvas:
        try:
            return WorkspaceService(repo).save_source_resume_canvas_document(
                document_id,
                payload.doc_json,
            )
        except InvalidSourceResumeCanvasError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
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

    @router.post("/drafts/{draft_id}/export/pdf")
    def export_revision_draft_pdf(
        draft_id: str,
        payload: ExportDraftPdfRequest | None = None,
        repo: RevisionRepository = Depends(repository),
    ) -> FileResponse:
        request = payload or ExportDraftPdfRequest()
        output_path = Path(request.output_path) if request.output_path else None
        try:
            artifact = RevisionExportGateService(repo, output_dir=export_dir()).export_pdf(
                draft_id,
                output_path=output_path,
                force_with_risk=request.force_with_risk,
            )
        except RevisionExportBlockedError as exc:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": str(exc),
                    "artifact_id": exc.artifact.id,
                    "review_status": exc.artifact.review_status,
                    "blocking_issue_ids": exc.blocking_issue_ids,
                    "warning_issue_ids": exc.warning_issue_ids,
                },
            ) from exc
        except RevisionServiceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail="Revision PDF export failed") from exc

        if artifact.file_path is None:
            raise HTTPException(status_code=500, detail="Revision PDF export did not produce a file")

        pdf_path = Path(artifact.file_path)
        draft = require_draft(repo, draft_id)
        document = require_document(repo, draft.document_id)
        filename = pdf_path.name if request.output_path else f"resume-{document.title or draft.id}.pdf"
        return FileResponse(
            pdf_path,
            media_type="application/pdf",
            filename=filename,
            content_disposition_type="attachment",
            headers={
                "X-Pdf-Path": path_header_value(pdf_path),
                "X-Export-Artifact-Id": artifact.id,
                "X-Export-Review-Status": artifact.review_status,
            },
        )

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


def _safe_upload_filename(filename: str) -> str:
    name = Path(filename).name.strip() or "resume"
    safe = "".join(char if char.isalnum() or char in {" ", ".", "-", "_"} else "_" for char in name)
    return safe.strip(" .") or "resume"


def _initializer_adapter_name(source: SourceDocument) -> str:
    suffix = _source_extension(source)
    mime_type = (source.mime_type or "").split(";", maxsplit=1)[0].strip().lower()
    if suffix in {"md", "markdown"} or mime_type in {"text/markdown", "text/x-markdown"}:
        return "markdown"
    if suffix == "docx" or mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return "docx"
    return "text"


def _source_extension(source: SourceDocument) -> str:
    for candidate in (source.file_path, source.original_uri, source.title):
        if not candidate:
            continue
        suffix = Path(candidate.split("?", maxsplit=1)[0].split("#", maxsplit=1)[0]).suffix
        if suffix:
            return suffix.lower().lstrip(".")
    return ""


def _save_import_source_file(base_dir: Path, document_id: str, filename: str, data: bytes) -> Path:
    target_dir = base_dir / document_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / filename
    if target_path.exists():
        stem = target_path.stem
        suffix = target_path.suffix
        target_path = target_dir / f"{stem}-{uuid4().hex}{suffix}"
    target_path.write_bytes(data)
    return target_path
