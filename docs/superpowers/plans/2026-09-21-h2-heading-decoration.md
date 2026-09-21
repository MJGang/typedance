# H2 标题款式与主题强调色实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有模板设置面板中增加主题强调色与三款 H2 标题款式，并让模板预览、工作台、HTML 与 PDF 使用一致的三段式 H2 DOM 和视觉结果。

**Architecture:** `@typedance/contracts` 定义严格的新配置模型，`@typedance/resume-renderer` 成为 TypeScript 侧唯一的模板 CSS 与静态 H2 渲染实现，TipTap 使用自定义 Heading NodeView 输出可编辑三段式 DOM，Python Sidecar 镜像相同语义并负责确定性 HTML/PDF 导出。项目尚未上线，直接清理开发期简历和主题数据，不增加旧 schema 迁移或运行时兼容层。

**Tech Stack:** TypeScript、React 19、TipTap 3.23.2、shadcn/ui（Maia）、Tailwind CSS、Zod 3、Vitest、Python 3.11+、FastAPI、Pydantic 2、Playwright/Chromium、SQLite、pytest。

**Spec:** `docs/superpowers/specs/2026-09-21-h2-heading-decoration-design.md`

## Global Constraints

- 文档、计划、提交说明默认使用中文；Git 提交遵循 `type(scope): subject`。
- 不保留旧模板字段、旧配置 fallback、双轨渲染或 legacy adapter。
- H2 装饰只允许 `minimal-line`、`accent-wash`、`dot-ribbon` 三种枚举。
- 经典 A4 默认强调色固定为 `#174EA6`，默认 H2 款式固定为 `minimal-line`。
- H2 块样式不得包含 `backgroundColor` 或 `borderBottom`；行内文字背景不在本次范围内。
- H2 必须输出 `prefix/content/suffix` 三个真实 span，不使用 `::before` 或 `::after` 生成装饰。
- `prefix`、`suffix` 必须为空、`aria-hidden="true"`，在编辑器中同时不可编辑；标题文字只存在于 `content`。
- Frontend 负责设置交互和 TipTap NodeView；Python Sidecar 负责业务数据、HTML/PDF 导出；Harness Core 与 TS Agent Host 不改动。
- 主题设置沿用当前 StylePanel：主题下拉框下增加强调色，H2 的“排版”前增加单列“标题款式”折叠项，其余信息架构不重做。
- `apps/web/components.json` 的 shadcn 样式必须保持 `radix-maia`；不得手写替换官方 `src/components/ui/*` 源码。
- 数据清理只删除 TypeDance 数据库中的开发期业务记录，不删除任何 ContextSource 指向的真实本地文件或目录。

## Review Focus

- H2 包含加粗、下划线、行内颜色或行内背景 mark 时，mark 必须只出现在 `content` 内，装饰节点不得复制文字。
- 用户把 H2 切换为段落、H1 或 H3，再切回 H2 时，光标、选区、撤销和 source canvas 属性必须保持正确。
- 三种强调色边界值 `#000000`、`#FFFFFF`、小写十六进制必须生成一致且合法的浅色，并在 TypeScript/Python 两侧得到相同结果。
- 标题换行、位于页尾或处于分栏中时，prefix/suffix 不得脱离标题，PDF 不得丢失背景、圆点或线条。
- 保存失败或 Sidecar 拒绝非法配置时，Frontend 必须保留未保存草稿并显示失败状态，不能静默恢复默认款式。

---

## 文件结构

### 新建文件

- `packages/resume-renderer/src/template-style.ts`：TypeScript 侧颜色混合、块 CSS、H2 装饰 CSS 和工作台作用域 CSS 的唯一实现。
- `apps/web/src/features/templates/components/style-panel/ThemeAccentColorControl.tsx`：现有主题选择器下方的主题强调色设置行。
- `apps/web/src/features/templates/components/style-panel/sections/HeadingDecorationSection.tsx`：H2 的 A/B/C 单列语义化单选列表。
- `apps/web/src/features/templates/components/style-panel/StylePanel.test.tsx`：主题色与 H2 面板行为测试。
- `apps/web/src/features/workspace/editor/ResumeHeading.ts`：TipTap Heading NodeView 与 DOM 同步工具。
- `apps/web/src/features/workspace/editor/ResumeHeading.test.ts`：Heading NodeView DOM、更新和编辑边界测试。
- `services/sidecar/tests/fixtures/heading2_styles.py`：Sidecar 测试共用的三款配置和固定 H2 文档样张。

### 修改文件

