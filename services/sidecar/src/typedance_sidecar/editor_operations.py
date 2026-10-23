"""编辑能力的唯一目录、参数校验和确定性变换。此模块不涉及 AI 或会话。"""

from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
import json
import re
from typing import Annotated, Any, Callable, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import TemplateStyleConfig

MIN_COLUMN_WIDTH = 15
ColumnWidth = Annotated[float, Field(ge=MIN_COLUMN_WIDTH, le=100, allow_inf_nan=False)]


def validate_widths(widths):
    if abs(sum(widths) - 100) > 0.01:
        raise ValueError("栏宽合计必须为 100%")


class Parameters(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class Target(Parameters):
    path: list[int] = Field(min_length=1, max_length=24, description="inspect 返回的节点路径；批量操作按顺序执行，结构改变后应重新 inspect。")

    @model_validator(mode="after")
    def valid_path(self):
        if any(index < 0 for index in self.path):
            raise ValueError("节点路径不能包含负数")
        return self


class TextTarget(Target):
    text: str = Field(min_length=1, max_length=12000, description="节点中需要修改的准确原文。必须唯一匹配。")
    occurrence: int | None = Field(default=None, ge=0, description="原文重复时指定从 0 开始的匹配序号；不提供时要求唯一匹配。")


class ReplaceText(TextTarget):
    replacement: str = Field(max_length=12000)


class InlineStyle(Parameters):
    fontSize: str | None = Field(default=None, pattern=r"^(?:[8-9]|[1-6][0-9]|7[0-2])px$")
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    backgroundColor: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class FormatText(TextTarget):
    mark: Literal["bold", "italic", "underline", "strike", "inlineStyle"]
    enabled: bool = True
    attributes: InlineStyle | None = None


class BlockAttributes(Parameters):
    textAlign: Literal["left", "center", "right", "justify"] | None = None
    lineHeight: str | None = Field(default=None, pattern=r"^(?:0\.[89][0-9]?|[12](?:\.[0-9]{1,2})?|3(?:\.0{1,2})?)$", description="无单位 CSS 行高字符串，范围 0.8–3。")
    indent: int | None = Field(default=None, ge=0, le=8)


class StyleBlocks(Parameters):
    paths: list[list[int]] = Field(min_length=1, max_length=200)
    attributes: BlockAttributes


class ConvertList(Parameters):
    paths: list[list[int]] = Field(min_length=1, max_length=200)
    kind: Literal["bulletList", "orderedList"]
    style: Literal["disc", "circle", "dash", "decimal", "lower-alpha", "decimal-nested"] | None = None


class ColumnRow(Parameters):
    paths: list[list[int]] = Field(min_length=1, max_length=12, description="要重排的连续同级段落或标题路径。")
    cells: list[list[str]] = Field(min_length=2, max_length=6, description="每栏中的原文片段；按精确原文分配，不能增删事实。分隔用的空白、竖线和中点可被移除。")


class ColumnsParameters(Parameters):
    widths: list[ColumnWidth] = Field(min_length=2, max_length=6, description="每栏百分比，合计 100，每栏至少 15。多行共用同一组宽度与栏间距以保持对齐。")
    alignments: list[Literal["left", "center", "right"]] = Field(min_length=2, max_length=6)
    gap: Literal["compact", "default", "wide"] = "default"

    @model_validator(mode="after")
    def valid_columns(self):
        validate_widths(self.widths)
        if len(self.widths) != len(self.alignments):
            raise ValueError("栏宽数量须与对齐数量一致、每栏至少 15%、总计 100%")
        return self


class LayoutColumns(ColumnsParameters):
    rows: list[ColumnRow] = Field(min_length=1, max_length=60)


class UpdateColumns(Parameters):
    paths: list[list[int]] = Field(min_length=1, max_length=60)
    widths: list[ColumnWidth] | None = Field(default=None, min_length=2, max_length=6)
    alignments: list[Literal["left", "center", "right"]] | None = Field(default=None, min_length=2, max_length=6)
    gap: Literal["compact", "default", "wide"] | None = None

    @model_validator(mode="after")
    def actual_change(self):
        if self.widths is None and self.alignments is None and self.gap is None:
            raise ValueError("至少提供栏宽、对齐或栏间距中的一项")
        if self.widths is not None:
            validate_widths(self.widths)
        return self


class ColumnCount(Target):
    count: int = Field(ge=2, le=6)


class WrapColumns(Parameters):
    paths: list[list[int]] = Field(min_length=1, max_length=200)
    count: int = Field(ge=2, le=6)
    gap: Literal["compact", "default", "wide"] = "default"


class AddColumn(Target):
    after_index: int = Field(ge=0, le=5)


class RemoveColumn(Target):
    index: int = Field(ge=0, le=5)


class Paths(Parameters):
    paths: list[list[int]] = Field(min_length=1, max_length=200)

    @model_validator(mode="after")
    def distinct_paths(self):
        for index, path in enumerate(self.paths):
            if not path or any(value < 0 for value in path) or any(path[:len(other)] == other or other[:len(path)] == path for other in self.paths[:index]):
                raise ValueError("目标路径必须非空、互不重复且不能同时包含祖先和子节点")
        return self


class MoveBlocks(Paths):
    before: list[int] = Field(min_length=1)


class ChangeBlockType(Paths):
    kind: Literal["paragraph", "heading"]
    level: int = Field(default=2, ge=1, le=3)


class InsertBlock(Parameters):
    parent: list[int] = Field(default_factory=list, max_length=24)
    index: int = Field(ge=0)
    kind: Literal["paragraph", "heading", "horizontalRule"]
    text: str = Field(default="", max_length=12000)
    level: int = Field(default=2, ge=1, le=3)


class ReorderColumns(Target):
    order: list[int] = Field(min_length=2, max_length=6)


class Margins(Parameters):
    top: int = Field(ge=0, le=883)
    bottom: int = Field(ge=0, le=883)
    left: int = Field(ge=0, le=554)
    right: int = Field(ge=0, le=554)

    @model_validator(mode="after")
    def content_area(self):
        if self.left + self.right > 554 or self.top + self.bottom > 883:
            raise ValueError("A4 页面必须保留至少 240px 的内容宽度和高度")
        return self


DEFAULT_MARGINS = {"top": 76, "bottom": 76, "left": 50, "right": 50}


class PatchTemplate(Parameters):
    changes: dict[str, Any] = Field(min_length=1, max_length=80, description="当前文档模板样式的点分路径及新值，例如 blocks.heading2.decorationStyle。可用字段由 template_schema 提供。只影响当前画布；保存为共享模板需独立授权。")


def node_at(doc: dict, path: list[int]) -> dict:
    node = doc
    for index in path:
        if not isinstance(index, int) or isinstance(index, bool) or index < 0 or index >= len(node.get("content", [])):
            raise ValueError("节点路径已失效，请重新读取当前文档结构")
        node = node["content"][index]
    return node


def node_text(node: dict) -> str:
    if node.get("type") == "text":
        return node.get("text", "")
    if node.get("type") == "hardBreak":
        return "\n"
    return "".join(node_text(child) for child in node.get("content", []))


class InspectOptions(Parameters):
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=60, ge=1, le=200)
    text_limit: int = Field(default=1200, ge=1, le=12000)


