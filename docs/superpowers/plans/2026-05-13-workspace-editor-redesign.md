# 简历编辑区重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A4 分页展示 + 模板样式 WYSIWYG + 拖拽排序 + 页边距可配置

**Architecture:** 在现有 TipTap 编辑器上叠加 `tiptap-pagination-plus`（decoration 方案，不修改文档结构）和 `@tiptap/extension-drag-handle`。模板 CSS 通过 `generateWorkspaceCSS()` 映射到 HTML 元素，作用域限制在分页容器内。PDF 导出管道完全独立，不受影响。

**Tech Stack:** Tiptap v3, React 19, TailwindCSS 4

---

### Task 1: 安装依赖

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: 添加依赖**

```bash
cd apps/web
pnpm add tiptap-pagination-plus @tiptap/extension-drag-handle @tiptap/extension-drag-handle-react
```

- [ ] **Step 2: 验证安装**

```bash
pnpm ls --filter @typedance/web tiptap-pagination-plus @tiptap/extension-drag-handle @tiptap/extension-drag-handle-react
```

Expected: 三个包都在列表中，无错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml
git commit -m "deps: add tiptap-pagination-plus and drag-handle extensions"
```

---

### Task 2: 新增 generateWorkspaceCSS()

**Files:**
- Modify: `apps/web/src/features/templates/style-engine/css-generator.ts`
- Test: `apps/web/src/features/templates/style-engine/__tests__/css-generator.test.ts`（如存在，否则跳过）

从 `TemplateDetail.tsx` 的 `generateElementCSS()` 提取并改造为通用函数：

- [ ] **Step 1: 在 css-generator.ts 中新增函数**

在 `generateFullCSS` 函数之后追加：

```typescript
// 元素映射表：block type name → TipTap 输出的 HTML 元素
const ELEMENT_MAP: Record<string, string[]> = {
  heading1: ["h1"],
  heading2: ["h2"],
  heading3: ["h3"],
  paragraph: ["p"],
  bulletList: ["ul", "li"],
  orderedList: ["ol", "li"],
};

/**
 * 将模板样式 CSS 映射到 HTML 元素选择器，作用域限制在分页容器内。
 * 与 generateFullCSS() 不同，这里输出的是 h1/h2/p/ul/li 对应的 CSS，
 * 而非 .td-resume-{name} 类选择器。
 */
export function generateWorkspaceCSS(
  blocks: Record<string, BlockStyle>,
  scope = ".rm-with-pagination .ProseMirror",
): string {
  const rules: string[] = [];
  for (const [blockName, style] of Object.entries(blocks)) {
    const elements = ELEMENT_MAP[blockName];
    if (!elements) continue;

    const blockCSS = generateBlockCSS(blockName, style);
    if (!blockCSS) continue;

    const selectors = elements.map((el) => `${scope} ${el}`).join(", ");
    rules.push(blockCSS.replace(`.td-resume-${blockName}`, selectors));
  }
  return rules.join("\n\n");
}
```

- [ ] **Step 2: 更新 TemplateDetail.tsx 改为使用新函数**

在 `TemplateDetail.tsx` 中将内部 `generateElementCSS()` 替换为导入 `generateWorkspaceCSS()`：

```typescript
// 删除内部 generateElementCSS() 函数
// 在文件顶部导入
import { generateWorkspaceCSS } from "../style-engine/css-generator";

// 调用处改为
const elementCssText = generateWorkspaceCSS(
  styleConfig.blocks ?? {},
  ".td-template-editor-wrapper",
);
```

- [ ] **Step 3: 运行测试确认不破坏现有逻辑**

```bash
pnpm --filter @typedance/web test
```

Expected: 测试通过

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/templates/style-engine/css-generator.ts apps/web/src/features/templates/components/TemplateDetail.tsx
git commit -m "refactor: extract generateWorkspaceCSS from TemplateDetail to css-generator"
```

---

### Task 3: 改造 ResumeRichTextEditor — 接入分页 + 拖拽

