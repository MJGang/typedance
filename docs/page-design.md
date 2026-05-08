# TypeDance V1 页面设计方案

> 最后更新：2026-05-08
> 适用范围：V1 桌面端 React + Vite + TypeScript 前端

---

## 1. 设计目标

TypeDance V1 的第一屏不是营销页，而是一个面向求职闭环的工作台。

用户打开应用后，应该立刻看到三件事：

1. 当前简历版本是否可投递。
2. 目标岗位要求和简历内容的匹配情况。
3. AI 建议引用了哪些个人资料证据、存在哪些风险、需要用户确认什么。

页面设计服务于 `30 分钟内生成一份针对目标岗位、可信、可投递 PDF 简历` 这一主目标。

---

## 2. 产品气质

### 2.1 关键词

- 专业、可信、克制
- 本地优先、可控、透明
- 文档工作台，而不是聊天玩具
- 证据驱动，而不是 AI 润色器

### 2.2 视觉方向

采用 Minimalism & Swiss Style：清晰网格、充足留白、高对比文字、弱装饰、强状态表达。

不使用大面积营销插画、渐变背景、漂浮装饰卡片或夸张 AI 风格。TypeDance 的信任感来自可追溯证据、明确权限和稳定排版。

---

## 3. 核心页面：Resume Workspace

### 3.1 信息架构

```text
--------------------------------------------------------------------------------+
| Top Bar: TypeDance / 当前简历版本 / 本地状态 / 导出 PDF                         |
+--------------------------------------------------------------------------------+
| Job Rail          | Resume Canvas                         | Insight Rail        |
| 目标岗位           | A4 简历编辑与预览                       | 匹配度 / 证据 / 风险  |
| JD 摘要            | TipTap 编辑器                           | AI 建议浮层入口       |
| 关键词             | 选中文本后的 / action menu               | Review Gate          |
| 多岗位版本          | 分页、超页、导出预检                      | Context Preview      |
+--------------------------------------------------------------------------------+
```

### 3.2 布局比例

- 顶栏：56px，固定高度。
- 左侧 Job Rail：280-320px，用于岗位版本、JD 摘要、关键词和岗位要求。
- 中央 Resume Canvas：自适应主区域，A4 页面居中，支持 100%/Fit Width 视图。
- 右侧 Insight Rail：320-360px，用于匹配结果、Evidence Card、AI Edit Run 状态和 Review Gate。
- 1366px 以下允许右侧 Rail 折叠为抽屉。
- 768px 以下进入单列任务流：岗位、简历、证据、导出检查以 Tabs 切换。

---

## 4. 首屏状态

### 4.1 空状态

空状态要推动用户进入闭环，而不是解释产品概念。

主操作：

- 导入旧简历
- 从模板开始
- 粘贴目标岗位

辅助入口：

- 添加资料库材料
- 查看本地存储位置

空状态文案保持短句：

- `先放入一份简历`
- `再贴上目标岗位`
- `TypeDance 会只基于你确认的材料给出建议`

### 4.2 工作中状态

当用户已有简历和 JD 后，首屏默认展示：

- 中央：当前简历 A4 预览与编辑器。
- 左侧：岗位卡片、JD 关键词、薪资/年限/技术要求摘要。
- 右侧：匹配概览、证据覆盖率、风险项和最近一次 AI 建议。

### 4.3 导出前状态

导出按钮永远可见，但 Review Gate 失败时不能静默导出。

导出区域状态：

- `Ready`：可直接导出 PDF。
- `Needs review`：存在缺证据、超页、敏感信息或 JD 不匹配。
- `Blocked by permission`：需要用户确认上下文、路径或模型调用权限。
- `Export with risks`：用户明确查看风险后可强制导出。

---

## 5. 关键组件设计

### 5.1 Top Bar

包含：

- 应用名：TypeDance
- Resume Version 选择器
- 本地存储状态：`Local`
- 主题切换：`Light / Dark / System`
- Run 状态：`Idle / Extracting evidence / Waiting for confirmation / Completed`
- 主 CTA：`Export PDF`

交互规则：

