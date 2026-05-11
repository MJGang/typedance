# TypeDance 模板库与样张内容配置设计

> 日期：2026-05-11
> 状态：已确认设计，等待实施计划
> 范围：React 工作台内的模板库入口、模板浏览、模板详情、样张内容编辑与本地保存

## 背景

当前 TypeDance 已有 `classic-a4` 模板能力，但用户只能在保存后通过 PDF 预览间接看到效果。模板样式、渲染入口、配置参数和样张内容没有独立页面承载，导致两个问题：

1. 用户无法像浏览视频封面一样快速理解现有模板长什么样。
2. 维护者无法直观看到模板由哪些样式参数和样张内容驱动，后续扩展模板配置成本不清晰。

本设计新增一个左侧菜单入口 `模板库`，在现有工作台内提供模板列表、模板详情和样张内容配置能力。第一版不做拖拽排版、不做模板样式编辑、不做模板市场、不做当前简历模板切换。

## 目标

- 在左侧菜单中新增 `模板库`，作为 `Resume Flow` 下的一级入口。
- 提供模板列表视图，让用户可以看到 A4 缩略样张、模板名称、标签和状态。
- 提供模板详情视图，让用户可以查看大样张、基础配置摘要、渲染入口和未来可配置项。
- 提供样张内容配置页面，用 TipTap 编辑预设样张内容，并保存到本地 sidecar。
- 模板库读取本地保存的样张内容；没有本地覆盖时回退到内置默认样张。
- 保持样张内容和模板样式分离：模板定义描述样式和能力，样张内容定义用于预览的 `doc_json`。
- 模板底层样式使用 Tailwind CSS 4 utility class 表达，避免用户直接编写任意 CSS。
- 提供受控样式配置能力：用户可以选择预设 class 或编辑 Tailwind class 字符串。
- 提供 PDF class 支持策略：通过白名单和黑名单限制哪些 Tailwind class 可以进入 PDF 渲染链路。

## 非目标

- 不做模板拖拽编辑器。
- 不做任意 CSS 编辑器，不允许用户直接手写 CSS 规则。
- 不做远程模板市场。
- 不做模板切换保存，不修改当前 `ResumeVersion.template_id`。
- 不把样张内容当作当前用户简历内容。
- 不承诺样张是用户当前简历的导出结果；样张只用于模板视觉预览。
- 不支持所有 Tailwind class；第一版只支持 PDF 渲染验证过的 class 子集。

## 信息架构

左侧菜单在 `Resume Flow` 中新增 `模板库`：

```text
Resume Flow
- 工作台
- 模板库
- 岗位
- 证据
- 检查
- 导出
```

点击 `模板库` 后，主区域显示模板库页面。模板库内部使用 tabs：

```text
[模板列表] [样张内容]
```

### 模板列表

模板列表用于快速浏览模板。桌面端使用卡片网格，移动端单列显示。

卡片包含：

- A4 比例缩略样张。
- 模板名称，例如 `Classic A4`。
- 中文说明，例如 `经典单栏简历`。
- 标签，例如 `内置`、`中英双语`、`ATS 友好`。
- 状态，例如 `当前使用`、`内置`、`规划中`。

第一版至少包含一个真实模板：

- `classic-a4`：真实内置模板，状态为 `built-in`。

可选增加规划占位模板：

- `modern-a4`：状态为 `planned`。
- `compact-a4`：状态为 `planned`。

规划模板必须清楚显示 `规划中`，不能让用户误以为可以使用。

### 模板详情

点击 `Classic A4` 后进入详情视图。

详情页包含：

- 返回模板库入口。
- 大号 A4 样张预览。
- 模板名称与定位说明。
- 适用语言。
- 页面尺寸、页边距、字体、主色、布局类型。
- `template_id`。
- 渲染入口，例如 `packages/resume-renderer/src/index.ts`。
- 当前实现说明：由受控 HTML/CSS 和 TipTap JSON 渲染，不直接复用编辑器 DOM。
- 后续可配置项清单，例如字体、主色、页边距、标题样式、段落间距。

详情页第一版不提供可用的 `应用模板` 按钮。若出现按钮，必须置灰并说明 `当前版本暂不支持切换模板`。

### 样张内容

样张内容页面负责维护模板库预览所使用的预设 TipTap JSON。

页面能力：

- 展示当前样张内容名称，例如 `通用技术岗样张`。
- 支持中文样张和英文样张分开维护。
- 使用 TipTap 编辑器轻量编辑样张内容。
- 展示保存状态。
- 说明该样张内容会用于模板列表缩略图和模板详情大样张。
- 保存到本地 sidecar，而不是只保存在内存中。

样张内容页面不编辑模板样式，只编辑预览内容。

## 数据模型

模板定义只引用样张内容 ID，不直接内嵌大块 `doc_json`。