def inspect_document(doc: dict, options: InspectOptions | None = None, template_style: dict | None = None) -> dict:
    validate_document(doc)
    options = options or InspectOptions()
    nodes = []

    def visit(node, path):
        if node.get("type") not in {"text", "hardBreak"}:
            text = node_text(node) if node.get("type") in {"paragraph", "heading", "codeBlock"} else ""
            nodes.append({"path": path, "type": node.get("type"),
                          "attributes": {key: value for key, value in node.get("attrs", {}).items() if key not in {"templateStyle", "pageMargins"}},
                          "text": text[:options.text_limit], "text_length": len(text), "child_count": len(node.get("content", [])),
                          "marks": [child for child in node.get("content", []) if child.get("marks")] if len(text) <= options.text_limit else []})
        for index, child in enumerate(node.get("content", [])):
            visit(child, [*path, index])

    visit(doc, [])
    selected, budget = [], 30000
    for node in nodes[options.offset:options.offset + options.limit]:
        size = len(json.dumps(node, ensure_ascii=False))
        if selected and size > budget:
            break
        selected.append(node)
        budget -= size
    end = options.offset + len(selected)
    return {"nodes": selected, "total_nodes": len(nodes), "next_offset": end if end < len(nodes) else None,
            "page_margins": doc.get("attrs", {}).get("pageMargins") or DEFAULT_MARGINS,
            "template_style": template_style or doc.get("attrs", {}).get("templateStyle")}


