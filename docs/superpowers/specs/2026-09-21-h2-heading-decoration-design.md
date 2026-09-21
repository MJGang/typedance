# H2 标题款式与主题强调色设计

## 背景

模板设置当前支持标题 1、标题 2、标题 3、正文和列表的字体、颜色、间距、对齐与边框配置，但这些能力只能组合基础 CSS 属性，无法稳定表达“左线底纹”“圆点短纹”等成套标题设计。

本次设计为 H2 提供少量经过设计的完整款式，并增加模板级主题强调色。目标是让用户在不理解 CSS 的情况下选择克制、专业的简历标题样式，同时保证模板编辑预览、简历工作台、模板卡片、HTML 导出和 PDF 导出结果一致。

项目尚未上线，现有数据均为开发期数据。本次直接切换到新的唯一数据模型，不提供旧字段、旧配置或旧渲染行为的运行时兼容。

## 目标

- 在现有模板设置面板中增加“主题强调色”，作为 H2 装饰色的唯一来源。
- 为 H2 提供三款固定的完整样式：极简底线、左线底纹、圆点短纹。
- 保留 H2 的字体、字号、字重、文字颜色、间距和对齐能力。
- 由款式接管 H2 的背景和边框，禁止用户继续自由组合会破坏设计的底层属性。
- 所有 H2 渲染出口使用统一的 `prefix/content/suffix` 三段式 DOM，不使用 `::before` 或 `::after` 生成装饰。
- 保证编辑、预览、HTML 和 PDF 中的结构、颜色和几何关系一致。

## 非目标

- 本期不为 H1、H3、正文或列表增加装饰款式。
- 本期不让用户自由组合圆点、左线、底纹、圆角或线条尺寸。
- 本期不让 A、B、C 分别保存独立颜色；三款统一跟随模板主题强调色。
- 本期不把主题强调色扩展到 H1、分隔线、列表标记等其他元素。
- 本期不调整简历正文中用户手动添加的行内文字颜色或行内背景色；本设计限制的是模板级 H2 块背景。
- 本期不增加自定义 CSS、任意 HTML 或用户自定义款式能力。
- 本期不保留已有开发期简历和主题数据，也不实现历史数据迁移或运行时 fallback。
- 本期不涉及 Harness Core、TS Agent Host、插件或 AI 编排。

## 方案选择

### 方案 A：保存固定款式枚举，由渲染器生成 DOM 与 CSS

配置只保存主题强调色和 H2 款式枚举。系统内置三款样式的 DOM 语义与几何参数，用户只能选择款式和调整仍被允许的文字属性。

优点是配置稳定、设置简单、容易校验，能够约束视觉质量；缺点是新增款式必须发版，并要求 TypeScript 与 Python 渲染实现保持一致。

### 方案 B：保存可自由组合的装饰参数

配置暴露前缀类型、后缀类型、背景、线宽、圆角、定位和尺寸等属性。

虽然自由度高，但会增加面板复杂度，允许组合出不适合简历的样式，也会显著扩大跨渲染器测试矩阵。

### 方案 C：保存自定义 HTML 或 CSS

将款式直接保存为 HTML/CSS 片段。

这种方案难以保证安全、可访问性、编辑器行为和 PDF 稳定性，也会破坏结构化配置边界。

本次采用方案 A。

## H2 内置款式

### A：极简底线 `minimal-line`

- 标题文字保持正常排版。
- `suffix` 在标题底部绘制一条横向强调线。
- `prefix` 保留为空的结构节点，但不显示。
- 作为经典 A4 和新建主题的默认款式。

### B：左线底纹 `accent-wash`

- `prefix` 绘制左侧竖向强调线。
- `suffix` 绘制从左向右逐渐变淡的浅色底纹。
- `content` 位于底纹之上。

### C：圆点短纹 `dot-ribbon`

- `prefix` 绘制标题左侧圆点。
- `suffix` 绘制标题下方的短条浅色底纹。
- `content` 位于短底纹之上。

三款样式的线宽、圆点尺寸、圆角、内边距和底纹比例由系统固定，不进入用户配置。

## 设置面板

本次只在现有面板结构上增加两处内容，不增加新的侧栏、顶层标签页或设置模式。

### 主题强调色

在现有主题下拉框下方增加“主题强调色”设置行：

- 左侧显示标签“主题强调色”。
- 右侧显示颜色块和十六进制颜色值。
- 点击后复用现有颜色选择器。
- 修改后立即更新演示简历，并进入现有“未保存修改”状态。

### 标题款式

当“段落样式”选中“标题2”时，在现有“排版”分组之前增加“标题款式”折叠项：

- 折叠摘要显示当前款式名称。
- 展开后按单列显示三项，每项独占一行。
- 每行左侧显示足够宽的真实比例预览，中间显示名称与简短说明，右侧显示单选状态。
- 切换款式后立即更新演示简历，并进入现有“未保存修改”状态。
- 该折叠项只在 H2 下显示。

### 现有控件调整

H2 选择固定款式后：

