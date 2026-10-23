from copy import deepcopy

import pytest

from typedance_sidecar.editor_operations import CAPABILITIES, InspectOptions, capability_catalog, inspect_document, node_text, prepare_operations
from fixtures.heading2_styles import template_style_payload


def paragraph(text, **attrs):
    return {"type": "paragraph", "attrs": attrs, "content": [{"type": "text", "text": text}]}


def doc(*nodes):
    return {"type": "doc", "content": list(nodes)}


def prepare(source, capability, **parameters):
    return prepare_operations(source, [{"capability": capability, "parameters": parameters}], capability_catalog()["revision"])["doc_json"]


def test_personal_information_four_columns_preserves_all_text_and_last_alignment():
    original = doc(*(paragraph(text, canvasNodeId=f"node_{index}") for index, text in enumerate(["姓名：小明", "性别：男", "手机：123", "邮箱：test@example.com"])))
    before = deepcopy(original)
    result = prepare(original, "columns.layout", widths=[25, 25, 25, 25], alignments=["left", "left", "left", "right"],
                     rows=[{"paths": [[0], [1], [2], [3]], "cells": [["姓名：小明"], ["性别：男"], ["手机：123"], ["邮箱：test@example.com"]]}])
    row = result["content"][0]
    assert row["attrs"] == {"count": 4, "widths": [25, 25, 25, 25], "gap": "default"}
    assert row["content"][3]["content"][0]["attrs"]["textAlign"] == "right"
    assert node_text(result) == node_text(original)
    assert original == before


def test_education_one_paragraph_splits_into_four_columns_without_inventing_text():
    original = doc(paragraph("某学院 本科 全日制 2011.09-2015.07"))
    result = prepare(original, "columns.layout", widths=[40, 15, 15, 30], alignments=["left", "left", "left", "right"],
                     rows=[{"paths": [[0]], "cells": [["某学院"], ["本科"], ["全日制"], ["2011.09-2015.07"]]}])
    assert [node_text(column) for column in result["content"][0]["content"]] == ["某学院", "本科", "全日制", "2011.09-2015.07"]
    identities = [node["attributes"].get("canvasNodeId") for node in inspect_document(result)["nodes"] if node["type"] == "paragraph"]
    assert len(identities) == len(set(identities))


def test_work_headers_share_geometry_and_preserve_heading_and_body():
    header = lambda text: {"type": "heading", "attrs": {"level": 3}, "content": [{"type": "text", "text": text}]}
    original = doc(header("甲公司 | Agent负责人"), paragraph("2023.02 - 2026.02"), paragraph("不改动的正文"), header("乙公司 | 技术经理"), paragraph("2019.08 - 2022.12"))
    rows = [{"paths": [[0], [1]], "cells": [["甲公司"], ["Agent负责人"], ["2023.02 - 2026.02"]]},
            {"paths": [[3], [4]], "cells": [["乙公司"], ["技术经理"], ["2019.08 - 2022.12"]]}]
    result = prepare(original, "columns.layout", widths=[45, 30, 25], alignments=["left", "left", "right"], rows=rows)
    assert result["content"][0]["attrs"] == result["content"][2]["attrs"]
    assert result["content"][1] == original["content"][2]
    for row in [result["content"][0], result["content"][2]]:
        assert row["content"][0]["content"][0]["type"] == "heading"
        assert row["content"][2]["content"][0]["attrs"]["textAlign"] == "right"


@pytest.mark.parametrize("cells", [[["某学院"], ["本科"], ["全日制"], ["新增日期"]], [["某学院"], ["本科"], [], ["2011"]]])
def test_layout_rejects_invention_or_omission(cells):
    with pytest.raises(ValueError):
        prepare(doc(paragraph("某学院 本科 全日制 2011")), "columns.layout", widths=[25] * 4, alignments=["left"] * 4, rows=[{"paths": [[0]], "cells": cells}])


def test_formatting_only_changes_selected_text_and_preserves_existing_color():
    source = doc({"type": "paragraph", "content": [{"type": "text", "text": "交付效率提升50%，其他内容", "marks": [{"type": "inlineStyle", "attrs": {"color": "#123456"}}]}]})
    result = prepare(source, "text.format", path=[0], text="提升50%", mark="bold")
    assert node_text(result) == node_text(source)
    bold = [node for node in result["content"][0]["content"] if {"type": "bold"} in node.get("marks", [])]
    assert [node["text"] for node in bold] == ["提升50%"]
    assert bold[0]["marks"][0] == {"type": "inlineStyle", "attrs": {"color": "#123456"}}


def test_unicode_repeated_text_requires_precise_occurrence():
    source = doc(paragraph("😀AI与AI"))
    with pytest.raises(ValueError, match="不唯一"):
        prepare(source, "text.replace", path=[0], text="AI", replacement="Agent")
    assert node_text(prepare(source, "text.replace", path=[0], text="AI", occurrence=1, replacement="Agent")) == "😀AI与Agent"