- `packages/contracts/src/legacy/template-style.ts`：严格主题、H2 专用 block schema 和导出类型。
- `packages/contracts/tests/contracts.test.ts`：新契约的正反例。
- `apps/web/src/features/templates/data.ts`、`style-engine/presets.ts`：内置主题的新默认值。
- `apps/web/src/features/templates/data.test.ts`、`theme-options.test.ts`、`templates.test.tsx`：更新 fixture 与默认值断言。
- `packages/resume-renderer/src/index.ts`：使用新样式生成器并输出三段式静态 H2。
- `packages/resume-renderer/tests/render.test.ts`：DOM、样式枚举和颜色混合测试。
- `apps/web/src/features/templates/style-engine/css-generator.ts`：删除；消费者改为使用 `@typedance/resume-renderer`。
- `apps/web/src/features/templates/style-engine/css-generator.test.ts`：删除；覆盖迁移到 renderer tests。
- `apps/web/src/features/templates/components/TemplateDetail.tsx`、`TemplatePreview.tsx`：改用共享 renderer API 并传完整配置。
- `apps/web/src/features/templates/components/TemplatePreview.test.tsx`：新配置和三段式 H2 断言。
- `apps/web/src/features/templates/components/style-panel/StylePanel.tsx`：插入主题色控件并更新完整配置。
- `apps/web/src/features/templates/components/style-panel/BlockStyleEditor.tsx`：H2 专用款式分组并隐藏块背景/边框。
- `apps/web/src/features/templates/components/style-panel/sections/ColorSection.tsx`：增加可关闭背景设置的明确属性。
- `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`：禁用 StarterKit 默认 Heading，接入 ResumeHeading 与当前 H2 款式。
- `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`：H2 编辑、复制、粘贴、撤销和等级切换回归。
- `apps/web/src/features/revision/DraftCanvas.tsx`、`DraftCanvas.test.tsx`：把完整模板配置传给 CSS 和编辑器 DOM。
- `apps/web/src/features/templates/components/TemplateSampleEditor.tsx`：样张编辑器显式接收并传递完整模板配置。
- `services/sidecar/src/typedance_sidecar/models.py`：严格主题与 H2 专用 Pydantic model。
- `services/sidecar/src/typedance_sidecar/style_renderer.py`：颜色混合和三款装饰 CSS。
- `services/sidecar/src/typedance_sidecar/pdf.py`：静态 H2 三段式 DOM，并让样式生成读取完整配置。
- `services/sidecar/tests/test_template_library.py`、`test_pdf_export.py`、`test_revision_export.py`：严格配置、HTML/PDF DOM 和导出回归。

## Task 1：收紧共享模板配置契约与内置默认数据

**Files:**
- Modify: `packages/contracts/src/legacy/template-style.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`
- Modify: `apps/web/src/features/templates/style-engine/presets.ts`
- Modify: `apps/web/src/features/templates/data.ts`
- Modify: `apps/web/src/features/templates/data.test.ts`
- Modify: `apps/web/src/features/templates/theme-options.test.ts`
- Modify: `apps/web/src/features/templates/templates.test.tsx`

**Interfaces:**
- Produces: `Heading2DecorationStyle`、`ThemeStyle`、`Heading2BlockStyle`、严格的 `TemplateStyleConfig`。
- Produces: `defaultClassicA4Style.theme.accentColor === "#174EA6"` 与 `blocks.heading2.decorationStyle === "minimal-line"`。
- Consumes: 现有 `blockStyleSchema` 的字体、文字颜色、间距和对齐字段。

- [ ] **Step 1：写契约失败测试**

在 `packages/contracts/tests/contracts.test.ts` 增加以下测试结构：

```ts
const validTemplateStyle = {
  template_id: "classic-a4",
  preset: "classic",
  theme: { accentColor: "#174EA6" },
  blocks: {
    heading1: {},
    heading2: { decorationStyle: "minimal-line", fontSize: "16px" },
    heading3: {},
    paragraph: {},
    bulletList: {},
    orderedList: {},
  },
  updated_at: "2026-09-21T00:00:00.000Z",
}

expect(templateStyleConfigSchema.parse(validTemplateStyle)).toEqual(validTemplateStyle)
expect(() => templateStyleConfigSchema.parse({ ...validTemplateStyle, theme: undefined })).toThrow()
expect(() => templateStyleConfigSchema.parse({
  ...validTemplateStyle,
  theme: { accentColor: "blue" },
})).toThrow()
expect(() => templateStyleConfigSchema.parse({
  ...validTemplateStyle,
  blocks: {
    ...validTemplateStyle.blocks,
    heading2: { decorationStyle: "unknown" },
  },
})).toThrow()
expect(() => templateStyleConfigSchema.parse({
  ...validTemplateStyle,
  blocks: {
    ...validTemplateStyle.blocks,
    heading2: { decorationStyle: "minimal-line", backgroundColor: "#ffffff" },
  },
})).toThrow()
```

- [ ] **Step 2：运行契约测试确认红灯**

Run: `pnpm --filter @typedance/contracts test -- contracts.test.ts`

Expected: FAIL，错误指出当前 schema 缺少 `theme`/`decorationStyle` 约束，且仍接受 H2 的旧背景字段。

- [ ] **Step 3：实现严格契约**

在 `template-style.ts` 中：

