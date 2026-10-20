from copy import deepcopy
import sqlite3

import pytest
from fastapi.testclient import TestClient

from typedance_sidecar.db import connect
from typedance_sidecar.main import app
from typedance_sidecar.revision_models import Document, DraftVersion, ParsedBlock, SourceDocument, SourceResumeCanvas
from typedance_sidecar.revision_repository import RevisionRepository
from typedance_sidecar.revision_services import WorkspaceService
from typedance_sidecar.source_canvas_doc_json import source_canvas_hash


@pytest.fixture
def repository(tmp_path):
    connection = connect(tmp_path / "typedance.sqlite")
    yield RevisionRepository(connection)
    connection.close()


def seed_formatted_resume(repository, tmp_path):
    now = "2026-10-01T00:00:00.000Z"
    document = repository.save_document(Document(
        id="doc_original", pack_id="resume", title="技术简历", template_id="custom-a4",
        status="active", target_language="zh-CN", current_draft_id="draft_original",
        accepted_draft_id="draft_original", created_at=now, updated_at=now,
    ))
    source_file = tmp_path / "原始简历.docx"
    source_file.write_bytes(b"read-only imported source")
    source = repository.save_source_document(SourceDocument(
        id="src_original", document_id=document.id, source_type="old_resume", title=source_file.name,
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        original_uri=str(source_file), file_path=str(source_file), raw_text="导入时的旧文本",
        parse_status="recognized", metadata={"import_extension": "docx"}, created_at=now,
    ))
    repository.save_parsed_block(ParsedBlock(
        id="block_original", source_document_id=source.id, type="paragraph", text="导入时的旧文本",
        order=0, page=1, source_span={"source_document_id": source.id, "page": 1},
    ))
    doc_json = {
        "type": "doc",
        "content": [{
            "type": "columns", "attrs": {"columns": 2, "gap": 18},
            "content": [{
                "type": "column", "attrs": {"width": 65},
                "content": [{
                    "type": "heading",
                    "attrs": {"level": 2, "canvasNodeId": "node_original", "sourceBlockId": "block_original",
                              "moduleId": "module_original", "textAlign": "center", "heading2Style": "accent-wash"},
                    "content": [{"type": "text", "text": "最新编辑的项目经验", "marks": [{"type": "bold"}]}],
                }],
            }, {
                "type": "column", "attrs": {"width": 35},
                "content": [{
                    "type": "paragraph",
                    "attrs": {"canvasNodeId": "node_added", "sourceBlockId": None, "textAlign": "right"},
                    "content": [{"type": "text", "text": "作品集", "marks": [{"type": "link", "attrs": {"href": "https://example.com"}}]}],
                }],
            }],
        }],
    }
    canvas = repository.save_source_resume_canvas(SourceResumeCanvas(
        id="canvas_original", document_id=document.id, old_resume_source_id=source.id,
        version=7, source_snapshot_hash=source_canvas_hash(doc_json), doc_json=doc_json,
        node_map=[{
            "canvas_node_id": "node_original", "source_block_id": "block_original", "module_id": "module_original",
            "node_type": "heading", "text": "最新编辑的项目经验",
            "source_span": {"source_document_id": source.id, "node_index": 1},
        }],
        module_anchors=[{"module_id": "module_original", "canvas_node_ids": ["node_original"], "title": "项目经验", "order": 0}],
        created_at=now, updated_at=now,
    ))
    repository.save_draft_version(DraftVersion(
        id="draft_original", document_id=document.id, run_id="run_original", pack_id="resume",
        status="accepted", summary="原件历史", created_at=now, updated_at=now,
    ))
    return document, source, canvas, source_file


def test_duplicate_keeps_current_format_and_remaps_all_source_canvas_associations(repository, tmp_path):
    document, source, canvas, _ = seed_formatted_resume(repository, tmp_path)

    duplicate = repository.duplicate_document(document.id)

    assert duplicate.id != document.id
    assert duplicate.title == "技术简历 副本"
    assert duplicate.template_id == "custom-a4"
    assert duplicate.pack_id == "resume"
    assert duplicate.target_language == "zh-CN"
    assert duplicate.current_draft_id is None
    assert duplicate.accepted_draft_id is None
    assert duplicate.created_at != document.created_at
    assert duplicate.created_at == duplicate.updated_at
    copied_source, = repository.list_source_documents(duplicate.id)
    assert copied_source.id != source.id
    assert copied_source.file_path == source.file_path
    assert copied_source.raw_text == "导入时的旧文本"
    assert copied_source.metadata == {"import_extension": "docx"}
    copied_block, = repository.list_parsed_blocks(copied_source.id)
    assert copied_block.id != "block_original"
    assert copied_block.source_document_id == copied_source.id
    assert copied_block.source_span == {"source_document_id": copied_source.id, "page": 1}
    copied_canvas = repository.get_source_resume_canvas(duplicate.id)
    assert copied_canvas.id != canvas.id
    assert copied_canvas.old_resume_source_id == copied_source.id
    assert copied_canvas.version == 1
    copied_node, = copied_canvas.node_map
    assert copied_node.canvas_node_id != "node_original"
    assert copied_node.source_block_id == copied_block.id
    assert copied_node.source_span == {"source_document_id": copied_source.id, "node_index": 1}
    assert copied_node.module_id != "module_original"
    copied_anchor, = copied_canvas.module_anchors
    assert copied_anchor.module_id == copied_node.module_id
    assert copied_anchor.canvas_node_ids == [copied_node.canvas_node_id]
    assert copied_anchor.title == "项目经验"
    expected_json = deepcopy(canvas.doc_json)
    heading_attrs = expected_json["content"][0]["content"][0]["content"][0]["attrs"]
    heading_attrs.update(canvasNodeId=copied_node.canvas_node_id, sourceBlockId=copied_block.id, moduleId=copied_node.module_id)
    added_attrs = copied_canvas.doc_json["content"][0]["content"][1]["content"][0]["attrs"]
    assert added_attrs["canvasNodeId"] not in {"node_original", "node_added", copied_node.canvas_node_id}
    expected_json["content"][0]["content"][1]["content"][0]["attrs"]["canvasNodeId"] = added_attrs["canvasNodeId"]
    assert copied_canvas.doc_json == expected_json
    assert copied_canvas.source_snapshot_hash == source_canvas_hash(expected_json)
    assert repository.get_document(document.id) == document
    assert repository.list_source_documents(document.id) == [source]
    assert repository.get_source_resume_canvas(document.id) == canvas
    assert repository.list_draft_versions(duplicate.id) == []
    assert repository.list_export_artifacts(duplicate.id) == []


