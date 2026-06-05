# 工作台源画布初始化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让旧简历导入先生成可编辑 `SourceResumeCanvas.doc_json` 并立即进入工作台，同时保留现有粘贴文本、TXT、Markdown、PDF、DOCX、DOC 格式支持，后台 AI 再识别模块、事实、问题和建议。

**Architecture:** 导入链路拆成快路径和慢路径。快路径在保存 `SourceDocument` 时通过 `SourceCanvasInitializer` 生成 `source_resume_canvas.doc_json/node_map/version`；慢路径的 `import_reconstruct` run 在后台读取同一份 source canvas 版本，完成 AI 识别后只把结果应用到匹配版本。

**Tech Stack:** FastAPI、Pydantic、SQLite JSON payload、Tiptap 3 Markdown extension、Vitest、React 19、pytest、Tailwind CSS。

---

## Scope Check

这份计划覆盖一个闭环工作流，不拆成多个独立计划：后端 source canvas 初始化、文件格式 adapter、revision run 后台化、版本绑定、前端导入状态共同决定“首屏是否等待 AI”和“Markdown 嵌套结构是否进入 Tiptap 官方解析”。DOCX/PDF/DOC 是同一初始化器下的格式 adapter，不单独立项。

## File Structure

- Create: `services/sidecar/src/typedance_sidecar/source_canvas_doc_json.py`
  - 负责遍历 Tiptap `doc_json`、注入 `canvasNodeId/sourceBlockId`、计算 `node_map`、计算 source canvas hash。
- Create: `services/sidecar/src/typedance_sidecar/source_canvas_initializer.py`
  - 负责按 source 格式选择 adapter，生成 `SourceResumeCanvas`。
- Create: `services/sidecar/src/typedance_sidecar/source_canvas_docx.py`
  - 负责从 DOCX 的 `word/document.xml` 读取段落、标题、列表层级和基础 inline marks。
- Create: `services/sidecar/src/typedance_sidecar/source_canvas_anchor_mapper.py`
  - 负责 AI 完成后把 `ParsedBlock.source_block_refs` 映射回已有 canvas node，并更新 `module_anchors`。
- Create: `services/sidecar/src/typedance_sidecar/source_section_rules.py`
  - 负责保存中文简历章节标题别名，供初始化器和 AI 慢路径共同使用。
- Modify: `services/sidecar/src/typedance_sidecar/markdown_doc_json.py`
  - 增加整篇 Markdown 转 `docJson` 的 Python 桥接方法。
- Modify: `services/sidecar/src/typedance_sidecar/revision_models.py`
  - 更新 source/run 状态、source metadata、canvas version/hash、run 输入 canvas 版本字段。
- Modify: `services/sidecar/src/typedance_sidecar/revision_api.py`
  - source 创建时初始化 canvas；`import_reconstruct` run 改为后台慢路径。
- Modify: `services/sidecar/src/typedance_sidecar/revision_import_flow.py`
  - 删除运行时逐 `ParsedBlock` 重建 source canvas 的路径；改为读取已有 canvas 并做版本校验。
- Modify: `services/sidecar/src/typedance_sidecar/revision_source_canvas.py`
  - 移除 `build(parsed_blocks=...)` 主路径，保留或迁移空白引导画布生成。
- Modify: `services/sidecar/src/typedance_sidecar/revision_services.py`
  - 保存 source canvas 文档时递增 version，并同步 hash/node_map/anchors。
- Modify: `packages/contracts/src/revision/source.ts`
  - 同步 source 状态和 metadata。
- Modify: `packages/contracts/src/revision/source-canvas.ts`
  - 同步 canvas version/hash 和节点类型。
- Modify: `packages/contracts/src/revision/run.ts`
  - 同步 run `stale` 状态和输入 canvas 版本字段。
- Modify: `packages/contracts/tests/contracts.test.ts`
  - 覆盖新状态和版本字段。
- Modify: `packages/resume-markdown/src/index.js`
  - 保持整篇 Markdown 官方解析入口，补强空文档和 list 测试需要的输出约束。
- Modify: `packages/resume-markdown/src/index.d.ts`
  - 导出 `markdownToResumeDocJson` 的整篇转换类型。
- Modify: `packages/resume-markdown/tests/index.test.js`
  - 覆盖嵌套有序/无序列表。
- Modify: `apps/web/src/api.ts`
  - 导入进度从“等待 AI 完成”改为“启动后台识别后加载工作台”。
- Modify: `apps/web/src/features/home/ImportOldResumeModal.tsx`
  - 更新进度文案，导入成功后不展示长时间 spinner。
- Modify: `apps/web/src/features/home/ImportOldResumeModal.test.tsx`
  - 覆盖导入步骤顺序。
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
  - 在 `current_draft` 为空但 `source_resume_canvas` 存在时展示可编辑画布和后台识别状态。
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
  - 覆盖 source canvas 先出现、AI 识别中、AI stale 状态。
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`
  - 保持粘贴 Markdown 使用整段官方解析；必要时补充嵌套列表 paste 测试。
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`
  - 保留已移除字号控件的回归断言。

---

### Task 1: 合同与后端模型切换到 source canvas 快慢路径状态

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/revision_models.py`
- Modify: `packages/contracts/src/revision/source.ts`
- Modify: `packages/contracts/src/revision/source-canvas.ts`
- Modify: `packages/contracts/src/revision/run.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

- [ ] **Step 1: 写失败的 contracts 测试**

在 `packages/contracts/tests/contracts.test.ts` 的 source document 测试里把 `parse_status` 改成 `"initialized"`，并加入 `metadata` 断言：

```ts
const source = sourceDocumentSchema.parse({
  id: "src_1",
  document_id: "doc_1",
  source_type: "old_resume",
  title: "旧简历.md",
  mime_type: "text/markdown",
  raw_text: "## 项目经历",
  parse_status: "initialized",
  metadata: {
    import_extension: "md",
    initializer_adapter: "markdown",
  },
  created_at: "2026-05-21T08:00:00.000Z",
});

expect(source.parse_status).toBe("initialized");
expect(source.metadata.initializer_adapter).toBe("markdown");
```

在 source canvas 测试对象加入：

```ts
version: 1,
source_snapshot_hash: "sha256:source-canvas-hash",
```

并断言：

```ts
expect(canvas.version).toBe(1);
expect(canvas.source_snapshot_hash).toBe("sha256:source-canvas-hash");
```

在 revision run 测试对象加入：

```ts
status: "recognizing",
input_source_canvas_id: "canvas_1",
input_source_canvas_version: 1,
```

并断言：

```ts
expect(run.input_source_canvas_id).toBe("canvas_1");
expect(run.input_source_canvas_version).toBe(1);
```

- [ ] **Step 2: 运行 contracts 测试确认失败**

Run: `rtk pnpm --filter @typedance/contracts test`

Expected: FAIL，错误指向 `parse_status` 不接受 `"initialized"`、`sourceResumeCanvasSchema` 不接受新字段、`revisionRunSchema` 不接受 `"recognizing"`。

- [ ] **Step 3: 修改 TypeScript contracts**

在 `packages/contracts/src/revision/source.ts` 中把 `parse_status` 枚举改成：

```ts
parse_status: z.enum([
  "pending",
  "initialized",
  "recognizing",
  "recognized",
  "recognition_failed",
]),
metadata: z.record(z.unknown()).default({}),
```

在 `packages/contracts/src/revision/source-canvas.ts` 中扩展节点类型和 canvas 字段：

```ts
export const sourceResumeCanvasNodeTypeSchema = z.enum([
  "heading",
  "paragraph",
  "list_item",
  "table_cell",
  "divider",
  "unknown",
]);

export const sourceResumeCanvasSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  old_resume_source_id: z.string().min(1),
  version: z.number().int().positive(),
  source_snapshot_hash: z.string().min(1),
  doc_json: z.record(z.unknown()),
  node_map: z.array(sourceResumeCanvasNodeSchema).default([]),
  module_anchors: z.array(moduleAnchorSchema).default([]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});
```

在 `packages/contracts/src/revision/run.ts` 中加入状态和字段：

```ts
"recognizing",
"stale",
```

```ts
input_source_canvas_id: z.string().optional(),
input_source_canvas_version: z.number().int().positive().optional(),
```

- [ ] **Step 4: 修改 Pydantic models**

在 `services/sidecar/src/typedance_sidecar/revision_models.py` 中更新：

```python
ParseStatus = Literal[
    "pending",
    "initialized",
    "recognizing",
    "recognized",
    "recognition_failed",
]
```

`SourceDocument` 加：

```python
metadata: dict[str, Any] = Field(default_factory=dict)
```

`SourceCanvasNodeType` 加 `"divider"`：

```python
SourceCanvasNodeType = Literal[
    "heading",
    "paragraph",
    "list_item",
    "table_cell",
    "divider",
    "unknown",
]
```

`SourceResumeCanvas` 加：

