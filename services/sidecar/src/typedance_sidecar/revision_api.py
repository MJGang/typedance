import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .canvas_export import CanvasExportService
from .context_sources import (
    build_webpage_source,
    file_uri,
    list_directory_children,
    open_context_source,
    open_context_source_child,
    read_context_source_text,
    refresh_webpage_metadata,
    reveal_context_source,
    reveal_context_source_child,
    source_path,
)
from .import_resume_file_text import ImportResumeFileError, extract_import_resume_file_text
from .models import Language, TemplateStyleConfig, utc_now
from .revision_models import (
    CanvasPrintSnapshot,
    ContextSource,
    ContextSourceChild,
    DEFAULT_TEMPLATE_ID,
    Document,
    DraftVersion,
    EvidenceLink,
    ExportArtifact,
    ParsedBlock,
    RenderProjection,
    RevisionIssue,
    RevisionProposal,
    SourceDocument,
    SourceResumeCanvas,
    UserConfirmation,
    WorkspaceView,
)
from .revision_export import RevisionExportService
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
    title: str | None = Field(default=None, min_length=1)
    template_id: str | None = Field(default=None, min_length=1)

    @field_validator("title", mode="after")
    @classmethod
    def validate_title(cls, title: str | None) -> str | None:
        if title is None:
            return None
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


class PageMarginsRequest(BaseModel):
    top: float = Field(ge=0)
    bottom: float = Field(ge=0)
    left: float = Field(ge=0)
    right: float = Field(ge=0)


class ExportDocumentRequest(BaseModel):
    output_path: str | None = None
    source_doc_json: dict[str, Any] | None = None
    page_margins: PageMarginsRequest | None = None
    template_style: TemplateStyleConfig | None = None

    @field_validator("source_doc_json", mode="after")
    @classmethod
    def validate_source_doc_json(cls, doc_json: dict[str, Any] | None) -> dict[str, Any] | None:
        if doc_json is None:
            return None
        if doc_json.get("type") != "doc":
            raise ValueError("source_doc_json.type must be 'doc'")
        if not isinstance(doc_json.get("content"), list):
            raise ValueError("source_doc_json.content must be a list")
        return doc_json


class CanvasExportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    print_snapshot: CanvasPrintSnapshot
    output_path: str | None = None


class ConfirmClaimRequest(BaseModel):
    document_id: str = Field(min_length=1)
    confirmation_type: Literal["truth_confirmed", "risk_accepted", "source_verified"] = "truth_confirmed"
    evidence_link_id: str | None = None
    issue_id: str | None = None
    note: str | None = None


class CreateLocalContextSourceRequest(BaseModel):
    path: str = Field(min_length=1)

    @field_validator("path", mode="after")
    @classmethod
    def validate_path(cls, path: str) -> str:
        trimmed = path.strip()
        if not trimmed:
            raise ValueError("path must not be blank")
        return trimmed


class CreateWebpageContextSourceRequest(BaseModel):
    url: str = Field(min_length=1)

    @field_validator("url", mode="after")
    @classmethod
    def validate_url(cls, url: str) -> str:
        trimmed = url.strip()
        if not trimmed:
            raise ValueError("url must not be blank")
        return trimmed


class UpdateContextSourceRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)

    @field_validator("title", mode="after")
    @classmethod
    def validate_title(cls, title: str | None) -> str | None:
        if title is None:
            return None
        trimmed = title.strip()
        if not trimmed:
            raise ValueError("title must not be blank")
        return trimmed