```ts
type ResumeTemplateDefinition = {
  id: string
  name: string
  localizedName: Record<UiLanguage, string>
  description: Record<UiLanguage, string>
  languages: TargetLanguage[]
  status: "built-in" | "planned"
  tags: Record<UiLanguage, string[]>
  sampleContentIds: Partial<Record<TargetLanguage, string>>
  configSummary: {
    pageSize: string
    margin: string
    fontStack: string
    accentColor: string
    layout: string
  }
  implementation: {
    packageName: string
    rendererEntry: string
    templateId: string
  }
  futureConfig: Record<UiLanguage, string[]>
}
```

模板样式配置单独建模。用户编辑的是受控 Tailwind class，而不是 CSS 文本：

```ts
type TemplateStyleConfig = {
  templateId: string
  slots: Record<
    string,
    {
      label: Record<UiLanguage, string>
      className: string
      allowedClassGroups: string[]
    }
  >
  updatedAt: string
}
```

示例 slot：

```ts
const classicA4StyleSlots = {
  page: {
    label: { "zh-CN": "页面", "en-US": "Page" },
    className: "bg-white text-slate-900 font-sans",
    allowedClassGroups: ["page-background", "text-color", "font-family"],
  },
  header: {
    label: { "zh-CN": "页眉", "en-US": "Header" },
    className: "border-b-2 border-blue-800 pb-3 mb-4",
    allowedClassGroups: ["border", "spacing", "color"],
  },
}
```

PDF class 支持策略单独建模：

```ts
type PdfClassPolicy = {
  allowlist: string[]
  blocklist: string[]
  groups: Record<
    string,
    {
      label: Record<UiLanguage, string>
      allowlist: string[]
      blocklist?: string[]
    }
  >
}
```

第一版策略建议：

- 默认只允许文本、颜色、间距、边框、字号、字重、行高、基础 flex/grid、页面背景等 PDF 已验证 class。
- 默认禁止交互、动画、过渡、滤镜、粘性定位、hover/focus 响应式变体、复杂 transform、任意值 class。
- 对用户手写 class 做解析和校验，保存前给出不支持项列表。
- 黑名单优先级高于白名单。

样张内容单独管理：

```ts
type TemplateSampleContent = {
  id: string
  name: Record<UiLanguage, string>
  targetLanguage: TargetLanguage
  docJson: ResumeDocJson
  plainTextSnapshot: string
  updatedAt: string
}
```

第一版内置样张：

- `sample-tech-zh`：中文通用技术岗样张。
- `sample-tech-en`：英文通用技术岗样张。

## 数据流

模板库样张渲染链路：

```text
Template Registry
  template_id: classic-a4
  sample_content_id: sample-tech-zh

Sample Content Store
  sample-tech-zh.doc_json

Renderer
  classic-a4 + sample-tech-zh.doc_json

Template Library UI
  卡片缩略样张 + 详情大样张
```

读取策略：

1. 模板库打开时读取模板注册表。
2. 根据当前预览语言选择模板绑定的 `sampleContentId`。
3. 向 sidecar 请求本地保存的样张内容。
4. 如果本地没有覆盖版本，回退到前端内置默认样张。
5. 使用样张 `doc_json` 和模板 ID 渲染样张。

保存策略：

1. 用户在 `样张内容` tab 中编辑 TipTap 内容。
2. 前端生成 `doc_json` 和 `plainTextSnapshot`。
3. 调用 sidecar 保存样张内容到本地 SQLite 或 `~/.typedance/` 下的本地存储。
4. 保存成功后，模板列表和详情页读取更新后的样张。

## 组件边界

建议新增前端模块：

```text
apps/web/src/features/templates/
  data.ts
  types.ts
  components/
    TemplateLibrary.tsx
    TemplateCard.tsx
    TemplateDetail.tsx
    TemplateSampleEditor.tsx
    TemplatePreview.tsx
    TemplateStylePanel.tsx
    PdfClassPolicyEditor.tsx
```

建议扩展现有模块：

- `WorkspaceSection` 增加 `templates`。
- `WorkspaceSidebar` 增加 `模板库` 菜单项。
- `App.tsx` 根据 `activeSection` 渲染 `TemplateLibrary` 或现有工作台。
- `copy` 增加中英文模板库文案。
- `api.ts` 增加样张内容读取和保存接口。
- `api.ts` 增加模板样式配置和 PDF class 策略读取、保存接口。

sidecar 建议新增 API：

```text
GET /template-samples/{id}
PUT /template-samples/{id}
GET /template-styles/{template_id}
PUT /template-styles/{template_id}
GET /pdf-class-policy
PUT /pdf-class-policy
```

API 管理样张内容、受控 Tailwind class 样式配置和 PDF class 策略，不接受任意 CSS 文本。

## Tailwind CSS 4 样式策略

模板实现必须以 Tailwind CSS 4 utility class 为底层表达，不允许把用户输入作为原始 CSS 注入渲染器。

基于 Tailwind CSS 4 文档，动态 class 需要显式纳入生成来源。第一版应使用 `@source inline()` 为允许的模板 class 生成 CSS；需要明确排除的 class 可使用 `@source not inline()` 或 TypeDance 自己的策略校验阻断。

