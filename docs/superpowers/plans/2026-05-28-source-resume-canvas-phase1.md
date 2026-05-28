# Source Resume Canvas Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把导入旧简历后的 Revision 工作台主编辑区切换为 `ResumeRichTextEditor` 原始画布，并叠加模块大纲、模块边界和阶段化导入反馈。

**Architecture:** 新增 `SourceResumeCanvas` 作为旧简历转换后的可编辑画布数据，和结构化 `DocumentModule` 分离。sidecar 在导入流中从 `ParsedBlock` 生成画布 `doc_json`、节点映射和模块锚点，`WorkspaceView` 返回该画布；web 使用新的 `DraftCanvas` 组件渲染 A4 编辑区和大纲，不再把 `render_projection.doc_json/html` 当主编辑区数据源。

**Tech Stack:** TypeScript, Zod contracts, React 19, TipTap 3, FastAPI sidecar, Pydantic, SQLite repository, Vitest, pytest.

---

## 文件结构

- Create: `packages/contracts/src/revision/source-canvas.ts`
  定义 `SourceResumeCanvas`、`SourceResumeCanvasNode`、`ModuleAnchor` 的 Zod schema 和类型。
- Modify: `packages/contracts/src/revision/workspace-view.ts`
  在 `WorkspaceView` 中加入 `source_resume_canvas?: SourceResumeCanvas`。
- Modify: `packages/contracts/src/index.ts`
  导出 source canvas 契约。
- Modify: `packages/contracts/tests/contracts.test.ts`
  覆盖 source canvas schema 和 workspace view 解析。
- Modify: `services/sidecar/src/typedance_sidecar/revision_models.py`
  增加 Pydantic 模型和 `WorkspaceView.source_resume_canvas` 字段。
- Modify: `services/sidecar/src/typedance_sidecar/revision_repository.py`
  增加 `source_resume_canvases` 表和保存/读取方法。
- Create: `services/sidecar/src/typedance_sidecar/revision_source_canvas.py`
  从旧简历 `ParsedBlock` 生成 TipTap `doc_json`、节点映射和模块锚点。
- Modify: `services/sidecar/src/typedance_sidecar/revision_import_flow.py`
  在导入流程中构建并保存 `SourceResumeCanvas`，并保存阶段步骤。
- Modify: `services/sidecar/src/typedance_sidecar/revision_blank_guided_flow.py`
  为新建/空白引导路径生成空白或基于用户输入的 `SourceResumeCanvas`。
- Modify: `services/sidecar/src/typedance_sidecar/revision_services.py`
  `WorkspaceService` 返回 source canvas。
- Modify: `services/sidecar/src/typedance_sidecar/revision_api.py`
  增加保存画布正文的简单接口。
- Modify: `services/sidecar/tests/test_revision_repository.py`
  覆盖 source canvas 存取。
- Create: `services/sidecar/tests/test_revision_source_canvas.py`
  覆盖转换器。
- Modify: `services/sidecar/tests/test_revision_import_flow.py`
  覆盖导入后工作台返回 source canvas。
- Modify: `services/sidecar/tests/test_revision_blank_guided_flow.py`
  覆盖新建简历也有可编辑画布。
- Modify: `apps/web/src/api.ts`
  增加 `saveSourceResumeCanvas` 和 `importOldResume` 阶段回调。
- Modify: `apps/web/src/api.test.ts`
  覆盖 import 阶段回调和保存画布接口。
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`
  TipTap 节点保留 `canvasNodeId`、`sourceBlockId`、`moduleId`，并暴露滚动到节点的方法。
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`
  覆盖画布节点属性渲染。
- Create: `apps/web/src/features/revision/DraftCanvas.tsx`
  使用 `ResumeRichTextEditor` 渲染 `SourceResumeCanvas.doc_json`，展示可折叠大纲并支持跳转。
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
  使用 `DraftCanvas` 取代 iframe 主画布，并展示阶段化 run status。
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
  覆盖原始画布、模块大纲、点击跳转和无 iframe。
- Modify: `apps/web/src/features/home/ImportOldResumeModal.tsx`
  导入时展示明确阶段，不再只有长期 spinner。
- Modify: `apps/web/src/features/home/ImportOldResumeModal.test.tsx`
  覆盖阶段文案。
- Modify: `apps/web/src/styles.css`
  只添加 TipTap 内部模块边界所需的全局选择器；其他布局使用 Tailwind。

---

### Task 1: Contracts for SourceResumeCanvas

**Files:**
- Create: `packages/contracts/src/revision/source-canvas.ts`
- Modify: `packages/contracts/src/revision/workspace-view.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/tests/contracts.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add these imports near the top of `packages/contracts/tests/contracts.test.ts`:

```ts
import {
  sourceResumeCanvasSchema,
  workspaceViewSchema,
} from "../src";
```

Add this test near the revision contract tests:

```ts
it("parses source resume canvas with stable node and module anchors", () => {
  const canvas = sourceResumeCanvasSchema.parse({
    id: "canvas_1",
    document_id: "doc_1",
    old_resume_source_id: "src_old_resume",
    doc_json: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: {
            canvasNodeId: "node_1",
            sourceBlockId: "block_1",
            moduleId: "mod_1",
          },
          content: [{ type: "text", text: "负责订单系统重构" }],
        },
      ],
    },
    node_map: [
      {
        canvas_node_id: "node_1",
        source_block_id: "block_1",
        node_type: "paragraph",
        text: "负责订单系统重构",
        source_span: { line: 1 },
        module_id: "mod_1",
      },
    ],
    module_anchors: [
      {
        module_id: "mod_1",
        canvas_node_ids: ["node_1"],
        title: "工作经历",
        order: 1,
      },
    ],
    created_at: "2026-05-28T08:00:00.000Z",
    updated_at: "2026-05-28T08:00:00.000Z",
  });

  expect(canvas.node_map[0].canvas_node_id).toBe("node_1");
  expect(canvas.module_anchors[0].canvas_node_ids).toEqual(["node_1"]);
});
```

Extend the existing workspace view test object with:

```ts
source_resume_canvas: {
  id: "canvas_1",
  document_id: "doc_1",
  old_resume_source_id: "src_old_resume",
  doc_json: { type: "doc", content: [] },
  node_map: [],
  module_anchors: [],
  created_at: "2026-05-28T08:00:00.000Z",
  updated_at: "2026-05-28T08:00:00.000Z",
},
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/contracts test
```

Expected: FAIL because `sourceResumeCanvasSchema` is not exported and `workspaceViewSchema` does not accept `source_resume_canvas`.

- [ ] **Step 3: Add the source canvas schema**

Create `packages/contracts/src/revision/source-canvas.ts`:

```ts
import { z } from "zod";
import { isoDateTimeSchema } from "../shared";

