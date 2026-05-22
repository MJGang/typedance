from typedance_sidecar.resume_agent_outputs import ResumeReviewOutput
from typedance_sidecar.resume_reviewer_runner import (
    ResumeReviewerRunRequest,
    RuleBasedResumeReviewerRunner,
)
from typedance_sidecar.revision_agent_runtime import build_agent_context
from typedance_sidecar.revision_models import DocumentClaim, DocumentModule, RevisionRun


def test_rule_based_resume_reviewer_runner_returns_review_output():
    context = build_agent_context(
        RevisionRun(
            id="run_review",
            document_id="doc_review",
            pack_id="resume",
            run_type="quality_review",
            status="created",
            created_at="2026-05-22T00:00:00.000Z",
            updated_at="2026-05-22T00:00:00.000Z",
        ),
        agent_name="ResumeReviewer",
    )
    request = ResumeReviewerRunRequest(
        modules=[
            DocumentModule(
                id="mod_basic",
                draft_id="draft_review",
                pack_id="resume",
                type="BasicInfo",
                title="基本信息",
                order=0,
                visibility="visible",
                status="needs_confirmation",
                data={"name": "张三", "phone": "13800000000"},
                created_at="2026-05-22T00:00:00.000Z",
                updated_at="2026-05-22T00:00:00.000Z",
            ),
            DocumentModule(
                id="mod_work",
                draft_id="draft_review",
                pack_id="resume",
                type="WorkExperience",
                title="工作经历",
                order=1,
                visibility="visible",
                status="needs_review",
                data={"items": [{"title": "订单系统重构"}]},
                created_at="2026-05-22T00:00:00.000Z",
                updated_at="2026-05-22T00:00:00.000Z",
            ),
            DocumentModule(
                id="mod_skills",
                draft_id="draft_review",
                pack_id="resume",
                type="CoreSkills",
                title="专业技能",
                order=2,
                visibility="visible",
                status="clean",
                data={"items": ["Vue3"]},
                created_at="2026-05-22T00:00:00.000Z",
                updated_at="2026-05-22T00:00:00.000Z",
            ),
        ],
        claims=[
            DocumentClaim(
                id="claim_work",
                draft_id="draft_review",
                module_id="mod_work",
                text="负责订单系统重构",
                claim_type="responsibility",
                confidence="inferred",
                created_at="2026-05-22T00:00:00.000Z",
                updated_at="2026-05-22T00:00:00.000Z",
            )
        ],
    )

    envelope = RuleBasedResumeReviewerRunner()(context, request)

    assert envelope["agent_name"] == "ResumeReviewer"
    assert envelope["output_type"] == "ResumeReviewOutput"
    payload = ResumeReviewOutput.model_validate(envelope["payload"])
    issue_types = {issue.type for issue in payload.issues}
    assert {"missing_contact", "missing_project_experience", "missing_result"} <= issue_types
    assert payload.quality_summary.status == "needs_review"