```ts
export const heading2DecorationStyleSchema = z.enum([
  "minimal-line",
  "accent-wash",
  "dot-ribbon",
])

export const themeStyleSchema = z.object({
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
}).strict()

export const heading2BlockStyleSchema = blockStyleSchema
  .omit({ backgroundColor: true, borderBottom: true })
  .extend({ decorationStyle: heading2DecorationStyleSchema })
  .strict()

export const templateBlocksSchema = z.object({
  heading1: blockStyleSchema,
  heading2: heading2BlockStyleSchema,
  heading3: blockStyleSchema,
  paragraph: blockStyleSchema,
  bulletList: blockStyleSchema,
  orderedList: blockStyleSchema,
}).strict()
```

把 `templateStyleConfigSchema` 改为必填 `theme` 与 `templateBlocksSchema`，并导出 `Heading2DecorationStyle`、`ThemeStyle`、`Heading2BlockStyle`。

- [ ] **Step 4：更新内置默认值和所有前端测试 fixture**

`CLASSIC_A4_PRESETS.classic.heading2` 增加：

```ts
decorationStyle: "minimal-line",
```

`defaultClassicA4Style` 增加：

```ts
theme: { accentColor: "#174EA6" },
```

所有测试 fixture 必须显式写出完整 `theme` 和六个 block；不得通过测试 helper 填充缺失字段来模拟运行时 fallback。

- [ ] **Step 5：运行契约与模板数据测试确认绿灯**

Run: `pnpm --filter @typedance/contracts test -- contracts.test.ts`

Expected: PASS。

Run: `pnpm --filter @typedance/web test -- data.test.ts theme-options.test.ts templates.test.tsx`

Expected: PASS。

- [ ] **Step 6：提交契约迭代**

```powershell
git add packages/contracts/src/legacy/template-style.ts packages/contracts/tests/contracts.test.ts apps/web/src/features/templates/style-engine/presets.ts apps/web/src/features/templates/data.ts apps/web/src/features/templates/data.test.ts apps/web/src/features/templates/theme-options.test.ts apps/web/src/features/templates/templates.test.tsx
git commit -m "feat(template): 收紧标题款式配置契约"
```

## Task 2：统一 TypeScript 模板样式生成与静态 H2 渲染

**Files:**
- Create: `packages/resume-renderer/src/template-style.ts`
- Modify: `packages/resume-renderer/src/index.ts`
- Modify: `packages/resume-renderer/tests/render.test.ts`
- Modify: `apps/web/src/features/templates/components/TemplatePreview.tsx`
- Modify: `apps/web/src/features/templates/components/TemplatePreview.test.tsx`
- Modify: `apps/web/src/features/templates/components/TemplateDetail.tsx`
- Delete: `apps/web/src/features/templates/style-engine/css-generator.ts`
- Delete: `apps/web/src/features/templates/style-engine/css-generator.test.ts`

**Interfaces:**
- Consumes: `TemplateStyleConfig`、`Heading2DecorationStyle`。
- Produces: `mixHexWithWhite(color: string, accentWeight?: number): string`。
- Produces: `generateTemplateCSS(config: TemplateStyleConfig): string`。
- Produces: `generateWorkspaceTemplateCSS(config: TemplateStyleConfig, scope?: string): string`。
- Produces: `renderStyledContentHtml(docJson: unknown, config: TemplateStyleConfig): string`。

- [ ] **Step 1：写颜色混合、CSS 和三段式 DOM 失败测试**

在 `packages/resume-renderer/tests/render.test.ts` 增加：

```ts
expect(mixHexWithWhite("#000000")).toBe("#e0e0e0")
expect(mixHexWithWhite("#FFFFFF")).toBe("#ffffff")
expect(mixHexWithWhite("#174ea6")).toBe("#e3eaf4")

const html = renderStyledContentHtml(h2Doc, styleConfig("dot-ribbon"))
expect(html).toContain('data-heading-style="dot-ribbon"')
expect(html).toContain('<span class="td-heading-prefix" aria-hidden="true"></span>')
expect(html).toContain('<span class="td-heading-content">教育经历</span>')
expect(html).toContain('<span class="td-heading-suffix" aria-hidden="true"></span>')
expect(html).not.toContain("::before")
expect(html).not.toContain("::after")
```

再分别断言三种枚举只改变 CSS 规则，不改变 H2 DOM 结构；包含 bold/underline/inlineStyle mark 时只在 `td-heading-content` 内出现。

增加包含超长 H2 和分栏 H2 的 fixture，断言生成的 H2 CSS 包含 `break-after: avoid` 与 `break-inside: avoid`，且三个 span 始终位于同一个 H2 内。

- [ ] **Step 2：运行 renderer 测试确认红灯**

Run: `pnpm --filter @typedance/resume-renderer test -- render.test.ts`

Expected: FAIL，缺少新函数、旧 H2 没有三个 span、旧 API 仍只接收 blocks。

- [ ] **Step 3：创建唯一 TypeScript 样式生成器**

`template-style.ts` 实现：

