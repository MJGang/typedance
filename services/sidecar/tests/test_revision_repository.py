import json
import sqlite3

from typedance_sidecar.db import connect
from typedance_sidecar.revision_models import (
    Document,
    DocumentClaim,
    DocumentModule,
    DraftVersion,
    EvidenceLink,
    ExportArtifact,
    ModuleAnchor,
    ParsedBlock,
    RenderProjection,
    RevisionAction,
    RevisionIssue,
    RevisionProposal,
    SourceResumeCanvas,
    SourceResumeCanvasNode,
    SourceDocument,
    UserConfirmation,
    utc_now,
)
from typedance_sidecar.revision_repository import RevisionRepository, migrate_revision_payloads


REVISION_TABLES = {
    "documents",
    "source_documents",
    "parsed_blocks",
    "source_resume_canvases",
    "draft_versions",
    "document_modules",
    "document_claims",
    "evidence_links",
    "revision_issues",
    "revision_proposals",
    "revision_actions",
    "user_confirmations",
    "render_projections",
    "export_artifacts",
}


def make_repository(tmp_path) -> RevisionRepository:
    return RevisionRepository(connect(tmp_path / "typedance.sqlite"))


def test_revision_models_validate_minimal_document_and_source():
    now = utc_now()
    document = Document(
        id="doc_1",
        pack_id="resume",
        title="张三基础简历",
        template_id="classic-a4",
        status="active",
        target_language="zh-CN",
        created_at=now,
        updated_at=now,
    )
    source = SourceDocument(
        id="src_1",
        document_id=document.id,
        source_type="old_resume",
        title="旧简历",
        raw_text="项目经历",
        parse_status="pending",
        created_at=now,
    )

    assert document.id == "doc_1"
    assert source.document_id == document.id


def test_repository_saves_source_resume_canvas(tmp_path):
    repo = make_repository(tmp_path)
    now = utc_now()
    canvas = SourceResumeCanvas(
        id="canvas_1",
        document_id="doc_1",
        old_resume_source_id="src_1",
        version=1,
        source_snapshot_hash="sha256:seed",
        doc_json={
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "attrs": {"canvasNodeId": "node_1"},
                    "content": [{"type": "text", "text": "负责订单系统重构"}],
                }
            ],
        },
        node_map=[
            SourceResumeCanvasNode(
                canvas_node_id="node_1",
                source_block_id="block_1",
                node_type="paragraph",
                text="负责订单系统重构",
                source_span={"line": 1},
                module_id="mod_1",
            )
        ],
        module_anchors=[
            ModuleAnchor(
                module_id="mod_1",
                canvas_node_ids=["node_1"],
                title="工作经历",
                order=1,
            )
        ],
        created_at=now,
        updated_at=now,
    )

    repo.save_source_resume_canvas(canvas)

    assert repo.get_source_resume_canvas("doc_1") == canvas


def test_repository_rolls_back_initialized_source_when_canvas_save_fails(tmp_path):
    repo = make_repository(tmp_path)
    now = utc_now()
    source = SourceDocument(
        id="src_atomic",
        document_id="doc_atomic",
        source_type="old_resume",
        title="旧简历",
        raw_text="项目经历",
        parse_status="initialized",
        created_at=now,
    )
    canvas = SourceResumeCanvas(
        id="canvas_atomic",
        document_id="doc_atomic",
        old_resume_source_id=source.id,
        version=1,
        source_snapshot_hash="sha256:atomic",
        doc_json={"type": "doc", "content": []},
        node_map=[],
        module_anchors=[],
        created_at=now,
        updated_at=now,
    ).model_copy(update={"document_id": None})

    try:
        repo.save_initialized_source_resume_canvas(source, canvas)
    except sqlite3.IntegrityError:
        pass
    else:
        raise AssertionError("expected canvas save to fail")

    assert repo.list_source_documents("doc_atomic") == []
    assert repo.get_source_resume_canvas("doc_atomic") is None