def inline_slice(node: dict, start: int, end: int) -> list[dict]:
    if node.get("type") not in {"paragraph", "heading", "codeBlock"} or any(child.get("type") not in {"text", "hardBreak"} for child in node.get("content", [])):
        raise ValueError("目标需要是仅含普通文字的段落或标题")
    result, offset = [], 0
    for child in node.get("content", []):
        text = node_text(child)
        left, right = max(start - offset, 0), min(end - offset, len(text))
        if right > left:
            copied = deepcopy(child)
            if child["type"] == "text":
                copied["text"] = text[left:right]
            result.append(copied)
        offset += len(text)
    return result


def text_range(node, expected, occurrence=None):
    text = node_text(node)
    matches = [match.start() for match in re.finditer(f"(?={re.escape(expected)})", text)]
    if not matches or (occurrence is None and len(matches) != 1) or (occurrence is not None and occurrence >= len(matches)):
        raise ValueError("目标原文不存在或不唯一，请缩小到准确节点并重新读取")
    start = matches[occurrence or 0]
    return start, start + len(expected)


def replace_text(doc, params: ReplaceText):
    node = node_at(doc, params.path)
    start, end = text_range(node, params.text, params.occurrence)
    selected = inline_slice(node, start, end)
    marks = selected[0].get("marks", []) if selected else []
    replacement = []
    for index, line in enumerate([params.replacement] if node["type"] == "codeBlock" else params.replacement.split("\n")):
        if index:
            replacement.append({"type": "hardBreak"})
        if line:
            replacement.append({"type": "text", "text": line, **({"marks": deepcopy(marks)} if marks else {})})
    node["content"] = inline_slice(node, 0, start) + replacement + inline_slice(node, end, len(node_text(node)))


def format_text(doc, params: FormatText):
    node = node_at(doc, params.path)
    start, end = text_range(node, params.text, params.occurrence)
    middle = inline_slice(node, start, end)
    for child in middle:
        if child["type"] != "text":
            continue
        marks = [mark for mark in child.get("marks", []) if mark["type"] != params.mark]
        if params.enabled:
            mark = {"type": params.mark}
            if params.mark == "inlineStyle":
                if not params.attributes:
                    raise ValueError("inlineStyle 必须提供样式属性")
                attributes = {**next((item.get("attrs", {}) for item in child.get("marks", []) if item["type"] == params.mark), {}), **params.attributes.model_dump(exclude_unset=True)}
                mark["attrs"] = {key: value for key, value in attributes.items() if value is not None}
            marks.append(mark)
        child["marks"] = marks
    node["content"] = inline_slice(node, 0, start) + middle + inline_slice(node, end, len(node_text(node)))


def style_blocks(doc, params: StyleBlocks):
    for path in params.paths:
        node = node_at(doc, path)
        if node["type"] not in {"paragraph", "heading", "listItem"}:
            raise ValueError("块样式只适用于段落、标题和列表项")
        node.setdefault("attrs", {}).update(params.attributes.model_dump(exclude_unset=True))