样式配置分三层：

1. **模板默认 class**：随内置模板发布，保证开箱可渲染。
2. **用户本地 class 覆盖**：通过模板详情中的样式配置面板编辑并保存到 sidecar。
3. **PDF class 策略**：决定哪些 class 可以被保存和渲染。

用户可以通过两种方式配置样式：

- 从按 slot 分组的 class 选项中选择，例如页眉边框、标题字号、强调色。
- 在高级输入框中编辑 Tailwind class 字符串。

高级输入框必须实时校验：

- 支持的 class 正常显示。
- 不支持但未知的 class 标记为 `未验证`，默认不允许保存。
- 命中黑名单的 class 标记为 `PDF 不支持`，禁止保存。
- 如果 class 没有被 Tailwind 生成来源覆盖，提示需要加入 policy allowlist。

保存样式配置时，sidecar 需要再次执行同样的策略校验，避免仅依赖前端。

## 渲染原则

- 模板样张必须基于预设 TipTap JSON 渲染，不能手写脱离真实链路的假 HTML。
- 样张内容和模板样式必须分离。
- 模板样式必须通过 Tailwind CSS 4 class 配置进入渲染链路，不能通过用户手写 CSS 进入渲染链路。
- PDF 渲染前必须校验 class policy；黑名单 class 和未允许 class 不得进入最终 HTML/CSS。
- 模板库预览不读取当前用户简历，避免误以为模板库会修改当前简历。
- 后续支持模板切换时，应复用同一条渲染链路：`ResumeVersion.doc_json + template_id -> renderer -> preview`。

## 交互细节

- 顶部路径显示 `TypeDance / 模板库`。
- 模板库页面不改变当前简历正文、目标语言、保存状态和 PDF 导出状态。
- 全局导出按钮仍导出当前简历，不导出模板样张。
- 技术字段如 `classic-a4`、包名、路径保持英文。
- UI 文案跟随应用语言切换。
- 样张内容编辑保存失败时，页面内显示持久错误状态，不能只用 toast。
- 样式 class 编辑保存失败时，必须列出具体不支持的 class 和原因。

## 测试与验收

验收标准：

1. 左侧菜单有 `模板库`，点击后主区域切换到模板库页面。
2. 模板列表能看到至少一个 `Classic A4` 模板卡片，包括 A4 缩略样张、名称、标签、状态。
3. 点击 `Classic A4` 能进入详情页，看到大样张、页面尺寸、页边距、字体、主色、`template_id`、渲染入口。
4. `样张内容` tab 能编辑中文或英文样张内容，并保存到本地 sidecar。
5. 模板库重新打开后，优先读取本地保存的样张内容；没有本地覆盖时回退到内置默认样张。
6. 模板样张由预设 TipTap JSON 渲染，不能与真实渲染链路脱节。
7. 模板库页不影响当前简历正文、目标语言、保存状态和 PDF 导出状态。
8. 中文/英文 UI 切换后，模板库主要文案跟随切换。
9. 桌面宽度下卡片网格整齐；移动宽度下单列显示，无横向滚动。
10. 规划模板如果出现，必须清楚标记 `规划中`，不可被误用。
11. 模板样式配置使用 Tailwind CSS 4 class，不允许输入或保存任意 CSS。
12. 用户可以选择预设 class，也可以编辑 class 字符串。
13. class 保存前必须经过 PDF class 白名单和黑名单校验。
14. 黑名单 class 和未允许 class 不能进入最终 PDF 渲染 HTML。
15. PDF class policy 有独立配置入口，可维护 allowlist、blocklist 和 class group。

建议测试：

- 单元测试：侧边栏出现 `模板库` 菜单。
- 单元测试：模板列表渲染 `Classic A4`。
- 单元测试：点击模板卡片进入详情。
- 单元测试：样张内容编辑后调用保存 API。
- 单元测试：支持 class 通过校验，不支持 class 显示错误。
- 单元测试：黑名单 class 优先阻断保存。
- API 测试：sidecar 能保存并读取样张内容。
- API 测试：sidecar 拒绝不符合 PDF class policy 的样式配置。
- E2E 测试：从左侧菜单进入模板库，打开 `Classic A4` 详情，编辑并保存样张内容。
- E2E 测试：编辑模板 class，保存后模板样张更新；输入 PDF 不支持 class 时保存被阻止。

## 自审记录

- 无 `TBD` 或未定义占位要求。
- 第一版范围明确排除拖拽排版、模板市场、模板切换保存和任意 CSS 编辑。
- 第一版允许受控 Tailwind CSS 4 class 样式配置，并要求 PDF class policy 校验。
- 模板样式与样张内容职责分离。
- 样张编辑后的读取来源已明确为本地 sidecar，并有内置默认回退。
- 设计与当前 `ResumeVersion.template_id`、TipTap JSON、受控 HTML/CSS 渲染管线一致。
