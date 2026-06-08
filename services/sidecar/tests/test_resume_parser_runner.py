import json

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


def parser_request(content):
    return ResumeParserRunRequest(
        source_document_id="src_import",
        source_canvas_id="canvas_import",
        source_canvas_version=1,
        source_canvas_doc_json={"type": "doc", "content": content},
    )


def paragraph(text: str):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def heading(text: str):
    return {
        "type": "heading",
        "attrs": {"level": 2},
        "content": [{"type": "text", "text": text}],
    }


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
    request = parser_request(
        [
            paragraph("张三"),
            paragraph("电话：13800000000"),
            heading("工作经历"),
            paragraph("负责订单系统重构"),
        ]
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
    request = parser_request([paragraph("职业技能")])

    envelope = RuleBasedResumeParserRunner()(context, request)

    payload = ParsedDocumentOutput.model_validate(envelope["payload"])
    assert payload.blocks[0].type == "heading"


def test_rule_based_resume_parser_runner_preserves_nested_source_canvas_list_items():
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
    request = parser_request(
        [
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "attrs": {
                            "canvasNodeId": "node_outer",
                            "sourceBlockId": "src_import_0001",
                        },
                        "content": [
                            paragraph("TypeDance"),
                            {
                                "type": "bulletList",
                                "content": [
                                    {
                                        "type": "listItem",
                                        "attrs": {
                                            "canvasNodeId": "node_inner",
                                            "sourceBlockId": "src_import_0002",
                                        },
                                        "content": [paragraph("初始化 source canvas")],
                                    }
                                ],
                            },
                        ],
                    }
                ],
            }
        ]
    )

    envelope = RuleBasedResumeParserRunner()(context, request)

    payload = ParsedDocumentOutput.model_validate(envelope["payload"])
    assert [(block.type, block.text) for block in payload.blocks] == [
        ("list", "TypeDance"),
        ("list", "初始化 source canvas"),
    ]
    assert payload.blocks[0].source_span == {
        "source_canvas_id": "canvas_import",
        "source_canvas_version": 1,
        "canvas_node_id": "node_outer",
        "source_block_id": "src_import_0001",
    }
    assert payload.blocks[1].source_span["canvas_node_id"] == "node_inner"


def test_rule_based_resume_parser_runner_recurses_inside_table_cells():
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
    request = parser_request(
        [
            {
                "type": "table",
                "content": [
                    {
                        "type": "tableRow",
                        "content": [
                            {
                                "type": "tableCell",
                                "attrs": {
                                    "canvasNodeId": "node_cell",
                                    "sourceBlockId": "src_import_0001",
                                },
                                "content": [
                                    paragraph("公司 A"),
                                    heading("项目经历"),
                                    {
                                        "type": "bulletList",
                                        "content": [
                                            {
                                                "type": "listItem",
                                                "attrs": {
                                                    "canvasNodeId": "node_cell_item",
                                                    "sourceBlockId": "src_import_0002",
                                                },
                                                "content": [paragraph("负责平台重构")],
                                            }
                                        ],
                                    },
                                ],
                            }
                        ],
                    }
                ],
            }
        ]
    )

    envelope = RuleBasedResumeParserRunner()(context, request)

    payload = ParsedDocumentOutput.model_validate(envelope["payload"])
    assert [(block.type, block.text) for block in payload.blocks] == [
        ("paragraph", "公司 A"),
        ("heading", "项目经历"),
        ("list", "负责平台重构"),
    ]
    assert payload.blocks[0].source_span["canvas_node_id"] == "node_cell"
    assert payload.blocks[2].source_span["canvas_node_id"] == "node_cell_item"


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
    request = parser_request([paragraph("张三")])

    envelope = LangChainResumeParserRunner(model_factory=lambda: FakeModel())(context, request)

    assert seen["schema"] is ParsedDocumentOutput
    output = ParsedDocumentOutput.model_validate(envelope["payload"])
    assert output.blocks[0].source_span == {
        "line": 0,
        "source_canvas_id": "canvas_import",
        "source_canvas_version": 1,
    }
    payload = json.loads(seen["messages"][1]["content"])
    assert payload["source_document_id"] == "src_import"
    assert payload["source_canvas_id"] == "canvas_import"
    assert payload["source_canvas_version"] == 1
    assert payload["source_canvas_doc_json"] == request.source_canvas_doc_json
    assert "raw_text" not in payload


def test_langchain_resume_parser_runner_restores_source_canvas_spans_when_model_omits_them():
    seen = {}
    raw_payload = ParsedDocumentOutput.model_validate(
        {
            "source_document_id": "src_import",
            "blocks": [
                {
                    "type": "list",
                    "text": "TypeDance",
                    "order": 0,
                    "source_span": {},
                    "confidence": 0.9,
                },
                {
                    "type": "list",
                    "text": "初始化 source canvas",
                    "order": 1,
                    "source_span": {"model_note": "kept"},
                    "confidence": 0.9,
                },
            ],
            "detected_language": "zh-CN",
            "parse_warnings": [],
        }
    )

    class FakeStructuredModel:
        def invoke(self, messages):
            seen["system"] = messages[0]["content"]
            return raw_payload

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
    request = parser_request(
        [
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "attrs": {
                            "canvasNodeId": "node_outer",
                            "sourceBlockId": "src_import_0001",
                        },
                        "content": [
                            paragraph("TypeDance"),
                            {
                                "type": "bulletList",
                                "content": [
                                    {
                                        "type": "listItem",
                                        "attrs": {
                                            "canvasNodeId": "node_inner",
                                            "sourceBlockId": "src_import_0002",
                                        },
                                        "content": [paragraph("初始化 source canvas")],
                                    }
                                ],
                            },
                        ],
                    }
                ],
            }
        ]
    )

    envelope = LangChainResumeParserRunner(model_factory=lambda: FakeModel())(context, request)

    payload = ParsedDocumentOutput.model_validate(envelope["payload"])
    assert payload.blocks[0].source_span == {
        "source_canvas_id": "canvas_import",
        "source_canvas_version": 1,
        "canvas_node_id": "node_outer",
        "source_block_id": "src_import_0001",
    }
    assert payload.blocks[1].source_span == {
        "source_canvas_id": "canvas_import",
        "source_canvas_version": 1,
        "canvas_node_id": "node_inner",
        "source_block_id": "src_import_0002",
        "model_note": "kept",
    }
    assert "canvasNodeId" in seen["system"]
    assert "source_span.canvas_node_id" in seen["system"]


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
