from pathlib import Path

import pytest

from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_export_gate import RevisionExportBlockedError, RevisionExportGateService
from typedance_sidecar.revision_models import Document, DocumentModule, DraftVersion, RevisionIssue, RevisionRun
from typedance_sidecar.revision_repository import RevisionRepository


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def seed_export_workspace(
    repo: RevisionRepository,
    *,
    issue_severity: str | None = None,
) -> tuple[Document, DraftVersion]:
    now = utc_now()
    document = repo.save_document(
        Document(
            id="doc_export",
            pack_id="resume",
            title="导出门禁简历",
            status="active",
            target_language="zh-CN",
            current_draft_id="draft_export",
            created_at=now,
            updated_at=now,
        )
    )
    run = repo.save_revision_run(
        RevisionRun(
            id="run_export",
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="quality_review",
            status="completed",
            created_at=now,
            updated_at=now,
        )
    )
    draft = repo.save_draft_version(
        DraftVersion(
            id="draft_export",
            document_id=document.id,
            run_id=run.id,
            pack_id=document.pack_id,
            status="accepted",
            summary="可导出草稿",
            created_at=now,
            updated_at=now,
        )
    )
    repo.save_document_module(
        DocumentModule(
            id="mod_basic",
            draft_id=draft.id,
            pack_id=document.pack_id,
            type="BasicInfo",
            title="基本信息",
            order=0,
            visibility="visible",
            status="clean",
            data={"name": "张三", "email": "zhangsan@example.com"},
            created_at=now,
            updated_at=now,
        )
    )
    if issue_severity is not None:
        repo.save_revision_issue(
            RevisionIssue(
                id=f"issue_{issue_severity}",
                run_id=run.id,
                document_id=document.id,
                draft_id=draft.id,
                type="missing_result",
                severity=issue_severity,
                title="仍需处理",
                message="导出前需要处理的问题。",
                reason="导出门禁需要识别风险。",
                status="open",
                created_by_agent="ExportGate",
                created_at=now,
            )
        )
    return document, draft


def fake_pdf_renderer(html: str, output_path: Path) -> Path:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(b"%PDF-1.4\n")
    assert "张三" in html
    return output_path


def test_export_gate_writes_pdf_artifact_and_marks_draft_exported(tmp_path):
    repo = make_repository(tmp_path)
    _document, draft = seed_export_workspace(repo)

    artifact = RevisionExportGateService(
        repo,
        output_dir=tmp_path / "exports",
        pdf_renderer=fake_pdf_renderer,
    ).export_pdf(draft.id)

    assert artifact.review_status == "passed"
    assert artifact.file_path is not None
    assert Path(artifact.file_path).exists()
    assert repo.list_export_artifacts("doc_export") == [artifact]
    exported_draft = repo.get_draft_version(draft.id)
    assert exported_draft is not None
    assert exported_draft.status == "exported"
    assert exported_draft.render_projection_id is not None


def test_export_gate_blocks_unresolved_blocking_issues(tmp_path):
    repo = make_repository(tmp_path)
    _document, draft = seed_export_workspace(repo, issue_severity="blocking")

    with pytest.raises(RevisionExportBlockedError) as exc:
        RevisionExportGateService(
            repo,
            output_dir=tmp_path / "exports",
            pdf_renderer=fake_pdf_renderer,
        ).export_pdf(draft.id)

    assert exc.value.blocking_issue_ids == ["issue_blocking"]
    assert exc.value.artifact.review_status == "blocked"
    assert exc.value.artifact.file_path is None
    assert repo.list_export_artifacts("doc_export")[0].review_status == "blocked"


def test_export_gate_requires_explicit_force_for_warnings(tmp_path):
    repo = make_repository(tmp_path)
    _document, draft = seed_export_workspace(repo, issue_severity="warning")
    service = RevisionExportGateService(
        repo,
        output_dir=tmp_path / "exports",
        pdf_renderer=fake_pdf_renderer,
    )

    with pytest.raises(RevisionExportBlockedError) as exc:
        service.export_pdf(draft.id)

    assert exc.value.warning_issue_ids == ["issue_warning"]

    artifact = service.export_pdf(draft.id, force_with_risk=True)

    assert artifact.review_status == "forced_with_risk"
    assert artifact.file_path is not None
    assert Path(artifact.file_path).exists()
