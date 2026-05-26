import pytest

from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import (
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    EvidenceLink,
    RevisionRun,
    SourceDocument,
)
from typedance_sidecar.revision_opportunity_calibration import RevisionOpportunityCalibrationService
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import RevisionServiceError, WorkspaceService


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def seed_opportunity_workspace(repo: RevisionRepository, *, include_source: bool = True) -> tuple[Document, DraftVersion, RevisionRun]:
    now = utc_now()
    document = repo.save_document(
        Document(
            id="doc_opp",
            pack_id="resume",
            title="基础简历",
            status="active",
            target_language="zh-CN",
            current_draft_id="draft_base",
            created_at=now,
            updated_at=now,
        )
    )
    draft = repo.save_draft_version(
        DraftVersion(
            id="draft_base",
            document_id=document.id,
            run_id="run_base",
            pack_id=document.pack_id,
            status="in_review",
            summary="基础简历",
            created_at=now,
            updated_at=now,
        )
    )
    skills = repo.save_document_module(
        DocumentModule(
            id="mod_skills",
            draft_id=draft.id,
            pack_id=document.pack_id,
            type="CoreSkills",
            title="专业技能",
            order=0,
            visibility="visible",
            status="clean",
            data={"items": ["Vue3", "TypeScript"]},
            created_at=now,
            updated_at=now,
        )
    )
    project = repo.save_document_module(
        DocumentModule(
            id="mod_project",
            draft_id=draft.id,
            pack_id=document.pack_id,
            type="ProjectExperience",
            title="项目经历",
            order=1,
            visibility="visible",
            status="needs_review",
            data={"items": [{"title": "简历系统", "bullets": ["使用 Vue3 和 TypeScript 搭建编辑器"]}]},
            created_at=now,
            updated_at=now,
        )
    )
    skill_claim = repo.save_document_claim(
        DocumentClaim(
            id="claim_skill",
            draft_id=draft.id,
            module_id=skills.id,
            text="Vue3",
            claim_type="skill",
            confidence="user_confirmed",
            created_at=now,
            updated_at=now,
        )
    )
    repo.save_document_claim(
        DocumentClaim(
            id="claim_project",
            draft_id=draft.id,
            module_id=project.id,
            text="使用 Vue3 和 TypeScript 搭建编辑器",
            claim_type="responsibility",
            confidence="supported",
            created_at=now,
            updated_at=now,
        )
    )
    repo.save_evidence_link(
        EvidenceLink(
            id="ev_skill",
            document_id=document.id,
            source_document_id="src_user",
            claim_id=skill_claim.id,
            support_level="direct",
            confidence=0.9,
            user_confirmed=True,
            extracted_text="Vue3",
            normalized_fact="Vue3",
            created_at=now,
        )
    )
    source_ids: list[str] = []
    if include_source:
        source = repo.save_source_document(
            SourceDocument(
                id="src_opp",
                document_id=document.id,
                source_type="external_context",
                title="前端工程师岗位",
                raw_text="要求：React、TypeScript、Node.js、数据可视化",
                parse_status="pending",
                created_at=now,
            )
        )
        source_ids.append(source.id)
    run = repo.save_revision_run(
        RevisionRun(
            id="run_opp",
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="opportunity_calibrate",
            status="created",
            source_document_ids=source_ids,
            base_draft_id=draft.id,
            created_at=now,
            updated_at=now,
        )
    )
    return document, draft, run


def test_opportunity_calibration_creates_variant_without_fabricating_claims(tmp_path):
    repo = make_repository(tmp_path)
    document, base_draft, run = seed_opportunity_workspace(repo)

    completed_run = RevisionOpportunityCalibrationService(repo).run_opportunity_calibrate(document.id, run.id)

    assert completed_run.status == "completed"
    assert completed_run.target_draft_id is not None
    assert completed_run.target_draft_id != base_draft.id

    drafts = repo.list_draft_versions(document.id)
    assert {draft.variant_type for draft in drafts} == {"base", "opportunity"}
    assert repo.get_document(document.id).current_draft_id == completed_run.target_draft_id

    workspace = WorkspaceService(repo).get_workspace_view(document.id)
    assert workspace.current_draft is not None
    assert workspace.current_draft.variant_type == "opportunity"
    assert workspace.render_projection is not None
    assert {module.type for module in workspace.modules} >= {"CoreSkills", "ProjectExperience"}
    assert all("React" not in claim.text for claim in workspace.claims)
    assert any(issue.type == "missing_opportunity_requirement" for issue in workspace.issues)
    assert any(issue.type == "overfit_risk" for issue in workspace.issues)
    assert workspace.proposals

    steps = repo.list_agent_steps(run.id)
    calibrator_steps = [step for step in steps if step.agent_name == "OpportunityCalibrator"]
    assert len(calibrator_steps) == 1
    assert "SourceDocument:src_opp" in calibrator_steps[0].input_refs
    assert any(ref.startswith("DocumentModule:") for ref in calibrator_steps[0].input_refs)
    assert any(ref.startswith("RevisionIssue:") for ref in calibrator_steps[0].output_refs)
    assert any(ref.startswith("RevisionProposal:") for ref in calibrator_steps[0].output_refs)


def test_opportunity_calibration_requires_external_context(tmp_path):
    repo = make_repository(tmp_path)
    document, _base_draft, run = seed_opportunity_workspace(repo, include_source=False)

    with pytest.raises(RevisionServiceError, match="Opportunity calibration requires external context"):
        RevisionOpportunityCalibrationService(repo).run_opportunity_calibrate(document.id, run.id)

    failed_run = repo.get_revision_run(run.id)
    assert failed_run is not None
    assert failed_run.status == "failed_retryable"


def test_opportunity_calibration_surfaces_calibrator_runtime_failure(tmp_path):
    repo = make_repository(tmp_path)
    document, _base_draft, run = seed_opportunity_workspace(repo)

    def raise_model_error(_context, _request):
        raise RuntimeError("calibrator model timeout")

    service = RevisionOpportunityCalibrationService(repo, calibrator_runner=raise_model_error)

    with pytest.raises(RevisionServiceError, match="calibrator model timeout"):
        service.run_opportunity_calibrate(document.id, run.id)

    failed_run = repo.get_revision_run(run.id)
    steps = repo.list_agent_steps(run.id)

    assert failed_run is not None
    assert failed_run.status == "failed_retryable"
    assert failed_run.output_summary == "calibrator model timeout"
    assert steps[-1].agent_name == "OpportunityCalibrator"
    assert steps[-1].status == "failed_model"
