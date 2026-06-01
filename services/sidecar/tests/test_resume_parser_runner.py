from typedance_sidecar.resume_agent_outputs import ParsedDocumentOutput
from typedance_sidecar.resume_parser_runner import (
    LangChainResumeParserRunner,
    ResumeParserRunRequest,
    RuleBasedResumeParserRunner,
    build_resume_parser_runner,
    load_resume_parser_runner_config,
)
from typedance_sidecar.revision_agent_runtime import build_agent_context
from typedance_sidecar.revision_models import RevisionRun


def test_rule_based_resume_parser_runner_returns_parsed_blocks():
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
        agent_name="SourceParser",
    )
    request = ResumeParserRunRequest(
        source_document_id="src_import",
        raw_text="张三\n电话：13800000000\n工作经历\n负责订单系统重构",
    )

    envelope = RuleBasedResumeParserRunner()(context, request)

    assert envelope["agent_name"] == "SourceParser"
    assert envelope["output_type"] == "ParsedDocumentOutput"
    payload = ParsedDocumentOutput.model_validate(envelope["payload"])
    assert payload.source_document_id == "src_import"
    assert [block.type for block in payload.blocks] == [
        "paragraph",
        "contact",
        "heading",
        "paragraph",
    ]


def test_rule_based_resume_parser_runner_recognizes_career_skills_heading():
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
        agent_name="SourceParser",
    )
    request = ResumeParserRunRequest(
        source_document_id="src_import",
        raw_text="职业技能",
    )

    envelope = RuleBasedResumeParserRunner()(context, request)

    payload = ParsedDocumentOutput.model_validate(envelope["payload"])
    assert payload.blocks[0].type == "heading"


def test_langchain_resume_parser_runner_uses_structured_output_model():
    seen = {}
    expected_payload = ParsedDocumentOutput.model_validate(
        {
            "source_document_id": "src_import",
            "blocks": [
                {
                    "type": "paragraph",
                    "text": "张三",
                    "order": 0,
                    "source_span": {"line": 0},
                    "confidence": 0.9,
                }
            ],
            "detected_language": "zh-CN",
            "parse_warnings": [],
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
            id="run_import",
            document_id="doc_import",
            pack_id="resume",
            run_type="import_reconstruct",
            status="created",
            created_at="2026-05-22T00:00:00.000Z",
            updated_at="2026-05-22T00:00:00.000Z",
        ),
        agent_name="SourceParser",
    )
    request = ResumeParserRunRequest(source_document_id="src_import", raw_text="张三")

    envelope = LangChainResumeParserRunner(model_factory=lambda: FakeModel())(context, request)

    assert seen["schema"] is ParsedDocumentOutput
    assert envelope["payload"] == expected_payload.model_dump()
    assert "src_import" in seen["messages"][1]["content"]


def test_resume_parser_runner_config_defaults_to_auto_and_rule_without_key(tmp_path):
    env = {"TYPEDANCE_DATA_DIR": str(tmp_path)}
    config = load_resume_parser_runner_config(env)
    runner = build_resume_parser_runner(env)

    assert config.mode == "auto"
    assert isinstance(runner, RuleBasedResumeParserRunner)


def test_resume_parser_runner_config_can_force_langchain_mode(tmp_path):
    runner = build_resume_parser_runner(
        {
            "TYPEDANCE_DATA_DIR": str(tmp_path),
            "TYPEDANCE_RESUME_PARSER_MODE": "langchain",
        }
    )

    assert isinstance(runner, LangChainResumeParserRunner)


def test_resume_parser_runner_auto_mode_uses_langchain_when_key_exists(tmp_path):
    runner = build_resume_parser_runner(
        {
            "TYPEDANCE_DATA_DIR": str(tmp_path),
            "TYPEDANCE_RESUME_PARSER_MODE": "auto",
            "DEEPSEEK_API_KEY": "test-key",
        }
    )

    assert isinstance(runner, LangChainResumeParserRunner)