- “颜色与背景”仅保留文字颜色，隐藏背景颜色设置。
- 隐藏“边框”分组。
- “排版”“间距”“对齐”保持现有能力。
- H1、H3、正文和列表的现有面板行为不变。

### 重置

重置内置主题时同时恢复：

- 主题强调色；
- H2 款式；
- H2 与其他块的原有文字样式。

经典 A4 的默认强调色为 `#174EA6`，默认 H2 款式为 `minimal-line`。

## 配置模型

TypeScript 契约采用明确的 H2 专用结构，不把 H2 款式字段加入所有 `BlockStyle`：

```ts
const heading2DecorationStyleSchema = z.enum([
  "minimal-line",
  "accent-wash",
  "dot-ribbon",
])

const themeStyleSchema = z.object({
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
})

const heading2BlockStyleSchema = blockStyleSchema
  .omit({ backgroundColor: true, borderBottom: true })
  .extend({
    decorationStyle: heading2DecorationStyleSchema,
  })
  .strict()

const templateStyleConfigSchema = z.object({
  template_id: z.string().min(1),
  name: z.string().optional(),
  preset: z.string(),
  theme: themeStyleSchema,
  blocks: z.object({
    heading1: blockStyleSchema,
    heading2: heading2BlockStyleSchema,
    heading3: blockStyleSchema,
    paragraph: blockStyleSchema,
    bulletList: blockStyleSchema,
    orderedList: blockStyleSchema,
  }),
  updated_at: isoDateTimeSchema,
})
```

Python Sidecar 使用对应的 Pydantic 枚举和专用 H2 model。`theme`、`accentColor` 和 `decorationStyle` 均为必填字段；读取、保存和渲染代码不提供缺省兼容值。

TypeScript 的 H2 schema 使用严格对象校验，Python 的 H2 Pydantic model 使用 `extra="forbid"`。因此旧的块背景、块边框和其他未知字段会直接触发契约错误，而不是被静默忽略。

配置只保存原始强调色。浅色底纹由渲染器使用固定的颜色混合算法生成，当前规则为将强调色以 12% 不透明度与白色混合，并输出确定的十六进制颜色。TypeScript 与 Python 必须通过相同测试向量验证混合结果。

## DOM 合同

所有 H2 渲染出口输出相同结构：

```html
<h2
  class="td-resume-heading2"
  data-heading-style="accent-wash"
>
  <span
    class="td-heading-prefix"
    aria-hidden="true"
    contenteditable="false"
  ></span>
  <span class="td-heading-content">教育经历</span>
  <span
    class="td-heading-suffix"
    aria-hidden="true"
    contenteditable="false"
  ></span>
</h2>
```

规则如下：

- `content` 是唯一承载标题文字和行内 mark 的节点。
- `prefix`、`suffix` 必须为空，使用 CSS 尺寸、背景和边框表达装饰。
- 装饰节点设置 `aria-hidden="true"`，在编辑器 NodeView 中同时设置 `contentEditable=false`。
- 不把三个 span 写入 `doc_json`；文档模型仍然只保存普通 Heading 节点与标题内容。
- 优先使用 `inline-flex`、grid 和正常文档流；只有底纹叠层需要使用定位。
- H2 自身负责统一的相对定位和层叠上下文，`content` 位于装饰层之上。

