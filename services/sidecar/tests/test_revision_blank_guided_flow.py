import pytest

from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_blank_guided_flow import RevisionBlankGuidedFlowService
from typedance_sidecar.revision_models import Document, RevisionRun, SourceDocument
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import RevisionServiceError, WorkspaceService


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def seed_guided_run(repo: RevisionRepository, raw_text: str | None = None) -> tuple[Document, SourceDocument, RevisionRun]:
    now = utc_now()
    document = repo.save_document(
        Document(
            id="doc_guided",
            pack_id="resume",
            title="新简历",
            status="active",
            target_language="zh-CN",
            created_at=now,
            updated_at=now,
        )
    )
    source = repo.save_source_document(
        SourceDocument(
            id="src_guided",
            document_id=document.id,
            source_type="manual_user_input",
            title="空白引导信息",
            raw_text=raw_text
            or """
身份状态: 社招
姓名: 张三
电话: 13800000000
邮箱: zhangsan@example.com
目标方向: 前端工程师
技能: Vue3、TypeScript、FastAPI
工作经历: 负责订单系统重构，优化核心链路稳定性
项目经历: 智能简历系统，搭建编辑器与导出流程
""",
            parse_status="pending",
            created_at=now,
        )
    )
    run = repo.save_revision_run(
        RevisionRun(
            id="run_guided",
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="blank_guided_generate",
            status="created",
            source_document_ids=[source.id],
            user_intent="从空白引导生成基础简历",
            created_at=now,
            updated_at=now,
        )
    )
    return document, source, run


def test_blank_guided_flow_generates_initial_workspace(tmp_path):
    repo = make_repository(tmp_path)
    document, _source, run = seed_guided_run(repo)

    completed_run = RevisionBlankGuidedFlowService(repo).run_blank_guided_generate(document.id, run.id)

    assert completed_run.status == "completed"
    assert completed_run.target_draft_id is not None
    assert repo.get_document(document.id).current_draft_id == completed_run.target_draft_id

    workspace = WorkspaceService(repo).get_workspace_view(document.id)
    assert workspace.current_draft is not None
    assert workspace.render_projection is not None
    assert workspace.source_resume_canvas is not None
    assert workspace.source_resume_canvas.doc_json["type"] == "doc"
    assert {module.type for module in workspace.modules} >= {
        "BasicInfo",
        "JobIntent",
        "CoreSkills",
        "WorkExperience",
        "ProjectExperience",
    }
    assert workspace.claims
    assert workspace.evidence
    assert workspace.issues
    assert workspace.proposals
    assert workspace.quality_gate is not None
    assert workspace.quality_gate.status == "needs_review"


def test_blank_guided_flow_marks_missing_hard_modules(tmp_path):
    repo = make_repository(tmp_path)
    document, _source, run = seed_guided_run(
        repo,
        raw_text="""
身份状态: 应届生
姓名: 李四
目标方向: 后端开发
""",
    )

    RevisionBlankGuidedFlowService(repo).run_blank_guided_generate(document.id, run.id)

    workspace = WorkspaceService(repo).get_workspace_view(document.id)
    issue_types = {issue.type for issue in workspace.issues}
    assert {"missing_contact", "missing_skills", "missing_work_experience", "missing_project_experience"} <= issue_types


def test_blank_guided_flow_rejects_empty_input(tmp_path):
    repo = make_repository(tmp_path)
    document, _source, run = seed_guided_run(repo, raw_text=" ")

    with pytest.raises(RevisionServiceError, match="Blank guided source has no text"):
        RevisionBlankGuidedFlowService(repo).run_blank_guided_generate(document.id, run.id)

    failed_run = repo.get_revision_run(run.id)
    assert failed_run is not None
    assert failed_run.status == "failed_retryable"