- 所有图标按钮使用 Lucide 图标，并提供 `aria-label`。
- 导出按钮在 Review Gate 有风险时显示警示标记，但不使用红绿颜色作为唯一提示。
- 本地状态点击后展示当前资料目录与权限摘要。

### 5.2 Job Rail

用于回答：这份简历是为哪个机会写的？

模块：

- 当前目标岗位卡片
- 岗位关键词
- 硬性要求
- 公司/行业语言校准状态
- 其他岗位版本列表

设计重点：

- 多岗位版本用紧凑列表，不做大卡片墙。
- 每个版本显示匹配分、最近修改时间和导出状态。
- 外部背景必须和用户经历证据视觉区分，避免用户误以为网页内容证明了自己的经历。

### 5.3 Resume Canvas

用于回答：最终投递出去的简历长什么样？

模块：

- A4 页面预览
- TipTap 编辑区
- 页数和超页提示
- 段落级风险标记
- 选中文本后的 `/` action menu

设计重点：

- 编辑器应像正式文档工具，而不是聊天输入框。
- 风险标记靠近对应段落，以小型边注呈现。
- AI 建议不能自动覆盖正文，必须由用户接受、编辑或拒绝。

### 5.4 Insight Rail

用于回答：AI 为什么这样建议，我能不能信？

模块：

- Match Summary：岗位匹配概览
- Evidence Coverage：简历段落证据覆盖
- AI Suggestion：当前建议、改写前后对比
- Evidence Cards：来源、摘录、可信度、是否包含敏感信息
- Review Gate：导出前风险检查

设计重点：

- Evidence Card 应显示来源类型：`resume`、`project_doc`、`manual_note`、`external_background`。
- `external_background` 只能用于岗位语言参考，不进入用户经历证据链。
- 缺证据主张使用文字标签 `Needs confirmation`，不能只靠颜色。

---

## 6. AI 交互模式

### 6.1 `/` Resume Action Menu

用户选中简历段落后打开命令菜单。

P0 命令：

- `/tailor-resume`
- `/extract-evidence`
- `/rewrite-bullet`
- `/check-risk`

菜单设计：

- 使用命令名 + 一行说明。
- 支持键盘上下选择和 Enter 执行。
- 每个命令显示是否需要资料库、JD、联网或云端模型权限。

### 6.2 Context Preview

云端 LLM 调用前必须显示上下文预览。

预览内容：

- 将发送的简历片段
- 将发送的 JD 片段
- 将发送的 Evidence Card 摘要
- 被 Secret 扫描移除的内容数量
- 模型 Provider

主操作：

- `Confirm and run`
- `Edit context`
- `Use local provider`
- `Cancel`

### 6.3 AI Suggestion

建议结果必须是可审查对象，而不是直接替换正文。

建议卡结构：

- 改写结果
- 使用的证据
- 匹配的 JD 要求
- 风险提示
- 操作：接受、编辑后接受、重新生成、拒绝

---

## 7. 状态与反馈

### 7.1 AI Edit Run 状态

Run 状态在右侧 Rail 和顶栏同时可见。

```text
created
permission_required
waiting_user_confirmation
running
failed_retryable
canceled
completed
```

每个失败状态都必须有可理解解释和下一步操作：

- 文件读取失败：重新选择路径、移除来源。
- 联网失败：仅基于 JD 和资料继续。
- 模型限流：重试、切换 Provider、稍后继续。
- 缺证据：查看来源、重新生成、用户确认。

### 7.2 Loading

- 资料解析：使用行内进度，不遮挡编辑器。
- AI 生成：建议区域显示阶段进度。
- PDF 导出：显示渲染预览和页数检查。

### 7.3 Toast 使用边界

Toast 只用于短暂反馈，例如保存成功、导出完成。

权限、风险、失败恢复不能只用 Toast，必须留在页面上的持久区域。

---

## 8. 视觉规范

### 8.1 主题模式

TypeDance 必须支持三种主题：

- `Light`：始终使用浅色主题。
- `Dark`：始终使用深色主题。
- `System`：跟随系统 `prefers-color-scheme`。

主题选择器放在 Top Bar 右侧，使用图标 + 下拉菜单或三段式菜单。当前主题需要持久化到本地设置；当用户选择 `System` 时，保存的是 `system`，实际渲染主题由系统偏好派生。