```python
version: int = Field(default=1, ge=1)
source_snapshot_hash: str = Field(min_length=1)
```

`RevisionRunStatus` 加：

```python
"recognizing",
"stale",
```

`RevisionRun` 加：

```python
input_source_canvas_id: str | None = None
input_source_canvas_version: int | None = Field(default=None, ge=1)
```

- [ ] **Step 5: 运行 contracts 测试确认通过**

Run: `rtk pnpm --filter @typedance/contracts test`

Expected: PASS。

- [ ] **Step 6: 提交模型与合同变更**

```bash
git add packages/contracts/src/revision/source.ts packages/contracts/src/revision/source-canvas.ts packages/contracts/src/revision/run.ts packages/contracts/tests/contracts.test.ts services/sidecar/src/typedance_sidecar/revision_models.py
git commit -m "feat(revision): 扩展源画布初始化状态"
```

---

### Task 2: 增加整篇 Markdown 转 docJson 的 Python 桥

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/markdown_doc_json.py`
- Modify: `packages/resume-markdown/tests/index.test.js`
- Test: `services/sidecar/tests/test_revision_source_canvas.py`

- [ ] **Step 1: 写 Markdown 嵌套列表测试**

在 `packages/resume-markdown/tests/index.test.js` 中加入：

```js
it("preserves nested ordered and unordered Markdown list structure", () => {
  const doc = markdownToResumeDocJson(`
1. 一级有序
   1. 二级有序
      1. 三级有序

- 一级无序
  - 二级无序
    - 三级无序
`);

  const orderedList = doc.content.find((node) => node.type === "orderedList");
  const bulletList = doc.content.find((node) => node.type === "bulletList");

  expect(orderedList.content[0].content[1].type).toBe("orderedList");
  expect(orderedList.content[0].content[1].content[0].content[1].type).toBe("orderedList");
  expect(bulletList.content[0].content[1].type).toBe("bulletList");
  expect(bulletList.content[0].content[1].content[0].content[1].type).toBe("bulletList");
});
```

- [ ] **Step 2: 写 Python 桥测试**

在 `services/sidecar/tests/test_revision_source_canvas.py` 中加入一个小 fake converter 测试，先直接调用新方法名：

```python
from typedance_sidecar.markdown_doc_json import TiptapMarkdownDocJsonConverter


def test_markdown_converter_converts_complete_markdown_document():
    converter = TiptapMarkdownDocJsonConverter()

    doc = converter.convert_markdown("## 项目经历\n\n- **架构**: Monorepo")

    assert doc["type"] == "doc"
    assert any(node["type"] == "heading" for node in doc["content"])
    bullet = next(node for node in doc["content"] if node["type"] == "bulletList")
    paragraph = bullet["content"][0]["content"][0]
    assert paragraph["content"][0]["marks"] == [{"type": "bold"}]
```

- [ ] **Step 3: 运行测试确认 Python 新方法不存在**

Run: `rtk pnpm --filter @typedance/resume-markdown test`

Expected: PASS，说明 JS 官方解析入口可用。

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_source_canvas.py::test_markdown_converter_converts_complete_markdown_document -q`

Expected: FAIL，错误为 `TiptapMarkdownDocJsonConverter` 没有 `convert_markdown`。

- [ ] **Step 4: 实现 Python 桥**

在 `MarkdownDocJsonConverter` protocol 中加入：

```python
def convert_markdown(self, markdown: str) -> dict[str, Any]:
    ...
```

在 `TiptapMarkdownDocJsonConverter` 中加入：

```python
def convert_markdown(self, markdown: str) -> dict[str, Any]:
    if not self.cli_path.exists():
        raise MarkdownDocJsonError(f"Markdown converter CLI not found: {self.cli_path}")

    decoded = self._run_cli({"markdown": markdown})
    doc_json = decoded.get("docJson")
    if not isinstance(doc_json, dict):
        raise MarkdownDocJsonError("Markdown converter returned no docJson")
    if doc_json.get("type") != "doc":
        raise MarkdownDocJsonError("Markdown converter returned invalid docJson")
    return doc_json
```

把 `convert_blocks` 中重复的 subprocess 逻辑抽成：

```python
def _run_cli(self, payload_value: dict[str, Any]) -> dict[str, Any]:
    payload = json.dumps(payload_value, ensure_ascii=False)
    try:
        completed = subprocess.run(
            [self.node_executable, str(self.cli_path)],
            input=payload,
            capture_output=True,
            text=True,
            encoding="utf-8",
            check=False,
            timeout=self.timeout_seconds,
        )
    except FileNotFoundError as exc:
        raise MarkdownDocJsonError(f"Node executable not found: {self.node_executable}") from exc
    except subprocess.TimeoutExpired as exc:
        raise MarkdownDocJsonError("Markdown converter timed out") from exc

    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "Markdown converter failed"
        raise MarkdownDocJsonError(message)

    try:
        decoded = json.loads(completed.stdout)
    except json.JSONDecodeError as exc:
        raise MarkdownDocJsonError("Markdown converter returned invalid JSON") from exc
    if not isinstance(decoded, dict):
        raise MarkdownDocJsonError("Markdown converter returned invalid payload")
    return decoded
```

`convert_blocks` 改为：

```python
decoded = self._run_cli({"blocks": blocks})
```

- [ ] **Step 5: 运行 Markdown 与 sidecar 单测**

Run: `rtk pnpm --filter @typedance/resume-markdown test`

Expected: PASS。

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_source_canvas.py::test_markdown_converter_converts_complete_markdown_document -q`

Expected: PASS。

- [ ] **Step 6: 提交 Markdown 桥**

```bash
git add packages/resume-markdown/tests/index.test.js services/sidecar/src/typedance_sidecar/markdown_doc_json.py services/sidecar/tests/test_revision_source_canvas.py
git commit -m "feat(markdown): 支持整篇文档转源画布"
```

---

### Task 3: 建立 docJson 标注与 node_map 派生工具

**Files:**
- Create: `services/sidecar/src/typedance_sidecar/source_canvas_doc_json.py`
- Test: `services/sidecar/tests/test_revision_source_canvas.py`

- [ ] **Step 1: 写失败测试覆盖嵌套列表节点标注**

在 `services/sidecar/tests/test_revision_source_canvas.py` 中加入：

```python
from typedance_sidecar.source_canvas_doc_json import annotate_source_doc_json


def test_annotates_nested_list_items_with_canvas_node_ids():
    source = SourceDocument(
        id="src_md",
        document_id="doc_md",
        source_type="old_resume",
        title="resume.md",
        raw_text="- 一级\n  - 二级",
        parse_status="initialized",
        created_at=utc_now(),
    )
    doc_json = {
        "type": "doc",
        "content": [
            {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": "一级"}]},
                            {
                                "type": "bulletList",
                                "content": [
                                    {
                                        "type": "listItem",
                                        "content": [
                                            {"type": "paragraph", "content": [{"type": "text", "text": "二级"}]}
                                        ],
                                    }
                                ],
                            },
                        ],
                    }
                ],
            }
        ],
    }

    annotated, node_map, source_hash = annotate_source_doc_json(doc_json, source)

    first_item = annotated["content"][0]["content"][0]
    nested_item = first_item["content"][1]["content"][0]
    assert first_item["attrs"]["canvasNodeId"] == "node_src_md_0001"
    assert nested_item["attrs"]["canvasNodeId"] == "node_src_md_0002"
    assert [node.node_type for node in node_map] == ["list_item", "list_item"]
    assert [node.text for node in node_map] == ["一级二级", "二级"]
    assert source_hash.startswith("sha256:")
```

- [ ] **Step 2: 运行测试确认工具不存在**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_source_canvas.py::test_annotates_nested_list_items_with_canvas_node_ids -q`

Expected: FAIL，错误为 `ModuleNotFoundError: typedance_sidecar.source_canvas_doc_json`。

- [ ] **Step 3: 实现 docJson 工具**

创建 `services/sidecar/src/typedance_sidecar/source_canvas_doc_json.py`：