def test_migrates_legacy_revision_payloads_before_model_validation(tmp_path):
    connection = connect(tmp_path / "typedance.sqlite")
    now = utc_now()
    legacy_source = {
        "id": "src_legacy",
        "document_id": "doc_legacy",
        "source_type": "old_resume",
        "title": "旧来源",
        "raw_text": "项目经历",
        "parse_status": "parsed",
        "created_at": now,
    }
    legacy_canvas = {
        "id": "canvas_legacy",
        "document_id": "doc_legacy",
        "old_resume_source_id": "src_legacy",
        "doc_json": {"type": "doc", "content": []},
        "node_map": [],
        "module_anchors": [],
        "created_at": now,
        "updated_at": now,
    }
    connection.execute(
        """
        INSERT INTO source_documents (id, document_id, payload, schema_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("src_legacy", "doc_legacy", json.dumps(legacy_source, ensure_ascii=False), "0.1.0", now, now),
    )
    connection.execute(
        """
        INSERT INTO source_resume_canvases (id, document_id, payload, schema_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("canvas_legacy", "doc_legacy", json.dumps(legacy_canvas, ensure_ascii=False), "0.1.0", now, now),
    )
    connection.commit()

    migrate_revision_payloads(connection)
    repo = RevisionRepository(connection)

    source = repo.list_source_documents("doc_legacy")[0]
    canvas = repo.get_source_resume_canvas("doc_legacy")
    assert source.parse_status == "recognized"
    assert source.metadata == {}
    assert canvas is not None
    assert canvas.version == 1
    assert canvas.source_snapshot_hash.startswith("sha256:")


def test_migrates_legacy_document_to_classic_a4_template(tmp_path):
    connection = connect(tmp_path / "typedance.sqlite")
    now = utc_now()
    legacy_document = {
        "id": "doc_legacy",
        "pack_id": "resume",
        "title": "旧文档",
        "status": "active",
        "target_language": "zh-CN",
        "created_at": now,
        "updated_at": now,
    }
    connection.execute(
        """
        INSERT INTO documents (id, payload, schema_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        ("doc_legacy", json.dumps(legacy_document, ensure_ascii=False), "0.1.0", now, now),
    )
    connection.commit()

    migrate_revision_payloads(connection)

    payload = json.loads(
        connection.execute(
            "SELECT payload FROM documents WHERE id = ?",
            ("doc_legacy",),
        ).fetchone()["payload"]
    )
    assert payload["template_id"] == "classic-a4"
    assert Document.model_validate(payload).template_id == "classic-a4"


def test_migrates_invalid_legacy_source_canvas_doc_json(tmp_path):
    connection = connect(tmp_path / "typedance.sqlite")
    now = utc_now()
    legacy_canvas = {
        "id": "canvas_invalid",
        "document_id": "doc_invalid",
        "old_resume_source_id": "src_invalid",
        "doc_json": None,
        "node_map": [],
        "module_anchors": [],
        "created_at": now,
        "updated_at": now,
    }
    connection.execute(
        """
        INSERT INTO source_resume_canvases (id, document_id, payload, schema_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        ("canvas_invalid", "doc_invalid", json.dumps(legacy_canvas, ensure_ascii=False), "0.1.0", now, now),
    )
    connection.commit()

    migrate_revision_payloads(connection)
    canvas = RevisionRepository(connection).get_source_resume_canvas("doc_invalid")

    assert canvas is not None
    assert canvas.doc_json == {"type": "doc", "content": []}
    assert canvas.version == 1
    assert canvas.source_snapshot_hash.startswith("sha256:")


def test_connect_creates_revision_tables(tmp_path):
    connection = connect(tmp_path / "typedance.sqlite")
    rows = connection.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
    ).fetchall()

    table_names = {row["name"] for row in rows}
    assert REVISION_TABLES.issubset(table_names)
    assert "revision_runs" not in table_names
    assert "agent_steps" not in table_names


def test_revision_repository_roundtrips_core_objects(tmp_path):
    now = utc_now()
    repo = RevisionRepository(connect(tmp_path / "typedance.sqlite"))

    document = repo.save_document(
        Document(
            id="doc_1",
            pack_id="resume",
            title="张三基础简历",
            template_id="classic-a4",
            status="active",
            target_language="zh-CN",
            created_at=now,
            updated_at=now,
        )
    )
    source = repo.save_source_document(
        SourceDocument(
            id="src_1",
            document_id=document.id,
            source_type="old_resume",
            title="旧简历",
            raw_text="项目经历：订单系统重构",
            parse_status="recognized",
            created_at=now,
        )
    )
    block = repo.save_parsed_block(
        ParsedBlock(
            id="blk_1",
            source_document_id=source.id,
            type="paragraph",
            text="订单系统重构",
            order=0,
            source_span={"start": 0, "end": 6},
        )
    )
    run_id = "hrun_1"
    draft = repo.save_draft_version(
        DraftVersion(
            id="draft_1",
            document_id=document.id,
            run_id=run_id,
            pack_id="resume",
            status="in_review",
            summary="新版基础简历草稿",
            unresolved_issue_ids=["issue_1"],
            created_at=now,
            updated_at=now,
        )
    )
    module = repo.save_document_module(
        DocumentModule(
            id="mod_1",
            draft_id=draft.id,
            pack_id="resume",
            type="ProjectExperience",
            title="项目经历",
            order=0,
            visibility="visible",
            status="needs_review",
            data={"items": []},
            created_at=now,
            updated_at=now,
        )
    )
    claim = repo.save_document_claim(
        DocumentClaim(
            id="claim_1",
            draft_id=draft.id,
            module_id=module.id,
            text="负责订单系统重构",
            claim_type="achievement",
            confidence="inferred",
            source_span_refs=[block.id],
            created_at=now,
            updated_at=now,
        )
    )
    evidence = repo.save_evidence_link(
        EvidenceLink(
            id="ev_1",
            document_id=document.id,
            source_document_id=source.id,
            claim_id=claim.id,
            support_level="partial",
            extracted_text=block.text,
            confidence=0.72,
            user_confirmed=False,
            created_at=now,
        )
    )
    issue = repo.save_revision_issue(
        RevisionIssue(
            id="issue_1",
            run_id=run_id,
            document_id=document.id,
            draft_id=draft.id,
            module_id=module.id,
            claim_id=claim.id,
            type="missing_result",
            severity="warning",
            title="缺少结果",
            message="这条经历看不出结果。",
            reason="HR 难以判断影响范围。",
            status="open",
            created_by_agent="ResumeReviewer",
            evidence_link_ids=[evidence.id],
            action_ids=["act_1"],
            created_at=now,
        )
    )
    action = repo.save_revision_action(
        RevisionAction(
            id="act_1",
            issue_id=issue.id,
            label="补充结果",
            action_type="request_user_input",
            created_at=now,
            updated_at=now,
        )
    )
    proposal = repo.save_revision_proposal(
        RevisionProposal(
            id="prop_1",
            run_id=run_id,
            document_id=document.id,
            draft_id=draft.id,
            target={"claim_id": claim.id},
            operation="replace_claim",
            original_snapshot={"text": claim.text},
            proposed_snapshot={"text": "主导订单系统重构，提升核心链路稳定性"},
            summary="让表达更结果导向",
            rationale="原文只有动作，没有体现影响。",
            related_issue_ids=[issue.id],
            evidence_link_ids=[evidence.id],
            confidence=0.8,
            risk_level="medium",
            requires_user_confirmation=True,
            status="pending",
            created_by_agent="ResumeRewriter",
            created_at=now,
        )
    )
    confirmation = repo.save_user_confirmation(
        UserConfirmation(
            id="confirm_1",
            document_id=document.id,
            claim_id=claim.id,
            issue_id=issue.id,
            confirmation_type="truth_confirmed",
            note="真实发生，但指标需要再确认。",
            created_at=now,
        )
    )
    projection = repo.save_render_projection(
        RenderProjection(
            id="render_1",
            draft_id=draft.id,
            render_profile="default-a4",
            html="<article></article>",
            doc_json={"type": "doc", "content": []},
            created_at=now,
        )
    )
    artifact = repo.save_export_artifact(
        ExportArtifact(
            id="export_1",
            document_id=document.id,
            draft_id=draft.id,
            format="pdf",
            file_path="resume.pdf",
            status="succeeded",
            created_at=now,
        )
    )

    assert repo.get_document(document.id) == document
    assert repo.list_documents() == [document]
    assert repo.list_source_documents(document.id) == [source]
    assert repo.list_parsed_blocks(source.id) == [block]
    assert repo.list_draft_versions(document.id) == [draft]
    assert repo.list_document_modules(draft.id) == [module]
    assert repo.list_document_claims(draft.id) == [claim]
    assert repo.list_evidence_links(document.id) == [evidence]
    assert repo.list_revision_issues(draft.id) == [issue]
    assert repo.list_revision_actions(issue.id) == [action]
    assert repo.list_revision_proposals(draft.id) == [proposal]
    assert repo.list_user_confirmations(document.id) == [confirmation]
    assert repo.get_render_projection(projection.id) == projection
    assert repo.list_export_artifacts(document.id) == [artifact]

    assert repo.delete_document(document.id) is True
    assert repo.get_document(document.id) is None
    assert repo.list_source_documents(document.id) == []
    assert repo.list_parsed_blocks(source.id) == []
    assert repo.list_draft_versions(document.id) == []
    assert repo.list_document_modules(draft.id) == []
    assert repo.list_document_claims(draft.id) == []
    assert repo.list_evidence_links(document.id) == []
    assert repo.list_revision_issues(draft.id) == []
    assert repo.list_revision_actions(issue.id) == []
    assert repo.list_revision_proposals(draft.id) == []
    assert repo.list_user_confirmations(document.id) == []
    assert repo.get_render_projection(projection.id) is None
    assert repo.list_export_artifacts(document.id) == []
    assert repo.delete_document(document.id) is False


def test_revision_repository_reassigns_document_template_references(tmp_path):
    now = utc_now()
    repo = make_repository(tmp_path)
    for document_id, template_id in (
        ("doc_custom_1", "custom-theme-1"),
        ("doc_custom_2", "custom-theme-1"),
        ("doc_classic", "classic-a4"),
    ):
        repo.save_document(
            Document(
                id=document_id,
                pack_id="resume",
                title=document_id,
                template_id=template_id,
                status="active",
                target_language="zh-CN",
                created_at=now,
                updated_at=now,
            )
        )

    changed = repo.reassign_document_template("custom-theme-1", "classic-a4")

    assert changed == 2
    assert repo.get_document("doc_custom_1").template_id == "classic-a4"
    assert repo.get_document("doc_custom_2").template_id == "classic-a4"
    assert repo.get_document("doc_classic").template_id == "classic-a4"