实现规则：

- 根节点使用 `data-theme="light"` 或 `data-theme="dark"`。
- 用户偏好状态只保存 `light | dark | system`；实际主题 `resolvedTheme` 从用户偏好和系统媒体查询派生。
- 页面加载时应在首帧前设置主题，避免 light/dark 闪烁。
- 所有组件只使用语义 token，不直接写 Tailwind 灰阶或硬编码主题色。
- 简历 PDF 预览默认保持白纸黑字，即使应用处于 Dark。Dark 模式下纸张之外的工作区变暗，A4 页面本身仍代表最终导出结果。

主题解析逻辑：

```ts
type ThemePreference = 'light' | 'dark' | 'system';
type ResolvedTheme = 'light' | 'dark';

function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }

  return preference;
}
```

### 8.2 主题色 Token

推荐采用“专业蓝 + 行动橙 + 成功绿”的有限调色，避免单一蓝灰主题。

Light:

```text
Background:       #F8FAFC
Surface:          #FFFFFF
Surface Muted:    #F1F5F9
Surface Raised:   #FFFFFF
Primary:          #2563EB
Primary Deep:     #1E40AF
Accent Action:    #F97316
Success:          #16A34A
Warning:          #D97706
Danger:           #DC2626
Text Strong:      #0F172A
Text Body:        #334155
Text Muted:       #64748B
Border:           #CBD5E1
Focus Ring:       #2563EB
Resume Paper:     #FFFFFF
Resume Ink:       #111827
Resume Muted:     #4B5563
Code Surface:     #F1F5F9
Overlay:          rgba(15, 23, 42, 0.48)
```

Dark:

```text
Background:       #0B1120
Surface:          #111827
Surface Muted:    #1F2937
Surface Raised:   #172033
Primary:          #60A5FA
Primary Deep:     #93C5FD
Accent Action:    #FB923C
Success:          #4ADE80
Warning:          #FBBF24
Danger:           #F87171
Text Strong:      #F8FAFC
Text Body:        #E2E8F0
Text Muted:       #CBD5E1
Border:           #475569
Focus Ring:       #93C5FD
Resume Paper:     #FFFFFF
Resume Ink:       #111827
Resume Muted:     #4B5563
Code Surface:     #1E293B
Overlay:          rgba(2, 6, 23, 0.72)
```

使用规则：

- 蓝色用于结构性选择和当前上下文。
- 橙色只用于高价值动作，例如导出、运行 AI。
- 绿色只用于已通过状态，不表示“AI 内容一定正确”。
- 警告和风险必须配合图标或文字标签。
- `Text Muted` 仍必须可读，不能使用低对比的灰色装饰文字。
- 禁止在 Dark 模式中使用纯黑大背景配纯白长文；正文使用 `Text Body`，标题使用 `Text Strong`。
- 透明面板在 Light 下透明度不得低于 `Surface / 92%`，避免背景穿透导致文字对比不足。
- Disabled 状态也要保持可识别：文字不低于 3:1，且配合禁用图标或说明。

### 8.3 字体

界面字体：

- `Inter` 或系统 sans-serif，用于工作台 UI。

简历预览字体：

- `Source Serif 4` 或 `Georgia`，用于正式文档感。
- 也应提供 sans-serif 简历模板，避免所有用户都被迫使用传统 serif。

字号建议：

- 顶栏与 Rail 正文：13-14px。
- 面板标题：14-16px。
- 简历正文预览：10.5-11.5pt。
- 状态标签：12px。

主题对比规则：

- Light 下正文使用 `Text Body` 或更深，不使用浅灰正文。
- Dark 下正文使用 `Text Body`，辅助说明使用 `Text Muted`，不使用 `#94A3B8` 以下的低亮度灰。
- 链接、按钮、风险标签的文字颜色必须和背景保持 4.5:1 以上。
- 简历预览的字体颜色不跟随应用 Dark 主题，始终以最终 PDF 可读性为准。

### 8.4 形状与间距

