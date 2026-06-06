import pytest

from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.resume_structurer_runner import RuleBasedResumeStructurerRunner
from typedance_sidecar.revision_import_flow import RevisionImportFlowService
from typedance_sidecar.revision_models import (
    Document,
    RevisionRun,
    SourceDocument,
    SourceResumeCanvas,
)
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import RevisionServiceError, WorkspaceService
from typedance_sidecar.source_canvas_initializer import (
    SourceCanvasInitializationError,
    SourceCanvasInitializer,
)


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def seed_import_run(
    repo: RevisionRepository,
    raw_text: str | None = None,
    *,
    create_canvas: bool = True,
) -> tuple[Document, SourceDocument, RevisionRun]:
    now = utc_now()
    document = repo.save_document(
        Document(
            id="doc_import",
            pack_id="resume",
            title="旧简历重构",
            status="active",
            target_language="zh-CN",
            created_at=now,
            updated_at=now,
        )
    )
    source = repo.save_source_document(
        SourceDocument(
            id="src_import",
            document_id=document.id,
            source_type="old_resume",
            title="粘贴的旧简历",
            raw_text=raw_text
            or """
张三
电话：13800000000
邮箱：zhangsan@example.com

工作经历
前端工程师 / 星河科技 / 2022.03 - 2025.05
负责订单系统重构，优化核心链路稳定性

项目经历
智能简历系统
使用 Vue3 和 TypeScript 搭建编辑器与 PDF 导出流程

专业技能
Vue3、TypeScript、FastAPI、Playwright
""",
            parse_status="pending",
            created_at=now,
        )
    )
    canvas = repo.save_source_resume_canvas(_source_canvas_for(source, now)) if create_canvas else None
    run = repo.save_revision_run(
        RevisionRun(
            id="run_import",
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="import_reconstruct",
            status="recognizing",
            source_document_ids=[source.id],
            input_source_canvas_id=canvas.id if canvas else "canvas_missing",
            input_source_canvas_version=canvas.version if canvas else 1,
            user_intent="导入旧简历并形成可审阅草稿",
            created_at=now,
            updated_at=now,
        )
    )
    return document, source, run


def _source_canvas_for(source: SourceDocument, now: str) -> SourceResumeCanvas:
    try:
        canvas = SourceCanvasInitializer().initialize(source)
    except SourceCanvasInitializationError:
        canvas = SourceResumeCanvas(
            id="canvas_import",
            document_id=source.document_id,
            old_resume_source_id=source.id,
            version=1,
            source_snapshot_hash="sha256:empty",
            doc_json={"type": "doc", "content": []},
            node_map=[],
            module_anchors=[],
            created_at=now,
            updated_at=now,
        )
    return canvas.model_copy(
        update={
            "id": "canvas_import",
            "version": 1,
            "created_at": now,
            "updated_at": now,
        }
    )


def test_import_flow_generates_workspace_objects(tmp_path):
    repo = make_repository(tmp_path)
    document, source, run = seed_import_run(repo)

    completed_run = RevisionImportFlowService(repo).run_import_reconstruct(document.id, run.id)

    assert completed_run.status == "completed"
    assert completed_run.target_draft_id is not None
    assert "旧简历" in (completed_run.output_summary or "")
    assert repo.get_document(document.id).current_draft_id == completed_run.target_draft_id

    parsed_source = repo.list_source_documents(document.id)[0]
    assert parsed_source.id == source.id
    assert parsed_source.parse_status == "recognized"
    assert [block.type for block in repo.list_parsed_blocks(source.id)][:3] == [
        "paragraph",
        "contact",
        "contact",
    ]
    steps = repo.list_agent_steps(run.id)
    parser_steps = [step for step in steps if step.agent_name == "SourceParser"]
    assert len(parser_steps) == 1
    assert parser_steps[0].input_refs == ["SourceDocument:src_import"]
    assert parser_steps[0].output_refs
    assert all(ref.startswith("ParsedBlock:") for ref in parser_steps[0].output_refs)
    structurer_steps = [step for step in steps if step.agent_name == "ResumeStructurer"]
    assert len(structurer_steps) == 1
    assert any(ref.startswith("ParsedBlock:") for ref in structurer_steps[0].input_refs)
    assert any(ref.startswith("DocumentModule:") for ref in structurer_steps[0].output_refs)
    assert any(ref.startswith("DocumentClaim:") for ref in structurer_steps[0].output_refs)
    assert any(step.agent_name == "MapSourceCanvasAnchors" for step in steps)

    workspace = WorkspaceService(repo).get_workspace_view(document.id)
    assert workspace.current_draft is not None
    assert workspace.current_draft.id == completed_run.target_draft_id
    assert workspace.render_projection is not None
    assert workspace.render_projection.draft_id == workspace.current_draft.id
    assert workspace.source_resume_canvas is not None
    assert workspace.source_resume_canvas.id == "canvas_import"
    assert workspace.source_resume_canvas.old_resume_source_id == source.id
    assert workspace.source_resume_canvas.doc_json["type"] == "doc"
    assert workspace.source_resume_canvas.node_map
    assert workspace.source_resume_canvas.module_anchors
    assert any(node.module_id for node in workspace.source_resume_canvas.node_map)
    assert {module.type for module in workspace.modules} >= {
        "BasicInfo",
        "WorkExperience",
        "ProjectExperience",
        "CoreSkills",
    }
    assert workspace.claims
    assert workspace.evidence
    assert workspace.issues
    assert workspace.proposals
    assert workspace.available_actions
    assert workspace.quality_gate is not None
    assert workspace.quality_gate.status == "needs_review"