def convert_list(doc, params: ConvertList):
    allowed = {"bulletList": {"disc", "circle", "dash"}, "orderedList": {"decimal", "lower-alpha", "decimal-nested"}}
    if params.style and params.style not in allowed[params.kind]:
        raise ValueError("列表样式与列表类型不匹配")
    groups = []
    for path in sorted(params.paths):
        node = node_at(doc, path)
        if node["type"] not in {"paragraph", "bulletList", "orderedList"}:
            raise ValueError("列表转换只适用于段落或列表")
        previous = groups[-1][-1] if groups else None
        if previous and path[:-1] == previous[:-1] and path[-1] == previous[-1] + 1:
            groups[-1].append(path)
        else:
            groups.append([path])
    # 每组连续同级节点生成一个列表；倒序替换，保持其余目标路径有效。
    for paths in reversed(groups):
        sources = [node_at(doc, path) for path in paths]
        first = sources[0]
        attrs = deepcopy(first.get("attrs", {})) if first["type"] != "paragraph" else {}
        attrs.pop("listStyleType", None)
        attrs.pop("start", None)
        if params.style:
            attrs["listStyleType"] = params.style
        if params.kind == "orderedList":
            attrs["start"] = first.get("attrs", {}).get("start", 1) if first["type"] == "orderedList" else 1
        content = []
        for node in sources:
            if node["type"] == "paragraph":
                content.append({"type": "listItem", "content": [node]})
            else:
                content.extend(node["content"])
        parent = node_at(doc, paths[0][:-1])
        parent["content"][paths[0][-1]:paths[-1][-1] + 1] = [{"type": params.kind, "attrs": attrs, "content": content}]


def layout_columns(doc, params: LayoutColumns):
    used = []
    for row in params.rows:
        if len(row.cells) != len(params.widths):
            raise ValueError("每行栏数必须与宽度数量一致")
        paths = sorted(row.paths)
        if any(not path for path in paths) or any(path[:-1] != paths[0][:-1] for path in paths) or [path[-1] for path in paths] != list(range(paths[0][-1], paths[-1][-1] + 1)):
            raise ValueError("分栏来源必须是连续的同级节点")
        if any(path in used for path in paths):
            raise ValueError("分栏来源不能重复")
        used.extend(paths)
    for row in sorted(params.rows, key=lambda item: item.paths[0], reverse=True):
        paths = sorted(row.paths)
        sources = [node_at(doc, path) for path in paths]
        consumed = [set() for _ in sources]
        columns = []
        reused_ids = set()
        for fragments, alignment in zip(row.cells, params.alignments):
            paragraphs = []
            for fragment in fragments:
                if not fragment:
                    raise ValueError("栏内原文片段不能为空")
                matches = []
                for index, node in enumerate(sources):
                    text = node_text(node)
                    start = text.find(fragment)
                    while start >= 0:
                        positions = set(range(start, start + len(fragment)))
                        if not positions & consumed[index]:
                            matches.append((index, start, positions))
                        start = text.find(fragment, start + 1)
                if len(matches) != 1:
                    raise ValueError("栏内原文不存在或无法唯一定位，不能猜测或改写内容")
                index, start, positions = matches[0]
                consumed[index].update(positions)
                original = sources[index]
                attrs = deepcopy(original.get("attrs", {}))
                source_id = attrs.get("canvasNodeId")
                if source_id in reused_ids or not source_id:
                    attrs.pop("sourceBlockId", None)
                    attrs["canvasNodeId"] = f"canvas_{uuid4().hex}"
                reused_ids.add(attrs["canvasNodeId"])
                attrs["textAlign"] = alignment
                paragraphs.append({"type": original["type"], "attrs": attrs, "content": inline_slice(original, start, start + len(fragment))})
            columns.append({"type": "column", "content": paragraphs or [{"type": "paragraph"}]})
        for index, node in enumerate(sources):
            if any(char not in " \t\r\n|｜·" for pos, char in enumerate(node_text(node)) if pos not in consumed[index]):
                raise ValueError("分栏遗漏原文；请将所有内容分配到栏内")
        parent = node_at(doc, paths[0][:-1])
        parent["content"][paths[0][-1]:paths[-1][-1] + 1] = [{"type": "columns", "attrs": {"count": len(columns), "widths": params.widths, "gap": params.gap}, "content": columns}]