TipTap 编辑器通过自定义 Heading NodeView 提供 `contentDOM`，而不是把装饰 span 当作可编辑内容。该实现遵循 TipTap NodeView 对不可编辑标签和可编辑内容容器的约束：[TipTap NodeView 官方说明](https://github.com/ueberdosis/tiptap-docs/blob/main/src/content/editor/extensions/custom-extensions/node-views/javascript.mdx)。

## 数据流与渲染边界

### 保存链路

1. 用户在现有 `StylePanel` 中修改主题强调色或 H2 款式。
2. Frontend 更新当前 `TemplateStyleConfig` 草稿，并沿用现有未保存状态。
3. 保存时通过现有模板样式 API 发送完整配置。
4. Python Sidecar 使用严格 Pydantic model 校验后，将完整 JSON 保存到 `template_styles.payload`。
5. 保存成功后，Frontend 使用服务端返回的完整配置替换本地草稿。

### TypeScript 渲染

TypeScript 侧当前存在 Web `style-engine/css-generator.ts` 与 `@typedance/resume-renderer` 内部生成器的重复逻辑。本次将模板 CSS 语义收敛到 `@typedance/resume-renderer`：

- 导出统一的模板 CSS 生成函数。
- 导出静态 H2 DOM 生成逻辑。
- 模板卡片继续使用静态 HTML。
- 模板编辑预览和简历工作台复用相同 CSS 生成函数。
- TipTap NodeView 使用同一组 DOM 类名、数据属性和款式枚举。

### Python 导出

Python Sidecar 继续负责业务数据和确定性 HTML/PDF 导出：

- `pdf.py` 的 Heading 渲染输出三段式 H2 DOM。
- `style_renderer.py` 根据 `decorationStyle` 和 `accentColor` 生成对应 CSS。
- HTML 导出与 PDF 导出共用同一个完整 HTML。
- Chromium PDF 保持 `print_background=True`。
- Python 不参与款式选择、编辑器状态或 AI 编排。

### 四个显示出口

下列出口必须保持一致：

1. 模板详情中的只读 `ResumeRichTextEditor`；
2. 简历工作台中的 `DraftCanvas`；
3. 模板卡片的 `TemplatePreview`；
4. Python Sidecar 生成的 HTML 和 PDF。

## 开发数据清理

项目尚未上线，因此不新增模板样式迁移器，也不增加运行时旧结构兼容。

实施新模型时，清理应用数据库中属于开发期的以下记录：

- 简历版本与工作台文档；
- 草稿、画布、导出记录和其他依赖简历内容的 revision 数据；
- 模板样张；
- 已保存模板样式。

保留与本次功能无关的应用设置。清理数据库引用时绝不删除用户机器上的真实源文件或目录；ContextSource 只解除应用内引用。

清理完成后由当前代码重新生成内置样张和经典 A4 配置。新 schema 生效后，任何缺少 `theme` 或 `heading2.decorationStyle` 的配置均视为无效数据。

## 错误处理

- 颜色选择器只允许输出合法的六位十六进制颜色。
- Frontend 在提交前使用共享 Zod schema 校验完整配置。
- Sidecar 再次执行 Pydantic 校验；非法请求返回明确的 422 响应。
- 保存失败时保留本地未保存草稿，现有状态区显示保存失败，不回退到旧主题配置。
- 未知 `decorationStyle` 是契约错误，渲染器不得静默映射到默认款式。
- PDF 渲染失败沿用现有导出错误路径，不生成部分成功的导出记录。

## 可访问性与编辑行为

- 三个款式项使用语义化单选控件，不用可点击 `div` 模拟单选。
- 款式名称始终可见，颜色和缩略图不是唯一状态提示。
- 选中状态同时提供单选状态、边框和文本反馈。
- `prefix`、`suffix` 不进入可访问性树，不进入复制文本。
- 键盘可聚焦并切换三款样式。
- TipTap 中光标、选区、复制、粘贴、撤销、Heading 等级切换和拖拽手柄不得被装饰节点干扰。

## 测试策略

### 契约测试

- 三种 `decorationStyle` 均可通过 TypeScript 与 Python schema。
- 缺少 `theme`、缺少 `accentColor`、缺少 H2 款式或出现未知枚举时校验失败。
- H2 配置拒绝 `backgroundColor` 和 `borderBottom`。
- TypeScript 与 Python 对颜色混合函数使用相同输入时输出相同十六进制颜色。

### 设置面板测试

- 主题下拉框下方显示主题强调色设置。
- 只有选中 H2 时显示“标题款式”。
- A、B、C 按单列渲染并具有正确单选状态。
- H2 下不显示背景颜色和边框设置。
- 修改颜色或款式会更新预览并进入未保存状态。
- 保存、放弃修改和重置主题包含新字段。

### TipTap 编辑测试

- H2 NodeView 输出 `prefix/content/suffix`。
- 只有 `content` 可编辑，装饰节点不可编辑且不参与复制文本。
- 验证输入、选区、加粗、行内颜色、粘贴、撤销和 Heading 等级切换。
- 验证拖拽手柄命中与滚动行为不受新增 span 影响。

### 渲染与导出测试

- 模板卡片、模板详情、工作台和 Sidecar HTML 均输出相同类名与 `data-heading-style`。
- A、B、C 分别验证 prefix、content、suffix 的显示规则。
- HTML 导出包含主题强调色及派生浅色。
- PDF 测试验证 `print_background`、背景渐变、线条、圆点、换行和分页。
- 为三款样式建立固定样张的 PDF 截图回归，发现 TypeScript 与 Python 视觉漂移时测试失败。

## 验收标准

- 用户可以在现有模板设置面板中修改主题强调色。
- 用户可以在 H2 下从 A、B、C 三款单列选项中选择一种款式。
- H2 不再暴露背景颜色和边框自由配置。
- 模板编辑预览、工作台、模板卡片、HTML 和 PDF 的 H2 视觉一致。
- 导出的 H2 包含真实 `prefix/content/suffix` span，不依赖伪元素。
- 标题文本的编辑、复制、粘贴、撤销、选区和拖拽行为保持正常。
- 代码中不存在旧配置 fallback、旧渲染分支或兼容适配器。
- 开发期简历和主题数据已清理，真实本地源文件未被删除。

## 预计影响范围

- `packages/contracts`：模板样式契约与专用 H2 类型。
- `packages/resume-renderer`：统一 TypeScript CSS 与静态 H2 DOM 生成。
- `apps/web`：设置面板、主题数据、TipTap Heading NodeView、预览调用与测试。
- `services/sidecar`：Pydantic model、H2 HTML/CSS、HTML/PDF 导出和测试。
- 开发数据库清理：只清除应用拥有的开发期业务记录，不触碰用户真实文件。