export const sourceResumeCanvasNodeTypeSchema = z.enum([
  "heading",
  "paragraph",
  "list_item",
  "table_cell",
  "unknown",
]);

export const sourceResumeCanvasNodeSchema = z.object({
  canvas_node_id: z.string().min(1),
  source_block_id: z.string().min(1).optional(),
  node_type: sourceResumeCanvasNodeTypeSchema,
  text: z.string(),
  source_span: z.record(z.unknown()).default({}),
  module_id: z.string().optional(),
});

export const moduleAnchorSchema = z.object({
  module_id: z.string().min(1),
  canvas_node_ids: z.array(z.string().min(1)).default([]),
  title: z.string().min(1),
  order: z.number().int().nonnegative(),
});

export const sourceResumeCanvasSchema = z.object({
  id: z.string().min(1),
  document_id: z.string().min(1),
  old_resume_source_id: z.string().min(1),
  doc_json: z.record(z.unknown()),
  node_map: z.array(sourceResumeCanvasNodeSchema).default([]),
  module_anchors: z.array(moduleAnchorSchema).default([]),
  created_at: isoDateTimeSchema,
  updated_at: isoDateTimeSchema,
});

export type SourceResumeCanvasNodeType = z.infer<typeof sourceResumeCanvasNodeTypeSchema>;
export type SourceResumeCanvasNode = z.infer<typeof sourceResumeCanvasNodeSchema>;
export type ModuleAnchor = z.infer<typeof moduleAnchorSchema>;
export type SourceResumeCanvas = z.infer<typeof sourceResumeCanvasSchema>;
```

Modify `packages/contracts/src/revision/workspace-view.ts`:

```ts
import { sourceResumeCanvasSchema } from "./source-canvas";
```

Add the field to `workspaceViewSchema`:

```ts
source_resume_canvas: sourceResumeCanvasSchema.optional(),
```

Modify `packages/contracts/src/index.ts`:

```ts
export * from "./revision/source-canvas";
```

- [ ] **Step 4: Run contract tests**

Run:

```powershell
corepack pnpm --filter @typedance/contracts test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add packages/contracts/src/revision/source-canvas.ts packages/contracts/src/revision/workspace-view.ts packages/contracts/src/index.ts packages/contracts/tests/contracts.test.ts
git commit -m "feat(contracts): 新增原始简历画布契约"
```

---

### Task 2: Sidecar Models and Repository Storage

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/revision_models.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_repository.py`
- Test: `services/sidecar/tests/test_revision_repository.py`

- [ ] **Step 1: Write failing repository test**

Add imports to `services/sidecar/tests/test_revision_repository.py`:

```py
from typedance_sidecar.revision_models import (
    ModuleAnchor,
    SourceResumeCanvas,
    SourceResumeCanvasNode,
)
```

Add this test:

```py
def test_repository_saves_source_resume_canvas(tmp_path):
    repo = make_repository(tmp_path)
    now = utc_now()
    canvas = SourceResumeCanvas(
        id="canvas_1",
        document_id="doc_1",
        old_resume_source_id="src_1",
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
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/sidecar test -- services/sidecar/tests/test_revision_repository.py::test_repository_saves_source_resume_canvas
```

Expected: FAIL because the models and repository methods do not exist.

- [ ] **Step 3: Add Pydantic models**

In `services/sidecar/src/typedance_sidecar/revision_models.py`, add after `ParsedBlock`:

```py
SourceCanvasNodeType = Literal["heading", "paragraph", "list_item", "table_cell", "unknown"]


class SourceResumeCanvasNode(BaseModel):
    canvas_node_id: str
    node_type: SourceCanvasNodeType
    text: str
    source_block_id: str | None = None
    source_span: dict[str, Any] = Field(default_factory=dict)
    module_id: str | None = None


class ModuleAnchor(BaseModel):
    module_id: str
    canvas_node_ids: list[str] = Field(default_factory=list)
    title: str
    order: int


class SourceResumeCanvas(BaseModel):
    id: str
    document_id: str
    old_resume_source_id: str
    doc_json: Any
    node_map: list[SourceResumeCanvasNode] = Field(default_factory=list)
    module_anchors: list[ModuleAnchor] = Field(default_factory=list)
    created_at: str
    updated_at: str
```

Add to `WorkspaceView`:

```py
source_resume_canvas: SourceResumeCanvas | None = None
```

- [ ] **Step 4: Add repository table and methods**

In `services/sidecar/src/typedance_sidecar/revision_repository.py`, add `SourceResumeCanvas` to imports:

