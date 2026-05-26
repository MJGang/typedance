from typedance_sidecar.resume_agent_outputs import StructuredResumeOutput
from typedance_sidecar.resume_structurer_runner import (
    LangChainResumeStructurerRunner,
    ResumeStructurerRunRequest,
    RuleBasedResumeStructurerRunner,
    build_resume_structurer_runner,
    load_resume_structurer_runner_config,
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


def test_langchain_resume_structurer_runner_uses_structured_output_model():
    seen = {}
    expected_payload = StructuredResumeOutput.model_validate(
        {
            "modules": [
                {
                    "temp_id": "module_basic_info",
                    "type": "BasicInfo",
                    "title": "基本信息",
                    "order": 0,
                    "visibility": "visible",
                    "status": "needs_confirmation",
                    "data": {"name": "张三"},
                    "source_block_refs": ["block_name"],
                    "confidence": 0.82,
                }
            ],
            "claims": [],
            "unresolved_blocks": [],
            "structure_warnings": [],
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
        agent_name="ResumeStructurer",
    )
    request = ResumeStructurerRunRequest(
        document_title="旧简历重构",
        pack_id="resume",
        parsed_blocks=[],
    )

    envelope = LangChainResumeStructurerRunner(model_factory=lambda: FakeModel())(context, request)

    assert seen["schema"] is StructuredResumeOutput
    assert envelope["payload"] == expected_payload.model_dump()
    assert "StructuredResumeOutput" in seen["messages"][0]["content"]


def test_resume_structurer_runner_config_defaults_to_auto_and_rule_without_key(tmp_path):
    env = {"TYPEDANCE_DATA_DIR": str(tmp_path)}
    config = load_resume_structurer_runner_config(env)
    runner = build_resume_structurer_runner(env)

    assert config.mode == "auto"
    assert isinstance(runner, RuleBasedResumeStructurerRunner)


def test_resume_structurer_runner_config_can_force_langchain_mode(tmp_path):
    runner = build_resume_structurer_runner(
        {
            "TYPEDANCE_DATA_DIR": str(tmp_path),
            "TYPEDANCE_RESUME_STRUCTURER_MODE": "langchain",
        }
    )

    assert isinstance(runner, LangChainResumeStructurerRunner)


def test_resume_structurer_runner_auto_mode_uses_langchain_when_key_exists(tmp_path):
    runner = build_resume_structurer_runner(
        {
            "TYPEDANCE_DATA_DIR": str(tmp_path),
            "TYPEDANCE_RESUME_STRUCTURER_MODE": "auto",
            "DEEPSEEK_API_KEY": "test-key",
        }
    )

    assert isinstance(runner, LangChainResumeStructurerRunner)