```python
from __future__ import annotations

import copy
import hashlib
import json
import re
from typing import Any

from .revision_models import SourceDocument, SourceResumeCanvasNode


LOCATABLE_NODE_TYPES = {"heading", "paragraph", "listItem", "tableCell", "horizontalRule"}


def annotate_source_doc_json(
    doc_json: dict[str, Any],
    source: SourceDocument,
) -> tuple[dict[str, Any], list[SourceResumeCanvasNode], str]:
    cloned = copy.deepcopy(doc_json)
    index = 0
    node_map: list[SourceResumeCanvasNode] = []

    def visit(value: Any, *, inside_list_item: bool = False) -> None:
        nonlocal index
        if isinstance(value, list):
            for item in value:
                visit(item, inside_list_item=inside_list_item)
            return
        if not isinstance(value, dict):
            return

        node_type = value.get("type")
        if node_type in LOCATABLE_NODE_TYPES and _should_annotate(value, inside_list_item=inside_list_item):
            index += 1
            canvas_node_id = f"node_{_safe_id(source.id)}_{index:04d}"
            source_block_id = f"sblk_{_safe_id(source.id)}_{index:04d}"
            attrs = dict(value.get("attrs") or {})
            attrs["canvasNodeId"] = canvas_node_id
            attrs["sourceBlockId"] = source_block_id
            value["attrs"] = attrs
            node_map.append(
                SourceResumeCanvasNode(
                    canvas_node_id=canvas_node_id,
                    source_block_id=source_block_id,
                    node_type=_canvas_node_type(str(node_type)),
                    text=_node_text(value),
                    source_span={
                        "source_document_id": source.id,
                        "node_index": index,
                    },
                )
            )

        child_inside_list_item = inside_list_item or node_type == "listItem"
        for child in value.get("content", []) if isinstance(value.get("content"), list) else []:
            visit(child, inside_list_item=child_inside_list_item)

    visit(cloned)
    return cloned, node_map, source_canvas_hash(cloned)


def source_canvas_hash(doc_json: dict[str, Any]) -> str:
    payload = json.dumps(doc_json, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _should_annotate(node: dict[str, Any], *, inside_list_item: bool) -> bool:
    node_type = node.get("type")
    if node_type == "paragraph":
        return not inside_list_item and bool(_node_text(node).strip())
    if node_type == "listItem":
        return bool(_node_text(node).strip())
    return True


def _canvas_node_type(node_type: str) -> str:
    return {
        "heading": "heading",
        "paragraph": "paragraph",
        "listItem": "list_item",
        "tableCell": "table_cell",
        "horizontalRule": "divider",
    }.get(node_type, "unknown")


def _node_text(value: Any) -> str:
    if isinstance(value, list):
        return "".join(_node_text(item) for item in value)
    if not isinstance(value, dict):
        return ""
    text = value.get("text")
    content = value.get("content")
    return (text if isinstance(text, str) else "") + _node_text(content)


def _safe_id(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]+", "_", value).strip("_") or "source"
```

- [ ] **Step 4: 运行单测**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_source_canvas.py::test_annotates_nested_list_items_with_canvas_node_ids -q`

Expected: PASS。

- [ ] **Step 5: 提交 docJson 标注工具**

```bash
git add services/sidecar/src/typedance_sidecar/source_canvas_doc_json.py services/sidecar/tests/test_revision_source_canvas.py
git commit -m "feat(canvas): 派生源画布节点映射"
```

---

### Task 4: 实现 Markdown/TXT/PDF/DOC 的 SourceCanvasInitializer 快路径

**Files:**
- Create: `services/sidecar/src/typedance_sidecar/source_section_rules.py`
- Create: `services/sidecar/src/typedance_sidecar/source_canvas_initializer.py`
- Modify: `services/sidecar/src/typedance_sidecar/import_resume_file_text.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_import_flow.py`
- Test: `services/sidecar/tests/test_source_canvas_initializer.py`
- Test: `services/sidecar/tests/test_import_resume_file_text.py`

- [ ] **Step 1: 写 Markdown 初始化测试**

创建 `services/sidecar/tests/test_source_canvas_initializer.py`：

```python
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import SourceDocument
from typedance_sidecar.source_canvas_initializer import SourceCanvasInitializer


def make_source(**updates):
    data = {
        "id": "src_md",
        "document_id": "doc_md",
        "source_type": "old_resume",
        "title": "resume.md",
        "mime_type": "text/markdown",
        "raw_text": "## 项目经历\n\n- **架构**: Monorepo\n  - 子项",
        "parse_status": "pending",
        "created_at": utc_now(),
    }
    data.update(updates)
    return SourceDocument(**data)


def test_initializer_preserves_markdown_nested_list_structure():
    canvas = SourceCanvasInitializer().initialize(make_source())

    assert canvas.document_id == "doc_md"
    assert canvas.old_resume_source_id == "src_md"
    assert canvas.version == 1
    assert canvas.source_snapshot_hash.startswith("sha256:")
    assert canvas.doc_json["type"] == "doc"
    assert any(node["type"] == "heading" for node in canvas.doc_json["content"])
    bullet = next(node for node in canvas.doc_json["content"] if node["type"] == "bulletList")
    assert bullet["content"][0]["content"][1]["type"] == "bulletList"
    assert canvas.node_map
```

- [ ] **Step 2: 写 TXT/PDF/DOC 文本路径测试**

在同一文件加入：

```python
def test_initializer_builds_plain_text_canvas_from_txt():
    source = make_source(
        id="src_txt",
        title="resume.txt",
        mime_type="text/plain",
        raw_text="张三\n\n工作经历\n负责订单系统重构",
    )

    canvas = SourceCanvasInitializer().initialize(source)

    assert [node["type"] for node in canvas.doc_json["content"]][:3] == [
        "paragraph",
        "heading",
        "paragraph",
    ]
    assert [node.text for node in canvas.node_map][:3] == ["张三", "工作经历", "负责订单系统重构"]


def test_initializer_uses_text_adapter_for_pdf_and_doc_text():
    for title, mime_type in [
        ("resume.pdf", "application/pdf"),
        ("resume.doc", "application/msword"),
    ]:
        source = make_source(
            id=f"src_{title.split('.')[-1]}",
            title=title,
            mime_type=mime_type,
            raw_text="项目经历\n负责支付系统优化",
        )

        canvas = SourceCanvasInitializer().initialize(source)

        assert canvas.doc_json["content"][0]["type"] == "heading"
        assert canvas.node_map[0].text == "项目经历"
```

- [ ] **Step 3: 写空内容错误测试**

```python
import pytest
from typedance_sidecar.source_canvas_initializer import SourceCanvasInitializationError


def test_initializer_rejects_empty_source_text():
    with pytest.raises(SourceCanvasInitializationError, match="Import source has no readable content"):
        SourceCanvasInitializer().initialize(make_source(raw_text=" \n\n "))
```

- [ ] **Step 4: 运行测试确认初始化器不存在**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_source_canvas_initializer.py -q`

Expected: FAIL，错误为 `ModuleNotFoundError: typedance_sidecar.source_canvas_initializer`。

- [ ] **Step 5: 抽出章节别名规则**

创建 `services/sidecar/src/typedance_sidecar/source_section_rules.py`：

```python
SECTION_ALIASES: list[tuple[tuple[str, ...], str, str]] = [
    (("工作经历", "工作经验", "实习经历", "任职经历"), "WorkExperience", "工作经历"),
    (("项目经历", "项目经验", "项目"), "ProjectExperience", "项目经历"),
    (("核心能力", "专业技能", "相关技能", "技能", "技能清单", "职业技能"), "CoreSkills", "专业技能"),
    (("教育经历", "教育背景", "学历"), "Education", "教育经历"),
    (("自我评价", "个人评价", "个人总结"), "SelfEvaluation", "自我评价"),
    (("求职意向", "职业意向"), "JobIntent", "求职意向"),
]
```

在 `revision_import_flow.py` 中删除本地 `SECTION_ALIASES` 常量，加入：

```python
from .source_section_rules import SECTION_ALIASES
```

- [ ] **Step 6: 实现 SourceCanvasInitializer**

创建 `services/sidecar/src/typedance_sidecar/source_canvas_initializer.py`：