```py
    SourceResumeCanvas,
```

Add this table definition after `parsed_blocks`:

```py
    """
    CREATE TABLE IF NOT EXISTS source_resume_canvases (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      schema_version TEXT NOT NULL DEFAULT '0.1.0',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
    """,
```

Add methods after `list_parsed_blocks`:

```py
    def save_source_resume_canvas(self, canvas: SourceResumeCanvas) -> SourceResumeCanvas:
        self._save("source_resume_canvases", canvas, {"document_id": canvas.document_id})
        return canvas

    def get_source_resume_canvas(self, document_id: str) -> SourceResumeCanvas | None:
        canvases = self._list("source_resume_canvases", SourceResumeCanvas, "document_id", document_id)
        return canvases[-1] if canvases else None
```

- [ ] **Step 5: Run repository test**

Run:

```powershell
corepack pnpm --filter @typedance/sidecar test -- services/sidecar/tests/test_revision_repository.py::test_repository_saves_source_resume_canvas
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add services/sidecar/src/typedance_sidecar/revision_models.py services/sidecar/src/typedance_sidecar/revision_repository.py services/sidecar/tests/test_revision_repository.py
git commit -m "feat(sidecar): 保存原始简历画布"
```

---

### Task 3: SourceResumeCanvas Builder and Import Integration

**Files:**
- Create: `services/sidecar/src/typedance_sidecar/revision_source_canvas.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_import_flow.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_blank_guided_flow.py`
- Test: `services/sidecar/tests/test_revision_source_canvas.py`
- Test: `services/sidecar/tests/test_revision_import_flow.py`
- Test: `services/sidecar/tests/test_revision_blank_guided_flow.py`

- [ ] **Step 1: Write failing builder tests**

Create `services/sidecar/tests/test_revision_source_canvas.py`:

```py
from typedance_sidecar.models import utc_now
from typedance_sidecar.revision_models import DocumentModule, ParsedBlock, SourceDocument
from typedance_sidecar.revision_source_canvas import SourceResumeCanvasBuilder


def test_builder_preserves_original_blocks_and_canvas_node_ids():
    now = utc_now()
    source = SourceDocument(
        id="src_1",
        document_id="doc_1",
        source_type="old_resume",
        title="旧简历",
        raw_text="张三\n工作经历\n负责订单系统重构",
        parse_status="parsed",
        created_at=now,
    )
    blocks = [
        ParsedBlock(id="block_1", source_document_id=source.id, type="paragraph", text="张三", order=0, source_span={"line": 1}),
        ParsedBlock(id="block_2", source_document_id=source.id, type="heading", text="工作经历", order=1, source_span={"line": 2}),
        ParsedBlock(id="block_3", source_document_id=source.id, type="paragraph", text="负责订单系统重构", order=2, source_span={"line": 3}),
    ]
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

    canvas = SourceResumeCanvasBuilder().build(
        source=source,
        parsed_blocks=blocks,
        modules=[module],
        module_source_refs={"mod_work": ["block_2", "block_3"]},
    )

    assert canvas.old_resume_source_id == "src_1"
    assert canvas.doc_json["content"][0]["attrs"]["canvasNodeId"] == "node_block_1"
    assert canvas.node_map[2].text == "负责订单系统重构"
    assert canvas.node_map[2].module_id == "mod_work"
    assert canvas.module_anchors[0].canvas_node_ids == ["node_block_2", "node_block_3"]
```

- [ ] **Step 2: Run builder test to verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/sidecar test -- services/sidecar/tests/test_revision_source_canvas.py
```

Expected: FAIL because `revision_source_canvas.py` does not exist.

- [ ] **Step 3: Implement builder**

Create `services/sidecar/src/typedance_sidecar/revision_source_canvas.py`:

```py
from uuid import uuid4

from .models import utc_now
from .revision_models import (
    DocumentModule,
    ModuleAnchor,
    ParsedBlock,
    SourceDocument,
    SourceResumeCanvas,
    SourceResumeCanvasNode,
)


