import pytest
from pydantic import BaseModel

from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_agent_runtime import (
    AgentRuntime,
    AgentRuntimeError,
    AgentSchemaRegistry,
    build_agent_context,
)
from typedance_sidecar.revision_models import (
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    EvidenceLink,
    RenderProjection,
    RevisionIssue,
    RevisionProposal,
    RevisionRun,
    SourceDocument,
)
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import (
    DraftService,
    ProposalService,
    RevisionServiceError,
    WorkspaceService,
)


class GuardrailPayload(BaseModel):
    output_ids: list[str]


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def make_schema_registry() -> AgentSchemaRegistry:
    registry = AgentSchemaRegistry()
    registry.register("GuardrailPayload", GuardrailPayload)
    return registry


def seed_guardrail_workspace(repo: RevisionRepository, *, claim_type: str = "responsibility") -> dict[str, object]:
    now = utc_now()
    document = repo.save_document(
        Document(
            id="doc_guardrail",
            pack_id="resume",
            title="防退化简历",
            status="active",
            target_language="zh-CN",
            current_draft_id="draft_guardrail",
            created_at=now,
            updated_at=now,
        )
    )
    source = repo.save_source_document(
        SourceDocument(
            id="src_guardrail",
            document_id=document.id,
            source_type="pasted_text",
            title="用户材料",
            raw_text="主导订单系统重构",
            parse_status="recognized",
            created_at=now,
        )
    )
    run = repo.save_revision_run(
        RevisionRun(
            id="run_guardrail",
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="quality_review",
            status="completed",
            source_document_ids=[source.id],
            created_at=now,
            updated_at=now,
        )
    )
    draft = repo.save_draft_version(
        DraftVersion(
            id="draft_guardrail",
            document_id=document.id,
            run_id=run.id,
            pack_id=document.pack_id,
            status="in_review",
            summary="结构化草稿",
            unresolved_issue_ids=["issue_guardrail"],
            created_at=now,
            updated_at=now,
        )
    )
    module = repo.save_document_module(
        DocumentModule(
            id="mod_guardrail",
            draft_id=draft.id,
            pack_id=document.pack_id,
            type="ProjectExperience",
            title="项目经历",
            order=0,
            visibility="visible",
            status="needs_review",
            data={"items": [{"id": "item_guardrail", "description": "负责订单系统重构"}]},
            created_at=now,
            updated_at=now,
        )
    )
    claim = repo.save_document_claim(
        DocumentClaim(
            id="claim_guardrail",
            draft_id=draft.id,
            module_id=module.id,
            text="负责订单系统重构",
            claim_type=claim_type,
            confidence="inferred",
            item_id="item_guardrail",
            created_at=now,
            updated_at=now,
        )
    )
    issue = repo.save_revision_issue(
        RevisionIssue(
            id="issue_guardrail",
            run_id=run.id,
            document_id=document.id,
            draft_id=draft.id,
            module_id=module.id,
            claim_id=claim.id,
            type="missing_result",
            severity="warning",
            title="缺少结果",
            message="这条经历看不出业务结果。",
            reason="需要补充结果或降级表达。",
            status="open",
            created_by_agent="ResumeReviewer",
            created_at=now,
        )
    )
    proposal = repo.save_revision_proposal(
        RevisionProposal(
            id="prop_guardrail",
            run_id=run.id,
            document_id=document.id,
            draft_id=draft.id,
            target={"claim_id": claim.id},
            operation="replace_claim",
            original_snapshot={"text": claim.text},
            proposed_snapshot={"text": "主导订单系统重构，提升核心链路稳定性。"},
            summary="改成结果导向表达",
            rationale="原文只有动作，没有体现影响。",
            related_issue_ids=[issue.id],
            evidence_link_ids=[],
            confidence=0.8,
            risk_level="medium",
            requires_user_confirmation=True,
            status="pending",
            created_by_agent="ResumeRewriter",
            created_at=now,
        )
    )
    return {
        "document": document,
        "source": source,
        "run": run,
        "draft": draft,
        "module": module,
        "claim": claim,
        "issue": issue,
        "proposal": proposal,
    }


def test_agent_runtime_rejects_plain_text_outputs(tmp_path):
    repo = make_repository(tmp_path)
    run = seed_guardrail_workspace(repo)["run"]
    assert isinstance(run, RevisionRun)
    runtime = AgentRuntime(repo, make_schema_registry())
    context = build_agent_context(run, agent_name="ResumeReviewer")

    with pytest.raises(AgentRuntimeError) as exc_info:
        runtime.invoke(context, lambda _context: "建议你把这一段改得更专业。")

    step = repo.list_agent_steps(run.id)[0]
    failed_run = repo.get_revision_run(run.id)
    assert exc_info.value.step_status == "failed_schema"
    assert exc_info.value.code == "envelope_schema_invalid"
    assert step.status == "failed_schema"
    assert failed_run is not None
    assert failed_run.status == "failed_retryable"


