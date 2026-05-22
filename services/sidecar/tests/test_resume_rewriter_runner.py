from typedance_sidecar.resume_agent_outputs import ResumeRewriteOutput
from typedance_sidecar.resume_rewriter_runner import (
    LangChainResumeRewriterRunner,
    ResumeRewriterRunRequest,
    RuleBasedResumeRewriterRunner,
    build_resume_rewriter_runner,
    load_resume_rewriter_runner_config,
)
from typedance_sidecar.revision_agent_runtime import build_agent_context
from typedance_sidecar.revision_models import RevisionRun


def make_request() -> ResumeRewriterRunRequest:
    return ResumeRewriterRunRequest(
        proposal_id="prop_1",
        issue_id="issue_1",
        issue_type="missing_result",
        issue_title="缺少结果",
        issue_message="这条经历看不出业务结果。",
        issue_reason="需要补充影响范围。",
        target={"module_id": "mod_1", "claim_id": "claim_1"},
        original_text="负责订单系统重构",
        user_intent="上线后接口错误率下降 30%。",
        evidence_link_ids=["ev_1"],
        risk_level="medium",
    )


def make_context():
    return build_agent_context(
        RevisionRun(
            id="run_1",
            document_id="doc_1",
            pack_id="resume",
            run_type="issue_action",
            status="created",
            created_at="2026-05-22T00:00:00.000Z",
            updated_at="2026-05-22T00:00:00.000Z",
        ),
        agent_name="ResumeRewriter",
    )


def test_rule_based_resume_rewriter_runner_returns_structured_envelope():
    envelope = RuleBasedResumeRewriterRunner()(make_context(), make_request())

    assert envelope["agent_name"] == "ResumeRewriter"
    assert envelope["output_type"] == "ResumeRewriteOutput"
    assert envelope["output_refs"] == ["RevisionProposal:prop_1"]
    payload = ResumeRewriteOutput.model_validate(envelope["payload"])
    assert payload.proposals[0].after == {
        "text": "负责订单系统重构，上线后接口错误率下降 30%。"
    }


def test_langchain_resume_rewriter_runner_uses_structured_output_model():
    seen = {}
    expected_payload = ResumeRewriteOutput.model_validate(
        {
            "proposals": [
                {
                    "target": {"module_id": "mod_1", "claim_id": "claim_1"},
                    "operation": "replace_claim",
                    "before": {"text": "负责订单系统重构"},
                    "after": {"text": "主导订单系统重构，上线后接口错误率下降 30%。"},
                    "summary": "改成结果导向表达",
                    "rationale": "用户提供了可确认的结果事实。",
                    "evidence_link_refs": ["ev_1"],
                    "confidence": 0.82,
                    "risk_level": "medium",
                    "requires_user_confirmation": False,
                    "related_issue_refs": ["issue_1"],
                }
            ],
            "follow_up_questions": [],
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

    runner = LangChainResumeRewriterRunner(model_factory=lambda: FakeModel())
    envelope = runner(make_context(), make_request())

    assert seen["schema"] is ResumeRewriteOutput
    assert envelope["output_refs"] == ["RevisionProposal:prop_1"]
    assert envelope["payload"] == expected_payload.model_dump()
    assert make_request().user_intent.rstrip("。") in seen["messages"][1]["content"]


def test_resume_rewriter_runner_config_defaults_to_rule_mode():
    config = load_resume_rewriter_runner_config({})
    runner = build_resume_rewriter_runner({})

    assert config.mode == "rule"
    assert isinstance(runner, RuleBasedResumeRewriterRunner)


def test_resume_rewriter_runner_config_can_force_langchain_mode():
    runner = build_resume_rewriter_runner({"TYPEDANCE_RESUME_REWRITER_MODE": "langchain"})

    assert isinstance(runner, LangChainResumeRewriterRunner)


def test_resume_rewriter_runner_auto_mode_uses_langchain_when_key_exists():
    runner = build_resume_rewriter_runner(
        {
            "TYPEDANCE_RESUME_REWRITER_MODE": "auto",
            "DEEPSEEK_API_KEY": "test-key",
        }
    )

    assert isinstance(runner, LangChainResumeRewriterRunner)
