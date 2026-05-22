import pytest

from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import Document, DocumentClaim, DocumentModule, DraftVersion, RevisionRun
from typedance_sidecar.revision_quality_review import RevisionQualityReviewService
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import RevisionServiceError, WorkspaceService


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def seed_review_workspace(repo: RevisionRepository, *, high_risk: bool = False) -> tuple[Document, DraftVersion, RevisionRun]:
    now = utc_now()
    document = repo.save_document(
        Document(
            id="doc_review",
            pack_id="resume",
            title="质量检查简历",
            status="active",
            target_language="zh-CN",
            current_draft_id="draft_review",
            created_at=now,
            updated_at=now,
        )
    )
    draft = repo.save_draft_version(
        DraftVersion(
            id="draft_review",
            document_id=document.id,
            run_id="run_seed",
            pack_id=document.pack_id,
            status="in_review",
            summary="待检查草稿",
            created_at=now,
            updated_at=now,
        )
    )
    basic = repo.save_document_module(
        DocumentModule(
            id="mod_basic",
            draft_id=draft.id,
            pack_id=document.pack_id,
            type="BasicInfo",
            title="基本信息",
            order=0,
            visibility="visible",
            status="needs_confirmation",
            data={"name": "张三", "phone": "13800000000"},
            created_at=now,
            updated_at=now,
        )
    )
    work = repo.save_document_module(
        DocumentModule(
            id="mod_work",
            draft_id=draft.id,
            pack_id=document.pack_id,
            type="WorkExperience",
            title="工作经历",
            order=1,
            visibility="visible",
            status="needs_review",
            data={"items": [{"title": "订单系统重构", "bullets": ["负责订单系统重构"]}]},
            created_at=now,
            updated_at=now,
        )
    )
    repo.save_document_module(
        DocumentModule(
            id="mod_skills",
            draft_id=draft.id,
            pack_id=document.pack_id,
            type="CoreSkills",
            title="专业技能",
            order=2,
            visibility="visible",
            status="clean",
            data={"items": ["Vue3", "TypeScript"]},
            created_at=now,
            updated_at=now,
        )
    )
    repo.save_document_claim(
        DocumentClaim(
            id="claim_work",
            draft_id=draft.id,
            module_id=work.id,
            text="负责订单系统重构",
            claim_type="responsibility",
            confidence="unsupported" if high_risk else "inferred",
            risk_flags=["truth_risk"] if high_risk else [],
            created_at=now,
            updated_at=now,
        )
    )
    repo.save_document_claim(
        DocumentClaim(
            id="claim_basic",
            draft_id=draft.id,
            module_id=basic.id,
            text="张三",
            claim_type="summary",
            confidence="user_confirmed",
            created_at=now,
            updated_at=now,
        )
    )
    run = repo.save_revision_run(
        RevisionRun(
            id="run_review",
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="quality_review",
            status="created",
            base_draft_id=draft.id,
            created_at=now,
            updated_at=now,
        )
    )
    return document, draft, run


def test_quality_review_generates_issues_proposals_and_projection(tmp_path):
    repo = make_repository(tmp_path)
    document, draft, run = seed_review_workspace(repo)

    completed_run = RevisionQualityReviewService(repo).run_quality_review(document.id, run.id)

    assert completed_run.status == "completed"
    assert completed_run.target_draft_id == draft.id

    workspace = WorkspaceService(repo).get_workspace_view(document.id)
    issue_types = {issue.type for issue in workspace.issues}
    assert {"missing_contact", "missing_project_experience", "missing_result"} <= issue_types
    assert workspace.proposals
    assert workspace.render_projection is not None
    assert workspace.quality_gate is not None
    assert workspace.quality_gate.status == "needs_review"

    steps = repo.list_agent_steps(run.id)
    reviewer_steps = [step for step in steps if step.agent_name == "ResumeReviewer"]
    assert len(reviewer_steps) == 1
    assert "DraftVersion:draft_review" in reviewer_steps[0].input_refs
    assert any(ref.startswith("DocumentModule:") for ref in reviewer_steps[0].input_refs)
    assert any(ref.startswith("DocumentClaim:") for ref in reviewer_steps[0].input_refs)
    assert reviewer_steps[0].output_refs
    assert all(ref.startswith("RevisionIssue:") for ref in reviewer_steps[0].output_refs)


def test_quality_review_blocks_unconfirmed_high_risk_claims(tmp_path):
    repo = make_repository(tmp_path)
    document, _draft, run = seed_review_workspace(repo, high_risk=True)

    RevisionQualityReviewService(repo).run_quality_review(document.id, run.id)

    workspace = WorkspaceService(repo).get_workspace_view(document.id)
    blocking_issues = [issue for issue in workspace.issues if issue.severity == "blocking"]
    assert any(issue.type == "claim_needs_confirmation" for issue in blocking_issues)
    assert workspace.quality_gate is not None
    assert workspace.quality_gate.status == "blocked"


def test_quality_review_surfaces_reviewer_runtime_failure(tmp_path):
    repo = make_repository(tmp_path)
    document, _draft, run = seed_review_workspace(repo)

    def raise_model_error(_context, _request):
        raise RuntimeError("review model timeout")

    service = RevisionQualityReviewService(repo, reviewer_runner=raise_model_error)

    with pytest.raises(RevisionServiceError, match="review model timeout"):
        service.run_quality_review(document.id, run.id)

    failed_run = repo.get_revision_run(run.id)
    steps = repo.list_agent_steps(run.id)

    assert failed_run is not None
    assert failed_run.status == "failed_retryable"
    assert failed_run.output_summary == "review model timeout"
    assert steps[-1].agent_name == "ResumeReviewer"
    assert steps[-1].status == "failed_model"


def test_quality_review_requires_a_draft(tmp_path):
    repo = make_repository(tmp_path)
    now = utc_now()
    document = repo.save_document(
        Document(
            id="doc_empty",
            pack_id="resume",
            title="空项目",
            status="active",
            target_language="zh-CN",
            created_at=now,
            updated_at=now,
        )
    )
    run = repo.save_revision_run(
        RevisionRun(
            id="run_empty",
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="quality_review",
            status="created",
            created_at=now,
            updated_at=now,
        )
    )

    with pytest.raises(RevisionServiceError, match="Quality review requires a draft"):
        RevisionQualityReviewService(repo).run_quality_review(document.id, run.id)

    failed_run = repo.get_revision_run(run.id)
    assert failed_run is not None
    assert failed_run.status == "failed_retryable"
