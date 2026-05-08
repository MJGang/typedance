import os
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .db import ResumeRepository, connect
from .models import ResumeVersion, ResumeVersionCreate, ResumeVersionUpdate
from .pdf import export_resume_pdf


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