def test_nested_ordered_list_converts_without_losing_items_or_marks():
    nested = {"type": "bulletList", "content": [{"type": "listItem", "content": [paragraph("子项")]}]}
    source = doc({"type": "orderedList", "attrs": {"start": 3}, "content": [{"type": "listItem", "content": [paragraph("主项"), nested]}]})
    result = prepare(source, "list.convert", paths=[[0]], kind="bulletList", style="disc")
    assert result["content"][0]["type"] == "bulletList"
    assert "start" not in result["content"][0]["attrs"]
    assert result["content"][0]["content"] == source["content"][0]["content"]


def test_margins_are_document_state_and_have_minimum_content_area():
    result = prepare(doc(paragraph("正文")), "page.margins", top=40, bottom=40, left=36, right=36)
    assert result["attrs"]["pageMargins"]["left"] == 36
    with pytest.raises(ValueError):
        prepare(doc(paragraph("正文")), "page.margins", top=76, bottom=76, left=500, right=500)


def test_batch_failure_is_atomic_and_removed_capability_cannot_execute(monkeypatch):
    source = doc(paragraph("原文"))
    original = deepcopy(source)
    revision = capability_catalog()["revision"]
    with pytest.raises(ValueError):
        prepare_operations(source, [{"capability": "text.replace", "parameters": {"path": [0], "text": "原文", "replacement": "新文"}}, {"capability": "deleted.feature", "parameters": {}}], revision)
    assert source == original
    monkeypatch.delitem(CAPABILITIES, "text.replace")
    assert "text.replace" not in [item["id"] for item in capability_catalog()["operations"]]
    with pytest.raises(ValueError, match="能力已变化"):
        prepare_operations(source, [{"capability": "text.replace", "parameters": {}}], revision)
    with pytest.raises(ValueError, match="不存在或已被删除"):
        prepare_operations(source, [{"capability": "text.replace", "parameters": {}}], capability_catalog()["revision"])


def test_invalid_node_ranges_and_arbitrary_attributes_are_rejected():
    source = doc(paragraph("保留"))
    for paths in [[[-1]], [[0], [0]], [[]]]:
        with pytest.raises(ValueError):
            prepare(source, "blocks.delete", paths=paths)
    with pytest.raises(ValueError):
        prepare(source, "block.style", paths=[[0]], attributes={"cssText": "position:fixed"})


def test_catalog_contains_real_template_model_and_each_parameter_schema():
    catalog = capability_catalog()
    assert catalog["scope"] == "current_document"
    assert "TemplateBlocks" in catalog["template_schema"]["$defs"]
    assert {item["id"] for item in catalog["operations"]} == set(CAPABILITIES)
    assert all(item["parameters"]["additionalProperties"] is False for item in catalog["operations"])


def test_structure_inspection_paginates_and_reports_truncation_without_duplicated_container_text():
    source = doc(*(paragraph("内容" * 1000) for _ in range(80)))
    first = inspect_document(source, InspectOptions(limit=20, text_limit=100))
    assert first["nodes"][0]["text"] == ""
    assert first["nodes"][1]["text_length"] == 2000
    assert len(first["nodes"][1]["text"]) == 100
    assert first["next_offset"] == 20
    second = inspect_document(source, InspectOptions(offset=20, limit=1, text_limit=12000))
    assert second["nodes"][0]["path"] == [19]
    assert second["nodes"][0]["text"] == "内容" * 1000


def test_template_changes_use_effective_selected_template_instead_of_obsolete_document_override():
    source = {**doc(paragraph("正文")), "attrs": {"templateStyle": template_style_payload(template_id="previous")}}
    selected = template_style_payload(template_id="current")
    result = prepare_operations(source, [{"capability": "template.style", "parameters": {"changes": {"theme.accentColor": "#112233"}}}], capability_catalog()["revision"], selected)
    assert result["doc_json"]["attrs"]["templateStyle"]["template_id"] == "current"


def test_heading_conversion_preserves_each_source_identity_and_inline_marks():
    source = doc(paragraph("First", canvasNodeId="node_1", sourceBlockId="block_1", moduleId="mod_1"),
                 paragraph("Second", canvasNodeId="node_2", sourceBlockId="block_2", moduleId="mod_2"))
    source["content"][0]["content"][0]["marks"] = [{"type": "bold"}]
    headings = prepare(source, "block.type", paths=[[0], [1]], kind="heading", level=2)
    for before, after in zip(source["content"], headings["content"]):
        assert after["type"] == "heading"
        assert after["attrs"] == {**before["attrs"], "level": 2}
        assert after["content"] == before["content"]
    restored = prepare(headings, "block.type", paths=[[0], [1]], kind="paragraph")
    assert restored == source