def test_editing_and_deleting_duplicate_preserves_original_and_import_file(repository, tmp_path):
    document, source, canvas, source_file = seed_formatted_resume(repository, tmp_path)
    duplicate = repository.duplicate_document(document.id)
    copied_canvas = repository.get_source_resume_canvas(duplicate.id)
    edited_json = deepcopy(copied_canvas.doc_json)
    edited_json["content"][0]["content"][0]["content"][0]["content"][0]["text"] = "只修改副本"

    WorkspaceService(repository).save_source_resume_canvas_document(duplicate.id, edited_json)
    assert repository.get_source_resume_canvas(document.id) == canvas
    assert repository.delete_document(duplicate.id)

    assert repository.get_document(duplicate.id) is None
    assert repository.list_source_documents(duplicate.id) == []
    assert repository.get_source_resume_canvas(duplicate.id) is None
    assert repository.get_document(document.id) == document
    assert repository.list_source_documents(document.id) == [source]
    assert repository.get_source_resume_canvas(document.id) == canvas
    assert source_file.read_bytes() == b"read-only imported source"


def test_duplicate_without_sources_creates_independent_empty_document(repository):
    original = repository.save_document(Document(
        id="doc_empty", pack_id="resume", title="空白简历", template_id="classic-a4", status="active",
        target_language="en-US", created_at="2026-10-01T00:00:00Z", updated_at="2026-10-01T00:00:00Z",
    ))

    duplicate = repository.duplicate_document(original.id)

    assert duplicate.title == "空白简历 副本"
    assert duplicate.target_language == "en-US"
    assert repository.get_document(duplicate.id) == duplicate
    assert repository.list_source_documents(duplicate.id) == []
    assert repository.get_source_resume_canvas(duplicate.id) is None


def test_duplicate_rolls_back_every_record_when_canvas_insert_fails(repository, tmp_path):
    document, source, canvas, _ = seed_formatted_resume(repository, tmp_path)
    tables = ["documents", "source_documents", "parsed_blocks", "source_resume_canvases", "draft_versions"]
    before = {table: repository.connection.execute(f"SELECT * FROM {table}").fetchall() for table in tables}
    repository.connection.execute("""
        CREATE TRIGGER reject_duplicate_canvas BEFORE INSERT ON source_resume_canvases
        WHEN NEW.document_id != 'doc_original'
        BEGIN SELECT RAISE(ABORT, 'injected canvas write failure'); END
    """)
    repository.connection.commit()

    with pytest.raises(sqlite3.IntegrityError, match="injected canvas write failure"):
        repository.duplicate_document(document.id)

    for table in tables:
        assert repository.connection.execute(f"SELECT * FROM {table}").fetchall() == before[table]
    assert not repository.connection.in_transaction
    assert repository.get_document(document.id) == document
    assert repository.list_source_documents(document.id) == [source]
    assert repository.get_source_resume_canvas(document.id) == canvas


def test_duplicate_endpoint_returns_document_without_requiring_request_body(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    repository = RevisionRepository(connect(tmp_path / "typedance.sqlite"))
    original, _, _, _ = seed_formatted_resume(repository, tmp_path)

    response = TestClient(app).post(f"/documents/{original.id}/duplicate")

    assert response.status_code == 201
    duplicate = Document.model_validate(response.json())
    assert duplicate.title == "技术简历 副本"
    assert duplicate.template_id == "custom-a4"
    assert repository.get_source_resume_canvas(duplicate.id) is not None
    repository.connection.close()


def test_duplicate_endpoint_returns_404_without_creating_anything(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))

    response = TestClient(app).post("/documents/missing/duplicate")

    assert response.status_code == 404
    assert response.json() == {"detail": "Document not found"}
    repository = RevisionRepository(connect(tmp_path / "typedance.sqlite"))
    assert repository.list_documents() == []
    repository.connection.close()
