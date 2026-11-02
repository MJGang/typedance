from copy import deepcopy
import json
from pathlib import Path

import pytest

from typedance_sidecar.editor_operations import capability_catalog, prepare_operations, validate_document


def apply(source, capability, **parameters):
    return prepare_operations(source, [{"capability": capability, "parameters": parameters}], capability_catalog()["revision"])


def paragraph(text="", **attrs):
    return {"type": "paragraph", "attrs": attrs, "content": [{"type": "text", "text": text}] if text else []}


def test_wrap_add_remove_and_unwrap_preserve_other_content_and_origins():
    source = {"type": "doc", "content": [paragraph("前文"), paragraph("公司 A", canvasNodeId="company"), paragraph("工作成果"), paragraph("后文")]}
    before = deepcopy(source)
    result = apply(source, "timeline.wrap", paths=[[1], [2]])
    assert source == before
    assert result["doc_json"]["content"][1]["content"][0]["content"] == source["content"][1:3]
    assert {"before_path": [1], "after_path": [1, 0, 0]} in result["node_origins"]
    inserted = apply(result["doc_json"], "timeline.add", path=[1], index=0)["doc_json"]
    assert len(inserted["content"][1]["content"]) == 2
    removed = apply(inserted, "timeline.remove", path=[1, 0])["doc_json"]
    assert apply(removed, "timeline.unwrap", path=[1])["doc_json"] == source


@pytest.mark.parametrize("parent", [[], [0]])
def test_insert_delete_and_last_item_removal_keep_an_editable_paragraph(parent):
    source = {"type": "doc", "content": [paragraph()]}
    if parent:
        source["content"] = [{"type": "columns", "attrs": {"count": 2}, "content": [{"type": "column", "content": [paragraph()]}, {"type": "column", "content": [paragraph("保留")]}]}]
        parent = [0, 0]
    inserted = apply(source, "timeline.insert", parent=parent, index=0)["doc_json"]
    path = [*parent, 0]
    first = apply(inserted, "timeline.remove", path=[*path, 0])["doc_json"]
    last = apply(first, "timeline.remove", path=[*path, 0])["doc_json"]
    validate_document(last)
    deleted = apply(inserted, "timeline.delete", path=path)["doc_json"]
    assert deleted == source


def test_delete_only_timeline_leaves_paragraph():
    source = apply({"type": "doc", "content": [paragraph()]}, "timeline.wrap", paths=[[0]])["doc_json"]
    assert apply(source, "timeline.delete", path=[0])["doc_json"] == {"type": "doc", "content": [{"type": "paragraph"}]}
    assert apply(source, "timeline.remove", path=[0, 0])["doc_json"] == {"type": "doc", "content": [{"type": "paragraph"}]}


def test_split_moves_existing_blocks_with_exact_origins_and_can_unwrap_to_original():
    source = {"type": "doc", "content": [paragraph("公司 A", canvasNodeId="a"), paragraph("成果 A"), paragraph("公司 B", canvasNodeId="b"), paragraph("成果 B")]}
    wrapped = apply(source, "timeline.wrap", paths=[[0], [1], [2], [3]])["doc_json"]
    split = apply(wrapped, "timeline.split", path=[0, 0, 2])
    assert len(split["doc_json"]["content"][0]["content"]) == 2
    assert {"before_path": [0, 0, 2], "after_path": [0, 1, 0]} in split["node_origins"]
    assert apply(split["doc_json"], "timeline.unwrap", path=[0])["doc_json"] == source
    with pytest.raises(ValueError):
        apply(wrapped, "timeline.split", path=[0, 0, 0])


def test_invalid_targets_do_not_change_source():
    source = {"type": "doc", "content": [paragraph("A"), paragraph("B"), paragraph("C")]}
    before = deepcopy(source)
    for capability, parameters in [("timeline.wrap", {"paths": [[0], [2]]}), ("timeline.add", {"path": [0], "index": 0}), ("timeline.remove", {"path": [0]})]:
        with pytest.raises(ValueError):
            apply(source, capability, **parameters)
    assert source == before


@pytest.mark.parametrize("node", [{"type": "timeline", "content": []}, {"type": "timeline", "content": [paragraph()]}, {"type": "timelineItem", "content": []}])
def test_invalid_timeline_structure_is_rejected(node):
    with pytest.raises(ValueError):
        validate_document({"type": "doc", "content": [node]})


def test_rich_timeline_round_trips_through_workspace_save_and_database_reopen(tmp_path):
    from typedance_sidecar.db import connect
    from typedance_sidecar.models import utc_now
    from typedance_sidecar.revision_models import Document, SourceDocument
    from typedance_sidecar.revision_repository import RevisionRepository
    from typedance_sidecar.revision_services import WorkspaceService
    from typedance_sidecar.revision_source_canvas import BlankSourceResumeCanvasBuilder

    rich = json.loads((Path(__file__).parent / "fixtures" / "timeline_rich.json").read_text(encoding="utf-8"))
    validate_document(rich)
    database = tmp_path / "timeline.sqlite"
    connection = connect(database)
    repo = RevisionRepository(connection)
    now = utc_now()
    repo.save_document(Document(id="doc_timeline", pack_id="resume", title="时间轴", status="active", target_language="zh-CN", template_id="classic-a4", created_at=now, updated_at=now))
    repo.save_source_document(SourceDocument(id="source_timeline", document_id="doc_timeline", source_type="old_resume", title="示例", raw_text="示例", parse_status="recognized", created_at=now))
    repo.save_source_resume_canvas(BlankSourceResumeCanvasBuilder().blank(document_id="doc_timeline", source_id="source_timeline"))
    saved = WorkspaceService(repo).save_source_resume_canvas_document("doc_timeline", rich)
    connection.close()
    reopened = connect(database)
    try:
        restored = RevisionRepository(reopened).get_source_resume_canvas("doc_timeline")
        assert restored.doc_json == rich
        assert restored.version == saved.version == 2
    finally:
        reopened.close()