```ts
export const HEADING_PREFIX_CLASS = "td-heading-prefix"
export const HEADING_CONTENT_CLASS = "td-heading-content"
export const HEADING_SUFFIX_CLASS = "td-heading-suffix"

export function mixHexWithWhite(color: string, accentWeight = 0.12): string {
  const normalized = color.slice(1)
  const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
  return `#${channels
    .map((channel) => Math.round(channel * accentWeight + 255 * (1 - accentWeight)).toString(16).padStart(2, "0"))
    .join("")}`
}
```

`generateTemplateCSS` 先生成现有 block 规则，再为 H2 写入 `--td-heading-accent` 和 `--td-heading-accent-soft`，最后根据三种 `data-heading-style` 生成 prefix/content/suffix 规则。H2 公共规则包含 `break-after: avoid` 与 `break-inside: avoid`。所有装饰规则只选择真实 span，不生成伪元素。

`generateWorkspaceTemplateCSS` 使用同一底层规则，仅将根选择器映射到传入 scope 下的真实 `h1/h2/h3/p/ul/ol`。

- [ ] **Step 4：修改静态 renderer API 与 H2 输出**

将 API 改为：

```ts
export function renderStyledContentHtml(
  docJson: unknown,
  config: TemplateStyleConfig,
): string

export function renderStyledHtml(
  docJson: unknown,
  config: TemplateStyleConfig,
  lang: string,
): string
```

H2 分支输出：

```ts
return `<h2 class="td-resume-heading2" data-heading-style="${style}">`
  + `<span class="${HEADING_PREFIX_CLASS}" aria-hidden="true"></span>`
  + `<span class="${HEADING_CONTENT_CLASS}">${content}</span>`
  + `<span class="${HEADING_SUFFIX_CLASS}" aria-hidden="true"></span>`
  + `</h2>`
```

H1、H3 继续输出普通 heading 标签。删除 `index.ts` 中重复的 CSS generator，改为导入并重新导出 `template-style.ts` 的公共函数。

- [ ] **Step 5：迁移 Web 消费者并删除旧 generator**

- `TemplatePreview` 把完整 `styleConfig` 传给 `generateTemplateCSS` 和 `renderStyledContentHtml`。
- `TemplateDetail` 使用 `generateTemplateCSS(theme.styleConfig)` 与 `generateWorkspaceTemplateCSS(theme.styleConfig, ".td-template-editor-wrapper")`。
- 删除 Web 旧 generator 与其重复测试，确保全仓没有旧 import。

Run: `rg -n "style-engine/css-generator|generateFullCSS|generateWorkspaceCSS" apps packages`

Expected: 无旧 generator import；只保留新 API 名称。

- [ ] **Step 6：运行 renderer 与模板预览测试**

Run: `pnpm --filter @typedance/resume-renderer test -- render.test.ts`

Expected: PASS。

Run: `pnpm --filter @typedance/web test -- TemplatePreview.test.tsx`

Expected: PASS，H2 结构与 A/B/C CSS 断言通过。

- [ ] **Step 7：提交 renderer 迭代**

```powershell
git add packages/resume-renderer apps/web/src/features/templates/components/TemplatePreview.tsx apps/web/src/features/templates/components/TemplatePreview.test.tsx apps/web/src/features/templates/components/TemplateDetail.tsx apps/web/src/features/templates/style-engine/css-generator.ts apps/web/src/features/templates/style-engine/css-generator.test.ts
git commit -m "feat(renderer): 统一H2标题款式渲染"
```

## Task 3：在现有设置面板中增加主题色与单列 H2 款式

**Files:**
- Create: `apps/web/src/features/templates/components/style-panel/ThemeAccentColorControl.tsx`
- Create: `apps/web/src/features/templates/components/style-panel/sections/HeadingDecorationSection.tsx`
- Create: `apps/web/src/features/templates/components/style-panel/StylePanel.test.tsx`
- Modify: `apps/web/src/features/templates/components/style-panel/StylePanel.tsx`
- Modify: `apps/web/src/features/templates/components/style-panel/BlockStyleEditor.tsx`
- Modify: `apps/web/src/features/templates/components/style-panel/sections/ColorSection.tsx`

**Interfaces:**
- Consumes: `styleConfig.theme.accentColor`、`Heading2BlockStyle.decorationStyle`。
- Produces: `ThemeAccentColorControl({ value, onChange })`。
- Produces: `HeadingDecorationSection({ value, accentColor, onChange })`。
- Uses: 现有 `ColorPickerPopover`、`InspectorSection`、shadcn `RadioGroup`/`RadioGroupItem`。

- [ ] **Step 1：确认 shadcn 组件状态**

Run: `pnpm dlx shadcn@latest info --json`

Expected: `style` 为 `radix-maia`，组件清单包含 `radio-group`。如果缺失，先运行 `pnpm dlx shadcn@latest add radio-group --dry-run` 检查影响，再运行 `pnpm dlx shadcn@latest add radio-group --yes`；不得手写 `src/components/ui/radio-group.tsx`。

- [ ] **Step 2：写设置面板失败测试**

`StylePanel.test.tsx` 覆盖：

