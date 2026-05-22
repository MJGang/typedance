from typedance_sidecar.resume_agent_outputs import ResumeReviewOutput
from typedance_sidecar.resume_reviewer_runner import (
    LangChainResumeReviewerRunner,
    ResumeReviewerRunRequest,
    RuleBasedResumeReviewerRunner,
    build_resume_reviewer_runner,
    load_resume_reviewer_runner_config,
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


def test_langchain_resume_reviewer_runner_uses_structured_output_model():
    seen = {}
    expected_payload = ResumeReviewOutput.model_validate(
        {
            "issues": [
                {
                    "type": "missing_result",
                    "severity": "warning",
                    "title": "经历缺少结果",
                    "message": "这条经历缺少可确认的结果。",
                    "reason": "结果能提升简历可信度。",
                    "target": {"module_id": "mod_work", "claim_id": "claim_work"},
                    "original_text": "负责订单系统重构",
                    "evidence_link_refs": [],
                    "action_templates": [],
                }
            ],
            "quality_summary": {
                "status": "needs_review",
                "blocking_count": 0,
                "warning_count": 1,
                "summary": "发现 1 个待优化问题。",
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
    request = ResumeReviewerRunRequest()

    envelope = LangChainResumeReviewerRunner(model_factory=lambda: FakeModel())(context, request)

    assert seen["schema"] is ResumeReviewOutput
    assert envelope["payload"] == expected_payload.model_dump()
    assert "quality_review" in seen["messages"][1]["content"]


def test_resume_reviewer_runner_config_defaults_to_rule_mode():
    config = load_resume_reviewer_runner_config({})
    runner = build_resume_reviewer_runner({})

    assert config.mode == "rule"
    assert isinstance(runner, RuleBasedResumeReviewerRunner)


def test_resume_reviewer_runner_config_can_force_langchain_mode():
    runner = build_resume_reviewer_runner({"TYPEDANCE_RESUME_REVIEWER_MODE": "langchain"})

    assert isinstance(runner, LangChainResumeReviewerRunner)


def test_resume_reviewer_runner_auto_mode_uses_langchain_when_key_exists():
    runner = build_resume_reviewer_runner(
        {
            "TYPEDANCE_RESUME_REVIEWER_MODE": "auto",
            "DEEPSEEK_API_KEY": "test-key",
        }
    )

    assert isinstance(runner, LangChainResumeReviewerRunner)