```python
from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from .markdown_doc_json import MarkdownDocJsonConverter, TiptapMarkdownDocJsonConverter
from .models import utc_now
from .revision_models import SourceDocument, SourceResumeCanvas
from .source_canvas_doc_json import annotate_source_doc_json
from .source_section_rules import SECTION_ALIASES


MARKDOWN_EXTENSIONS = {"md", "markdown"}
TEXT_EXTENSIONS = {"txt"}
DOCUMENT_TEXT_EXTENSIONS = {"pdf", "doc"}


class SourceCanvasInitializationError(RuntimeError):
    pass


class SourceCanvasInitializer:
    def __init__(self, markdown_converter: MarkdownDocJsonConverter | None = None) -> None:
        self.markdown_converter = markdown_converter or TiptapMarkdownDocJsonConverter()

    def initialize(self, source: SourceDocument) -> SourceResumeCanvas:
        adapter = self._adapter_for(source)
        doc_json = self._doc_json_for(adapter, source)
        annotated_doc, node_map, source_hash = annotate_source_doc_json(doc_json, source)
        now = utc_now()
        return SourceResumeCanvas(
            id=f"canvas_{uuid4().hex}",
            document_id=source.document_id,
            old_resume_source_id=source.id,
            version=1,
            source_snapshot_hash=source_hash,
            doc_json=annotated_doc,
            node_map=node_map,
            module_anchors=[],
            created_at=now,
            updated_at=now,
        )

    def _doc_json_for(self, adapter: str, source: SourceDocument) -> dict[str, Any]:
        raw_text = (source.raw_text or "").strip()
        if not raw_text:
            raise SourceCanvasInitializationError("Import source has no readable content")
        if adapter == "markdown":
            return self.markdown_converter.convert_markdown(raw_text)
        return self._plain_text_doc_json(raw_text)

    def _adapter_for(self, source: SourceDocument) -> str:
        extension = Path(source.title).suffix.lower().lstrip(".")
        mime_type = (source.mime_type or "").lower()
        if extension in MARKDOWN_EXTENSIONS or mime_type in {"text/markdown", "text/x-markdown"}:
            return "markdown"
        if self._looks_like_markdown(source.raw_text or ""):
            return "markdown"
        if extension in TEXT_EXTENSIONS | DOCUMENT_TEXT_EXTENSIONS:
            return "text"
        return "text"

    def _looks_like_markdown(self, text: str) -> bool:
        lines = [line.rstrip() for line in text.splitlines()]
        return any(
            line.startswith(("# ", "## ", "### ", "- ", "* ", "+ ", "1. "))
            or line.strip() == "---"
            or "**" in line
            or "`" in line
            for line in lines
        )

    def _plain_text_doc_json(self, text: str) -> dict[str, Any]:
        content: list[dict[str, Any]] = []
        for paragraph in [item.strip() for item in text.splitlines() if item.strip()]:
            if self._is_section_heading(paragraph):
                content.append({
                    "type": "heading",
                    "attrs": {"level": 2},
                    "content": [{"type": "text", "text": paragraph.rstrip(":：")}],
                })
            else:
                content.append({
                    "type": "paragraph",
                    "content": [{"type": "text", "text": paragraph}],
                })
        return {"type": "doc", "content": content or [{"type": "paragraph"}]}

    def _is_section_heading(self, text: str) -> bool:
        normalized = text.strip().rstrip(":：")
        return any(normalized in aliases for aliases, _module_type, _title in SECTION_ALIASES)
```

- [ ] **Step 7: 记录导入 metadata**

在 `services/sidecar/src/typedance_sidecar/import_resume_file_text.py` 不改变抽取返回值；在 API 保存 source 时写入：

```python
metadata={
    "import_extension": Path(filename).suffix.lower().lstrip("."),
    "import_filename": filename,
    "extraction_adapter": "sharepoint-to-text" if filename.rsplit(".", 1)[-1].lower() in {"pdf", "docx", "doc"} else "text-decode",
}
```

这一步在 Task 6 的 API 保存中落地。

- [ ] **Step 8: 运行初始化器测试**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_source_canvas_initializer.py -q`

Expected: PASS。

- [ ] **Step 9: 提交初始化器文本路径**

```bash
git add services/sidecar/src/typedance_sidecar/source_section_rules.py services/sidecar/src/typedance_sidecar/source_canvas_initializer.py services/sidecar/src/typedance_sidecar/revision_import_flow.py services/sidecar/tests/test_source_canvas_initializer.py
git commit -m "feat(canvas): 初始化文本类源画布"
```

---

### Task 5: 增加 DOCX 结构 adapter

**Files:**
- Create: `services/sidecar/src/typedance_sidecar/source_canvas_docx.py`
- Modify: `services/sidecar/src/typedance_sidecar/source_canvas_initializer.py`
- Test: `services/sidecar/tests/test_source_canvas_initializer.py`

- [ ] **Step 1: 写 DOCX fixture 生成器测试**

在 `services/sidecar/tests/test_source_canvas_initializer.py` 加入：

```python
from pathlib import Path
from zipfile import ZipFile


def write_minimal_docx(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    document_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>项目经历</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>
      <w:r><w:rPr><w:b/></w:rPr><w:t>架构升级</w:t></w:r>
      <w:r><w:t>：Monorepo</w:t></w:r>
    </w:p>
  </w:body>
</w:document>
"""
    with ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", "<?xml version=\"1.0\"?><Types/>")
        archive.writestr("word/document.xml", document_xml)


def test_initializer_preserves_docx_heading_list_and_bold(tmp_path):
    docx_path = tmp_path / "resume.docx"
    write_minimal_docx(docx_path)
    source = make_source(
        id="src_docx",
        title="resume.docx",
        mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        raw_text="项目经历\n架构升级：Monorepo",
        file_path=str(docx_path),
    )

    canvas = SourceCanvasInitializer().initialize(source)

    heading = canvas.doc_json["content"][0]
    bullet = canvas.doc_json["content"][1]
    paragraph = bullet["content"][0]["content"][0]
    assert heading["type"] == "heading"
    assert heading["content"][0]["text"] == "项目经历"
    assert bullet["type"] == "bulletList"
    assert paragraph["content"][0] == {
        "type": "text",
        "text": "架构升级",
        "marks": [{"type": "bold"}],
    }
```

- [ ] **Step 2: 运行 DOCX 测试确认失败**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_source_canvas_initializer.py::test_initializer_preserves_docx_heading_list_and_bold -q`

Expected: FAIL，当前 initializer 会走纯文本路径，不能保留 bold mark 和 list 结构。

- [ ] **Step 3: 实现 DOCX adapter**

创建 `services/sidecar/src/typedance_sidecar/source_canvas_docx.py`：

```python
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from xml.etree import ElementTree
from zipfile import ZipFile


W_NS = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


@dataclass
class DocxRun:
    text: str
    marks: list[dict[str, str]] = field(default_factory=list)


@dataclass
class DocxParagraph:
    style: str | None
    list_level: int | None
    runs: list[DocxRun]

    @property
    def text(self) -> str:
        return "".join(run.text for run in self.runs)


class DocxSourceCanvasAdapter:
    def to_doc_json(self, path: Path) -> dict[str, Any]:
        paragraphs = self._paragraphs(path)
        content: list[dict[str, Any]] = []
        index = 0
        while index < len(paragraphs):
            paragraph = paragraphs[index]
            if not paragraph.text.strip():
                index += 1
                continue
            if paragraph.list_level is not None:
                list_items: list[dict[str, Any]] = []
                while index < len(paragraphs) and paragraphs[index].list_level is not None:
                    list_items.append({
                        "type": "listItem",
                        "content": [{
                            "type": "paragraph",
                            "content": self._inline_content(paragraphs[index].runs),
                        }],
                    })
                    index += 1
                content.append({"type": "bulletList", "content": list_items})
                continue
            if self._is_heading(paragraph.style):
                content.append({
                    "type": "heading",
                    "attrs": {"level": self._heading_level(paragraph.style)},
                    "content": self._inline_content(paragraph.runs),
                })
            else:
                content.append({
                    "type": "paragraph",
                    "content": self._inline_content(paragraph.runs),
                })
            index += 1
        return {"type": "doc", "content": content or [{"type": "paragraph"}]}

    def _paragraphs(self, path: Path) -> list[DocxParagraph]:
        with ZipFile(path) as archive:
            xml = archive.read("word/document.xml")
        root = ElementTree.fromstring(xml)
        result: list[DocxParagraph] = []
        for p_node in root.iter(f"{W_NS}p"):
            p_pr = p_node.find(f"{W_NS}pPr")
            style = self._attr_value(p_pr.find(f"{W_NS}pStyle") if p_pr is not None else None)
            list_level = None
            num_pr = p_pr.find(f"{W_NS}numPr") if p_pr is not None else None
            if num_pr is not None:
                ilvl = self._attr_value(num_pr.find(f"{W_NS}ilvl"))
                list_level = int(ilvl) if isinstance(ilvl, str) and ilvl.isdigit() else 0
            runs = [self._run(r_node) for r_node in p_node.findall(f"{W_NS}r")]
            result.append(DocxParagraph(style=style, list_level=list_level, runs=[run for run in runs if run.text]))
        return result

    def _run(self, r_node: ElementTree.Element) -> DocxRun:
        text = "".join(t_node.text or "" for t_node in r_node.findall(f"{W_NS}t"))
        r_pr = r_node.find(f"{W_NS}rPr")
        marks: list[dict[str, str]] = []
        if r_pr is not None and r_pr.find(f"{W_NS}b") is not None:
            marks.append({"type": "bold"})
        if r_pr is not None and r_pr.find(f"{W_NS}i") is not None:
            marks.append({"type": "italic"})
        if r_pr is not None and r_pr.find(f"{W_NS}u") is not None:
            marks.append({"type": "underline"})
        return DocxRun(text=text, marks=marks)

    def _inline_content(self, runs: list[DocxRun]) -> list[dict[str, Any]]:
        content = []
        for run in runs:
            node: dict[str, Any] = {"type": "text", "text": run.text}
            if run.marks:
                node["marks"] = run.marks
            content.append(node)
        return content or [{"type": "text", "text": ""}]

    def _attr_value(self, node: ElementTree.Element | None) -> str | None:
        if node is None:
            return None
        return node.attrib.get(f"{W_NS}val")

    def _is_heading(self, style: str | None) -> bool:
        return bool(style and style.lower().startswith("heading"))

    def _heading_level(self, style: str | None) -> int:
        if style and style[-1:].isdigit():
            return max(1, min(6, int(style[-1])))
        return 2