```tsx
render(<StylePanel styleConfig={config} activeBlock="heading2" {...callbacks} />)
expect(screen.getByText("主题强调色")).toBeInTheDocument()
expect(screen.getByRole("radio", { name: /极简底线/ })).toBeChecked()
expect(screen.getByRole("radio", { name: /左线底纹/ })).toBeInTheDocument()
expect(screen.getByRole("radio", { name: /圆点短纹/ })).toBeInTheDocument()
expect(screen.queryByLabelText("背景颜色")).not.toBeInTheDocument()
expect(screen.queryByText("边框")).not.toBeInTheDocument()
```

再验证 `activeBlock="paragraph"` 时不显示标题款式，但仍显示原背景和边框能力；点击主题色/款式后 `onChange` 收到完整新配置且 `preset` 清空。

在 `templates.test.tsx` 让 `saveTemplateStyle` 拒绝请求，断言页面保留刚选择的主题色和 H2 款式、继续显示未保存状态，并显示保存失败信息。

- [ ] **Step 3：运行设置面板测试确认红灯**

Run: `pnpm --filter @typedance/web test -- StylePanel.test.tsx`

Expected: FAIL，缺少主题色和标题款式控件。

- [ ] **Step 4：实现主题强调色设置行**

`ThemeAccentColorControl` 沿用现有密度：标签、颜色块、十六进制值和 `ColorPickerPopover`。回调签名固定为：

```ts
type Props = {
  value: string
  onChange: (accentColor: string) => void
}
```

`StylePanel` 在 `ThemeSelector` 下方插入该控件，并通过：

```ts
onChange({
  ...styleConfig,
  preset: "",
  theme: { ...styleConfig.theme, accentColor },
})
```

更新完整配置。

- [ ] **Step 5：实现 H2 单列款式分组**

`HeadingDecorationSection` 使用 `RadioGroup`，三个 `RadioGroupItem` 每个对应一整行：宽预览、名称、说明、单选状态。缩略预览必须用真实的三个 span：

```tsx
<h2 data-heading-style={option.value}>
  <span className="td-heading-prefix" aria-hidden="true" />
  <span className="td-heading-content">教育经历</span>
  <span className="td-heading-suffix" aria-hidden="true" />
</h2>
```

使用共享 `generateTemplateCSS` 或与正式预览相同的类名，不单独复制另一套装饰几何参数。

- [ ] **Step 6：限制 H2 背景与边框**

`ColorSection` 增加明确属性：

```ts
type Props = {
  value: BlockStyle
  onChange: (value: BlockStyle) => void
  showBackground?: boolean
}
```

默认 `true`。`BlockStyleEditor` 在 H2 分支中按以下顺序渲染：标题款式、排版、颜色与背景（`showBackground={false}`）、间距、对齐；不渲染 `BorderSection`。其他 block 保持原顺序和能力。

- [ ] **Step 7：运行设置面板与现有模板测试**

Run: `pnpm --filter @typedance/web test -- StylePanel.test.tsx templates.test.tsx TemplatePreview.test.tsx`

Expected: PASS。

Run: `pnpm dlx shadcn@latest info --json`

Expected: `style` 仍为 `radix-maia`。

- [ ] **Step 8：提交面板迭代**

```powershell
git add apps/web/src/features/templates/components/style-panel apps/web/src/components/ui/radio-group.tsx apps/web/components.json
git commit -m "feat(template): 增加主题色与H2款式选择"
```

只暂存实际发生变化的 shadcn 文件；如果 `radio-group` 已存在且未变化，不得把它重复加入提交。

## Task 4：为 TipTap 接入可编辑三段式 Heading NodeView

**Files:**
- Create: `apps/web/src/features/workspace/editor/ResumeHeading.ts`
- Create: `apps/web/src/features/workspace/editor/ResumeHeading.test.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx`
- Modify: `apps/web/src/features/revision/DraftCanvas.tsx`
- Modify: `apps/web/src/features/revision/DraftCanvas.test.tsx`
- Modify: `apps/web/src/features/templates/components/TemplateSampleEditor.tsx`

**Interfaces:**
- Consumes: `Heading2DecorationStyle`、完整 `TemplateStyleConfig`。
- Produces: `createResumeHeading(getHeading2Style: () => Heading2DecorationStyle)`。
- Produces: `syncHeading2DecorationDom(editor: Editor, style: Heading2DecorationStyle): void`。
- `ResumeRichTextEditor` 新增必填属性 `templateStyle: TemplateStyleConfig`，调用方不得传缺省兼容值。

- [ ] **Step 1：添加直接 Heading 依赖并确认版本一致**

Run: `pnpm --filter @typedance/web add @tiptap/extension-heading@3.23.2`

Expected: `apps/web/package.json` 增加精确版本 `3.23.2`，lockfile 不升级其他 TipTap 包。

- [ ] **Step 2：写 NodeView 失败测试**

`ResumeHeading.test.ts` 构造 level 2 node 并断言：

