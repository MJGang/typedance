from typedance_sidecar.resume_agent_outputs import OpportunityCalibrationOutput
from typedance_sidecar.resume_opportunity_calibrator_runner import (
    OpportunityCalibratorRunRequest,
    RuleBasedOpportunityCalibratorRunner,
)
from typedance_sidecar.revision_agent_runtime import build_agent_context
from typedance_sidecar.revision_models import DocumentClaim, DocumentModule, RevisionRun


def test_rule_based_opportunity_calibrator_returns_gap_output():
    context = build_agent_context(
        RevisionRun(
            id="run_opp",
            document_id="doc_opp",
            pack_id="resume",
            run_type="opportunity_calibrate",
            status="created",
            created_at="2026-05-22T00:00:00.000Z",
            updated_at="2026-05-22T00:00:00.000Z",
        ),
        agent_name="OpportunityCalibrator",
    )
    request = OpportunityCalibratorRunRequest(
        source_title="前端工程师岗位",
        source_text="要求：React、TypeScript、Node.js、数据可视化",
        base_draft_id="draft_base",
        variant_draft_id="draft_variant",
        modules=[
            DocumentModule(
                id="mod_skills",
                draft_id="draft_variant",
                pack_id="resume",
                type="CoreSkills",
                title="专业技能",
                order=0,
                visibility="visible",
                status="clean",
                data={"items": ["Vue3", "TypeScript"]},
                created_at="2026-05-22T00:00:00.000Z",
                updated_at="2026-05-22T00:00:00.000Z",
            )
        ],
        claims=[
            DocumentClaim(
                id="claim_skill",
                draft_id="draft_variant",
                module_id="mod_skills",
                text="Vue3",
                claim_type="skill",
                confidence="user_confirmed",
                created_at="2026-05-22T00:00:00.000Z",
                updated_at="2026-05-22T00:00:00.000Z",
            )
        ],
    )

    envelope = RuleBasedOpportunityCalibratorRunner()(context, request)

    assert envelope["agent_name"] == "OpportunityCalibrator"
    assert envelope["output_type"] == "OpportunityCalibrationOutput"
    payload = OpportunityCalibrationOutput.model_validate(envelope["payload"])
    assert any(req.text == "React" and req.evidence_status == "missing" for req in payload.opportunity_requirements)
    assert any(issue.type == "missing_opportunity_requirement" for issue in payload.issues)
    assert payload.proposals
    assert payload.variant_plan.base_draft_ref == "DraftVersion:draft_base"
