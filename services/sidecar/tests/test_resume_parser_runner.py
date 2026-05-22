from typedance_sidecar.resume_agent_outputs import ParsedDocumentOutput
from typedance_sidecar.resume_parser_runner import (
    ResumeParserRunRequest,
    RuleBasedResumeParserRunner,
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