def update_columns(doc, params: UpdateColumns):
    for path in params.paths:
        node = node_at(doc, path)
        count = len(node.get("content", []))
        if node["type"] != "columns" or (params.widths is not None and len(params.widths) != count) or (params.alignments is not None and len(params.alignments) != count):
            raise ValueError("目标必须是栏数一致的分栏节点；改变栏数使用 columns.count")
        node.setdefault("attrs", {}).update(count=count, **params.model_dump(exclude={"paths", "alignments"}, exclude_none=True))
        for column, alignment in zip(node["content"], params.alignments or []):
            for block in column.get("content", []):
                if block["type"] in {"paragraph", "heading", "listItem"}:
                    block.setdefault("attrs", {})["textAlign"] = alignment


def equal_widths(count):
    width = int(100 / count * 10000) / 10000
    return [width] * (count - 1) + [round(100 - width * (count - 1), 4)]


def column_widths(node):
    return node.get("attrs", {}).get("widths") or equal_widths(len(node["content"]))


def require_columns(doc, path):
    node = node_at(doc, path)
    if node["type"] != "columns":
        raise ValueError("目标不是分栏")
    return node


def wrap_columns(doc, params: WrapColumns):
    paths = sorted(params.paths)
    if any(path[:-1] != paths[0][:-1] for path in paths) or [path[-1] for path in paths] != list(range(paths[0][-1], paths[-1][-1] + 1)):
        raise ValueError("分栏来源必须为连续的同级内容块")
    content = [node_at(doc, path) for path in paths]
    if any(node["type"] in {"text", "hardBreak", "column", "listItem"} for node in content):
        raise ValueError("只能对完整内容块分栏")
    columns = [{"type": "column", "content": content}] + [{"type": "column", "content": [{"type": "paragraph"}]} for _ in range(params.count - 1)]
    node_at(doc, paths[0][:-1])["content"][paths[0][-1]:paths[-1][-1] + 1] = [{"type": "columns", "attrs": {"count": params.count, "gap": params.gap, "widths": equal_widths(params.count)}, "content": columns}]


def set_column_count(doc, params: ColumnCount):
    node = require_columns(doc, params.path)
    count = len(node["content"])
    if params.count == count:
        return
    if params.count < count:
        survivor = node["content"][params.count - 1]
        survivor["content"].extend(block for column in node["content"][params.count:] for block in column["content"])
        del node["content"][params.count:]
    else:
        node["content"].extend({"type": "column", "content": [{"type": "paragraph"}]} for _ in range(params.count - count))
    node.setdefault("attrs", {}).update(count=params.count, widths=equal_widths(params.count))


def add_column(doc, params: AddColumn):
    node = require_columns(doc, params.path)
    count = len(node["content"])
    if count >= 6 or params.after_index >= count:
        raise ValueError("最多六栏，且插入位置须为现有栏")
    widths = column_widths(node)
    target = 100 / (count + 1)
    available = sum(width - MIN_COLUMN_WIDTH for width in widths)
    next_widths = [round(width - target * (width - MIN_COLUMN_WIDTH) / available, 4) for width in widths]
    next_widths.insert(params.after_index + 1, round(100 - sum(next_widths), 4))
    node["content"].insert(params.after_index + 1, {"type": "column", "content": [{"type": "paragraph"}]})
    node.setdefault("attrs", {}).update(count=count + 1, widths=next_widths)


def remove_column(doc, params: RemoveColumn):
    node = require_columns(doc, params.path)
    count = len(node["content"])
    if params.index >= count:
        raise ValueError("删除位置必须为现有栏")
    widths = list(column_widths(node))
    node["content"].pop(params.index)
    if count == 2:
        node_at(doc, params.path[:-1])["content"][params.path[-1]:params.path[-1] + 1] = node["content"][0]["content"]
    else:
        removed = widths.pop(params.index)
        recipient = max(0, params.index - 1)
        widths[recipient] = round(widths[recipient] + removed, 4)
        node.setdefault("attrs", {}).update(count=count - 1, widths=widths)