class SourceResumeCanvasBuilder:
    def build(
        self,
        *,
        source: SourceDocument,
        parsed_blocks: list[ParsedBlock],
        modules: list[DocumentModule],
        module_source_refs: dict[str, list[str]],
    ) -> SourceResumeCanvas:
        now = utc_now()
        sorted_blocks = sorted(
            [block for block in parsed_blocks if block.source_document_id == source.id],
            key=lambda block: block.order,
        )
        module_by_block = self._module_by_block(module_source_refs)
        doc_nodes = []
        node_map = []

        for block in sorted_blocks:
            canvas_node_id = self._canvas_node_id(block.id)
            module_id = module_by_block.get(block.id)
            doc_nodes.append(self._doc_node(block, canvas_node_id, module_id))
            node_map.append(
                SourceResumeCanvasNode(
                    canvas_node_id=canvas_node_id,
                    source_block_id=block.id,
                    node_type=self._node_type(block),
                    text=block.text,
                    source_span=block.source_span,
                    module_id=module_id,
                )
            )

        return SourceResumeCanvas(
            id=f"canvas_{uuid4().hex}",
            document_id=source.document_id,
            old_resume_source_id=source.id,
            doc_json={"type": "doc", "content": doc_nodes},
            node_map=node_map,
            module_anchors=self._module_anchors(modules, module_source_refs),
            created_at=now,
            updated_at=now,
        )

    def blank(self, *, document_id: str, source_id: str, title: str = "新简历") -> SourceResumeCanvas:
        now = utc_now()
        node_id = "node_blank_start"
        return SourceResumeCanvas(
            id=f"canvas_{uuid4().hex}",
            document_id=document_id,
            old_resume_source_id=source_id,
            doc_json={
                "type": "doc",
                "content": [
                    {
                        "type": "heading",
                        "attrs": {"level": 1, "canvasNodeId": node_id, "sourceBlockId": source_id},
                        "content": [{"type": "text", "text": title}],
                    }
                ],
            },
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

    def _doc_node(self, block: ParsedBlock, canvas_node_id: str, module_id: str | None) -> dict[str, object]:
        attrs: dict[str, object] = {
            "canvasNodeId": canvas_node_id,
            "sourceBlockId": block.id,
        }
        if module_id:
            attrs["moduleId"] = module_id

        if block.type == "heading":
            return {
                "type": "heading",
                "attrs": {**attrs, "level": 2},
                "content": [{"type": "text", "text": block.text}],
            }

        if block.type == "list":
            return {
                "type": "bulletList",
                "content": [
                    {
                        "type": "listItem",
                        "attrs": attrs,
                        "content": [
                            {
                                "type": "paragraph",
                                "content": [{"type": "text", "text": block.text.lstrip("-*•· ").strip()}],
                            }
                        ],
                    }
                ],
            }

        return {
            "type": "paragraph",
            "attrs": attrs,
            "content": [{"type": "text", "text": block.text}],
        }

    def _node_type(self, block: ParsedBlock) -> str:
        if block.type == "heading":
            return "heading"
        if block.type == "list":
            return "list_item"
        if block.type in {"paragraph", "contact", "date_range"}:
            return "paragraph"
        return "unknown"

    def _module_by_block(self, module_source_refs: dict[str, list[str]]) -> dict[str, str]:
        result: dict[str, str] = {}
        for module_id, block_ids in module_source_refs.items():
            for block_id in block_ids:
                result[block_id] = module_id
        return result

    def _module_anchors(
        self,
        modules: list[DocumentModule],
        module_source_refs: dict[str, list[str]],
    ) -> list[ModuleAnchor]:
        anchors: list[ModuleAnchor] = []
        for module in sorted([module for module in modules if module.visibility == "visible"], key=lambda item: item.order):
            node_ids = [self._canvas_node_id(block_id) for block_id in module_source_refs.get(module.id, [])]
            if not node_ids:
                continue
            anchors.append(
                ModuleAnchor(
                    module_id=module.id,
                    canvas_node_ids=node_ids,
                    title=module.title,
                    order=module.order,
                )
            )
        return anchors

    def _canvas_node_id(self, block_id: str) -> str:
        return f"node_{block_id}"
```

- [ ] **Step 4: Integrate import flow**

Modify imports in `services/sidecar/src/typedance_sidecar/revision_import_flow.py`:

```py
from .revision_source_canvas import SourceResumeCanvasBuilder
```

After modules are built and before saving claims, add:

```py
        module_source_refs = {
            saved.id: module.source_block_refs
            for module, saved in zip(structured_output.modules, modules, strict=False)
        }
```

After saving modules, add:

```py
        source_canvas = SourceResumeCanvasBuilder().build(
            source=sources[0],
            parsed_blocks=parsed_blocks,
            modules=modules,
            module_source_refs=module_source_refs,
        )
        self.repository.save_source_resume_canvas(source_canvas)
        self._save_step(run.id, "BuildSourceCanvas")
```

- [ ] **Step 5: Add import flow assertions**

In `services/sidecar/tests/test_revision_import_flow.py`, after `workspace = WorkspaceService(repo).get_workspace_view(document.id)`, add:

```py
    assert workspace.source_resume_canvas is not None
    assert workspace.source_resume_canvas.old_resume_source_id == source.id
    assert workspace.source_resume_canvas.doc_json["type"] == "doc"
    assert workspace.source_resume_canvas.node_map
    assert workspace.source_resume_canvas.module_anchors
```

Add this stage assertion after `steps = repo.list_agent_steps(run.id)`:

```py
    assert any(step.agent_name == "BuildSourceCanvas" for step in steps)
```

- [ ] **Step 6: Create blank guided source canvas**

In `services/sidecar/src/typedance_sidecar/revision_blank_guided_flow.py`, import:

```py
from .revision_source_canvas import SourceResumeCanvasBuilder
```

After `projection = RenderService(self.repository).build_projection_for_draft(updated_draft.id)`, before `self._save_step(run.id, "RenderProjection")`, add:

```py
        if self.repository.get_source_resume_canvas(document.id) is None:
            self.repository.save_source_resume_canvas(
                SourceResumeCanvasBuilder().blank(
                    document_id=document.id,
                    source_id=sources[0].id,
                    title=document.title,
                )
            )
            self._save_step(run.id, "BuildSourceCanvas")
```

- [ ] **Step 7: Add blank guided assertion**

In `services/sidecar/tests/test_revision_blank_guided_flow.py`, after retrieving the workspace, add:

```py
    assert workspace.source_resume_canvas is not None
    assert workspace.source_resume_canvas.doc_json["type"] == "doc"
```

- [ ] **Step 8: Run sidecar tests for builder and flows**

Run:

```powershell
corepack pnpm --filter @typedance/sidecar test -- services/sidecar/tests/test_revision_source_canvas.py services/sidecar/tests/test_revision_import_flow.py services/sidecar/tests/test_revision_blank_guided_flow.py
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add services/sidecar/src/typedance_sidecar/revision_source_canvas.py services/sidecar/src/typedance_sidecar/revision_import_flow.py services/sidecar/src/typedance_sidecar/revision_blank_guided_flow.py services/sidecar/tests/test_revision_source_canvas.py services/sidecar/tests/test_revision_import_flow.py services/sidecar/tests/test_revision_blank_guided_flow.py
git commit -m "feat(import): 生成旧简历原始画布"
```

---

### Task 4: Workspace View and Canvas Save API

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/revision_services.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_api.py`
- Modify: `services/sidecar/tests/test_revision_services.py`
- Modify: `services/sidecar/tests/test_revision_api.py`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`

- [ ] **Step 1: Write failing sidecar workspace test**

In `services/sidecar/tests/test_revision_services.py`, extend the workspace view test by saving a canvas before calling `get_workspace_view`:

```py
repo.save_source_resume_canvas(
    SourceResumeCanvas(
        id="canvas_1",
        document_id=document.id,
        old_resume_source_id="src_1",
        doc_json={"type": "doc", "content": []},
        node_map=[],
        module_anchors=[],
        created_at=now,
        updated_at=now,
    )
)
```

Then assert:

```py
    assert view.source_resume_canvas is not None
    assert view.source_resume_canvas.id == "canvas_1"
```

- [ ] **Step 2: Return canvas from WorkspaceService**

In `services/sidecar/src/typedance_sidecar/revision_services.py`, add the field to the `WorkspaceView(...)` call:

```py
            source_resume_canvas=self.repository.get_source_resume_canvas(document.id),
```

- [ ] **Step 3: Add simple save endpoint test**

In `services/sidecar/tests/test_revision_api.py`, add:

```py
def test_revision_api_updates_source_resume_canvas(client):
    document = client.post(
        "/documents",
        json={
            "pack_id": "resume",
            "title": "旧简历",
            "target_language": "zh-CN",
            "initial_mode": "import_old_resume",
        },
    ).json()
    source = client.post(
        f"/documents/{document['id']}/sources",
        json={
            "source_type": "old_resume",
            "title": "旧简历",
            "raw_text": "张三",
            "mime_type": "text/plain",
        },
    ).json()
    client.post(
        f"/documents/{document['id']}/source-resume-canvas",
        json={
            "old_resume_source_id": source["id"],
            "doc_json": {"type": "doc", "content": []},
            "node_map": [],
            "module_anchors": [],
        },
    )

    response = client.put(
        f"/documents/{document['id']}/source-resume-canvas",
        json={"doc_json": {"type": "doc", "content": [{"type": "paragraph"}]}},
    )

    assert response.status_code == 200
    assert response.json()["doc_json"]["content"][0]["type"] == "paragraph"
```

- [ ] **Step 4: Add API endpoints**

In `services/sidecar/src/typedance_sidecar/revision_api.py`, add request models near other request models:

```py
class CreateSourceResumeCanvasRequest(BaseModel):
    old_resume_source_id: str
    doc_json: dict[str, Any]
    node_map: list[SourceResumeCanvasNode] = Field(default_factory=list)
    module_anchors: list[ModuleAnchor] = Field(default_factory=list)


class UpdateSourceResumeCanvasRequest(BaseModel):
    doc_json: dict[str, Any]
```

Add routes after `get_workspace_view`:

```py
    @router.post("/documents/{document_id}/source-resume-canvas", response_model=SourceResumeCanvas, status_code=201)
    def create_source_resume_canvas(
        document_id: str,
        payload: CreateSourceResumeCanvasRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> SourceResumeCanvas:
        require_document(repo, document_id)
        now = utc_now()
        canvas = SourceResumeCanvas(
            id=f"canvas_{uuid4().hex}",
            document_id=document_id,
            old_resume_source_id=payload.old_resume_source_id,
            doc_json=payload.doc_json,
            node_map=payload.node_map,
            module_anchors=payload.module_anchors,
            created_at=now,
            updated_at=now,
        )
        return repo.save_source_resume_canvas(canvas)

    @router.put("/documents/{document_id}/source-resume-canvas", response_model=SourceResumeCanvas)
    def update_source_resume_canvas(
        document_id: str,
        payload: UpdateSourceResumeCanvasRequest,
        repo: RevisionRepository = Depends(repository),
    ) -> SourceResumeCanvas:
        require_document(repo, document_id)
        canvas = repo.get_source_resume_canvas(document_id)
        if canvas is None:
            raise HTTPException(status_code=404, detail="Source resume canvas not found")
        return repo.save_source_resume_canvas(
            canvas.model_copy(update={"doc_json": payload.doc_json, "updated_at": utc_now()})
        )
```

Ensure imports include:

```py
    ModuleAnchor,
    SourceResumeCanvas,
    SourceResumeCanvasNode,
```

- [ ] **Step 5: Add web API helper and tests**

In `apps/web/src/api.ts`, import type:

```ts
  type SourceResumeCanvas,
```

Add:

```ts
export async function saveSourceResumeCanvas(documentId: string, docJson: Record<string, unknown>): Promise<SourceResumeCanvas> {
  const response = await fetch(`${baseUrl}/documents/${documentId}/source-resume-canvas`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ doc_json: docJson }),
  });
  return parseTemplateResponse(
    response,
    (value) => sourceResumeCanvasSchema.parse(value),
    "Failed to save source resume canvas",
  );
}
```

Update imports to include `sourceResumeCanvasSchema`.

In `apps/web/src/api.test.ts`, add a fetch mock assertion:

```ts
it("saves source resume canvas doc json", async () => {
  mockFetch.mockResolvedValueOnce(jsonResponse({
    id: "canvas_1",
    document_id: "doc_1",
    old_resume_source_id: "src_1",
    doc_json: { type: "doc", content: [] },
    node_map: [],
    module_anchors: [],
    created_at: "2026-05-28T08:00:00.000Z",
    updated_at: "2026-05-28T08:00:00.000Z",
  }));

  const { saveSourceResumeCanvas } = await import("./api");
  await saveSourceResumeCanvas("doc_1", { type: "doc", content: [] });

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining("/documents/doc_1/source-resume-canvas"),
    expect.objectContaining({ method: "PUT" }),
  );
});
```

- [ ] **Step 6: Run API and service tests**

Run:

```powershell
corepack pnpm --filter @typedance/sidecar test -- services/sidecar/tests/test_revision_services.py services/sidecar/tests/test_revision_api.py
corepack pnpm --filter @typedance/web test -- src/api.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add services/sidecar/src/typedance_sidecar/revision_services.py services/sidecar/src/typedance_sidecar/revision_api.py services/sidecar/tests/test_revision_services.py services/sidecar/tests/test_revision_api.py apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat(workspace): 返回并保存原始简历画布"
```

---

### Task 5: TipTap Canvas Node Attributes and Scroll Handle

**Files:**
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`