```

- [ ] **Step 4: 接入 initializer**

在 `source_canvas_initializer.py` 中加入：

```python
from .source_canvas_docx import DocxSourceCanvasAdapter
```

构造函数加入：

```python
self.docx_adapter = DocxSourceCanvasAdapter()
```

`_doc_json_for` 加入 DOCX 分支：

```python
if adapter == "docx":
    if not source.file_path:
        raise SourceCanvasInitializationError("DOCX source has no saved file path")
    return self.docx_adapter.to_doc_json(Path(source.file_path))
```

`_adapter_for` 加入：

```python
if extension == "docx":
    return "docx"
```

- [ ] **Step 5: 运行 DOCX 单测**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_source_canvas_initializer.py::test_initializer_preserves_docx_heading_list_and_bold -q`

Expected: PASS。

- [ ] **Step 6: 提交 DOCX adapter**

```bash
git add services/sidecar/src/typedance_sidecar/source_canvas_docx.py services/sidecar/src/typedance_sidecar/source_canvas_initializer.py services/sidecar/tests/test_source_canvas_initializer.py
git commit -m "feat(canvas): 支持docx结构初始化"
```

---

### Task 6: Source 创建接口初始化 canvas 并返回可进入工作台的数据

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/revision_api.py`
- Test: `services/sidecar/tests/test_revision_api.py`

- [ ] **Step 1: 写粘贴 source 创建即生成 canvas 的 API 测试**

在 `services/sidecar/tests/test_revision_api.py` 中把 `test_revision_api_creates_document_source_and_run` 拆出 source 初始化断言：

```python
created_source = client.post(
    f"/documents/{document['id']}/sources",
    json={
        "source_type": "pasted_text",
        "title": "粘贴旧简历",
        "raw_text": "## 项目经历\n\n- **订单系统**: 重构",
        "mime_type": "text/markdown",
    },
)
assert created_source.status_code == 201
source = created_source.json()
assert source["parse_status"] == "initialized"

workspace_after_source = client.get(f"/documents/{document['id']}/workspace-view").json()
canvas = workspace_after_source["source_resume_canvas"]
assert canvas["old_resume_source_id"] == source["id"]
assert canvas["doc_json"]["content"][0]["type"] == "heading"
assert canvas["version"] == 1
assert workspace_after_source["current_draft"] is None
```

- [ ] **Step 2: 写上传 source 创建即生成 canvas 的 API 测试**

在 `test_revision_api_creates_uploaded_resume_source` 中增加：

```python
assert source["parse_status"] == "initialized"
assert source["metadata"]["import_extension"] == "md"
workspace = client.get(f"/documents/{document['id']}/workspace-view").json()
assert workspace["source_resume_canvas"]["old_resume_source_id"] == source["id"]
```

- [ ] **Step 3: 运行 API 单测确认失败**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_api.py::test_revision_api_creates_document_source_and_run tests/test_revision_api.py::test_revision_api_creates_uploaded_resume_source -q`

Expected: FAIL，source 仍是 `pending` 且 workspace 里没有 source canvas。

- [ ] **Step 4: 在 revision_api.py 增加初始化 helper**

在 imports 加：

```python
from .source_canvas_initializer import SourceCanvasInitializationError, SourceCanvasInitializer
```

在 `create_revision_router` 内部增加：

```python
def save_initialized_source(repo: RevisionRepository, source: SourceDocument) -> SourceDocument:
    try:
        canvas = SourceCanvasInitializer().initialize(source)
    except SourceCanvasInitializationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    initialized_source = source.model_copy(
        update={
            "parse_status": "initialized",
            "metadata": {
                **source.metadata,
                "initializer_adapter": _initializer_adapter_name(source),
            },
        }
    )
    repo.save_source_document(initialized_source)
    repo.save_source_resume_canvas(canvas)
    return initialized_source


def _initializer_adapter_name(source: SourceDocument) -> str:
    suffix = Path(source.title).suffix.lower().lstrip(".")
    if suffix in {"md", "markdown"} or (source.mime_type or "").lower() in {"text/markdown", "text/x-markdown"}:
        return "markdown"
    if suffix == "docx":
        return "docx"
    return "text"
```

- [ ] **Step 5: 接入 create_source**

把 `return SourceService(repo).save_source(source)` 改为：

```python
return save_initialized_source(repo, source)
```

`SourceDocument` 构造时加：

```python
metadata={},
```

- [ ] **Step 6: 接入 create_import_file_source**

构造上传 source 时加：

```python
metadata={
    "import_extension": Path(filename).suffix.lower().lstrip("."),
    "import_filename": filename,
    "extraction_adapter": "sharepoint-to-text"
    if Path(filename).suffix.lower().lstrip(".") in {"pdf", "docx", "doc"}
    else "text-decode",
},
```

并把 `return SourceService(repo).save_source(source)` 改为：

```python
return save_initialized_source(repo, source)
```

- [ ] **Step 7: 运行 API 单测**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_api.py::test_revision_api_creates_document_source_and_run tests/test_revision_api.py::test_revision_api_creates_uploaded_resume_source -q`

Expected: PASS。

- [ ] **Step 8: 提交 source API 快路径**

```bash
git add services/sidecar/src/typedance_sidecar/revision_api.py services/sidecar/tests/test_revision_api.py
git commit -m "feat(api): 导入来源时初始化源画布"
```

---

### Task 7: 保存 source canvas 时递增版本并同步 hash

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/revision_services.py`
- Test: `services/sidecar/tests/test_revision_api.py`
- Test: `services/sidecar/tests/test_revision_services.py`

- [ ] **Step 1: 写 API 保存版本递增测试**

在 `test_revision_api_saves_source_resume_canvas_document` 中把 seeded canvas 加上 `version=1` 和 `source_snapshot_hash="sha256:old"`，并增加：

```python
assert payload["version"] == 2
assert payload["source_snapshot_hash"].startswith("sha256:")
assert payload["source_snapshot_hash"] != "sha256:old"
```

- [ ] **Step 2: 运行单测确认失败**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_api.py::test_revision_api_saves_source_resume_canvas_document -q`

Expected: FAIL，版本不会递增且 hash 不更新。

- [ ] **Step 3: 修改 WorkspaceService 保存逻辑**

在 `revision_services.py` imports 加：

```python
from .source_canvas_doc_json import source_canvas_hash
```

`save_source_resume_canvas_document` 的 `saved = canvas.model_copy(update={...})` 中加入：

```python
"version": canvas.version + 1,
"source_snapshot_hash": source_canvas_hash(doc_json),
```

- [ ] **Step 4: 更新 seed 测试数据**

所有手写 `SourceResumeCanvas(...)` 的测试对象都必须显式加入：

```python
version=1,
source_snapshot_hash="sha256:seed",
```

覆盖文件：

- `services/sidecar/tests/test_revision_api.py`
- `services/sidecar/tests/test_revision_services.py`
- `services/sidecar/tests/test_revision_source_canvas.py`
- `services/sidecar/tests/test_revision_import_flow.py`

- [ ] **Step 5: 运行相关 sidecar 测试**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_api.py tests/test_revision_services.py tests/test_revision_source_canvas.py -q`

Expected: PASS。

- [ ] **Step 6: 提交版本递增**

```bash
git add services/sidecar/src/typedance_sidecar/revision_services.py services/sidecar/tests/test_revision_api.py services/sidecar/tests/test_revision_services.py services/sidecar/tests/test_revision_source_canvas.py services/sidecar/tests/test_revision_import_flow.py
git commit -m "feat(canvas): 保存源画布时递增版本"
```

---

### Task 8: 后台 import_reconstruct run 绑定 canvas 版本

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/revision_api.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_import_flow.py`
- Test: `services/sidecar/tests/test_revision_api.py`
- Test: `services/sidecar/tests/test_revision_import_flow.py`

- [ ] **Step 1: 写 API run 返回 recognizing 的测试**

在 `test_revision_api_creates_document_source_and_run` 中把 run 断言改成：

```python
created_run = client.post(
    f"/documents/{document['id']}/revision-runs",
    json={
        "run_type": "import_reconstruct",
        "source_document_ids": [source["id"]],
        "user_intent": "导入旧简历并重构",
    },
)
assert created_run.status_code == 201
run = created_run.json()
assert run["pack_id"] == "resume"
assert run["input_source_canvas_id"] == canvas["id"]
assert run["input_source_canvas_version"] == canvas["version"]
assert run["status"] in {"recognizing", "completed"}
```

TestClient 会执行 FastAPI background task；因此这里允许真实测试环境看到 `"completed"`，但必须断言响应携带输入 canvas 版本字段。

- [ ] **Step 2: 写 import flow 不再 build source canvas 的测试**

在 `test_revision_import_flow.py` 的 seed 阶段预先保存 source canvas：

```python
repo.save_source_resume_canvas(
    SourceResumeCanvas(
        id="canvas_import",
        document_id=document.id,
        old_resume_source_id=source.id,
        version=1,
        source_snapshot_hash="sha256:import",
        doc_json={
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "attrs": {
                        "canvasNodeId": "node_src_import_0001",
                        "sourceBlockId": "sblk_src_import_0001",
                    },
                    "content": [{"type": "text", "text": "张三"}],
                }
            ],
        },
        node_map=[
            SourceResumeCanvasNode(
                canvas_node_id="node_src_import_0001",
                source_block_id="sblk_src_import_0001",
                node_type="paragraph",
                text="张三",
                source_span={"source_document_id": source.id, "node_index": 1},
            )
        ],
        module_anchors=[],
        created_at=now,
        updated_at=now,
    )
)
```

并把 `assert any(step.agent_name == "BuildSourceCanvas" for step in steps)` 改成：

```python
assert not any(step.agent_name == "BuildSourceCanvas" for step in steps)
```

- [ ] **Step 3: 运行 import flow 测试确认失败**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_import_flow.py::test_import_flow_generates_workspace_objects -q`

