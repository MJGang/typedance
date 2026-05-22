import pytest

from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_issue_action import RevisionIssueActionService
from typedance_sidecar.revision_models import (
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    RevisionIssue,
    RevisionRun,
    SourceDocument,
)
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import RevisionServiceError


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def seed_issue_action_workspace(repo: RevisionRepository) -> None:
    now = utc_now()
    document = repo.save_document(
        Document(
            id="doc_1",
            pack_id="resume",
            title="张三的简历",
            status="active",
            target_language="zh-CN",
            current_draft_id="draft_1",
            created_at=now,
            updated_at=now,
        )
    )
    source = repo.save_source_document(
        SourceDocument(
            id="src_1",
            document_id=document.id,
            source_type="old_resume",
            title="旧简历",
            raw_text="负责订单系统重构",
            parse_status="parsed",
            created_at=now,
        )
    )
    import_run = repo.save_revision_run(
        RevisionRun(
            id="run_import",
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="import_reconstruct",
            status="completed",
            source_document_ids=[source.id],
            created_at=now,
            updated_at=now,
        )
    )
    draft = repo.save_draft_version(
        DraftVersion(
            id="draft_1",
            document_id=document.id,
            run_id=import_run.id,
            pack_id=document.pack_id,
            status="in_review",
            summary="结构化草稿",
            unresolved_issue_ids=["issue_1"],
            created_at=now,
            updated_at=now,
        )
    )
    module = repo.save_document_module(
        DocumentModule(
            id="mod_1",
            draft_id=draft.id,
            pack_id=document.pack_id,
            type="ProjectExperience",
            title="项目经历",
            order=0,
            visibility="visible",
            status="needs_review",
            data={"items": [{"id": "item_1", "text": "负责订单系统重构"}]},
            created_at=now,
            updated_at=now,
        )
    )
    claim = repo.save_document_claim(
        DocumentClaim(
            id="claim_1",
            draft_id=draft.id,
            module_id=module.id,
            item_id="item_1",
            text="负责订单系统重构",
            claim_type="responsibility",
            confidence="inferred",
            created_at=now,
            updated_at=now,
        )
    )
    repo.save_revision_issue(
        RevisionIssue(
            id="issue_1",
            run_id=import_run.id,
            document_id=document.id,
            draft_id=draft.id,
            module_id=module.id,
            claim_id=claim.id,
            type="missing_result",
            severity="warning",
            title="缺少结果",
            message="这条经历看不出业务结果。",
            reason="需要补充影响范围。",
            status="needs_user_input",
            created_by_agent="ResumeReviewer",
            created_at=now,
        )
    )


def test_issue_action_creates_contextual_proposal_from_user_fact(tmp_path):
    repo = make_repository(tmp_path)
    seed_issue_action_workspace(repo)
    now = utc_now()
    run = repo.save_revision_run(
        RevisionRun(
            id="run_issue",
            document_id="doc_1",
            pack_id="resume",
            run_type="issue_action",
            status="created",
            base_draft_id="draft_1",
            selected_module_id="mod_1",
            selected_issue_id="issue_1",
            user_intent="上线后接口错误率下降 30%。",
            created_at=now,
            updated_at=now,
        )
    )

    completed = RevisionIssueActionService(repo).run_issue_action("doc_1", run.id)

    assert completed.status == "completed"
    assert completed.target_draft_id == "draft_1"
    assert "局部改稿建议" in (completed.output_summary or "")

    steps = repo.list_agent_steps(run.id)
    assert [step.agent_name for step in steps] == ["CollectIssueContext", "ResumeRewriter"]
    assert all(step.status == "completed" for step in steps)
    assert steps[1].input_refs[:3] == [
        "DraftVersion:draft_1",
        "RevisionIssue:issue_1",
        "DocumentClaim:claim_1",
    ]
    assert len(steps[1].input_refs) == 4
    assert steps[1].input_refs[3].startswith("UserConfirmation:confirm_")

    confirmations = repo.list_user_confirmations("doc_1")
    assert len(confirmations) == 1
    assert confirmations[0].claim_id == "claim_1"
    assert confirmations[0].issue_id == "issue_1"
    assert confirmations[0].note == "上线后接口错误率下降 30%。"

    proposals = [proposal for proposal in repo.list_revision_proposals("draft_1") if proposal.run_id == run.id]
    assert len(proposals) == 1
    proposal = proposals[0]
    assert proposal.operation == "replace_claim"
    assert proposal.target == {"module_id": "mod_1", "claim_id": "claim_1"}
    assert proposal.related_issue_ids == ["issue_1"]
    assert proposal.status == "pending"
    assert proposal.created_by_agent == "ResumeRewriter"
    assert steps[1].output_refs == [f"RevisionProposal:{proposal.id}"]
    assert proposal.proposed_snapshot == {
        "text": "负责订单系统重构，上线后接口错误率下降 30%。"
    }


def test_issue_action_surfaces_rewriter_runtime_failure(tmp_path):
    repo = make_repository(tmp_path)
    seed_issue_action_workspace(repo)
    now = utc_now()
    run = repo.save_revision_run(
        RevisionRun(
            id="run_issue",
            document_id="doc_1",
            pack_id="resume",
            run_type="issue_action",
            status="created",
            base_draft_id="draft_1",
            selected_module_id="mod_1",
            selected_issue_id="issue_1",
            user_intent="上线后接口错误率下降 30%。",
            created_at=now,
            updated_at=now,
        )
    )
    def raise_model_error(_context, _request):
        raise RuntimeError("model provider timeout")

    service = RevisionIssueActionService(repo, rewriter_runner=raise_model_error)

    with pytest.raises(RevisionServiceError, match="model provider timeout"):
        service.run_issue_action("doc_1", run.id)

    failed_run = repo.get_revision_run(run.id)
    steps = repo.list_agent_steps(run.id)

    assert failed_run is not None
    assert failed_run.status == "failed_retryable"
    assert failed_run.output_summary == "model provider timeout"
    assert steps[-1].agent_name == "ResumeRewriter"
    assert steps[-1].status == "failed_model"