- [ ] **Step 1: Write failing editor attribute test**

In `ResumeRichTextEditor.toolbar.test.tsx`, add:

```tsx
it("renders source canvas node attributes as data attributes", async () => {
  render(
    <ResumeRichTextEditor
      ariaLabel="Resume editor"
      docJson={{
        type: "doc",
        content: [
          {
            type: "paragraph",
            attrs: {
              canvasNodeId: "node_1",
              sourceBlockId: "block_1",
              moduleId: "mod_1",
            },
            content: [{ type: "text", text: "负责订单系统重构" }],
          },
        ],
      }}
      onChange={vi.fn()}
    />,
  );

  expect(await screen.findByText("负责订单系统重构")).toHaveAttribute("data-canvas-node-id", "node_1");
  expect(screen.getByText("负责订单系统重构")).toHaveAttribute("data-module-id", "mod_1");
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx
```

Expected: FAIL because the attributes are not part of the TipTap schema and are not rendered.

- [ ] **Step 3: Add canvas attributes to TipTap global attributes**

In `ResumeRichTextEditor.tsx`, add to `BlockStyle.addGlobalAttributes()` for `BLOCK_STYLE_NODE_TYPES`:

```ts
          canvasNodeId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-canvas-node-id"),
            renderHTML: (attributes) => (
              typeof attributes.canvasNodeId === "string" && attributes.canvasNodeId
                ? { "data-canvas-node-id": attributes.canvasNodeId }
                : {}
            ),
          },
          sourceBlockId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-source-block-id"),
            renderHTML: (attributes) => (
              typeof attributes.sourceBlockId === "string" && attributes.sourceBlockId
                ? { "data-source-block-id": attributes.sourceBlockId }
                : {}
            ),
          },
          moduleId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-module-id"),
            renderHTML: (attributes) => (
              typeof attributes.moduleId === "string" && attributes.moduleId
                ? { "data-module-id": attributes.moduleId }
                : {}
            ),
          },
```