Expected: FAIL，当前 flow 仍保存 `BuildSourceCanvas` step 并重建 canvas。

- [ ] **Step 4: API 创建 run 时绑定 canvas 版本**

在 `revision_api.py` 的 `create_revision_run` 中，保存 import run 前读取 canvas：

```python
source_canvas = repo.get_source_resume_canvas(document_id) if payload.run_type == "import_reconstruct" else None
if payload.run_type == "import_reconstruct" and source_canvas is None:
    raise HTTPException(status_code=400, detail="Source resume canvas is not initialized")
```

构造 `RevisionRun` 时设置：

```python
status="recognizing" if payload.run_type == "import_reconstruct" else "created",
input_source_canvas_id=source_canvas.id if source_canvas else None,
input_source_canvas_version=source_canvas.version if source_canvas else None,
```

在 router 参数中加入：

```python
from fastapi import BackgroundTasks
```

`create_revision_run` 参数把 `BackgroundTasks` 放在 `repo` 依赖参数前面：

```python
background_tasks: BackgroundTasks,
repo: RevisionRepository = Depends(repository),
```

对 import run 改为：

```python
if saved_run.run_type == "import_reconstruct":
    background_tasks.add_task(
        _run_import_reconstruct_background,
        repo,
        document_id,
        saved_run.id,
    )
    return saved_run
```

在 router 内增加后台函数：

```python
def _run_import_reconstruct_background(
    repo: RevisionRepository,
    document_id: str,
    run_id: str,
) -> None:
    try:
        RevisionImportFlowService(repo).run_import_reconstruct(document_id, run_id)
    except RevisionServiceError:
        return
```

- [ ] **Step 5: import flow 读取已有 canvas 并校验版本**

在 `revision_import_flow.py` 的 `_run` 开头读取：

```python
source_canvas = self.repository.get_source_resume_canvas(document.id)
if source_canvas is None:
    raise RevisionServiceError("Source resume canvas is not initialized")
if run.input_source_canvas_id != source_canvas.id or run.input_source_canvas_version != source_canvas.version:
    stale_run = run.model_copy(
        update={
            "status": "stale",
            "output_summary": "源画布已更新，需要重新识别。",
            "updated_at": utc_now(),
        }
    )
    self.repository.save_revision_run(stale_run)
    return stale_run
```

删除 `_run` 中：

```python
source_canvas = SourceResumeCanvasBuilder().build(...)
self.repository.save_source_resume_canvas(source_canvas)
self._save_step(run.id, "BuildSourceCanvas")
```

在解析前更新 source：

```python
self.repository.save_source_document(sources[0].model_copy(update={"parse_status": "recognizing"}))
```

完成后更新 source：

```python
self.repository.save_source_document(sources[0].model_copy(update={"parse_status": "recognized"}))
```

在 `_parse_sources` 中删除旧代码：

```python
if source_blocks:
    self.repository.save_source_document(source.model_copy(update={"parse_status": "parsed"}))
```

异常路径中把 source 更新为：

```python
"parse_status": "recognition_failed"
```

- [ ] **Step 6: 运行 API 与 import flow 测试**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_api.py::test_revision_api_creates_document_source_and_run tests/test_revision_import_flow.py -q`

Expected: PASS。

- [ ] **Step 7: 提交后台 run**

```bash
git add services/sidecar/src/typedance_sidecar/revision_api.py services/sidecar/src/typedance_sidecar/revision_import_flow.py services/sidecar/tests/test_revision_api.py services/sidecar/tests/test_revision_import_flow.py
git commit -m "feat(import): 后台识别绑定源画布版本"
```

---

### Task 9: AI 完成后把 module anchors 映射到已有 canvas

**Files:**
- Create: `services/sidecar/src/typedance_sidecar/source_canvas_anchor_mapper.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_import_flow.py`
- Test: `services/sidecar/tests/test_revision_source_canvas.py`
- Test: `services/sidecar/tests/test_revision_import_flow.py`

- [ ] **Step 1: 写 anchor mapper 单测**

在 `test_revision_source_canvas.py` 加入：

```python
from typedance_sidecar.source_canvas_anchor_mapper import SourceCanvasAnchorMapper


def test_anchor_mapper_maps_parsed_blocks_to_existing_canvas_nodes():
    now = utc_now()
    source = SourceDocument(
        id="src_import",
        document_id="doc_import",
        source_type="old_resume",
        title="旧简历",
        raw_text="工作经历\n负责订单系统重构",
        parse_status="recognized",
        created_at=now,
    )
    canvas = SourceResumeCanvas(
        id="canvas_import",
        document_id="doc_import",
        old_resume_source_id=source.id,
        version=1,
        source_snapshot_hash="sha256:seed",
        doc_json={
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {"canvasNodeId": "node_heading", "sourceBlockId": "sblk_heading"},
                    "content": [{"type": "text", "text": "工作经历"}],
                },
                {
                    "type": "paragraph",
                    "attrs": {"canvasNodeId": "node_body", "sourceBlockId": "sblk_body"},
                    "content": [{"type": "text", "text": "负责订单系统重构"}],
                },
            ],
        },
        node_map=[
            SourceResumeCanvasNode(canvas_node_id="node_heading", source_block_id="sblk_heading", node_type="heading", text="工作经历"),
            SourceResumeCanvasNode(canvas_node_id="node_body", source_block_id="sblk_body", node_type="paragraph", text="负责订单系统重构"),
        ],
        module_anchors=[],
        created_at=now,
        updated_at=now,
    )
    module = DocumentModule(
        id="mod_work",
        draft_id="draft_1",
        pack_id="resume",
        type="WorkExperience",
        title="工作经历",
        order=1,
        visibility="visible",
        status="needs_review",
        data={},
        created_at=now,
        updated_at=now,
    )
    blocks = [
        ParsedBlock(id="block_heading", source_document_id=source.id, type="heading", text="工作经历", order=0),
        ParsedBlock(id="block_body", source_document_id=source.id, type="paragraph", text="负责订单系统重构", order=1),
    ]

    updated = SourceCanvasAnchorMapper().apply_module_anchors(
        canvas=canvas,
        modules=[module],
        parsed_blocks=blocks,
        module_source_refs={"mod_work": ["block_heading", "block_body"]},
    )

    assert updated.module_anchors[0].canvas_node_ids == ["node_heading", "node_body"]
    assert [node.module_id for node in updated.node_map] == ["mod_work", "mod_work"]
```

- [ ] **Step 2: 运行 mapper 测试确认失败**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_source_canvas.py::test_anchor_mapper_maps_parsed_blocks_to_existing_canvas_nodes -q`

Expected: FAIL，mapper 模块不存在。

- [ ] **Step 3: 实现 anchor mapper**

创建 `services/sidecar/src/typedance_sidecar/source_canvas_anchor_mapper.py`：

```python
from __future__ import annotations

from .models import utc_now
from .revision_models import DocumentModule, ModuleAnchor, ParsedBlock, SourceResumeCanvas


class SourceCanvasAnchorMapper:
    def apply_module_anchors(
        self,
        *,
        canvas: SourceResumeCanvas,
        modules: list[DocumentModule],
        parsed_blocks: list[ParsedBlock],
        module_source_refs: dict[str, list[str]],
    ) -> SourceResumeCanvas:
        node_by_block = self._node_by_block_text(canvas, parsed_blocks)
        module_by_node_id: dict[str, str] = {}
        anchors: list[ModuleAnchor] = []
        module_by_id = {module.id: module for module in modules if module.visibility == "visible"}
        for module in sorted(module_by_id.values(), key=lambda item: item.order):
            node_ids = []
            for block_id in module_source_refs.get(module.id, []):
                node_id = node_by_block.get(block_id)
                if node_id and node_id not in node_ids:
                    node_ids.append(node_id)
                    module_by_node_id[node_id] = module.id
            if node_ids:
                anchors.append(
                    ModuleAnchor(
                        module_id=module.id,
                        canvas_node_ids=node_ids,
                        title=module.title,
                        order=module.order,
                    )
                )

        return canvas.model_copy(
            update={
                "node_map": [
                    node.model_copy(update={"module_id": module_by_node_id.get(node.canvas_node_id)})
                    for node in canvas.node_map
                ],
                "module_anchors": anchors,
                "updated_at": utc_now(),
            }
        )

    def _node_by_block_text(
        self,
        canvas: SourceResumeCanvas,
        parsed_blocks: list[ParsedBlock],
    ) -> dict[str, str]:
        available_nodes = list(canvas.node_map)
        result: dict[str, str] = {}
        for block in sorted(parsed_blocks, key=lambda item: item.order):
            normalized_block = self._normalize(block.text)
            match = next(
                (
                    node
                    for node in available_nodes
                    if normalized_block and normalized_block in self._normalize(node.text)
                ),
                None,
            )
            if match is None:
                continue
            result[block.id] = match.canvas_node_id
            available_nodes.remove(match)
        return result

    def _normalize(self, value: str) -> str:
        return "".join(value.strip().lstrip("-*•· ").split())
```