def test_import_flow_rejects_empty_sources(tmp_path):
    repo = make_repository(tmp_path)
    document, _source, run = seed_import_run(repo, raw_text="  \n\n")

    with pytest.raises(RevisionServiceError, match="Import source has no text"):
        RevisionImportFlowService(repo).run_import_reconstruct(document.id, run.id)

    failed_run = repo.get_revision_run(run.id)
    assert failed_run is not None
    assert failed_run.status == "failed_retryable"
    failed_source = repo.list_source_documents(document.id)[0]
    assert failed_source.parse_status == "recognition_failed"


def test_import_flow_recognizes_common_career_skills_heading(tmp_path):
    repo = make_repository(tmp_path)
    document, _source, run = seed_import_run(
        repo,
        raw_text="""
张三

职业技能
React、TypeScript、Node.js
""",
    )

    RevisionImportFlowService(repo).run_import_reconstruct(document.id, run.id)

    workspace = WorkspaceService(repo).get_workspace_view(document.id)
    assert workspace.source_resume_canvas is not None
    assert any(module.type == "CoreSkills" for module in workspace.modules)
    heading_node = next(
        node
        for node in workspace.source_resume_canvas.node_map
        if node.text == "职业技能"
    )
    assert heading_node.text == "职业技能"
    assert heading_node.node_type == "heading"
    assert heading_node.module_id is None


def test_import_flow_renders_markdown_source_canvas_syntax(tmp_path):
    repo = make_repository(tmp_path)
    document, _source, run = seed_import_run(
        repo,
        raw_text="""
张三

## 核心能力
- **前端架构**: Vue
---
""",
    )

    RevisionImportFlowService(repo).run_import_reconstruct(document.id, run.id)

    workspace = WorkspaceService(repo).get_workspace_view(document.id)
    assert workspace.source_resume_canvas is not None
    nodes = workspace.source_resume_canvas.doc_json["content"]

    heading = next(node for node in nodes if node["type"] == "heading" and node.get("content"))
    bullet = next(node for node in nodes if node["type"] == "bulletList")
    divider = next(node for node in nodes if node["type"] == "horizontalRule")

    assert heading["content"][0]["text"] == "核心能力"
    paragraph = bullet["content"][0]["content"][0]
    assert paragraph["content"] == [
        {"type": "text", "text": "前端架构", "marks": [{"type": "bold"}]},
        {"type": "text", "text": ": Vue"},
    ]
    assert divider["attrs"]["canvasNodeId"]


def test_import_flow_rejects_multiple_sources(tmp_path):
    repo = make_repository(tmp_path)
    document, source, run = seed_import_run(repo)
    now = utc_now()
    second_source = repo.save_source_document(
        SourceDocument(
            id="src_import_2",
            document_id=document.id,
            source_type="old_resume",
            title="第二份旧简历",
            raw_text="李四\n项目经历\n负责支付系统优化",
            parse_status="pending",
            created_at=now,
        )
    )
    repo.save_revision_run(
        run.model_copy(update={"source_document_ids": [source.id, second_source.id]})
    )

    with pytest.raises(RevisionServiceError, match="Import flow requires exactly one source"):
        RevisionImportFlowService(repo).run_import_reconstruct(document.id, run.id)

    failed_run = repo.get_revision_run(run.id)
    assert failed_run is not None
    assert failed_run.status == "failed_retryable"
    failed_sources = repo.list_source_documents(document.id)
    assert {source.parse_status for source in failed_sources} == {"pending"}