Update `ResumeRichTextEditorHandle`:

```ts
export type ResumeRichTextEditorHandle = {
  setColumnsCount: (count: ColumnsCount) => void
  setColumnsGap: (gap: ColumnsGap) => void
  unsetColumns: () => void
  scrollToCanvasNode: (canvasNodeId: string) => void
}
```

Add to `useImperativeHandle`:

```ts
      scrollToCanvasNode: (canvasNodeId) => {
        const root = editor?.view.dom
        const node = root?.querySelector(`[data-canvas-node-id="${CSS.escape(canvasNodeId)}"]`)
        if (node instanceof HTMLElement) {
          node.scrollIntoView({ behavior: "smooth", block: "center" })
          node.focus({ preventScroll: true })
        }
      },
```

- [ ] **Step 4: Run editor test**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx
git commit -m "feat(editor): 保留原始画布节点属性"
```

---

### Task 6: DraftCanvas UI and Revision Workspace Integration

**Files:**
- Create: `apps/web/src/features/revision/DraftCanvas.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing workspace tests**

In `RevisionWorkspacePage.test.tsx`, add `source_resume_canvas` to the `workspace` fixture:

```ts
  source_resume_canvas: {
    id: "canvas_1",
    document_id: "doc_1",
    old_resume_source_id: "src_1",
    doc_json: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { canvasNodeId: "node_project", sourceBlockId: "block_project", moduleId: "mod_1" },
          content: [{ type: "text", text: "负责核心链路重构。" }],
        },
      ],
    },
    node_map: [
      {
        canvas_node_id: "node_project",
        source_block_id: "block_project",
        node_type: "paragraph",
        text: "负责核心链路重构。",
        source_span: { line: 1 },
        module_id: "mod_1",
      },
    ],
    module_anchors: [
      {
        module_id: "mod_1",
        canvas_node_ids: ["node_project"],
        title: "项目经历",
        order: 0,
      },
    ],
    created_at: "2026-05-21T08:00:00.000Z",
    updated_at: "2026-05-21T08:00:00.000Z",
  },
```

Add tests:

```tsx
it("renders the source resume canvas instead of iframe preview", async () => {
  renderPage();

  expect(await screen.findByText("负责核心链路重构。")).toBeInTheDocument();
  expect(screen.queryByTitle("结构化草稿预览")).not.toBeInTheDocument();
});

it("renders collapsible module outline", async () => {
  renderPage();

  expect(await screen.findByRole("button", { name: /大纲/ })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "项目经历" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: FAIL because `DraftCanvas` does not exist and page still renders iframe/fallback module list.

- [ ] **Step 3: Create DraftCanvas**

Create `apps/web/src/features/revision/DraftCanvas.tsx`:

```tsx
import { useMemo, useRef, useState } from "react";
import { ChevronDown, ListTree } from "lucide-react";
import type { ModuleAnchor, SourceResumeCanvas } from "@typedance/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ResumeDocJson, ResumeEditorChange } from "../workspace/editor";
import {
  ResumeRichTextEditor,
  type ResumeRichTextEditorHandle,
} from "../workspace/components/ResumeRichTextEditor";