```ts
expect(dom.tagName).toBe("H2")
expect(dom.dataset.headingStyle).toBe("accent-wash")
expect(prefix.className).toBe("td-heading-prefix")
expect(prefix.contentEditable).toBe("false")
expect(content.className).toBe("td-heading-content")
expect(contentDOM).toBe(content)
expect(suffix.className).toBe("td-heading-suffix")
expect(suffix.contentEditable).toBe("false")
```

验证 level 1/3 仍使用普通 `h1/h3`，level 改变时 NodeView `update` 返回 `false` 触发重建。

- [ ] **Step 3：运行 NodeView 测试确认红灯**

Run: `pnpm --filter @typedance/web test -- ResumeHeading.test.ts`

Expected: FAIL，模块尚不存在。

- [ ] **Step 4：实现 ResumeHeading**

用 `Heading.extend` 保留现有 heading schema、命令和 Markdown 行为。`addNodeView` 对 H2 创建：

```ts
const dom = document.createElement("h2")
dom.className = "td-resume-heading2"
dom.dataset.headingStyle = getHeading2Style()

const prefix = document.createElement("span")
prefix.className = "td-heading-prefix"
prefix.setAttribute("aria-hidden", "true")
prefix.contentEditable = "false"

const contentDOM = document.createElement("span")
contentDOM.className = "td-heading-content"

const suffix = document.createElement("span")
suffix.className = "td-heading-suffix"
suffix.setAttribute("aria-hidden", "true")
suffix.contentEditable = "false"

dom.append(prefix, contentDOM, suffix)
return { dom, contentDOM, update }
```

`syncHeading2DecorationDom` 只更新 `.td-resume-heading2` 的 `data-heading-style`，不改 doc JSON 或选区。

- [ ] **Step 5：接入 ResumeRichTextEditor**

- 将 `StarterKit` 改为 `StarterKit.configure({ heading: false })`。
- 用 `useRef` 保存最新 `templateStyle.blocks.heading2.decorationStyle`，创建 ResumeHeading 时传 getter。
- 在主题变化 effect 和编辑器 `onCreate`/`onUpdate` 后调用 `syncHeading2DecorationDom`，保证已有和新建 H2 都更新 data attribute。
- `cssText` 改由调用方使用共享 `generateWorkspaceTemplateCSS` 生成；编辑器不复制款式 CSS。
- `DraftCanvas`、`TemplateDetail` 与 `TemplateSampleEditor` 显式传入完整 `templateStyle`；所有直接渲染 `ResumeRichTextEditor` 的测试也传入 `defaultClassicA4Style`，不得把属性改为可选或在组件内部补默认值。

- [ ] **Step 6：补齐编辑行为回归测试**

在 `ResumeRichTextEditor.toolbar.test.tsx` 覆盖：

- H2 的 `doc_json` 仍只有 Heading 和文字，不包含 prefix/suffix。
- 输入文字只进入 content span。
- 加粗、下划线、行内颜色和行内背景 mark 保留。
- 复制得到纯标题文字，不含装饰文字。
- 粘贴 Markdown、撤销、H2→段落→H2 正常。
- source canvas 的 `canvasNodeId/sourceBlockId/moduleId` 在切换等级后保留。

在 `DraftCanvas.test.tsx` 验证主题从 A 切到 B 时不重建或丢失画布内容，并更新所有 H2 的 `data-heading-style`。

- [ ] **Step 7：运行编辑器和画布测试**

Run: `pnpm --filter @typedance/web test -- ResumeHeading.test.ts ResumeRichTextEditor.toolbar.test.tsx DraftCanvas.test.tsx`

Expected: PASS。

- [ ] **Step 8：提交编辑器迭代**

```powershell
git add apps/web/package.json pnpm-lock.yaml apps/web/src/features/workspace/editor apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx apps/web/src/features/workspace/components/ResumeRichTextEditor.toolbar.test.tsx apps/web/src/features/revision/DraftCanvas.tsx apps/web/src/features/revision/DraftCanvas.test.tsx apps/web/src/features/templates/components/TemplateSampleEditor.tsx
git commit -m "feat(editor): 支持H2三段式可编辑结构"
```

## Task 5：让 Python Sidecar 严格校验并渲染相同 H2

**Files:**
- Create: `services/sidecar/tests/fixtures/heading2_styles.py`
- Modify: `services/sidecar/src/typedance_sidecar/models.py`
- Modify: `services/sidecar/src/typedance_sidecar/style_renderer.py`
- Modify: `services/sidecar/src/typedance_sidecar/pdf.py`
- Modify: `services/sidecar/tests/test_template_library.py`
- Modify: `services/sidecar/tests/test_pdf_export.py`
- Modify: `services/sidecar/tests/test_revision_export.py`

**Interfaces:**
- Produces: `Heading2DecorationStyle = Literal[...]`、`ThemeStyle`、`Heading2BlockStyle`。
- Produces: `mix_hex_with_white(color: str, accent_weight: float = 0.12) -> str`。
- Produces: `generate_template_css(config: TemplateStyleConfig) -> str`。
- Consumes: Task 1 确定的完整 JSON 契约与 Task 2 的类名/data attribute。