def unwrap_columns(doc, params: Paths):
    for path in sorted(params.paths, reverse=True):
        node = node_at(doc, path)
        if node["type"] != "columns":
            raise ValueError("目标不是分栏")
        content = [block for column in node["content"] for block in column["content"]]
        node_at(doc, path[:-1])["content"][path[-1]:path[-1] + 1] = content


def delete_blocks(doc, params: Paths):
    for path in sorted(params.paths, reverse=True):
        if not path:
            raise ValueError("不能删除文档根节点")
        node_at(doc, path)
        node_at(doc, path[:-1])["content"].pop(path[-1])
    if not doc.get("content"):
        doc["content"] = [{"type": "paragraph"}]


def move_blocks(doc, params: MoveBlocks):
    paths = sorted(params.paths)
    if not paths or any(path[:-1] != params.before[:-1] for path in paths) or params.before in paths:
        raise ValueError("移动目标必须是未选中的同级节点")
    node_at(doc, params.before)
    parent = node_at(doc, params.before[:-1])
    nodes = [node_at(doc, path) for path in paths]
    before = params.before[-1] - sum(path[-1] < params.before[-1] for path in paths)
    for path in reversed(paths):
        parent["content"].pop(path[-1])
    parent["content"][before:before] = nodes


def change_block_type(doc, params: ChangeBlockType):
    for path in params.paths:
        node = node_at(doc, path)
        if node["type"] not in {"paragraph", "heading"}:
            raise ValueError("只支持正文与标题之间转换")
        node["type"] = params.kind
        attrs = node.setdefault("attrs", {})
        attrs.pop("level", None)
        if params.kind == "heading":
            attrs["level"] = params.level


def insert_block(doc, params: InsertBlock):
    parent = node_at(doc, params.parent)
    if parent["type"] not in {"doc", "column", "listItem"} or params.index > len(parent.get("content", [])):
        raise ValueError("此位置不能插入内容块")
    node = {"type": params.kind, "attrs": {"canvasNodeId": f"canvas_{uuid4().hex}"}}
    if params.kind == "horizontalRule":
        if params.text:
            raise ValueError("分隔线不能包含文字")
    else:
        node["content"] = [{"type": "text", "text": params.text}] if params.text else []
    if params.kind == "heading":
        node["attrs"]["level"] = params.level
    parent.setdefault("content", []).insert(params.index, node)


def reorder_columns(doc, params: ReorderColumns):
    node = node_at(doc, params.path)
    if node["type"] != "columns" or sorted(params.order) != list(range(len(node["content"]))):
        raise ValueError("栏顺序必须是当前所有栏索引的唯一排列")
    node["content"] = [node["content"][index] for index in params.order]
    widths = node.get("attrs", {}).get("widths")
    if widths:
        node["attrs"]["widths"] = [widths[index] for index in params.order]


def page_margins(doc, params: Margins):
    doc.setdefault("attrs", {})["pageMargins"] = params.model_dump()


def patch_template(doc, params: PatchTemplate):
    style = deepcopy(doc.get("attrs", {}).get("templateStyle"))
    if not style:
        raise ValueError("当前快照未提供模板样式，请重新读取编辑器")
    for path, value in params.changes.items():
        keys = path.split(".")
        if keys[0] not in {"theme", "blocks"} or len(keys) < 2:
            raise ValueError("仅允许修改当前文档模板的 theme 和 blocks 字段")
        parent = style
        for key in keys[:-1]:
            if not isinstance(parent.get(key), dict):
                raise ValueError("模板样式路径不存在")
            parent = parent[key]
        parent[keys[-1]] = value
    # 与实际保存/渲染使用同一个模型；新增或删除样式属性会同步到能力目录。
    style["preset"] = ""
    doc.setdefault("attrs", {})["templateStyle"] = TemplateStyleConfig.model_validate(style).model_dump(by_alias=True, exclude_none=True)


