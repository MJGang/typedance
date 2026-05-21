import pytest

from typedance_sidecar.resume_agent_outputs import (
    CoachNarrationOutput,
    ParsedDocumentOutput,
    ResumeReviewOutput,
    ResumeRewriteOutput,
    register_resume_agent_output_schemas,
    resume_agent_output_schemas,
)
from typedance_sidecar.revision_agent_runtime import (
    AgentOutputEnvelope,
    AgentRuntimeError,
    AgentSchemaRegistry,
)


def make_envelope(output_type: str, payload: dict):
    return AgentOutputEnvelope(
        invocation_id="inv_1",
        run_id="run_1",
        document_id="doc_1",
        pack_id="resume",
        agent_name="TestAgent",
        output_type=output_type,
        confidence=0.9,
        warnings=[],
        payload=payload,
    )


def test_resume_agent_output_schemas_register_all_expected_types():
    schemas = resume_agent_output_schemas()
    registry = register_resume_agent_output_schemas(AgentSchemaRegistry())

    assert set(schemas) == {
        "ParsedDocumentOutput",
        "StructuredResumeOutput",
        "ResumeReviewOutput",
        "ResumeRewriteOutput",
        "EvidenceVerificationOutput",
        "OpportunityCalibrationOutput",
        "RenderPlanOutput",
        "CoachNarrationOutput",
    }
    assert registry.validate(
        make_envelope(
            "ParsedDocumentOutput",
            {
                "source_document_id": "src_1",
                "blocks": [],
                "detected_language": "unknown",
                "parse_warnings": [],
            },
        )
    )


def test_parser_output_validates_structured_blocks():
    registry = register_resume_agent_output_schemas(AgentSchemaRegistry())

    payload = registry.validate(
        make_envelope(
            "ParsedDocumentOutput",
            {
                "source_document_id": "src_1",
                "blocks": [
                    {
                        "type": "paragraph",
                        "text": "负责订单系统重构",
                        "order": 0,
                        "source_span": {"start": 0, "end": 8},
                        "confidence": 0.96,
                    }
                ],
                "detected_language": "zh-CN",
                "parse_warnings": [],
            },
        )
    )

    assert isinstance(payload, ParsedDocumentOutput)
    assert payload.blocks[0].text == "负责订单系统重构"
    assert payload.blocks[0].confidence == 0.96


def test_reviewer_output_requires_locatable_issues():
    registry = register_resume_agent_output_schemas(AgentSchemaRegistry())

    payload = registry.validate(
        make_envelope(
            "ResumeReviewOutput",
            {
                "issues": [
                    {
                        "type": "missing_result",
                        "severity": "warning",
                        "title": "缺少结果",
                        "message": "这条经历看不出业务结果。",
                        "reason": "HR 难以判断影响范围。",
                        "target": {"module_type": "ProjectExperience", "claim_id": "claim_1"},
                        "evidence_link_refs": [],
                        "action_templates": [
                            {
                                "action_type": "request_user_input",
                                "label": "补充结果",
                                "target": {"claim_id": "claim_1"},
                            }
                        ],
                    }
                ],
                "quality_summary": {
                    "status": "needs_review",
                    "blocking_count": 0,
                    "warning_count": 1,
                    "summary": "有 1 个表达问题需要处理。",
                },
            },
        )
    )

    assert isinstance(payload, ResumeReviewOutput)
    assert payload.issues[0].target.claim_id == "claim_1"
    assert payload.issues[0].action_templates[0].action_type == "request_user_input"


def test_rewriter_output_supports_proposals_and_follow_up_questions():
    registry = register_resume_agent_output_schemas(AgentSchemaRegistry())

    payload = registry.validate(
        make_envelope(
            "ResumeRewriteOutput",
            {
                "proposals": [
                    {
                        "target": {"claim_id": "claim_1"},
                        "operation": "replace_claim",
                        "before": {"text": "负责订单系统重构"},
                        "after": {"text": "主导订单系统重构，提升核心链路稳定性。"},
                        "summary": "改成结果导向表达",
                        "rationale": "原文只有动作，没有说明影响。",
                        "evidence_link_refs": ["ev_1"],
                        "confidence": 0.81,
                        "risk_level": "medium",
                        "requires_user_confirmation": True,
                        "related_issue_refs": ["issue_1"],
                    }
                ],
                "follow_up_questions": [
                    {
                        "target": {"claim_id": "claim_1"},
                        "question": "这个重构上线后有没有可确认的稳定性指标？",
                        "expected_answer_type": "short_text",
                        "reason": "避免虚构具体指标。",
                        "blocking": False,
                    }
                ],
            },
        )
    )

    assert isinstance(payload, ResumeRewriteOutput)
    assert payload.proposals[0].requires_user_confirmation is True
    assert payload.follow_up_questions[0].blocking is False


def test_coach_output_is_structured_not_freeform_chat():
    registry = register_resume_agent_output_schemas(AgentSchemaRegistry())

    payload = registry.validate(
        make_envelope(
            "CoachNarrationOutput",
            {
                "summary": "这段项目经历现在能看出你做了什么，但还看不出结果。",
                "next_best_actions": [
                    {
                        "id": "act_1",
                        "label": "补充结果",
                        "action_type": "request_user_input",
                        "target": {"claim_id": "claim_1"},
                    }
                ],
                "tone": "encouraging",
            },
        )
    )

    assert isinstance(payload, CoachNarrationOutput)
    assert payload.next_best_actions[0].target is not None
    assert payload.next_best_actions[0].target.claim_id == "claim_1"


def test_agent_output_contract_rejects_invalid_confidence():
    registry = register_resume_agent_output_schemas(AgentSchemaRegistry())

    with pytest.raises(AgentRuntimeError) as exc_info:
        registry.validate(
            make_envelope(
                "ParsedDocumentOutput",
                {
                    "source_document_id": "src_1",
                    "blocks": [
                        {
                            "type": "paragraph",
                            "text": "负责订单系统重构",
                            "order": 0,
                            "confidence": 1.2,
                        }
                    ],
                },
            )
        )

    assert exc_info.value.code == "payload_schema_invalid"