**Files:**
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`

完整重写该文件：

```typescript
import { useEffect } from "react"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import type { JSONContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import DragHandle from "@tiptap/extension-drag-handle-react"
import { PaginationPlus, PAGE_SIZES } from "tiptap-pagination-plus"
import { Bold, Heading2, Italic, List, Pilcrow } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { ResumeDocJson, ResumeEditorChange } from "../editor"

type MarginConfig = {
  top: number
  bottom: number
  left: number
  right: number
}

type ResumeRichTextEditorProps = {
  ariaLabel: string
  docJson: ResumeDocJson
  onChange: (change: ResumeEditorChange) => void
  onSelectionUpdate?: (blockType: string) => void
  editable?: boolean
  cssText?: string
  marginConfig?: MarginConfig
  onMarginChange?: (margins: MarginConfig) => void
}

type ToolbarState = {
  isBold: boolean
  isItalic: boolean
  isHeading2: boolean
  isBulletList: boolean
}

const inactiveToolbarState: ToolbarState = {
  isBold: false,
  isItalic: false,
  isHeading2: false,
  isBulletList: false,
}

export function ResumeRichTextEditor({
  ariaLabel,
  docJson,
  onChange,
  onSelectionUpdate,
  editable = true,
  cssText = "",
  marginConfig,
}: ResumeRichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { draggable: true },
        paragraph: { draggable: true },
      }),
      PaginationPlus.configure({
        enabled: true,
        pageGap: 24,
        pageGapBorderSize: 1,
        pageGapBorderColor: "#e5e5e5",
        pageBreakBackground: "transparent",
        ...PAGE_SIZES.A4,
        marginTop: marginConfig?.top ?? 95,
        marginBottom: marginConfig?.bottom ?? 95,
        marginLeft: marginConfig?.left ?? 76,
        marginRight: marginConfig?.right ?? 76,
        contentMarginTop: 10,
        contentMarginBottom: 10,
      }),
    ],
    content: docJson as unknown as JSONContent,
    editable,
    editorProps: {
      attributes: {
        "aria-label": ariaLabel,
        class: "td-rich-editor-prosemirror",
      },
    },
    onUpdate: ({ editor }) => {
      onChange({
        plainText: editor.getText({ blockSeparator: "\n\n" }),
        docJson: editor.getJSON() as ResumeDocJson,
      })
    },
    onSelectionUpdate: ({ editor }) => {
      if (!onSelectionUpdate) return
      const { $from } = editor.state.selection
      const node = $from.parent
      if (node.type.name === "heading") {
        onSelectionUpdate(`heading${node.attrs.level}`)
      } else {
        onSelectionUpdate(node.type.name)
      }
    },
  })

  const toolbarState =
    useEditorState<ToolbarState>({
      editor,
      selector: ({ editor }) => {
        if (!editor) return inactiveToolbarState
        return {
          isBold: editor.isActive("bold"),
          isItalic: editor.isActive("italic"),
          isHeading2: editor.isActive("heading", { level: 2 }),
          isBulletList: editor.isActive("bulletList"),
        }
      },
    }) ?? inactiveToolbarState

  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    if (editor.isEditable !== editable) {
      editor.setEditable(editable)
    }
    const current = JSON.stringify(editor.getJSON())
    const next = JSON.stringify(docJson)
    if (current !== next) {
      editor.commands.setContent(docJson as unknown as JSONContent, { emitUpdate: false })
    }
  }, [docJson, editor, editable])

  return (
    <div className="td-rich-editor">
      {editable && (
        <div className="td-rich-editor-toolbar" role="toolbar" aria-label="简历格式工具栏">
          <Button
            type="button"
            variant={toolbarState.isBold ? "default" : "outline"}
            size="icon"
            aria-label="加粗"
            onClick={() => editor?.chain().focus().toggleBold().run()}
            disabled={!editor}
          >
            <Bold />
          </Button>
          <Button
            type="button"
            variant={toolbarState.isItalic ? "default" : "outline"}
            size="icon"
            aria-label="斜体"
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            disabled={!editor}
          >
            <Italic />
          </Button>
          <Button
            type="button"
            variant={toolbarState.isHeading2 ? "default" : "outline"}
            size="icon"
            aria-label="二级标题"
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            disabled={!editor}
          >
            <Heading2 />
          </Button>
          <Button
            type="button"
            variant={toolbarState.isBulletList ? "default" : "outline"}
            size="icon"
            aria-label="无序列表"
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            disabled={!editor}
          >
            <List />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="段落"
            onClick={() => editor?.chain().focus().setParagraph().run()}
            disabled={!editor}
          >
            <Pilcrow />
          </Button>
        </div>
      )}
      <style>{cssText}</style>
      <DragHandle editor={editor}>
        <div className="td-drag-handle" />
      </DragHandle>
      <div className="td-editor-print-wrapper">
        <EditorContent editor={editor} className="td-rich-editor-content" />
      </div>
    </div>
  )
}
```

- [ ] **Step 1: 重写 ResumeRichTextEditor.tsx** 替换为上述代码
- [ ] **Step 2: 验证 TypeScript 编译通过**

```bash
pnpm --filter @typedance/web build
```

Expected: 编译无错误

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx
git commit -m "feat: add pagination and drag-handle to rich text editor"
```

---

### Task 4: 改造 WorkspacePage — 传递 CSS 和边距

**Files:**
- Modify: `apps/web/src/features/workspace/WorkspacePage.tsx`

- [ ] **Step 1: 更新导入**