def test_import_flow_missing_canvas_does_not_mark_source_failed(tmp_path):
    repo = make_repository(tmp_path)
    document, source, run = seed_import_run(repo, create_canvas=False)

    with pytest.raises(RevisionServiceError, match="Source resume canvas is not initialized"):
        RevisionImportFlowService(repo).run_import_reconstruct(document.id, run.id)

    failed_run = repo.get_revision_run(run.id)
    assert failed_run is not None
    assert failed_run.status == "failed_retryable"
    assert repo.list_source_documents(document.id)[0].parse_status == source.parse_status


def test_import_flow_marks_stale_when_source_canvas_version_changes(tmp_path):
    repo = make_repository(tmp_path)
    document, source, run = seed_import_run(repo)
    canvas = repo.get_source_resume_canvas(document.id)
    assert canvas is not None
    repo.save_source_resume_canvas(
        canvas.model_copy(
            update={
                "version": canvas.version + 1,
                "source_snapshot_hash": "sha256:updated",
                "updated_at": utc_now(),
            }
        )
    )

    stale_run = RevisionImportFlowService(repo).run_import_reconstruct(document.id, run.id)

    assert stale_run.status == "stale"
    assert stale_run.output_summary == "源画布已更新，需要重新识别。"
    assert repo.list_draft_versions(document.id) == []
    assert repo.list_source_documents(document.id)[0].parse_status == source.parse_status


def test_import_flow_late_stale_does_not_save_workspace_objects(tmp_path):
    repo = make_repository(tmp_path)
    document, source, run = seed_import_run(repo)
    rule_structurer = RuleBasedResumeStructurerRunner()

    def bump_canvas_version(_context, request):
        canvas = repo.get_source_resume_canvas(document.id)
        assert canvas is not None
        repo.save_source_resume_canvas(
            canvas.model_copy(
                update={
                    "version": canvas.version + 1,
                    "source_snapshot_hash": "sha256:late-updated",
                    "updated_at": utc_now(),
                }
            )
        )
        return rule_structurer(_context, request)

    stale_run = RevisionImportFlowService(
        repo,
        structurer_runner=bump_canvas_version,
    ).run_import_reconstruct(document.id, run.id)

    stored_run = repo.get_revision_run(run.id)
    canvas = repo.get_source_resume_canvas(document.id)
    assert stored_run is not None
    assert stale_run.status == "stale"
    assert stored_run.status == "stale"
    assert repo.list_draft_versions(document.id) == []
    assert canvas is not None
    assert canvas.module_anchors == []
    assert not any(node.module_id for node in canvas.node_map)
    assert repo.connection.execute("SELECT COUNT(*) FROM document_modules").fetchone()[0] == 0
    assert repo.list_source_documents(document.id)[0].parse_status != "recognition_failed"


def test_import_flow_surfaces_parser_runtime_failure(tmp_path):
    repo = make_repository(tmp_path)
    document, _source, run = seed_import_run(repo)

    def raise_model_error(_context, _request):
        raise RuntimeError("parser model timeout")

    service = RevisionImportFlowService(repo, parser_runner=raise_model_error)

    with pytest.raises(RevisionServiceError, match="parser model timeout"):
        service.run_import_reconstruct(document.id, run.id)

    failed_run = repo.get_revision_run(run.id)
    steps = repo.list_agent_steps(run.id)

    assert failed_run is not None
    assert failed_run.status == "failed_retryable"
    assert failed_run.output_summary == "parser model timeout"
    assert steps[-1].agent_name == "SourceParser"
    assert steps[-1].status == "failed_model"
    assert repo.list_source_documents(document.id)[0].parse_status == "recognition_failed"


def test_import_flow_surfaces_structurer_runtime_failure(tmp_path):
    repo = make_repository(tmp_path)
    document, _source, run = seed_import_run(repo)

    def raise_model_error(_context, _request):
        raise RuntimeError("structurer model timeout")

    service = RevisionImportFlowService(repo, structurer_runner=raise_model_error)

    with pytest.raises(RevisionServiceError, match="structurer model timeout"):
        service.run_import_reconstruct(document.id, run.id)

    failed_run = repo.get_revision_run(run.id)
    steps = repo.list_agent_steps(run.id)

    assert failed_run is not None
    assert failed_run.status == "failed_retryable"
    assert failed_run.output_summary == "structurer model timeout"
    assert steps[-1].agent_name == "ResumeStructurer"
    assert steps[-1].status == "failed_model"
    assert repo.list_source_documents(document.id)[0].parse_status == "recognition_failed"