- [ ] **Step 1：写 Sidecar 严格模型失败测试**

在 `test_template_library.py` 增加合法 round-trip，并提交以下非法 payload：缺少 `theme`、非法颜色、未知款式、H2 包含 `backgroundColor`、H2 包含 `borderBottom`。每个请求都必须返回 422。

- [ ] **Step 2：写 Python DOM/CSS 失败测试**

在 `test_pdf_export.py` 对三种固定 fixture 断言：

```python
assert 'data-heading-style="dot-ribbon"' in html
assert '<span class="td-heading-prefix" aria-hidden="true"></span>' in html
assert '<span class="td-heading-content">教育经历</span>' in html
assert '<span class="td-heading-suffix" aria-hidden="true"></span>' in html
assert "::before" not in html
assert "::after" not in html
assert mix_hex_with_white("#174ea6") == "#e3eaf4"
```

包含 marks 的 H2 必须把 `<strong>`、`<u>` 和 inline style span 放在 content span 内。

增加超长标题、页尾标题和分栏标题 fixture，断言 H2 三段结构没有被拆散，CSS 包含 `break-after: avoid` 与 `break-inside: avoid`，并由真实 PDF 视觉检查覆盖最终分页表现。

- [ ] **Step 3：运行 Sidecar 目标测试确认红灯**

Run: `python -m pytest services/sidecar/tests/test_template_library.py services/sidecar/tests/test_pdf_export.py services/sidecar/tests/test_revision_export.py -q`

Expected: FAIL，Pydantic 仍接受旧结构，HTML 尚无三段式 H2。

- [ ] **Step 4：实现严格 Pydantic 模型**

使用 `ConfigDict(populate_by_name=True, extra="forbid")`，拆分：

```python
Heading2DecorationStyle = Literal["minimal-line", "accent-wash", "dot-ribbon"]

class ThemeStyle(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accent_color: str = Field(alias="accentColor", pattern=r"^#[0-9A-Fa-f]{6}$")

class Heading2BlockStyle(BlockStyle):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")
    decoration_style: Heading2DecorationStyle = Field(alias="decorationStyle")
```

`Heading2BlockStyle` 不继承含 `background_color`/`border_bottom` 的模型；抽取共享文字字段基类，再分别组合普通 BlockStyle 与 Heading2BlockStyle。`TemplateStyleConfig.blocks` 使用严格的专用 `TemplateBlocks`，不再是任意字符串 dict。

- [ ] **Step 5：实现 Python 样式和 H2 DOM**

- `mix_hex_with_white` 与 TypeScript 使用相同取整公式。
- `generate_template_css` 接收完整配置并为 H2 写入强调色、浅色和三款 span 规则。
- `_render_block` 接收当前模板配置或 H2 款式参数；level 2 输出三段式 DOM，level 1/3 保持普通 heading。
- `_render_doc_body`、`render_resume_html` 把完整配置传入 block 渲染和 CSS 生成。
- HTML/PDF 继续共用 `render_resume_html`，保持 `print_background=True`。

- [ ] **Step 6：运行 Sidecar 目标测试确认绿灯**

Run: `python -m pytest services/sidecar/tests/test_template_library.py services/sidecar/tests/test_pdf_export.py services/sidecar/tests/test_revision_export.py -q`

Expected: PASS。

- [ ] **Step 7：提交 Sidecar 迭代**

```powershell
git add services/sidecar/src/typedance_sidecar/models.py services/sidecar/src/typedance_sidecar/style_renderer.py services/sidecar/src/typedance_sidecar/pdf.py services/sidecar/tests/fixtures/heading2_styles.py services/sidecar/tests/test_template_library.py services/sidecar/tests/test_pdf_export.py services/sidecar/tests/test_revision_export.py
git commit -m "feat(pdf): 对齐H2标题款式导出"
```

## Task 6：清理开发数据并验证新旧边界

**Files:**
- No repository file changes expected。
- Data target: `%USERPROFILE%\.typedance\typedance.sqlite`，除非 `TYPEDANCE_DATA_DIR` 明确覆盖。

**Interfaces:**
- Consumes: 新 Pydantic schema 与当前 SQLite 表清单。
- Produces: 不含旧简历、草稿、画布、导出、模板样张或模板样式记录的开发数据库。
- Preserves: `app_settings` 和用户机器上的真实文件/目录。

- [ ] **Step 1：只读解析精确数据库路径与表清单**

Run: `python -c "from typedance_sidecar.main import app_data_dir; print((app_data_dir() / 'typedance.sqlite').resolve())"`，工作目录设为 `services/sidecar` 或设置 `PYTHONPATH=src`。

Run: 使用 SQLite 只读连接查询 `sqlite_master` 和各业务表行数。

Expected: 输出一个位于用户 `.typedance` 或显式 `TYPEDANCE_DATA_DIR` 下的绝对文件路径；不得是工作区根目录、用户主目录或磁盘根目录。