将：
```typescript
import { generateFullCSS } from "../templates/style-engine/css-generator"
```
改为：
```typescript
import { generateWorkspaceCSS } from "../templates/style-engine/css-generator"
```

- [ ] **Step 2: 修改 CSS 计算**

将：
```typescript
const cssText = useMemo(() => generateFullCSS(styleConfig.blocks ?? {}), [styleConfig])
```
改为：
```typescript
const cssText = useMemo(() => generateWorkspaceCSS(styleConfig.blocks ?? {}), [styleConfig])
```

- [ ] **Step 3: 修改 JSX 中的 style 注入**

移除旧的直接注入 `<style>{cssText}</style>`，同时更新 Editor 的 JSX：

将：
```tsx
<div className="flex-1 overflow-auto p-4">
  <style>{cssText}</style>
  <ResumeRichTextEditor
    ariaLabel="Resume editor"
    docJson={docJson}
    onChange={handleEditorChange}
    onSelectionUpdate={handleSelectionUpdate}
  />
</div>
```
改为：
```tsx
<div className="flex-1 overflow-auto bg-gray-50 p-8">
  <ResumeRichTextEditor
    ariaLabel="Resume editor"
    docJson={docJson}
    onChange={handleEditorChange}
    onSelectionUpdate={handleSelectionUpdate}
    cssText={cssText}
  />
</div>
```

- [ ] **Step 4: 验证编译**

```bash
pnpm --filter @typedance/web build
```

Expected: 编译无错误

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/workspace/WorkspacePage.tsx
git commit -m "feat: pass workspace CSS to editor, update wrapper layout"
```

---

### Task 5: 调整全局 CSS 样式

**Files:**
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: 更新编辑器相关样式**

找到 `.td-rich-editor-content` 和 `.td-rich-editor-prosemirror` 的 CSS 规则，调整以适应 A4 分页容器。

将：
```css
.td-rich-editor-content {
  display: flex;
  min-height: 0;
  flex: 1 1 auto;
}

.td-rich-editor-prosemirror {
  width: 100%;
  min-height: 260px;
  flex: 1 1 auto;
  overflow: auto;
  padding: 1.5rem 1.75rem;
  ...
}
```

改为：
```css
.td-rich-editor-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1 1 auto;
}

.td-rich-editor-prosemirror {
  width: 100%;
  min-height: 400px;
  flex: 1 1 auto;
  outline: none;
}

/* 拖拽 handle 样式 */
.td-drag-handle {
  width: 16px;
  height: 16px;
  background: transparent;
  cursor: grab;
  position: absolute;
  left: -24px;
  top: 50%;
  transform: translateY(-50%);
  opacity: 0;
  transition: opacity 0.15s;
  border-radius: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 鼠标悬停时显示 handle */
.td-rich-editor-prosemirror p:hover > .td-drag-handle,
.td-rich-editor-prosemirror h1:hover > .td-drag-handle,
.td-rich-editor-prosemirror h2:hover > .td-drag-handle,
.td-rich-editor-prosemirror h3:hover > .td-drag-handle {
  opacity: 1;
}
```

同时删除不再需要的 `.td-rich-editor-prosemirror` 中旧的 padding、overflow 规则（因为分页插件接管了布局）。

- [ ] **Step 2: 添加分页容器样式覆盖**

在 styles.css 底部追加：

```css
/* PaginationPlus 样式微调 */
.rm-with-pagination .ProseMirror {
  font-size: inherit;
  line-height: inherit;
}

.rm-with-pagination .page {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  margin-bottom: 4px;
}
```

- [ ] **Step 3: 验证编译**

```bash
pnpm --filter @typedance/web build
```

Expected: 编译无错误

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/styles.css
git commit -m "style: update editor styles for A4 pagination and drag handle"
```

---

### Task 6: 端到端验证

- [ ] **Step 1: 启动 dev server**

```bash
pnpm dev
```

Expected: Web (5173) + Sidecar (4317) 正常启动

- [ ] **Step 2: 功能验证清单**

手动验证以下场景：
1. 打开一个已有简历 → 编辑器以 A4 纸形式展示，样式与模板定义一致
2. 输入大量内容，超出第一页 → 自动出现第二页，有页间间距
3. 鼠标悬停在段落上 → 左侧出现拖拽 handle
4. 拖拽段落排序 → 段落移动，分页自动重新计算
5. 在 StylePanel 中调整样式 → 编辑器内容实时更新
6. 点击保存 → 成功保存 doc_json
7. 导出 PDF → PDF 与之前行为一致，不受影响

- [ ] **Step 3: 运行现有测试**

```bash
pnpm test
```

Expected: 全部测试通过

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: complete workspace editor redesign with A4 pagination"
```
