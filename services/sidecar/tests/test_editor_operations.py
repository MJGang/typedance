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
    identities = [node["attributes"].get("canvasNodeId") for node in inspect_document(result, InspectOptions(view="layout"))["nodes"] if node["type"] == "paragraph"]
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


def test_contiguous_paragraphs_become_one_numbered_list_with_source_attributes_preserved():
    source = doc(*(paragraph(text, canvasNodeId=f"node_{index}", sourceBlockId=f"source_{index}") for index, text in enumerate(["第一项", "第二项", "第三项"])))
    source["content"][1]["content"][0]["marks"] = [{"type": "bold"}]
    result = prepare(source, "list.convert", paths=[[2], [0], [1]], kind="orderedList", style="decimal")
    assert len(result["content"]) == 1
    numbered = result["content"][0]
    assert numbered["attrs"]["start"] == 1
    assert [item["content"][0] for item in numbered["content"]] == source["content"]


def test_list_conversion_groups_only_contiguous_siblings_and_preserves_nested_lists():
    nested = {"type": "bulletList", "content": [{"type": "listItem", "content": [paragraph("嵌套项")]}]}
    existing = {"type": "orderedList", "attrs": {"start": 3}, "content": [{"type": "listItem", "content": [paragraph("原列表项"), nested]}]}
    source = doc(existing, paragraph("连续正文"), paragraph("未选中的正文"), paragraph("另一组一"), paragraph("另一组二"))
    result = prepare(source, "list.convert", paths=[[0], [1], [3], [4]], kind="orderedList", style="decimal")
    assert [node["type"] for node in result["content"]] == ["orderedList", "paragraph", "orderedList"]
    assert result["content"][0]["attrs"]["start"] == 3
    assert result["content"][0]["content"][0] == existing["content"][0]
    assert len(result["content"][0]["content"]) == 2
    assert len(result["content"][2]["content"]) == 2
    assert node_text(result) == node_text(source)


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
    catalog = capability_catalog(list(CAPABILITIES))
    assert catalog["scope"] == "current_document"
    assert "TemplateBlocks" in catalog["template_schema"]["$defs"]
    assert {item["id"] for item in catalog["operations"]} == set(CAPABILITIES)
    assert all(item["parameters"]["additionalProperties"] is False for item in catalog["operations"])


def test_catalog_outline_and_selected_schemas_share_the_same_authoritative_revision():
    outline = capability_catalog()
    selected = capability_catalog(["text.replace"])
    assert "template_schema" not in outline
    assert all("parameters" not in operation for operation in outline["operations"])
    assert [operation["id"] for operation in selected["operations"]] == ["text.replace"]
    assert selected["operations"][0]["parameters"]["additionalProperties"] is False
    assert selected["revision"] == outline["revision"] == capability_catalog(["template.style"])["revision"]
    with pytest.raises(ValueError, match="不存在或已被删除"):
        capability_catalog(["removed.operation"])


def test_targeted_detail_inspection_preserves_text_and_utf16_marks_without_repeating_text_in_marks():
    source = doc(paragraph("other"), {"type": "paragraph", "content": [
        {"type": "text", "text": "😀正文", "marks": [{"type": "bold"}]},
        {"type": "text", "text": "保留"},
    ]})
    outline = inspect_document(source)
    assert [node["path"] for node in outline["nodes"]] == [[0], [1]]
    assert "marks" not in outline["nodes"][1]
    assert "template_style" not in outline
    detail = inspect_document(source, InspectOptions(view="detail", paths=[[1]], text_limit=12000))
    assert len(detail["nodes"]) == 1
    assert detail["nodes"][0]["text"] == "😀正文保留"
    assert detail["nodes"][0]["marks"] == [{"from": 0, "to": 4, "marks": [{"type": "bold"}]}]
    layout = inspect_document(source, InspectOptions(view="layout", paths=[[1]]))
    assert "text" not in layout["nodes"][0]
    assert layout["nodes"][0]["text_length"] == 5
    with pytest.raises(ValueError):
        inspect_document(source, InspectOptions(paths=[[100]]))


def test_structure_inspection_paginates_and_reports_truncation_without_duplicated_container_text():
    source = doc(*(paragraph("内容" * 1000) for _ in range(80)))
    first = inspect_document(source, InspectOptions(limit=20, text_limit=100))
    assert first["nodes"][0]["path"] == [0]
    assert first["nodes"][0]["text_truncated"] is True
    assert first["nodes"][1]["text_length"] == 2000
    assert len(first["nodes"][1]["text"]) == 100
    assert first["next_offset"] == 20
    second = inspect_document(source, InspectOptions(offset=20, limit=1, text_limit=12000))
    assert first["truncation_reasons"] == ["node_limit"]
    assert second["nodes"][0]["path"] == [20]
    assert second["nodes"][0]["text"] == "内容" * 1000