- [ ] **Step 4: 在 import flow 中应用 anchors**

在 `revision_import_flow.py` imports 中替换掉 `SourceResumeCanvasBuilder`：

```python
from .source_canvas_anchor_mapper import SourceCanvasAnchorMapper
```

在 modules 保存后加入：

```python
current_canvas = self.repository.get_source_resume_canvas(document.id)
if current_canvas is None:
    raise RevisionServiceError("Source resume canvas is not initialized")
if current_canvas.version != run.input_source_canvas_version:
    stale_run = run.model_copy(
        update={
            "status": "stale",
            "output_summary": "源画布已更新，需要重新识别。",
            "updated_at": utc_now(),
        }
    )
    self.repository.save_revision_run(stale_run)
    return stale_run

updated_canvas = SourceCanvasAnchorMapper().apply_module_anchors(
    canvas=current_canvas,
    modules=modules,
    parsed_blocks=parsed_blocks,
    module_source_refs=module_source_refs,
)
self.repository.save_source_resume_canvas(updated_canvas)
self._save_step(run.id, "MapSourceCanvasAnchors")
```

- [ ] **Step 5: 更新 import flow 断言**

在 `test_import_flow_generates_workspace_objects` 中断言：

```python
assert any(step.agent_name == "MapSourceCanvasAnchors" for step in steps)
assert workspace.source_resume_canvas.module_anchors
assert any(node.module_id for node in workspace.source_resume_canvas.node_map)
```

- [ ] **Step 6: 运行 mapper 与 import flow 测试**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_source_canvas.py::test_anchor_mapper_maps_parsed_blocks_to_existing_canvas_nodes tests/test_revision_import_flow.py::test_import_flow_generates_workspace_objects -q`

Expected: PASS。

- [ ] **Step 7: 提交 anchors 映射**

```bash
git add services/sidecar/src/typedance_sidecar/source_canvas_anchor_mapper.py services/sidecar/src/typedance_sidecar/revision_import_flow.py services/sidecar/tests/test_revision_source_canvas.py services/sidecar/tests/test_revision_import_flow.py
git commit -m "feat(canvas): 将AI模块锚定到源画布"
```

---

### Task 10: 删除旧逐 block 源画布运行路径，保留空白引导画布

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/revision_source_canvas.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_blank_guided_flow.py`
- Modify: `services/sidecar/tests/test_revision_source_canvas.py`
- Modify: `services/sidecar/tests/test_revision_blank_guided_flow.py`

- [ ] **Step 1: 写 guard 测试确认没有 build(parsed_blocks=...) 路径**

在 `services/sidecar/tests/test_revision_source_canvas.py` 中把旧 `SourceResumeCanvasBuilder().build(...)` 测试删除，新增：

```python
from typedance_sidecar.revision_source_canvas import BlankSourceResumeCanvasBuilder


def test_revision_source_canvas_only_exposes_blank_builder():
    builder = BlankSourceResumeCanvasBuilder()
    canvas = builder.blank(document_id="doc_blank", source_id="src_blank", title="新简历")

    assert canvas.doc_json["content"][0]["type"] == "heading"
    assert canvas.version == 1
    assert canvas.source_snapshot_hash.startswith("sha256:")
```

- [ ] **Step 2: 运行测试确认旧类仍存在**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_source_canvas.py::test_revision_source_canvas_only_exposes_blank_builder -q`

Expected: FAIL，`BlankSourceResumeCanvasBuilder` 还不存在。

- [ ] **Step 3: 重命名并收窄 revision_source_canvas.py**

`revision_source_canvas.py` 保留以下 imports：

```python
from uuid import uuid4

from .models import utc_now
from .revision_models import SourceResumeCanvas, SourceResumeCanvasNode
from .source_canvas_doc_json import source_canvas_hash
```

把 `SourceResumeCanvasBuilder` 改成：

```python
class BlankSourceResumeCanvasBuilder:
    def blank(
        self,
        *,
        document_id: str,
        source_id: str,
        title: str = "新简历",
    ) -> SourceResumeCanvas:
        now = utc_now()
        node_id = "node_blank_start"
        doc_json = {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {
                        "level": 1,
                        "canvasNodeId": node_id,
                        "sourceBlockId": source_id,
                    },
                    "content": [{"type": "text", "text": title}],
                }
            ],
        }
        return SourceResumeCanvas(
            id=f"canvas_{uuid4().hex}",
            document_id=document_id,
            old_resume_source_id=source_id,
            version=1,
            source_snapshot_hash=source_canvas_hash(doc_json),
            doc_json=doc_json,
            node_map=[
                SourceResumeCanvasNode(
                    canvas_node_id=node_id,
                    source_block_id=source_id,
                    node_type="heading",
                    text=title,
                    source_span={},
                )
            ],
            module_anchors=[],
            created_at=now,
            updated_at=now,
        )
```

并删除 `build(...)`、`_doc_node(...)`、`_module_anchors(...)`、`_include_adjacent_module_headings(...)` 等逐 block 构建方法。

- [ ] **Step 4: 更新空白引导 flow import**

在 `revision_blank_guided_flow.py` 中：

```python
from .revision_source_canvas import BlankSourceResumeCanvasBuilder
```

并把：

```python
SourceResumeCanvasBuilder().blank(...)
```

改成：

```python
BlankSourceResumeCanvasBuilder().blank(...)
```

- [ ] **Step 5: 确认旧 build 引用清零**

Run: `rtk rg "SourceResumeCanvasBuilder|BuildSourceCanvas|\\.build\\(" services/sidecar/src/typedance_sidecar services/sidecar/tests`

Expected: 输出中不再出现 `SourceResumeCanvasBuilder` 和 `BuildSourceCanvas`；`.build(` 只允许出现在非 source canvas 语义的已有测试或服务里。

- [ ] **Step 6: 运行相关测试**

Run: `rtk pnpm --filter @typedance/sidecar test -- tests/test_revision_source_canvas.py tests/test_revision_blank_guided_flow.py tests/test_revision_import_flow.py -q`

Expected: PASS。

- [ ] **Step 7: 提交删除旧路径**

```bash
git add services/sidecar/src/typedance_sidecar/revision_source_canvas.py services/sidecar/src/typedance_sidecar/revision_blank_guided_flow.py services/sidecar/tests/test_revision_source_canvas.py services/sidecar/tests/test_revision_blank_guided_flow.py services/sidecar/tests/test_revision_import_flow.py
git commit -m "refactor(canvas): 删除逐块重建源画布路径"
```

---

### Task 11: 前端导入流程改为先进入工作台再显示后台识别

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`
- Modify: `apps/web/src/features/home/ImportOldResumeModal.tsx`
- Modify: `apps/web/src/features/home/ImportOldResumeModal.test.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

- [ ] **Step 1: 写 api 导入顺序测试**

在 `apps/web/src/api.test.ts` 中找到 `importOldResume` 测试，改成断言顺序为：

```ts
expect(progressSteps).toEqual([
  "create_document",
  "save_source",
  "start_recognition",
  "load_workspace",
]);
```

并断言 `getRevisionWorkspaceView` 在 `createRevisionRun` resolve 后立即调用，不等待 run 变成 completed：

```ts
expect(fetchMock).toHaveBeenCalledWith(
  expect.stringContaining("/workspace-view"),
  undefined,
);
```

- [ ] **Step 2: 修改进度 union 和 importOldResume**

在 `apps/web/src/api.ts` 中把：

```ts
| "run_import"
```

改成：

```ts
| "start_recognition"
```

并把：

```ts
onProgress?.("run_import")
await createRevisionRun(...)
onProgress?.("load_workspace")
return getRevisionWorkspaceView(document.id)
```

改成：

```ts
onProgress?.("start_recognition")
await createRevisionRun(document.id, {
  run_type: "import_reconstruct",
  source_document_ids: [source.id],
  user_intent: "导入旧简历并生成可审阅草稿",
})
onProgress?.("load_workspace")
return getRevisionWorkspaceView(document.id)
```

这里 `createRevisionRun` 仍然 await HTTP 创建成功，后端不再同步等待 AI 完成。

- [ ] **Step 3: 更新 Modal 文案测试**

在 `ImportOldResumeModal.test.tsx` 中断言阶段文案：

```ts
expect(screen.getByText("生成原始画布")).toBeInTheDocument();
expect(screen.getByText("启动后台识别")).toBeInTheDocument();
expect(screen.getByText("打开工作台")).toBeInTheDocument();
```

- [ ] **Step 4: 修改 Modal 进度文案**

在 `ImportOldResumeModal.tsx` 的进度 map 中：

```ts
save_source: "生成原始画布",
start_recognition: "启动后台识别",
load_workspace: "打开工作台",
```

删除旧文案“解析原文、生成画布并识别模块”。

- [ ] **Step 5: 写 RevisionWorkspacePage 空 draft 测试**

在 `RevisionWorkspacePage.test.tsx` 加：

```tsx
it("renders source canvas while import recognition is running", async () => {
  mockWorkspaceView({
    current_draft: undefined,
    modules: [],
    issues: [],
    proposals: [],
    source_resume_canvas: {
      id: "canvas_1",
      document_id: "doc_1",
      old_resume_source_id: "src_1",
      version: 1,
      source_snapshot_hash: "sha256:seed",
      doc_json: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: { canvasNodeId: "node_1", sourceBlockId: "sblk_1" },
            content: [{ type: "text", text: "旧简历内容" }],
          },
        ],
      },
      node_map: [],
      module_anchors: [],
      created_at: "2026-05-28T08:00:00.000Z",
      updated_at: "2026-05-28T08:00:00.000Z",
    },
    run_status: {
      run_id: "run_1",
      status: "recognizing",
      current_step: "ResumeStructurer",
    },
  });

  render(<RevisionWorkspacePage />);

  expect(await screen.findByText("旧简历内容")).toBeInTheDocument();
  expect(screen.getByText("正在识别模块和建议")).toBeInTheDocument();
});
```

- [ ] **Step 6: 修改 RevisionWorkspacePage 状态**

在 `RevisionWorkspacePage.tsx` 中增加：

```ts
const isRecognitionRunning = workspace.run_status?.status === "recognizing"
const isRecognitionStale = workspace.run_status?.status === "stale"
```

右侧空态文案改为：

```tsx
{isRecognitionRunning ? "正在识别模块和建议" : isRecognitionStale ? "源画布已更新，需要重新识别" : "还没有生成可审阅草稿"}
```

保持中间 `source_resume_canvas` 有值时继续渲染 `DraftCanvas`/`ResumeRichTextEditor`。

- [ ] **Step 7: 运行前端测试**

Run: `rtk pnpm --filter @typedance/web test -- apps/web/src/api.test.ts apps/web/src/features/home/ImportOldResumeModal.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