@dataclass(frozen=True)
class Capability:
    title: str
    description: str
    parameters: type[Parameters]
    execute: Callable[[dict, Any], None]
    effect: Literal["content", "format", "layout"]


CAPABILITIES = {
    "text.replace": Capability("改写文字", "精确替换一个段落内的原文，保留其他内容和格式。", ReplaceText, replace_text, "content"),
    "text.format": Capability("文字强调与样式", "对准确原文设置或移除加粗、斜体、下划线、删除线、字号及颜色。", FormatText, format_text, "format"),
    "block.style": Capability("段落样式", "设置段落、标题或列表项的对齐、行高和缩进。", StyleBlocks, style_blocks, "format"),
    "list.convert": Capability("列表转换", "将段落或现有列表转换为有序/无序列表，保留列表项和嵌套内容。", ConvertList, convert_list, "layout"),
    "columns.layout": Capability("分栏排版", "把连续段落中的准确原文分配到 2–6 栏。多行共用宽度和间距；右对齐只影响指定栏。不能遗漏文字。", LayoutColumns, layout_columns, "layout"),
    "columns.wrap": Capability("创建分栏", "将连续完整内容块保留在第一栏，其余栏为空；智能分配原文使用 columns.layout。", WrapColumns, wrap_columns, "layout"),
    "columns.count": Capability("调整栏数", "调整到 2–6 栏；减少时把被移除栏的内容合并到最后保留栏，不删除内容。", ColumnCount, set_column_count, "layout"),
    "columns.add": Capability("插入空栏", "在指定栏后插入空栏，保留内容并重新分配栏宽，最多六栏。", AddColumn, add_column, "layout"),
    "columns.remove": Capability("删除栏及内容", "删除明确指定的栏和其中内容；仅两栏时展开保留栏。纯排版任务不得用来删减事实。", RemoveColumn, remove_column, "content"),
    "columns.update": Capability("调整现有分栏", "独立或批量修改同栏数分栏的宽度、栏间距、对齐；未指定项保持原值。", UpdateColumns, update_columns, "layout"),
    "columns.unwrap": Capability("取消分栏", "按栏顺序恢复普通内容，保留文字。", Paths, unwrap_columns, "layout"),
    "blocks.move": Capability("移动内容块", "将同级内容块移动到指定同级节点之前，保留结构与内容。", MoveBlocks, move_blocks, "layout"),
    "block.type": Capability("正文与标题", "将正文或标题转换为正文/H1–H3，保留原文、标记和来源关联。", ChangeBlockType, change_block_type, "format"),
    "blocks.insert": Capability("插入内容块", "在明确位置插入正文、标题或分隔线，不能为用户编造事实。", InsertBlock, insert_block, "content"),
    "columns.reorder": Capability("调整栏顺序", "按完整索引排列移动栏及对应宽度，保持内容。", ReorderColumns, reorder_columns, "layout"),
    "blocks.delete": Capability("删除内容块", "删除明确指定的内容节点；属于内容修改，不应用于仅要求排版的任务。", Paths, delete_blocks, "content"),
    "page.margins": Capability("页面边距", "设置实际 A4 页面边距（px），辅助线、分页和导出使用相同状态。", Margins, page_margins, "layout"),
    "template.style": Capability("优化当前模板样式", "修改当前画布使用的模板样式，保存在文档中并可撤销，不覆盖其他简历或共享模板。", PatchTemplate, patch_template, "format"),
}


def capability_catalog() -> dict:
    operations = [{"id": key, "title": capability.title, "description": capability.description,
                   "effect": capability.effect, "parameters": capability.parameters.model_json_schema()} for key, capability in CAPABILITIES.items()]
    body = {"operations": operations, "template_schema": TemplateStyleConfig.model_json_schema(by_alias=True),
            "scope": "current_document", "units": {"page_margins": "px", "column_widths": "percent"}}
    return {"revision": sha256(json.dumps(body, sort_keys=True).encode()).hexdigest(), **body}