def test_default_outline_covers_text_blocks_without_container_attributes():
    source = doc({"type": "bulletList", "content": [
        {"type": "listItem", "content": [paragraph(f"第{index}段", canvasNodeId=f"node_{index}")]}
        for index in range(76)
    ]})
    outline = inspect_document(source)
    assert outline["scope"] == "text_blocks"
    assert outline["total_nodes"] == outline["returned_nodes"] == 76
    assert outline["next_offset"] is None
    assert outline["truncated"] is False
    assert outline["truncation_reasons"] == []
    assert outline["nodes"][-1]["path"] == [0, 75, 0]
    assert all("attributes" not in node and "child_count" not in node for node in outline["nodes"])
    detail = inspect_document(source, InspectOptions(view="detail", paths=[[0, 75, 0]]))
    assert detail["nodes"][0]["attributes"]["canvasNodeId"] == "node_75"
    with pytest.raises(ValueError, match="paths"):
        inspect_document(source, InspectOptions(view="detail"))


def test_inspect_response_budget_explicitly_reports_omitted_nodes():
    result = inspect_document(doc(*(paragraph("长" * 1000) for _ in range(100))), InspectOptions(text_limit=1000))
    assert 0 < result["returned_nodes"] < 100
    assert result["next_offset"] == result["returned_nodes"]
    assert result["truncated"] is True
    assert "response_budget" in result["truncation_reasons"]


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


def columns_doc(widths, labels):
    return doc({"type": "columns", "attrs": {"count": len(widths), "gap": "wide", "widths": widths},
                "content": [{"type": "column", "content": [paragraph(label, canvasNodeId=f"node_{index}")]} for index, label in enumerate(labels)]})


def test_manual_column_wrap_preserves_whole_blocks_and_shrinking_keeps_all_content():
    source = doc(paragraph("甲", canvasNodeId="node_a"), paragraph("乙", canvasNodeId="node_b"), paragraph("不选中的正文"))
    wrapped = prepare(source, "columns.wrap", paths=[[0], [1]], count=3)
    assert wrapped["content"][0]["content"][0]["content"] == source["content"][:2]
    assert node_text(wrapped) == node_text(source)
    assert wrapped["content"][1] == source["content"][2]
    source = columns_doc([30, 40, 30], ["甲", "乙", "丙"])
    shrunk = prepare(source, "columns.count", path=[0], count=2)
    assert [node_text(column) for column in shrunk["content"][0]["content"]] == ["甲", "乙丙"]
    assert shrunk["content"][0]["attrs"] == {"count": 2, "gap": "wide", "widths": [50, 50]}
    assert prepare(shrunk, "columns.count", path=[0], count=4)["content"][0]["content"][:2] == shrunk["content"][0]["content"]


def test_column_add_preserves_existing_nodes_and_width_constraints_and_refuses_seventh():
    source = columns_doc([60, 40], ["左", "右"])
    added = prepare(source, "columns.add", path=[0], after_index=0)["content"][0]
    assert [node_text(column) for column in added["content"]] == ["左", "", "右"]
    assert added["content"][0] == source["content"][0]["content"][0]
    assert added["content"][2] == source["content"][0]["content"][1]
    assert added["attrs"]["widths"][0] > added["attrs"]["widths"][2]
    sixth = prepare(columns_doc([20] * 5, list("一二三四五")), "columns.add", path=[0], after_index=4)
    assert len(sixth["content"][0]["content"]) == 6
    assert min(sixth["content"][0]["attrs"]["widths"]) >= 15
    assert sum(sixth["content"][0]["attrs"]["widths"]) == pytest.approx(100)
    before = deepcopy(sixth)
    with pytest.raises(ValueError, match="最多六栏"):
        prepare(sixth, "columns.add", path=[0], after_index=5)
    assert sixth == before


def test_column_remove_redistributes_width_and_unwraps_last_survivor():
    source = columns_doc([30, 40, 30], ["甲", "乙", "丙"])
    removed = prepare(source, "columns.remove", path=[0], index=1)
    assert [node_text(column) for column in removed["content"][0]["content"]] == ["甲", "丙"]
    assert removed["content"][0]["attrs"]["widths"] == [70, 30]
    assert prepare(removed, "columns.remove", path=[0], index=0)["content"] == source["content"][0]["content"][2]["content"]


def test_partial_column_updates_preserve_mixed_block_alignment_and_other_fields():
    source = columns_doc([60, 40], ["左", "右"])
    source["content"][0]["content"][0]["content"].append(paragraph("居中", textAlign="center"))
    source["content"][0]["content"][1]["content"][0]["attrs"]["textAlign"] = "right"
    for parameters in [{"gap": "compact"}, {"widths": [55, 45]}]:
        updated = prepare(source, "columns.update", paths=[[0]], **parameters)["content"][0]
        assert updated["content"] == source["content"][0]["content"]
        assert updated["attrs"] == {**source["content"][0]["attrs"], **parameters}


