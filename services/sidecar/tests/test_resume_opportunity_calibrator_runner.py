from typedance_sidecar.resume_agent_outputs import OpportunityCalibrationOutput
from typedance_sidecar.resume_opportunity_calibrator_runner import (
    LangChainOpportunityCalibratorRunner,
    OpportunityCalibratorRunRequest,
    RuleBasedOpportunityCalibratorRunner,
    build_opportunity_calibrator_runner,
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


def test_langchain_opportunity_calibrator_runner_uses_structured_output_model():
    seen = {}
    expected_payload = OpportunityCalibrationOutput.model_validate(
        {
            "opportunity_requirements": [
                {
                    "type": "skill",
                    "text": "React",
                    "importance": "required",
                    "evidence_status": "missing",
                }
            ],
            "match_summary": {
                "matched_count": 0,
                "partial_count": 0,
                "missing_count": 1,
                "summary": "岗位要求中 1 项缺少基础事实支撑。",
            },
            "issues": [],
            "proposals": [],
            "variant_plan": {
                "title": "前端工程师岗位版本",
                "base_draft_ref": "DraftVersion:draft_base",
                "proposal_refs": [],
                "risk_notes": [],
            },
        }
    )

    class FakeStructuredModel:
        def invoke(self, messages):
            seen["messages"] = messages
            return expected_payload

    class FakeModel:
        def with_structured_output(self, schema):
            seen["schema"] = schema
            return FakeStructuredModel()

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
        source_text="要求：React",
        base_draft_id="draft_base",
        variant_draft_id="draft_variant",
    )

    envelope = LangChainOpportunityCalibratorRunner(model_factory=lambda: FakeModel())(context, request)

    assert seen["schema"] is OpportunityCalibrationOutput
    assert envelope["payload"] == expected_payload.model_dump()
    assert "opportunity_calibrate" in seen["messages"][1]["content"]


def test_opportunity_calibrator_runner_defaults_to_rule(tmp_path):
    runner = build_opportunity_calibrator_runner({"TYPEDANCE_DATA_DIR": str(tmp_path)})

    assert isinstance(runner, RuleBasedOpportunityCalibratorRunner)


def test_opportunity_calibrator_runner_uses_langchain_mode(tmp_path):
    runner = build_opportunity_calibrator_runner(
        {
            "TYPEDANCE_DATA_DIR": str(tmp_path),
            "TYPEDANCE_RESUME_OPPORTUNITY_CALIBRATOR_MODE": "langchain",
        }
    )

    assert isinstance(runner, LangChainOpportunityCalibratorRunner)