- 卡片圆角不超过 8px。
- 工具按钮保持 32px 或 36px 固定尺寸。
- Rail 内部模块间距 16px。
- A4 页面外使用浅灰工作区背景，不加厚重投影。
- Hover 只改变边框、背景或文字颜色，不使用会造成布局跳动的缩放。

### 8.5 主题下的组件状态

所有状态都必须有 Light 和 Dark 两套可读表现：

| 状态 | Light | Dark | 文本要求 |
| --- | --- | --- | --- |
| Selected | 浅蓝背景 + 蓝色边框 | 深蓝面 + 亮蓝边框 | 必须显示选中标签或图标 |
| Hover | 背景加深一级 | 背景提亮一级 | 不改变布局尺寸 |
| Focus | 蓝色 focus ring | 亮蓝 focus ring | 2px 以上可见轮廓 |
| Success | 浅绿背景 + 深绿文字 | 深绿面 + 亮绿文字 | 配合 `Passed` 文案 |
| Warning | 浅琥珀背景 + 深琥珀文字 | 深琥珀面 + 亮琥珀文字 | 配合 `Needs review` 文案 |
| Danger | 浅红背景 + 深红文字 | 深红面 + 亮红文字 | 配合 `Blocked` 或具体错误 |
| Disabled | 低饱和背景 | 低饱和背景 | 说明为什么不可用 |

状态信息不能只靠颜色表达。Review Gate、权限、证据风险必须同时使用图标、文字标签和可展开说明。

---

## 9. 响应式规则

### 1440px+

- 三栏完整展开。
- A4 页面可 Fit Width，右侧 Rail 保持 360px。

### 1024px-1439px

- 左侧 Rail 收窄到 280px。
- 右侧 Rail 允许用户折叠。

### 768px-1023px

- Job Rail 变为顶部横向版本条。
- Insight Rail 变为右侧抽屉。
- Resume Canvas 占主屏。

### 375px-767px

- 使用 Tabs：`Resume`、`Job`、`Evidence`、`Review`。
- 导出按钮固定在底部操作栏。
- A4 预览默认只读，编辑进入独立编辑模式。

---

## 10. 可访问性与实现要求

- 支持 `Light / Dark / System`，并在首帧前解析主题，避免主题闪烁。
- 所有错误消息使用 `role="alert"` 或 `aria-live`。
- 表单输入必须有 label，不依赖 placeholder。
- 图标按钮必须有 accessible name。
- 所有功能必须可键盘操作。
- Focus 顺序遵循视觉顺序：Top Bar -> Job Rail -> Resume Canvas -> Insight Rail。
- 正文对比度不低于 4.5:1。
- 大号标题和装饰性次要文本也不低于 3:1；交互控件边框和 focus ring 不低于 3:1。
- Light 和 Dark 下都要检查 `Text Strong`、`Text Body`、`Text Muted`、链接、按钮、状态标签和表单错误。
- 动画遵守 `prefers-reduced-motion`。
- React 状态只保存真实来源状态；匹配分、证据覆盖率、风险数量等可派生值在 render 或 selector 中计算。

---

## 11. MVP 页面清单

### P0

- Resume Workspace
- Context Preview Modal
- Evidence Card Drawer
- Review Gate Panel
- PDF Export Preview

### P1

- Job Target Manager
- Profile Evidence Vault
- Permission Settings
- AI Run History

### 暂不做

- 插件市场
- 面向用户的 Agent 编排平台
- 通用 AI 写作首页
- 复杂 CRM 投递看板

---

## 12. 设计验收标准

1. 非工程用户能在首屏理解当前下一步。
2. 用户能区分“自己的证据”和“外部岗位背景”。
3. AI 建议不会在未经确认时进入简历正文。
4. 导出前风险不会被隐藏在 Toast 或日志里。
5. 375px、768px、1024px、1440px 下无横向滚动和文字重叠。
6. 所有主操作可键盘完成。
7. 页面气质像专业文档工作台，而不是聊天应用或营销页。
8. `Light / Dark / System` 三种主题都能切换、持久化，并跟随系统主题变化。
9. 两种实际渲染主题下正文、静音文字、边框、按钮、状态标签和错误提示都通过对比度检查。
10. Dark 模式下 A4 简历预览仍保持最终 PDF 的白纸黑字可读效果。