Expected: PASS。

- [ ] **Step 8: 提交前端导入体验**

```bash
git add apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/features/home/ImportOldResumeModal.tsx apps/web/src/features/home/ImportOldResumeModal.test.tsx apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
git commit -m "feat(workspace): 导入后先进入源画布"
```

---

### Task 12: Markdown 粘贴和嵌套列表渲染回归

**Files:**
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`
- Modify: `apps/web/src/styles.css`
- Test: `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`

- [ ] **Step 1: 写嵌套 Markdown paste 测试**

在 `ResumeRichTextEditor.toolbar.test.tsx` 中加入：

```tsx
it("parses pasted nested Markdown lists into structured editor nodes", async () => {
  const user = userEvent.setup();
  const handleChange = vi.fn();
  render(
    <ResumeRichTextEditor
      value={{ type: "doc", content: [{ type: "paragraph" }] }}
      onChange={handleChange}
    />,
  );

  const editor = screen.getByRole("textbox");
  await user.click(editor);
  fireEvent.paste(editor, {
    clipboardData: {
      getData: (type: string) =>
        type === "text/plain"
          ? "1. 一级\n   1. 二级\n\n- 无序\n  - 子项"
          : "",
    },
  });

  await waitFor(() => {
    const latest = handleChange.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(latest)).toContain("orderedList");
    expect(JSON.stringify(latest)).toContain("bulletList");
  });
});
```

- [ ] **Step 2: 确认字号控件回归断言保留**

同一测试文件保留：

```tsx
expect(screen.queryByRole("button", { name: "字号" })).not.toBeInTheDocument();
```

- [ ] **Step 3: 运行编辑器测试**

Run: `rtk pnpm --filter @typedance/web test -- apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`

Expected: PASS。

- [ ] **Step 4: 检查嵌套列表 CSS**

如果测试通过但手动渲染列表缩进错误，只在 `styles.css` 中为 editor 内容区补充 list 层级缩进：

```css
.td-rich-editor .ProseMirror ul,
.td-rich-editor .ProseMirror ol {
  padding-left: 1.35rem;
}

.td-rich-editor .ProseMirror li > ul,
.td-rich-editor .ProseMirror li > ol {
  margin-top: 0.25rem;
}
```

已有样式能正确显示时不修改 `styles.css`。

- [ ] **Step 5: 运行 web test**

Run: `rtk pnpm --filter @typedance/web test`

Expected: PASS。

- [ ] **Step 6: 提交编辑器回归**

```bash
git add apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx apps/web/src/styles.css
git commit -m "fix(editor): 保持markdown嵌套列表结构"
```

---

### Task 13: 全链路回归与构建

**Files:**
- Modify: `docs/superpowers/specs/2026-06-05-source-canvas-initialization-design.md`
- Modify: `docs/superpowers/plans/2026-06-05-source-canvas-initialization.md`

- [ ] **Step 1: 运行所有相关包测试**

Run:

```bash
rtk pnpm --filter @typedance/resume-markdown test
rtk pnpm --filter @typedance/contracts test
rtk pnpm --filter @typedance/sidecar test
rtk pnpm --filter @typedance/web test
```

Expected: 四条命令全部 PASS。

- [ ] **Step 2: 运行 web build**

Run: `rtk pnpm --filter @typedance/web build`

Expected: PASS，无 TypeScript 构建错误。

- [ ] **Step 3: 运行仓库总测**

Run: `rtk pnpm test`

Expected: PASS。

- [ ] **Step 4: 搜索旧同步等待路径**

Run:

```bash
rtk rg "BuildSourceCanvas|SourceResumeCanvasBuilder|parse_status=\"parsed\"|parse_status: \"parsed\"|run_import" services packages apps
```

Expected: 没有 `BuildSourceCanvas`、`SourceResumeCanvasBuilder`、`parse_status="parsed"`、`parse_status: "parsed"`、`run_import` 的业务运行路径命中。

- [ ] **Step 5: 更新设计文档实施记录**

在 `docs/superpowers/specs/2026-06-05-source-canvas-initialization-design.md` 末尾追加：

```markdown
## 实施记录

- 已将旧简历导入拆为 source canvas 快路径和 AI 识别慢路径。
- `source_resume_canvas.doc_json` 由 `SourceCanvasInitializer` 直接从 source 生成，不再由 `ParsedBlock` 逐块拼接。
- Markdown 以整篇文本进入 Tiptap Markdown parser，嵌套列表保留结构。
- DOCX 读取段落、标题、列表和基础 inline marks；PDF、DOC 使用抽取文本进入可编辑画布。
- AI 结果绑定 `input_source_canvas_id` 和 `input_source_canvas_version`，版本不匹配时标记为 stale。
```

- [ ] **Step 6: 提交最终文档和回归修正**

```bash
git add docs/superpowers/specs/2026-06-05-source-canvas-initialization-design.md docs/superpowers/plans/2026-06-05-source-canvas-initialization.md
git commit -m "docs(plan): 记录源画布初始化实施"
```

---

## Acceptance Checklist

- [ ] 导入 `.md` 后，嵌套有序/无序列表在 A4 画布中显示为真实嵌套列表。
- [ ] 粘贴 Markdown 到画布后，标题、加粗、分割线和嵌套列表进入结构化 Tiptap doc_json。
- [ ] 粘贴文本、`.txt`、`.pdf`、`.docx`、`.doc` 均能生成可编辑 source canvas。
- [ ] DOCX 至少保留段落、标题、列表和 bold/italic/underline。
- [ ] 导入后工作台首屏不等待 AI 完整完成。
- [ ] AI 识别中右侧显示识别状态，画布仍可编辑保存。
- [ ] 保存画布会递增 `SourceResumeCanvas.version`。
- [ ] AI 结果只应用到匹配的 `input_source_canvas_id/version`。
- [ ] 旧逐 `ParsedBlock` 构建 source canvas 的运行时代码已删除。
- [ ] `render_projection.doc_json` 不参与首屏原始画布渲染。
