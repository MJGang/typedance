import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)

from .db import ResumeRepository, TemplateSampleRepository, TemplateStyleRepository, connect
from .models import (
    ResumeVersion,
    ResumeVersionCreate,
    ResumeVersionUpdate,
    TemplateSampleContent,
    TemplateStyleConfig,
    utc_now,
)
from .pdf import render_and_export_pdf, cleanup_browser


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    cleanup_browser()


app = FastAPI(title="TypeDance Sidecar", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)



def app_data_dir() -> Path:
    override = os.environ.get("TYPEDANCE_DATA_DIR")
    if override:
        return Path(override)
    return Path.home() / ".typedance"


def resume_repository() -> ResumeRepository:
    return ResumeRepository(connect(app_data_dir() / "typedance.sqlite"))


def template_sample_repository() -> TemplateSampleRepository:
    return TemplateSampleRepository(connect(app_data_dir() / "typedance.sqlite"))


def template_style_repository() -> TemplateStyleRepository:
    return TemplateStyleRepository(connect(app_data_dir() / "typedance.sqlite"))



def preview_pdf_dir() -> Path:
    return app_data_dir() / "files" / "previews"


def with_preview_pdf(
    resume: ResumeVersion,
    request: Request,
    style_repo: TemplateStyleRepository,
) -> ResumeVersion:
    try:
        template_style = style_repo.get(resume.template_id)
        pdf_path = render_and_export_pdf(resume, template_style, preview_pdf_dir() / f"{resume.id}.pdf")
        preview_url = str(request.url_for("get_preview_pdf", resume_id=resume.id))
        return resume.model_copy(update={"preview_pdf_path": str(pdf_path), "preview_pdf_url": preview_url})
    except Exception:
        logger.warning("PDF preview generation failed")
        return resume


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.1.0"}


@app.get("/resume-versions", response_model=list[ResumeVersion])
def list_resume_versions(repo: ResumeRepository = Depends(resume_repository)) -> list[ResumeVersion]:
    return repo.list()


@app.post("/resume-versions", response_model=ResumeVersion, status_code=201)
def create_resume_version(
    payload: ResumeVersionCreate,
    request: Request,
    repo: ResumeRepository = Depends(resume_repository),
    style_repo: TemplateStyleRepository = Depends(template_style_repository),
) -> ResumeVersion:
    resume = ResumeVersion.new(payload)
    return repo.save(with_preview_pdf(resume, request, style_repo))


@app.get("/resume-versions/{resume_id}", response_model=ResumeVersion)
def get_resume_version(
    resume_id: str,
    repo: ResumeRepository = Depends(resume_repository),
) -> ResumeVersion:
    resume = repo.get(resume_id)
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume version not found")
    return resume


@app.patch("/resume-versions/{resume_id}", response_model=ResumeVersion)
def update_resume_version(
    resume_id: str,
    payload: ResumeVersionUpdate,
    repo: ResumeRepository = Depends(resume_repository),
) -> ResumeVersion:
    resume = repo.get(resume_id)
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume version not found")
    return repo.save(resume.apply_update(payload))


@app.delete("/resume-versions/{resume_id}", status_code=204)
def delete_resume_version(
    resume_id: str,
    repo: ResumeRepository = Depends(resume_repository),
) -> None:
    resume = repo.get(resume_id)
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume version not found")
    repo.delete(resume_id)


@app.get("/template-samples/{sample_id}", response_model=TemplateSampleContent)
def get_template_sample(
    sample_id: str,
    repo: TemplateSampleRepository = Depends(template_sample_repository),
) -> TemplateSampleContent:
    sample = repo.get(sample_id)
    if sample is None:
        raise HTTPException(status_code=404, detail="Template sample not found")
    return sample


@app.put("/template-samples/{sample_id}", response_model=TemplateSampleContent)
def save_template_sample(
    sample_id: str,
    payload: TemplateSampleContent,
    repo: TemplateSampleRepository = Depends(template_sample_repository),
) -> TemplateSampleContent:
    if payload.id != sample_id:
        raise HTTPException(status_code=400, detail="Template sample id mismatch")
    return repo.save(payload.model_copy(update={"updated_at": utc_now()}))


@app.get("/template-styles/{template_id}", response_model=TemplateStyleConfig, response_model_exclude_none=True)
def get_template_style(
    template_id: str,
    repo: TemplateStyleRepository = Depends(template_style_repository),
) -> TemplateStyleConfig:
    config = repo.get(template_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Template style not found")
    return config


@app.put("/template-styles/{template_id}", response_model=TemplateStyleConfig, response_model_exclude_none=True)
def save_template_style(
    template_id: str,
    payload: TemplateStyleConfig,
    style_repo: TemplateStyleRepository = Depends(template_style_repository),
) -> TemplateStyleConfig:
    if payload.template_id != template_id:
        raise HTTPException(status_code=400, detail="Template style id mismatch")
    return style_repo.save(payload.model_copy(update={"updated_at": utc_now()}))


@app.get("/previews/{resume_id}.pdf", name="get_preview_pdf")
def get_preview_pdf(
    resume_id: str,
    request: Request,
    repo: ResumeRepository = Depends(resume_repository),
    style_repo: TemplateStyleRepository = Depends(template_style_repository),
) -> FileResponse:
    resume = repo.get(resume_id)
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume version not found")

    # Regenerate preview with latest template styles on every access
    try:
        resume = repo.save(with_preview_pdf(resume, request, style_repo))
    except Exception as exc:
        logger.warning("PDF preview regeneration failed (non-fatal): %s", exc)

    pdf_path = Path(resume.preview_pdf_path) if resume.preview_pdf_path else None
    if not pdf_path or not pdf_path.exists():
        raise HTTPException(status_code=404, detail="Preview PDF not found")

    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"{resume.id}.pdf",
        content_disposition_type="inline",
    )


@app.post("/exports/pdf/{resume_id}")
def export_pdf(
    resume_id: str,
    repo: ResumeRepository = Depends(resume_repository),
    style_repo: TemplateStyleRepository = Depends(template_style_repository),
) -> FileResponse:
    resume = repo.get(resume_id)
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume version not found")

    style = style_repo.get(resume.template_id) if resume.template_id else None
    exports_dir = app_data_dir() / "files" / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = exports_dir / f"{resume_id}.pdf"

    try:
        render_and_export_pdf(resume, style, pdf_path)
    except Exception as exc:
        logger.error("PDF export failed for %s: %s", resume_id, exc)
        raise HTTPException(status_code=500, detail="PDF export failed")

    filename = f"resume-{resume.title or resume_id}.pdf"
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=filename,
        content_disposition_type="attachment",
    )
