from typedance_sidecar.resume_agent_outputs import StructuredResumeOutput
from typedance_sidecar.resume_structurer_runner import (
    ResumeStructurerRunRequest,
    RuleBasedResumeStructurerRunner,
)
from typedance_sidecar.revision_agent_runtime import build_agent_context
from typedance_sidecar.revision_models import ParsedBlock, RevisionRun


def test_rule_based_resume_structurer_runner_returns_modules_and_claims():
    context = build_agent_context(
        RevisionRun(
            id="run_import",
            document_id="doc_import",
            pack_id="resume",
            run_type="import_reconstruct",
            status="created",
            created_at="2026-05-22T00:00:00.000Z",
            updated_at="2026-05-22T00:00:00.000Z",
        ),
        agent_name="ResumeStructurer",
    )
    blocks = [
        ParsedBlock(
            id="block_name",
            source_document_id="src_import",
            type="paragraph",
            text="张三",
            order=0,
        ),
        ParsedBlock(
            id="block_work_heading",
            source_document_id="src_import",
            type="heading",
            text="工作经历",
            order=1,
        ),
        ParsedBlock(
            id="block_work_item",
            source_document_id="src_import",
            type="paragraph",
            text="前端工程师 / 星河科技 / 2022.03 - 2025.05",
            order=2,
        ),
        ParsedBlock(
            id="block_work_bullet",
            source_document_id="src_import",
            type="paragraph",
            text="负责订单系统重构",
            order=3,
        ),
    ]
    request = ResumeStructurerRunRequest(
        document_title="旧简历重构",
        pack_id="resume",
        parsed_blocks=blocks,
    )

    envelope = RuleBasedResumeStructurerRunner()(context, request)

    assert envelope["agent_name"] == "ResumeStructurer"
    assert envelope["output_type"] == "StructuredResumeOutput"
    payload = StructuredResumeOutput.model_validate(envelope["payload"])
    assert {module.type for module in payload.modules} >= {"BasicInfo", "WorkExperience"}
    assert any(claim.text == "负责订单系统重构" for claim in payload.claims)
