import pytest

from typedance_sidecar.db import connect
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_import_flow import RevisionImportFlowService
from typedance_sidecar.revision_models import Document, RevisionRun, SourceDocument
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import RevisionServiceError, WorkspaceService


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def seed_import_run(repo: RevisionRepository, raw_text: str | None = None) -> tuple[Document, SourceDocument, RevisionRun]:
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
    run = repo.save_revision_run(
        RevisionRun(
            id="run_import",
            document_id=document.id,
            pack_id=document.pack_id,
            run_type="import_reconstruct",
            status="created",
            source_document_ids=[source.id],
            user_intent="导入旧简历并形成可审阅草稿",
            created_at=now,
            updated_at=now,
        )
    )
    return document, source, run


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
    assert parsed_source.parse_status == "parsed"
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
    assert any(step.agent_name == "BuildSourceCanvas" for step in steps)

    workspace = WorkspaceService(repo).get_workspace_view(document.id)
    assert workspace.current_draft is not None
    assert workspace.current_draft.id == completed_run.target_draft_id
    assert workspace.render_projection is not None
    assert workspace.render_projection.draft_id == workspace.current_draft.id
    assert workspace.source_resume_canvas is not None
    assert workspace.source_resume_canvas.old_resume_source_id == source.id
    assert workspace.source_resume_canvas.doc_json["type"] == "doc"
    assert workspace.source_resume_canvas.node_map
    assert workspace.source_resume_canvas.module_anchors
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