def validate_document(doc: dict) -> None:
    ids, count = set(), 0

    def visit(node, depth):
        nonlocal count
        count += 1
        if depth > 32 or count > 10000 or not isinstance(node, dict) or not isinstance(node.get("type"), str):
            raise ValueError("文档结构无效或超过处理范围")
        kind = node["type"]
        content = node.get("content", [])
        if not isinstance(content, list) or any(not isinstance(child, dict) for child in content):
            raise ValueError("文档子节点必须为节点数组")
        if not isinstance(node.get("attrs", {}), dict):
            raise ValueError("节点属性必须为对象")
        if kind in {"doc", "column", "listItem", "bulletList", "orderedList"} and not content:
            raise ValueError("内容容器不能为空")
        if kind == "columns" and (not 2 <= len(content) <= 6 or any(child.get("type") != "column" for child in content)):
            raise ValueError("分栏必须包含 2–6 个栏节点")
        if kind == "columns":
            attrs = node.get("attrs", {})
            if attrs.get("count", len(content)) != len(content):
                raise ValueError("分栏数量属性须与实际栏数一致")
            if attrs.get("widths") is not None:
                ColumnsParameters(widths=attrs["widths"], alignments=["left"] * len(content))
                if len(attrs["widths"]) != len(content):
                    raise ValueError("分栏宽度数量与实际栏数不一致")
        if kind in {"bulletList", "orderedList"} and any(child.get("type") != "listItem" for child in content):
            raise ValueError("列表只能包含列表项")
        if kind == "listItem" and content[0].get("type") != "paragraph":
            raise ValueError("列表项必须以正文段落开始")
        if kind == "text" and (not isinstance(node.get("text"), str) or not node["text"]):
            raise ValueError("文本节点不能为空")
        identity = node.get("attrs", {}).get("canvasNodeId")
        if identity:
            if identity in ids:
                raise ValueError("画布节点 ID 重复")
            ids.add(identity)
        for child in content:
            visit(child, depth + 1)

    visit(doc, 0)
    attrs = doc.get("attrs", {})
    if attrs.get("pageMargins"):
        Margins.model_validate(attrs["pageMargins"])
    if attrs.get("templateStyle"):
        TemplateStyleConfig.model_validate(attrs["templateStyle"])
    if len(json.dumps(doc, ensure_ascii=False)) > 500_000:
        raise ValueError("画布文档超过处理大小限制")


def prepare_operations(doc_json: dict, operations: list[dict], catalog_revision: str, template_style: dict | None = None) -> dict:
    catalog = capability_catalog()
    if catalog_revision != catalog["revision"]:
        raise ValueError("编辑能力已变化，请重新读取能力目录")
    if doc_json.get("type") != "doc" or not isinstance(doc_json.get("content"), list):
        raise ValueError("无效画布文档")
    validate_document(doc_json)
    if not 1 <= len(operations) <= 100:
        raise ValueError("每个事务需要 1–100 项操作")
    result = deepcopy(doc_json)
    if template_style and any(operation.get("capability") == "template.style" for operation in operations):
        result.setdefault("attrs", {})["templateStyle"] = TemplateStyleConfig.model_validate(template_style).model_dump(by_alias=True, exclude_none=True)
    effects = []
    for operation in operations:
        if set(operation) != {"capability", "parameters"}:
            raise ValueError("操作只能包含 capability 和 parameters")
        capability = CAPABILITIES.get(operation["capability"])
        if not capability:
            raise ValueError("编辑能力不存在或已被删除")
        params = capability.parameters.model_validate(operation["parameters"])
        if hasattr(params, "paths"):
            Paths(paths=params.paths)
        capability.execute(result, params)
        effects.append({"capability": operation["capability"], "title": capability.title, "effect": capability.effect})
    validate_document(result)
    return {"doc_json": result, "effects": effects, "catalog_revision": catalog["revision"]}