def test_column_reorder_moves_custom_widths_with_content():
    source = columns_doc([30, 40, 30], ["甲", "乙", "丙"])
    result = prepare(source, "columns.reorder", path=[0], order=[1, 2, 0])["content"][0]
    assert [node_text(column) for column in result["content"]] == ["乙", "丙", "甲"]
    assert result["attrs"]["widths"] == [40, 30, 30]


def test_column_alignment_applies_to_nested_list_text_without_overwriting_nested_columns():
    inner = columns_doc([60, 40], ["独立左栏", "独立右栏"])["content"][0]
    nested = {"type": "orderedList", "attrs": {"start": 3}, "content": [{"type": "listItem", "content": [paragraph("子项", textAlign="left")]}]}
    source = doc({"type": "bulletList", "content": [{"type": "listItem", "content": [paragraph("主项", textAlign="left"), nested]}]}, inner)
    wrapped = prepare(source, "columns.wrap", paths=[[0], [1]], count=2)
    result = prepare(wrapped, "columns.update", paths=[[0]], alignments=["right", "left"])
    first_column = result["content"][0]["content"][0]
    listing, preserved_inner = first_column["content"]
    item = listing["content"][0]
    assert item["attrs"]["textAlign"] == "right"
    assert item["content"][0]["attrs"]["textAlign"] == "right"
    child = item["content"][1]["content"][0]
    assert child["attrs"]["textAlign"] == child["content"][0]["attrs"]["textAlign"] == "right"
    assert item["content"][1]["attrs"]["start"] == 3
    assert node_text(result) == node_text(source)
    assert preserved_inner == inner


@pytest.mark.parametrize("capability,parameters,targets", [
    ("columns.wrap", {"count": 2}, [[0, 0, 0], [0, 0, 1]]),
    ("list.convert", {"kind": "bulletList"}, [[0, 0, 0], [0, 1, 0]]),
])
def test_node_origins_report_exact_sources_without_ids_even_for_identical_paragraphs(capability, parameters, targets):
    source = doc(paragraph("相同内容"), paragraph("相同内容"))
    result = prepare_operations(source, [{"capability": capability, "parameters": {"paths": [[0], [1]], **parameters}}], capability_catalog()["revision"])
    assert [item for item in result["node_origins"] if len(item["before_path"]) == 1] == [{"before_path": [index], "after_path": target} for index, target in enumerate(targets)]
    assert source == doc(paragraph("相同内容"), paragraph("相同内容"))


def test_deleted_then_recreated_identical_content_reports_the_old_node_as_removed():
    result = prepare_operations(doc(paragraph("原文")), [
        {"capability": "blocks.delete", "parameters": {"paths": [[0]]}},
        {"capability": "blocks.insert", "parameters": {"index": 0, "text": "原文", "kind": "paragraph"}},
    ], capability_catalog()["revision"])
    assert {"before_path": [0], "after_path": None} in result["node_origins"]


def test_text_origins_follow_utf16_fragments_across_batched_formatting_and_column_layout():
    source = doc(paragraph("甲公司 | Agent😀负责人"))
    result = prepare_operations(source, [
        {"capability": "text.format", "parameters": {"path": [0], "text": "甲", "mark": "bold", "enabled": False}},
        {"capability": "columns.layout", "parameters": {"widths": [50, 50], "alignments": ["left", "right"],
            "rows": [{"paths": [[0]], "cells": [["甲公司"], ["Agent😀负责人"]]}]}},
    ], capability_catalog()["revision"])
    assert result["text_origins"] == [{"before_path": [0], "spans": [
        {"before_from": 0, "before_to": 3, "after_path": [0, 0, 0], "after_from": 0},
        {"before_from": 6, "before_to": 16, "after_path": [0, 1, 0], "after_from": 0},
    ]}]


def test_text_origins_distinguish_deleted_and_surviving_identical_text():
    result = prepare_operations(doc(paragraph("引用😀与引用😀")), [
        {"capability": "text.replace", "parameters": {"path": [0], "text": "引用😀", "occurrence": 0, "replacement": ""}},
    ], capability_catalog()["revision"])
    assert result["text_origins"] == [{"before_path": [0], "spans": [
        {"before_from": 4, "before_to": 9, "after_path": [0], "after_from": 0},
    ]}]


@pytest.mark.parametrize("capability,parameters", [
    ("columns.update", {"paths": [[0]]}),
    ("columns.update", {"paths": [[0]], "widths": [10, 90]}),
    ("columns.update", {"paths": [[0]], "widths": [40, 40]}),
    ("columns.update", {"paths": [[0]], "alignments": ["left"] * 3}),
    ("columns.count", {"path": [0], "count": 7}),
    ("columns.add", {"path": [0], "after_index": 2}),
    ("columns.remove", {"path": [0], "index": 2}),
    ("blocks.delete", {"paths": [[0, 0]]}),
])
def test_invalid_column_mutations_are_atomic(capability, parameters):
    source = columns_doc([60, 40], ["甲", "乙"])
    before = deepcopy(source)
    with pytest.raises(ValueError):
        prepare(source, capability, **parameters)
    assert source == before
