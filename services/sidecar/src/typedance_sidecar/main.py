import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .db import AppSettingsRepository, ResumeRepository, TemplateSampleRepository, TemplateStyleRepository, connect
from .models import (
    PdfClassPolicy,
    ResumeVersion,
    ResumeVersionCreate,
    ResumeVersionUpdate,
    TemplateSampleContent,
    TemplateStyleConfig,
    utc_now,
)
from .pdf import export_resume_pdf
from .template_policy import DEFAULT_PDF_CLASS_POLICY, validate_style_config


app = FastAPI(title="TypeDance Sidecar", version="0.1.0")
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


def app_settings_repository() -> AppSettingsRepository:
    return AppSettingsRepository(connect(app_data_dir() / "typedance.sqlite"))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.1.0"}


@app.get("/resume-versions", response_model=list[ResumeVersion])
def list_resume_versions(repo: ResumeRepository = Depends(resume_repository)) -> list[ResumeVersion]:
    return repo.list()


@app.post("/resume-versions", response_model=ResumeVersion, status_code=201)
def create_resume_version(
    payload: ResumeVersionCreate,
    repo: ResumeRepository = Depends(resume_repository),
) -> ResumeVersion:
    resume = ResumeVersion.new(payload)
    return repo.save(resume)


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


@app.get("/template-styles/{template_id}", response_model=TemplateStyleConfig)
def get_template_style(
    template_id: str,
    repo: TemplateStyleRepository = Depends(template_style_repository),
) -> TemplateStyleConfig:
    config = repo.get(template_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Template style not found")
    return config


@app.put("/template-styles/{template_id}", response_model=TemplateStyleConfig)
def save_template_style(
    template_id: str,
    payload: TemplateStyleConfig,
    style_repo: TemplateStyleRepository = Depends(template_style_repository),
    settings_repo: AppSettingsRepository = Depends(app_settings_repository),
) -> TemplateStyleConfig:
    if payload.template_id != template_id:
        raise HTTPException(status_code=400, detail="Template style id mismatch")

    config = payload.model_copy(update={"updated_at": utc_now()})
    policy = settings_repo.get_pdf_class_policy() or DEFAULT_PDF_CLASS_POLICY
    validation_errors = validate_style_config(config, policy)
    if validation_errors:
        raise HTTPException(status_code=422, detail=[error.model_dump() for error in validation_errors])
    return style_repo.save(config)


@app.get("/pdf-class-policy", response_model=PdfClassPolicy)
def get_pdf_class_policy(repo: AppSettingsRepository = Depends(app_settings_repository)) -> PdfClassPolicy:
    return repo.get_pdf_class_policy() or DEFAULT_PDF_CLASS_POLICY


@app.put("/pdf-class-policy", response_model=PdfClassPolicy)
def save_pdf_class_policy(
    payload: PdfClassPolicy,
    repo: AppSettingsRepository = Depends(app_settings_repository),
) -> PdfClassPolicy:
    return repo.save_pdf_class_policy(payload.model_copy(update={"updated_at": utc_now()}))


@app.post("/exports/pdf/{resume_id}", status_code=201)
def export_pdf(resume_id: str, repo: ResumeRepository = Depends(resume_repository)) -> dict[str, str]:
    resume = repo.get(resume_id)
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume version not found")

    pdf_path = export_resume_pdf(resume, app_data_dir() / "files" / "exports")
    return {
        "id": f"pdf_{resume.id}",
        "resume_version_id": resume.id,
        "file_path": str(pdf_path),
        "language": resume.target_language,
        "layout_profile": "single-page-a4",
        "layout_status": "ready",
        "created_at": resume.updated_at
    }