class ContextSourceContent(BaseModel):
    source_id: str
    type: str
    title: str
    uri: str
    path: str | None = None
    text: str
    truncated: bool


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

    def require_context_source(repo: RevisionRepository, source_id: str) -> ContextSource:
        source = repo.get_context_source(source_id)
        if source is None:
            raise HTTPException(status_code=404, detail="Context source not found")
        return source

    def require_proposal(repo: RevisionRepository, proposal_id: str) -> RevisionProposal:
        proposal = repo.get_revision_proposal(proposal_id)
        if proposal is None:
            raise HTTPException(status_code=404, detail="Proposal not found")
        return proposal

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
            template_id=DEFAULT_TEMPLATE_ID,
            status="active",
            target_language=payload.target_language,
            created_at=now,
            updated_at=now,
        )
        return repo.save_document(document)

    @router.post("/documents/{document_id}/duplicate", response_model=Document, status_code=201)
    def duplicate_document(
        document_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> Document:
        document = repo.duplicate_document(document_id)
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found")
        return document

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
        updates: dict[str, Any] = {"updated_at": utc_now()}
        if payload.title is not None:
            updates["title"] = payload.title
        if payload.template_id is not None:
            updates["template_id"] = payload.template_id
        return repo.save_document(document.model_copy(update=updates))

    @router.delete("/documents/{document_id}", status_code=204)
    def delete_document(
        document_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> None:
        if not repo.delete_document(document_id):
            raise HTTPException(status_code=404, detail="Document not found")

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

    @router.get(
        "/documents/{document_id}/workspace-view",
        response_model=WorkspaceView,
        response_model_exclude_none=True,
    )
    def get_workspace_view(
        document_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> WorkspaceView:
        try:
            return WorkspaceService(repo).get_workspace_view(document_id)
        except RevisionServiceError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/documents/{document_id}/context-sources", response_model=list[ContextSource])
    def list_context_sources(
        document_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> list[ContextSource]:
        require_document(repo, document_id)
        return repo.list_context_sources(document_id)

    @router.post("/documents/{document_id}/context-sources/file", response_model=ContextSource, status_code=201)
    def create_file_context_source(
        document_id: str,
        payload: CreateLocalContextSourceRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> ContextSource:
        require_document(repo, document_id)
        path = Path(payload.path).expanduser().resolve()
        if not path.is_file():
            raise HTTPException(status_code=400, detail="Path must point to an existing file")
        now = utc_now()
        source = ContextSource(
            id=f"ctx_{uuid4().hex}",
            workspace_id=document_id,
            type="file",
            title=path.name,
            uri=file_uri(path),
            metadata={"permission": "read"},
            created_at=now,
            updated_at=now,
        )
        return repo.save_context_source(source)

    @router.post("/documents/{document_id}/context-sources/directory", response_model=ContextSource, status_code=201)
    def create_directory_context_source(
        document_id: str,
        payload: CreateLocalContextSourceRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> ContextSource:
        require_document(repo, document_id)
        path = Path(payload.path).expanduser().resolve()
        if not path.is_dir():
            raise HTTPException(status_code=400, detail="Path must point to an existing directory")
        now = utc_now()
        source = ContextSource(
            id=f"ctx_{uuid4().hex}",
            workspace_id=document_id,
            type="directory",
            title=path.name,
            uri=file_uri(path),
            metadata={"permission": "read"},
            created_at=now,
            updated_at=now,
        )
        return repo.save_context_source(source)

    @router.post("/documents/{document_id}/context-sources/webpage", response_model=ContextSource, status_code=201)
    def create_webpage_context_source(
        document_id: str,
        payload: CreateWebpageContextSourceRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> ContextSource:
        require_document(repo, document_id)
        try:
            source = build_webpage_source(f"ctx_{uuid4().hex}", document_id, payload.url)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return repo.save_context_source(source)

    @router.patch("/context-sources/{source_id}", response_model=ContextSource)
    def update_context_source(
        source_id: str,
        payload: UpdateContextSourceRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> ContextSource:
        source = require_context_source(repo, source_id)
        updates: dict[str, Any] = {"updated_at": utc_now()}
        if payload.title is not None:
            updates["title"] = payload.title
        return repo.save_context_source(source.model_copy(update=updates))

    @router.delete("/context-sources/{source_id}", status_code=204)
    def remove_context_source(
        source_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> None:
        if not repo.delete_context_source(source_id):
            raise HTTPException(status_code=404, detail="Context source not found")

    @router.get("/context-sources/{source_id}/children", response_model=list[ContextSourceChild])
    def list_context_source_children(
        source_id: str,
        path: str = Query(default=""),
        repo: RevisionRepository = Depends(repository),
    ) -> list[ContextSourceChild]:
        source = require_context_source(repo, source_id)
        if source.type != "directory":
            raise HTTPException(status_code=400, detail="Context source is not a directory")
        try:
            return list_directory_children(source_path(source), path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except NotADirectoryError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.get("/context-sources/{source_id}/content", response_model=ContextSourceContent)
    def get_context_source_content(
        source_id: str,
        path: str = Query(default=""),
        repo: RevisionRepository = Depends(repository),
    ) -> ContextSourceContent:
        source = require_context_source(repo, source_id)
        try:
            text, truncated = read_context_source_text(source, path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return ContextSourceContent(
            source_id=source.id,
            type=source.type,
            title=source.title,
            uri=source.uri,
            path=path or None,
            text=text,
            truncated=truncated,
        )

    @router.post("/context-sources/{source_id}/refresh", response_model=ContextSource)
    def refresh_context_source(
        source_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> ContextSource:
        source = require_context_source(repo, source_id)
        if source.type != "webpage":
            raise HTTPException(status_code=400, detail="Only webpage context sources can be refreshed")
        try:
            metadata = refresh_webpage_metadata(source.uri)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Failed to refresh webpage metadata: {exc}") from exc
        return repo.save_context_source(source.model_copy(update={
            "title": metadata.title,
            "description": metadata.description,
            "summary": metadata.summary,
            "favicon_url": metadata.favicon_url,
            "updated_at": utc_now(),
        }))

    @router.post("/context-sources/{source_id}/open", status_code=204)
    def open_context_source_endpoint(
        source_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> None:
        try:
            open_context_source(require_context_source(repo, source_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/context-sources/{source_id}/reveal", status_code=204)
    def reveal_context_source_endpoint(
        source_id: str,
        repo: RevisionRepository = Depends(repository),
    ) -> None:
        try:
            reveal_context_source(require_context_source(repo, source_id))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @router.post("/context-sources/{source_id}/children/open", status_code=204)
    def open_context_source_child_endpoint(
        source_id: str,
        path: str = Query(min_length=1),
        repo: RevisionRepository = Depends(repository),
    ) -> None:
        try:
            open_context_source_child(require_context_source(repo, source_id), path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/context-sources/{source_id}/children/reveal", status_code=204)
    def reveal_context_source_child_endpoint(
        source_id: str,
        path: str = Query(min_length=1),
        repo: RevisionRepository = Depends(repository),
    ) -> None:
        try:
            reveal_context_source_child(require_context_source(repo, source_id), path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except FileNotFoundError as exc:
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

    def export_revision_document_response(
        document_id: str,
        export_format: Literal["pdf", "html"],
        payload: ExportDocumentRequest | None,
        repo: RevisionRepository,
    ) -> FileResponse:
        request = payload or ExportDocumentRequest()
        output_path = Path(request.output_path) if request.output_path else None
        try:
            artifact = RevisionExportService(repo, output_dir=export_dir()).export_document(
                document_id,
                export_format,
                output_path=output_path,
                source_doc_json=request.source_doc_json,
                page_margins=request.page_margins.model_dump() if request.page_margins else None,
                template_style=request.template_style,
            )
        except RevisionServiceError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Revision {export_format.upper()} export failed") from exc

        return export_artifact_response(document_id, export_format, artifact, bool(request.output_path), repo)

    def export_artifact_response(
        document_id: str,
        export_format: Literal["pdf", "html"],
        artifact: ExportArtifact,
        has_output_path: bool,
        repo: RevisionRepository,
    ) -> FileResponse:
        if artifact.file_path is None:
            raise HTTPException(status_code=500, detail=f"Revision {export_format.upper()} export did not produce a file")

        export_path = Path(artifact.file_path)
        document = require_document(repo, document_id)
        filename = export_path.name if has_output_path else f"resume-{document.title or document.id}.{export_format}"
        media_type = "application/pdf" if export_format == "pdf" else "text/html; charset=utf-8"
        path_header_name = "X-Pdf-Path" if export_format == "pdf" else "X-Html-Path"
        return FileResponse(
            export_path,
            media_type=media_type,
            filename=filename,
            content_disposition_type="attachment",
            headers={
                path_header_name: path_header_value(export_path),
                "X-Export-Artifact-Id": artifact.id,
            },
        )

    @router.post("/documents/{document_id}/export/pdf")
    def export_revision_document_pdf(
        document_id: str,
        payload: ExportDocumentRequest | None = None,
        repo: RevisionRepository = Depends(repository),
    ) -> FileResponse:
        return export_revision_document_response(document_id, "pdf", payload, repo)

    @router.post("/documents/{document_id}/export/html")
    def export_revision_document_html(
        document_id: str,
        payload: ExportDocumentRequest | None = None,
        repo: RevisionRepository = Depends(repository),
    ) -> FileResponse:
        return export_revision_document_response(document_id, "html", payload, repo)

    def export_canvas_response(
        document_id: str,
        export_format: Literal["pdf", "html"],
        payload: CanvasExportRequest,
        repo: RevisionRepository,
    ) -> FileResponse:
        require_document(repo, document_id)
        try:
            artifact = CanvasExportService(repo, output_dir=export_dir()).export_document(
                document_id,
                export_format,
                print_snapshot=payload.print_snapshot,
                output_path=Path(payload.output_path) if payload.output_path else None,
            )
        except Exception as exc:
            logging.getLogger(__name__).exception("Canvas %s export failed", export_format)
            raise HTTPException(status_code=500, detail=f"Canvas {export_format.upper()} export failed") from exc
        return export_artifact_response(document_id, export_format, artifact, bool(payload.output_path), repo)

    @router.post("/documents/{document_id}/canvas-export/pdf")
    def export_canvas_pdf(
        document_id: str,
        payload: CanvasExportRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> FileResponse:
        return export_canvas_response(document_id, "pdf", payload, repo)

    @router.post("/documents/{document_id}/canvas-export/html")
    def export_canvas_html(
        document_id: str,
        payload: CanvasExportRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> FileResponse:
        return export_canvas_response(document_id, "html", payload, repo)

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