def test_accepting_replace_claim_proposal_updates_claim_and_history(tmp_path):
    repo = make_repository(tmp_path)
    seeded = seed_guardrail_workspace(repo)
    proposal = seeded["proposal"]
    draft = seeded["draft"]
    issue = seeded["issue"]
    assert isinstance(proposal, RevisionProposal)
    assert isinstance(draft, DraftVersion)
    assert isinstance(issue, RevisionIssue)
    repo.save_render_projection(
        RenderProjection(
            id="render_stale",
            draft_id=draft.id,
            render_profile="default-a4",
            html="<article>负责订单系统重构</article>",
            doc_json={"type": "doc", "content": []},
            created_at=utc_now(),
        )
    )
    repo.save_draft_version(draft.model_copy(update={"render_projection_id": "render_stale"}))

    applied = ProposalService(repo).accept_proposal(proposal.id)

    updated_claim = repo.list_document_claims(draft.id)[0]
    updated_module = repo.list_document_modules(draft.id)[0]
    updated_draft = repo.get_draft_version(draft.id)
    updated_issue = repo.get_revision_issue(issue.id)
    assert applied.status == "applied"
    assert updated_claim.text == "主导订单系统重构，提升核心链路稳定性。"
    assert updated_module.data["items"][0]["description"] == "主导订单系统重构，提升核心链路稳定性。"
    assert updated_draft is not None
    assert updated_draft.applied_proposal_ids == [proposal.id]
    assert updated_draft.unresolved_issue_ids == []
    assert updated_draft.render_projection_id is None
    assert updated_issue is not None
    assert updated_issue.status == "accepted"


def test_accepting_draft_blocks_unconfirmed_achievement_claims(tmp_path):
    repo = make_repository(tmp_path)
    draft = seed_guardrail_workspace(repo, claim_type="achievement")["draft"]
    assert isinstance(draft, DraftVersion)

    with pytest.raises(RevisionServiceError) as exc_info:
        DraftService(repo).accept_draft(draft.id)

    assert "claim_guardrail" in str(exc_info.value)
    persisted_draft = repo.get_draft_version(draft.id)
    assert persisted_draft is not None
    assert persisted_draft.status == "in_review"


def test_accepting_draft_allows_achievement_claims_with_direct_evidence(tmp_path):
    repo = make_repository(tmp_path)
    seeded = seed_guardrail_workspace(repo, claim_type="achievement")
    document = seeded["document"]
    source = seeded["source"]
    claim = seeded["claim"]
    draft = seeded["draft"]
    assert isinstance(document, Document)
    assert isinstance(source, SourceDocument)
    assert isinstance(claim, DocumentClaim)
    assert isinstance(draft, DraftVersion)
    repo.save_evidence_link(
        EvidenceLink(
            id="ev_direct",
            document_id=document.id,
            source_document_id=source.id,
            claim_id=claim.id,
            support_level="direct",
            confidence=0.91,
            user_confirmed=False,
            extracted_text="主导订单系统重构",
            created_at=utc_now(),
        )
    )

    accepted = DraftService(repo).accept_draft(draft.id)

    assert accepted.status == "accepted"


def test_workspace_view_keeps_revision_objects_together(tmp_path):
    repo = make_repository(tmp_path)
    seeded = seed_guardrail_workspace(repo)
    document = seeded["document"]
    source = seeded["source"]
    claim = seeded["claim"]
    assert isinstance(document, Document)
    assert isinstance(source, SourceDocument)
    assert isinstance(claim, DocumentClaim)
    repo.save_evidence_link(
        EvidenceLink(
            id="ev_workspace",
            document_id=document.id,
            source_document_id=source.id,
            claim_id=claim.id,
            support_level="partial",
            confidence=0.72,
            user_confirmed=False,
            extracted_text="订单系统重构",
            created_at=utc_now(),
        )
    )

    view = WorkspaceService(repo).get_workspace_view(document.id)

    assert [issue.id for issue in view.issues] == ["issue_guardrail"]
    assert [proposal.id for proposal in view.proposals] == ["prop_guardrail"]
    assert [evidence.id for evidence in view.evidence] == ["ev_workspace"]
    assert {action.action_type for action in view.available_actions} == {
        "accept_proposal",
        "dismiss_issue",
        "reject_proposal",
    }