type DraftCanvasProps = {
  canvas: SourceResumeCanvas;
  onChange: (change: ResumeEditorChange) => void;
};

export function DraftCanvas({ canvas, onChange }: DraftCanvasProps) {
  const editorRef = useRef<ResumeRichTextEditorHandle>(null);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const anchors = useMemo(
    () => [...canvas.module_anchors].sort((left, right) => left.order - right.order),
    [canvas.module_anchors],
  );

  const scrollToAnchor = (anchor: ModuleAnchor) => {
    const firstNodeId = anchor.canvas_node_ids[0];
    if (firstNodeId) editorRef.current?.scrollToCanvasNode(firstNodeId);
  };

  return (
    <div className="relative min-h-0">
      <div className="absolute right-3 top-3 z-10 w-56 rounded-md border border-border bg-background/95 shadow-sm backdrop-blur">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full justify-between"
          aria-expanded={outlineOpen}
          onClick={() => setOutlineOpen((value) => !value)}
        >
          <span className="inline-flex items-center gap-2">
            <ListTree className="size-4" />
            大纲
          </span>
          <ChevronDown className={cn("size-4 transition-transform", outlineOpen && "rotate-180")} />
        </Button>
        {outlineOpen && (
          <div className="max-h-80 overflow-y-auto border-t border-border p-1">
            {anchors.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">模块识别完成后显示大纲。</p>
            ) : (
              anchors.map((anchor) => (
                <Button
                  key={anchor.module_id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start truncate text-xs"
                  style={{ paddingLeft: `${8 + Math.min(anchor.order, 3) * 10}px` }}
                  onClick={() => scrollToAnchor(anchor)}
                >
                  {anchor.title}
                </Button>
              ))
            )}
          </div>
        )}
      </div>
      <div className="td-source-resume-canvas">
        <ResumeRichTextEditor
          ref={editorRef}
          ariaLabel="原始简历编辑区"
          docJson={canvas.doc_json as ResumeDocJson}
          onChange={onChange}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Replace iframe section in RevisionWorkspacePage**

Add imports:

```tsx
import type { ResumeEditorChange } from "../workspace/editor";
import { DraftCanvas } from "./DraftCanvas";
```

Add state near other `useState` calls:

```tsx
  const [localCanvasDocJson, setLocalCanvasDocJson] = useState<Record<string, unknown> | null>(null);
```

After `const workspace = state.workspace`, derive canvas:

```tsx
  const sourceCanvas = workspace.source_resume_canvas
    ? {
        ...workspace.source_resume_canvas,
        doc_json: localCanvasDocJson ?? workspace.source_resume_canvas.doc_json,
      }
    : undefined;
```

Add handler:

```tsx
  const handleCanvasChange = useCallback((change: ResumeEditorChange) => {
    setLocalCanvasDocJson(change.docJson as Record<string, unknown>);
  }, []);
```

Replace lines that currently render `workspace.render_projection?.html ? iframe : ModuleList` with:

```tsx
            {sourceCanvas ? (
              <DraftCanvas canvas={sourceCanvas} onChange={handleCanvasChange} />
            ) : (
              <div className="rounded-md border border-border bg-muted/30 p-4">
                <p className="text-sm font-medium">原始画布尚未生成</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  旧简历解析完成后会显示可编辑 A4 画布。
                </p>
              </div>
            )}
```

- [ ] **Step 5: Add focused CSS for module boundaries**

Append to `apps/web/src/styles.css`:

```css
.td-source-resume-canvas [data-module-id] {
  border-radius: 4px;
  transition:
    outline-color 120ms ease,
    background-color 120ms ease;
}

.td-source-resume-canvas [data-module-id]:hover {
  outline: 1px solid rgba(59, 130, 246, 0.45);
  background-color: rgba(59, 130, 246, 0.06);
}
```

- [ ] **Step 6: Run workspace tests**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add apps/web/src/features/revision/DraftCanvas.tsx apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx apps/web/src/styles.css
git commit -m "feat(workspace): 使用原始简历画布作为主编辑区"
```

---

### Task 7: Import Progress UX Without Long Ambiguous Spinner

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/api.test.ts`
- Modify: `apps/web/src/features/home/ImportOldResumeModal.tsx`
- Modify: `apps/web/src/features/home/ImportOldResumeModal.test.tsx`

- [ ] **Step 1: Write failing import progress test**

In `ImportOldResumeModal.test.tsx`, add:

```tsx
it("shows staged import progress while submitting", async () => {
  let resolveImport: (value: unknown) => void = () => {};
  apiMocks.importOldResume.mockImplementation(
    (_input, onProgress?: (step: string) => void) =>
      new Promise((resolve) => {
        resolveImport = resolve;
        onProgress?.("create_document");
        onProgress?.("save_source");
        onProgress?.("run_import");
      }),
  );

  renderModal();
  fireEvent.change(screen.getByLabelText("旧简历内容"), { target: { value: "张三" } });
  fireEvent.click(screen.getByRole("button", { name: "生成改稿工作台" }));

  expect(await screen.findByText("创建工作台")).toBeInTheDocument();
  expect(screen.getByText("保存旧简历")).toBeInTheDocument();
  expect(screen.getByText("解析原文、生成画布并识别模块")).toBeInTheDocument();

  resolveImport({
    document: { id: "doc_1" },
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/home/ImportOldResumeModal.test.tsx
```

Expected: FAIL because `importOldResume` has no progress callback and modal does not render stage text.

- [ ] **Step 3: Add progress callback to API helper**

In `apps/web/src/api.ts`, add:

```ts
export type ImportOldResumeProgressStep =
  | "create_document"
  | "save_source"
  | "run_import"
  | "load_workspace";
```

Change signature:

```ts
export async function importOldResume(
  input: ImportOldResumeInput,
  onProgress?: (step: ImportOldResumeProgressStep) => void,
): Promise<WorkspaceView> {
```

Call progress stages:

```ts
  onProgress?.("create_document");
  const document = await createRevisionDocument({
```

```ts
  onProgress?.("save_source");
  const source = input.file
```

```ts
  onProgress?.("run_import");
  await createRevisionRun(document.id, {
```

```ts
  onProgress?.("load_workspace");
  return getRevisionWorkspaceView(document.id);
```

- [ ] **Step 4: Render progress stages in modal**

In `ImportOldResumeModal.tsx`, import the progress type:

```ts
import { importOldResume, type ImportOldResumeProgressStep } from "@/api";
```

Add constants:

```ts
const IMPORT_PROGRESS_LABELS: Record<ImportOldResumeProgressStep, string> = {
  create_document: "创建工作台",
  save_source: "保存旧简历",
  run_import: "解析原文、生成画布并识别模块",
  load_workspace: "打开可编辑画布",
};
```

Add state:

```ts
  const [progressSteps, setProgressSteps] = useState<ImportOldResumeProgressStep[]>([]);
```

Reset in `useEffect`:

```ts
    setProgressSteps([]);
```

Add callback:

```ts
  function pushProgressStep(step: ImportOldResumeProgressStep) {
    setProgressSteps((steps) => (steps.includes(step) ? steps : [...steps, step]));
  }
```

Pass callback:

```ts
      const workspace = await importOldResume({
        title: title.trim() || "旧简历重构",
        ...(selectedFile ? { file: selectedFile } : { raw_text: rawText }),
      }, pushProgressStep);
```

Render before errors:

```tsx
          {submitting && progressSteps.length > 0 && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="mb-2 text-sm font-medium">正在准备可编辑工作台</p>
              <ol className="space-y-1 text-sm text-muted-foreground">
                {progressSteps.map((step) => (
                  <li key={step} className="flex items-center gap-2">
                    <span className="size-1.5 rounded-full bg-primary" />
                    {IMPORT_PROGRESS_LABELS[step]}
                  </li>
                ))}
              </ol>
            </div>
          )}
```

- [ ] **Step 5: Run import modal tests**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/home/ImportOldResumeModal.test.tsx src/api.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/src/api.ts apps/web/src/api.test.ts apps/web/src/features/home/ImportOldResumeModal.tsx apps/web/src/features/home/ImportOldResumeModal.test.tsx
git commit -m "feat(import): 展示旧简历导入阶段进度"
```

---

### Task 8: Verification and Documentation Alignment

**Files:**
- Modify: `docs/brainstorming/2026-05-28-source-resume-canvas-phase1.md`

- [ ] **Step 1: Run focused sidecar tests**

Run:

```powershell
corepack pnpm --filter @typedance/sidecar test -- services/sidecar/tests/test_revision_source_canvas.py services/sidecar/tests/test_revision_import_flow.py services/sidecar/tests/test_revision_blank_guided_flow.py services/sidecar/tests/test_revision_services.py services/sidecar/tests/test_revision_api.py
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx src/features/revision/RevisionWorkspacePage.test.tsx src/features/home/ImportOldResumeModal.test.tsx src/api.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run contract tests**

Run:

```powershell
corepack pnpm --filter @typedance/contracts test
```

Expected: PASS.

- [ ] **Step 4: Run build and lint required by repo UI changes**

Run:

```powershell
corepack pnpm --filter @typedance/web build
corepack pnpm --filter @typedance/web lint
```

Expected: PASS.

- [ ] **Step 5: Run full repo test if focused verification is green**

Run:

```powershell
corepack pnpm test
```

Expected: PASS.

- [ ] **Step 6: Update design doc with implementation notes**

Append to `docs/brainstorming/2026-05-28-source-resume-canvas-phase1.md`:

```md

## 实施备注

- 第一阶段实现后，Revision 工作台主编辑区读取 `WorkspaceView.source_resume_canvas.doc_json`。
- `render_projection` 仍保留给导出和后续正式草稿预览，不作为主编辑区数据源。
- 导入旧简历时前端显示阶段化进度；当前阶段不引入复杂事件流接口。
```

- [ ] **Step 7: Commit verification notes**

```powershell
git add docs/brainstorming/2026-05-28-source-resume-canvas-phase1.md
git commit -m "docs(brainstorming): 补充原始画布实施备注"
```

---

## 自审

**Spec coverage:** 本计划覆盖第一阶段设计中的原始数据转换层、`ResumeRichTextEditor` 主画布、模块边界、大纲跳转、直接编辑、知识库隔离、第二阶段标注预留、耗时任务阶段化反馈。

**Plan scan:** 本计划没有保留空白待填语或无代码的泛化步骤。每个修改步骤都给出了具体代码或精确命令。

**Type consistency:** TypeScript contract 使用 `SourceResumeCanvas`、`SourceResumeCanvasNode`、`ModuleAnchor`；Python 模型使用同名语义；前端读取 `workspace.source_resume_canvas`；TipTap attrs 使用 camelCase `canvasNodeId/sourceBlockId/moduleId`，DOM 属性使用 kebab-case `data-canvas-node-id/data-source-block-id/data-module-id`。
