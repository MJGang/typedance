from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import (
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    EvidenceLink,
    ExportArtifact,
    ParsedBlock,
    RenderProjection,
    RevisionIssue,
    RevisionProposal,
    RevisionRun,
    SourceDocument,
)
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import (
    DraftService,
    EvidenceService,
    ExportService,
    IssueService,
    ProposalService,
    RenderService,
    SourceService,
    WorkspaceService,
)


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def seed_revision_workspace(repo: RevisionRepository) -> dict[str, object]:
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
    run = repo.save_revision_run(
        RevisionRun(
            id="run_1",
            document_id=document.id,
            pack_id="resume",
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
            run_id=run.id,
            pack_id="resume",
            status="in_review",
            summary="基于旧简历生成的新草稿",
            unresolved_issue_ids=["issue_1"],
            render_projection_id="render_1",
            created_at=now,
            updated_at=now,
        )
    )
    module = repo.save_document_module(
        DocumentModule(
            id="mod_1",
            draft_id=draft.id,
            pack_id="resume",
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
            text="负责订单系统重构",
            claim_type="responsibility",
            confidence="inferred",
            source_span_refs=["blk_1"],
            created_at=now,
            updated_at=now,
        )
    )
    evidence = repo.save_evidence_link(
        EvidenceLink(
            id="ev_1",
            document_id=document.id,
            source_document_id=source.id,
            claim_id=claim.id,
            support_level="partial",
            confidence=0.72,
            user_confirmed=False,
            extracted_text="负责订单系统重构",
            created_at=now,
        )
    )
    issue = repo.save_revision_issue(
        RevisionIssue(
            id="issue_1",
            run_id=run.id,
            document_id=document.id,
            draft_id=draft.id,
            module_id=module.id,
            claim_id=claim.id,
            type="missing_result",
            severity="blocking",
            title="缺少结果",
            message="这条经历看不出业务结果。",
            reason="投递前需要补充结果或降级表达。",
            status="open",
            created_by_agent="ResumeReviewer",
            evidence_link_ids=[evidence.id],
            created_at=now,
        )
    )
    proposal = repo.save_revision_proposal(
        RevisionProposal(
            id="prop_1",
            run_id=run.id,
            document_id=document.id,
            draft_id=draft.id,
            target={"claim_id": claim.id},
            operation="replace_claim",
            original_snapshot={"text": claim.text},
            proposed_snapshot={"text": "主导订单系统重构，提升核心链路稳定性。"},
            summary="让表达更结果导向",
            rationale="原文只有动作，没有体现影响。",
            related_issue_ids=[issue.id],
            evidence_link_ids=[evidence.id],
            confidence=0.8,
            risk_level="medium",
            requires_user_confirmation=True,
            status="pending",
            created_by_agent="ResumeRewriter",
            created_at=now,
        )
    )
    projection = repo.save_render_projection(
        RenderProjection(
            id="render_1",
            draft_id=draft.id,
            render_profile="default-a4",
            html="<article>张三的简历</article>",
            doc_json={"type": "doc", "content": []},
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
        "evidence": evidence,
        "issue": issue,
        "proposal": proposal,
        "projection": projection,
    }


def test_source_service_stores_sources_and_parsed_blocks(tmp_path):
    repo = make_repository(tmp_path)
    now = utc_now()
    document = repo.save_document(
        Document(
            id="doc_1",
            pack_id="resume",
            title="张三的简历",
            status="active",
            target_language="zh-CN",
            created_at=now,
            updated_at=now,
        )
    )
    service = SourceService(repo)

    source = service.save_source(
        SourceDocument(
            id="src_1",
            document_id=document.id,
            source_type="pasted_text",
            title="粘贴内容",
            raw_text="项目经历：订单系统",
            parse_status="parsed",
            created_at=now,
        )
    )
    block = service.save_parsed_block(
        ParsedBlock(
            id="blk_1",
            source_document_id=source.id,
            type="paragraph",
            text="项目经历：订单系统",
            order=0,
        )
    )

    assert service.list_sources(document.id) == [source]
    assert service.list_parsed_blocks(source.id) == [block]


def test_draft_service_accepts_draft_and_updates_document(tmp_path):
    repo = make_repository(tmp_path)
    seeded = seed_revision_workspace(repo)
    draft = seeded["draft"]
    assert isinstance(draft, DraftVersion)

    accepted = DraftService(repo).accept_draft(draft.id)
    document = repo.get_document("doc_1")

    assert accepted.status == "accepted"
    assert document is not None
    assert document.current_draft_id == draft.id
    assert document.accepted_draft_id == draft.id


def test_issue_and_proposal_services_update_related_state(tmp_path):
    repo = make_repository(tmp_path)
    seeded = seed_revision_workspace(repo)
    proposal = seeded["proposal"]
    assert isinstance(proposal, RevisionProposal)

    applied = ProposalService(repo).accept_proposal(proposal.id)
    draft = repo.get_draft_version("draft_1")
    issue = repo.get_revision_issue("issue_1")

    assert applied.status == "applied"
    assert draft is not None
    assert draft.applied_proposal_ids == [proposal.id]
    assert draft.unresolved_issue_ids == []
    assert issue is not None
    assert issue.status == "accepted"

    dismissed = IssueService(repo).dismiss_issue("issue_1")
    assert dismissed.status == "dismissed"


def test_evidence_service_confirms_claims_and_evidence_links(tmp_path):
    repo = make_repository(tmp_path)
    seeded = seed_revision_workspace(repo)
    claim = seeded["claim"]
    evidence = seeded["evidence"]
    assert isinstance(claim, DocumentClaim)
    assert isinstance(evidence, EvidenceLink)

    service = EvidenceService(repo)
    confirmation = service.confirm_claim(
        "doc_1",
        claim.id,
        issue_id="issue_1",
        note="用户确认该经历真实发生。",
        confirmation_id="confirm_1",
    )
    confirmed_evidence = service.confirm_evidence_link(evidence.id)

    assert confirmation.confirmation_type == "truth_confirmed"
    assert confirmation.claim_id == claim.id
    assert confirmed_evidence.user_confirmed is True


def test_workspace_service_aggregates_current_revision_view(tmp_path):
    repo = make_repository(tmp_path)
    seed_revision_workspace(repo)

    view = WorkspaceService(repo).get_workspace_view("doc_1")

    assert view.document.id == "doc_1"
    assert view.current_draft is not None
    assert view.current_draft.id == "draft_1"
    assert [module.id for module in view.modules] == ["mod_1"]
    assert [claim.id for claim in view.claims] == ["claim_1"]
    assert [issue.id for issue in view.issues] == ["issue_1"]
    assert [proposal.id for proposal in view.proposals] == ["prop_1"]
    assert [evidence.id for evidence in view.evidence] == ["ev_1"]
    assert [source.id for source in view.source_summaries] == ["src_1"]
    assert view.render_projection is not None
    assert view.render_projection.id == "render_1"
    assert view.quality_gate is not None
    assert view.quality_gate.status == "blocked"
    assert view.quality_gate.blocking_issue_ids == ["issue_1"]


def test_render_and_export_services_wrap_repository_operations(tmp_path):
    repo = make_repository(tmp_path)
    seeded = seed_revision_workspace(repo)
    projection = seeded["projection"]
    assert isinstance(projection, RenderProjection)

    artifact = ExportArtifact(
        id="export_1",
        document_id="doc_1",
        draft_id="draft_1",
        format="pdf",
        file_path="resume.pdf",
        review_status="passed",
        created_at=utc_now(),
    )

    assert RenderService(repo).get_projection(projection.id) == projection
    assert ExportService(repo).save_artifact(artifact) == artifact
    assert ExportService(repo).list_artifacts("doc_1") == [artifact]
