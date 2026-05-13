# 简历编辑区重构方案

## 概述

重构简历编辑区，实现：A4 纸分页展示、模板样式所见即所得、拖拽排序、页边距可配置。

## 技术方案

### 依赖

| 包 | 版本 | 用途 | 许可证 |
|---|------|------|--------|
| `tiptap-pagination-plus` | ^3.1.0 | A4 分页 | MIT |
| `@tiptap/extension-drag-handle` | ^3.x | 拖拽核心 | MIT |
| `@tiptap/extension-drag-handle-react` | ^3.x | 拖拽 React 组件 | MIT |

所有包均为免费开源，无需 Tiptap Pro 订阅。

### 架构变更

```
WorkspacePage
├── 工具栏（不变）
├── 编辑区（改造）
│   ├── <style> 注入模板样式（改为映射到 HTML 元素）
│   └── ResumeRichTextEditor（新增 PaginationPlus + DragHandle）
└── RightPanel（不变）
```

### 组件改动清单

#### 1. `ResumeRichTextEditor.tsx`

**新增扩展：**
- `PaginationPlus.configure()` — 启用 A4 分页
  - `pageGap: 24` — 页间间距
  - `marginTop/Bottom/Left/Right` — 页边距（默认 A4 标准）
  - `contentMarginTop/Bottom` — 内容与页眉/页脚间距
  - `enabled: true` — 默认启用
- `DragHandle` 组件 + Page/Heading/Paragraph 节点标记 `draggable: true`

**注入模板 CSS：**
- 接收 `cssText` prop，注入到编辑区 `<style>`
- CSS 选择器映射为 HTML 元素（h1/h2/p/ul/ol），作用域限定在分页容器内的编辑器内容区

**Props 新增：**
- `cssText?: string` — 模板样式 CSS
- `marginConfig?: MarginConfig` — 页边距配置
- `onMarginChange?: (margins: MarginConfig) => void` — 边距变更回调

#### 2. `WorkspacePage.tsx`

- 移除旧的直接注入 `<style>{cssText}</style>`
- 改为传给 `ResumeRichTextEditor` 的 `cssText` prop
- 边距变更时调用 `updateMargins()` 命令

#### 3. 模板样式映射

复用 `TemplateDetail.tsx` 中的 `generateElementCSS()` 方法逻辑（已有代码），将 `.td-resume-{blockName}` 选择器映射到 TipTap 输出的 HTML 元素。

**需要改造：** 原函数 scope 写死为 `.td-template-editor-wrapper`，搬入工作台后改为 `generateWorkspaceCSS()`，scope 设为 `.rm-with-pagination .ProseMirror`，使其作用域与分页容器兼容。

```
heading1 → h1
heading2 → h2
heading3 → h3
paragraph → p
bulletList → ul, li
orderedList → ol, li
```

作用域限定在 `.rm-with-pagination .ProseMirror` 内部，避免与分页插件的 DOM 冲突。

### 数据流

```
StylePanel 调整块级样式
  → WorkspacePage 更新 styleConfig state
  → generateElementCSS() 生成元素映射 CSS
  → ResumeRichTextEditor 通过 prop 接收并注入 <style>

页边距控制（UI 位置待定：可放在 StylePanel 新增一节，或独立为一个简单控件）
  → WorkspacePage 调用 editor.commands.updateMargins()
  → tiptap-pagination-plus 更新 CSS 变量，页面自动重排
```

### 分页实施机制（tiptap-pagination-plus）

使用 ProseMirror Decoration 方案，不修改文档结构：
1. 通过 Decoration.widget 在文档位置 0 插入页面分隔 DOM
2. 每次内容变化后，通过 scrollHeight 测量总内容高度
3. 按 pageHeight - margins 计算所需页数
4. 插入/移除页面 spacer 元素
5. DragHandle 操作的仍然是平坦的 ProseMirror 文档，不受影响

### 拖拽实现

- DragHandle React 组件包裹编辑器内容
- 在 Paragraph、Heading 等节点上设置 `draggable: true`
- DragHandle 的 floating-ui 定位适配 A4 页面容器
- 拖拽重新排序段落：同页/跨页均可，分页插件在事务提交后自动重排

### 风险项

| 风险 | 缓解措施 |
|------|----------|
| 分页插件与现有 CSS 冲突 | 使用 `.rm-with-pagination` 作用域隔离 |
| 拖拽 handle 在分页容器中定位偏移 | DragHandle 使用 floating-ui，位置计算相对 viewport |
| 模板样式部分属性在 screen 和 print 渲染不一致 | 用 pt 单位，接受固有差异 |
| 分页插件页数计算在高频输入时抖动 | requestAnimationFrame 节流 |

### 不动的内容

- PDF 导出管道（完全独立，不受影响）
- StylePanel 组件逻辑
- RightPanel 组件
- AI Tab 组件
- API 层
- 后端 Python 代码
- 数据模型 / Zod Schema