- [ ] **Step 2：确认删除集合不包含 app_settings**

固定删除白名单和顺序为：`revision_actions`、`revision_proposals`、`revision_issues`、`user_confirmations`、`evidence_links`、`document_claims`、`document_modules`、`render_projections`、`export_artifacts`、`draft_versions`、`parsed_blocks`、`source_documents`、`source_resume_canvases`、`context_sources`、`documents`、`resume_versions`、`template_samples`、`template_styles`。明确排除 `app_settings`。

只执行 SQL `DELETE`，不删除数据库文件，不删除 `.typedance/files/sources` 或任意用户本地路径。

- [ ] **Step 3：在单一事务中清理并验证**

通过 Python `sqlite3` 连接精确数据库文件：

```python
connection.execute("BEGIN IMMEDIATE")
for table in ordered_business_tables:
    connection.execute(f'DELETE FROM "{table}"')
connection.commit()
```

表名必须来自代码内固定白名单，不允许从环境输入拼接。执行后重新查询行数：业务表均为 0，`app_settings` 行数与清理前一致。

- [ ] **Step 4：验证新配置拒绝旧数据**

Run: `python -m pytest services/sidecar/tests/test_template_library.py -q`

Expected: PASS，缺少新字段的 payload 返回 422；仓库中不存在迁移器或 fallback。

Run: `rg -n "legacy|fallback|decorationStyle.*default|accentColor.*default" apps/web packages services/sidecar/src`

Expected: 不存在为旧模板配置保留的运行时兼容分支；通用未知节点 fallback 不属于模板配置兼容，需人工区分。

## Task 7：全量验证、PDF 视觉检查与收尾提交

**Files:**
- Modify only if verification exposes defects。
- Generated artifacts: `artifacts/h2-heading-styles/`，不提交 PDF/PNG，除非仓库已有同类可重复视觉基线约定。

**Interfaces:**
- Consumes: Tasks 1-6 的完整实现。
- Produces: 测试、构建、真实 HTML/PDF 与视觉检查证据。

- [ ] **Step 1：运行全量 TypeScript 测试**

Run: `pnpm --filter @typedance/contracts test`

Expected: PASS，0 failed。

Run: `pnpm --filter @typedance/resume-renderer test`

Expected: PASS，0 failed。

Run: `pnpm --filter @typedance/web test`

Expected: PASS，0 failed。

- [ ] **Step 2：运行 Sidecar 全量测试**

Run: `python -m pytest services/sidecar/tests -q`

Expected: PASS，0 failed。

- [ ] **Step 3：运行 lint 与生产构建**

Run: `pnpm --filter @typedance/web lint`

Expected: exit 0。

Run: `pnpm --filter @typedance/contracts build`

Expected: exit 0。

Run: `pnpm --filter @typedance/resume-renderer build`

Expected: exit 0。

Run: `pnpm --filter @typedance/web build`

Expected: exit 0。

- [ ] **Step 4：核对 shadcn 与无伪元素约束**

Run: `pnpm dlx shadcn@latest info --json`

Expected: `style` 为 `radix-maia`。

Run: `rg -n "td-heading-(prefix|suffix).*::|::(before|after).*td-heading" apps packages services`

Expected: 无匹配。

- [ ] **Step 5：生成三款真实 HTML/PDF**

使用固定 H2 样张分别创建 `minimal-line`、`accent-wash`、`dot-ribbon` 三份完整 `TemplateStyleConfig`，调用 Sidecar `render_resume_html` 与 `render_and_export_pdf` 输出到 `artifacts/h2-heading-styles/`。

每份 HTML 通过脚本断言：

- 三个 span 各出现一次；
- `data-heading-style` 与当前款式一致；
- 强调色和派生浅色存在；
- 不包含 H2 装饰伪元素；
- 标题 marks 位于 content 内。

- [ ] **Step 6：渲染并目视检查 PDF**

使用 Poppler `pdftoppm -png -r 144` 把三份 PDF 首屏渲染为 PNG，逐张检查：

- A 的底线长度和标题间距；
- B 的左线、渐变底纹和文字层级；
- C 的圆点、短底纹和换行；
- 背景在 PDF 中未丢失；
- 三款标题与后续正文没有重叠；
- 分页和分栏样张中装饰没有脱离 H2。

若视觉问题需要代码修复，先增加能够复现的结构或样式测试，再修改并重复 Steps 1-6。

- [ ] **Step 7：检查最终差异与提交状态**

Run: `git diff --check`

Expected: 无输出，exit 0。

Run: `git status --short`

Expected: 只允许 `.superpowers/` 浏览器讨论稿保持未跟踪；产品代码和测试均已提交。

Run: `git log --oneline -8`

Expected: 包含本计划列出的四个功能提交和设计/计划文档提交。

任何验证失败都必须回到拥有该代码的任务，先补充失败测试、完成修正并使用该任务列出的精确文件清单提交，再重新执行 Task 7。不得把 `.superpowers/` 或 `artifacts/h2-heading-styles/` 加入提交。
