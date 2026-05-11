# TypeDance 块级样式配置设计

> 日期：2026-05-11
> 状态：已确认设计，等待实施计划
> 范围：模板样式配置从 Tailwind class 文本输入升级为按 TipTap 块类型的结构化样式面板

## 背景

当前模板库的样式配置功能（`TemplateDetail.tsx` 中的 "Tailwind class 配置"）基于原始 Tailwind class 文本输入。用户必须手动输入 `bg-white text-slate-900` 等 class 字符串，每个模板只有 `page` 和 `header` 两个硬编码槽位，无法按 TipTap 块类型（h1、h2、paragraph、list 等）独立控制样式。

这带来三个问题：

1. **新手不可用**——不熟悉 Tailwind 的用户无法上手。
2. **粒度太粗**——所有正文类块共享同一组样式，无法区分 h1 大标题和  h2 章节标题。
3. **交互原始**——没有颜色选择器、字号滑块、字体下拉等现代 UI 控件。

## 目标

- 按 TipTap 块类型（h1/h2/h3/paragraph/bulletList/orderedList）分别配置样式。
- 完全消除 Tailwind class 文本输入，全部改为可视化控件。
- 所见即所得——所有修改即时反映在编辑器预览中。
- 自动保存——与简历内容编辑一致的 auto-save 行为。
- 预设方案——每个模板自带多套预设（经典/现代/简洁/商务），方便新手起步。
- 渲染层支持双轨——WeasyPrint 走 CSS 生成，FPDF 走 Adapter 兜底。

## 非目标

- 不做任意 CSS 输入——用户不直接写 class 或 CSS。
- 不改动现有模板库浏览/选择/详情流程。
- 不新增块类型——只覆盖 h1/h2/h3/paragraph/bulletList/orderedList 六类。
- 不做样式版本历史（V1 只保存当前版本，不切历史）。

### PdfClassPolicy 移除说明

由于不再使用 Tailwind class 字符串，PdfClassPolicy（白名单/黑名单校验）整体移除。替代方式：

- 输入校验由属性控件的类型约束完成（如 ColorPicker 只输出合法 hex、FontSizeInput 限制值域）。
- 渲染器兼容性在 UI 中通过 `rendererCompatible` 标记提示，不做全局校验。
- 对应的 API 端点 `GET/PUT /pdf-class-policy`、前端 `classPolicy.ts`、侧边栏 `template_policy.py` 一并移除。

## 数据模型

### BlockStyle

每个块的样式定义为结构化类型，而非 Tailwind class 字符串：

```typescript
type BlockStyle = {
  // 排版
  fontFamily?: string;
  fontSize?: string;            // "14pt"
  fontWeight?: 400 | 500 | 600 | 700;
  lineHeight?: number;          // 无单位倍率，如 1.5
  letterSpacing?: string;       // "0.5pt"
  textTransform?: "none" | "uppercase" | "capitalize";

  // 颜色
  color?: string;               // hex
  backgroundColor?: string;     // hex

  // 对齐
  textAlign?: "left" | "center" | "right";

  // 间距
  marginTop?: string;           // "8pt"
  marginBottom?: string;        // "8pt"

  // 边框（仅 h2 等需要）
  borderBottom?: {
    style: "none" | "solid" | "double";
    width?: string;
    color?: string;
  };

  // 列表专属
  listStyleType?: "disc" | "circle" | "square" | "decimal" | "none";
  paddingLeft?: string;         // 列表缩进
};
```

### TemplateStyleConfig

```typescript
type TemplateStyleConfig = {
  template_id: string;
  preset: string;                           // 当前预设名称
  blocks: Record<BlockType, BlockStyle>;
  updated_at: string;
};

type BlockType = "heading1" | "heading2" | "heading3"
               | "paragraph" | "bulletList" | "orderedList";
```

### 向后兼容

未使用，不处理。当前 `class_name` 字段直接废弃。

## 信息架构

样式配置作为模板详情的增强，不改变现有入口路径：

```
左侧菜单「模板库」
  └─ 模板列表
       └─ 点击模板卡片 → 模板详情
            ├─ 基本信息区（不变）
            └─ 样式配置面板（增强）
                 ├─ 预设选择器
                 └─ 块级属性编辑
```

## UI 布局

采用左编辑、右配置的两栏布局：

```
┌─────────────────────────────────────────────────┐
│  左：TipTap 编辑器 (样张)  │  右：样式面板        │
│                            │                     │
│  张三                      │  预设: [经典▼]      │
│                            │  ──────────────     │
│  工作经历                  │  h2  ▸ 排版        │
│  ─────────                 │  h1  ▸ 颜色        │
│                            │  h3  ▸ 间距        │
│  · 负责 xxx               │  p   ▸ 边框        │
│  · 完成 yyy               │  ul  ▸ 对齐        │
│                            │  ol                  │
│                            │                     │
│                            │  已保存 1 分钟前     │
└─────────────────────────────────────────────────┘
```

### 右面板构成

从上到下依次为：

1. **块选择器**——6 个块的 tab/segmented control，点击切换下方编辑区。
2. **折叠属性组**——当前选中块的可编辑属性，按功能折叠：
   - 排版（字体、字号、行高、字重、字间距、大小写）
   - 颜色与背景（文字色、背景色）
   - 间距（上边距、下边距）
   - 对齐（左/中/右）
   - 边框（仅 h2 等需要时显示——样式、粗细、颜色）
   - 列表选项（仅 bulletList/orderedList——符号样式、缩进）
3. **状态栏**——显示"已保存"时间戳，FPDF 不支持的属性 ⚠️ 提示。

### 控件 UI（均使用 shadcn/ui）

| 属性 | 控件 | shadcn 组件 |
|---|---|---|
| 字体 | Select 下拉，选项带字体预览 | `Select` |
| 字号 | Input 数字 | `Input` type text |
| 字重 | Select | `Select` |
| 行高 | Input | `Input` |
| 字间距 | Input | `Input` |
| 大小写 | ToggleGroup 三态 | `ToggleGroup` |
| 文字颜色 | Popover + 色板网格 + 自定义 hex | `Popover` + `Input` |
| 背景色 | Popover + 色板网格 + 自定义 hex | `Popover` + `Input` |
| 对齐 | ToggleGroup 图标 | `ToggleGroup` |
| 上/下边距 | Input 并排 | `Input` × 2 |
| 边框样式 | Select | `Select` |
| 边框粗细 | Input | `Input` |
| 边框颜色 | Popover + 色板 | `Popover` |
| 列表样式 | Select | `Select` |
| 列表缩进 | Input | `Input` |
| 分组折叠 | Collapsible | `Collapsible` |

## 交互设计

### 配置即预览

所有样式修改**不通过"保存"按钮**——每个属性控件的变更 debounce 300ms 后自动写入编辑器预览 + 持久化。

### 编辑器 ↔ 面板双向联动

用户在编辑器内点击任意文本 → `onSelectionUpdate` 触发 → 检测当前块类型：

```typescript
function getActiveBlockType(editor: Editor): string {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  if (node.type.name === "heading") {
    return `heading${node.attrs.level}`;
  }
  return node.type.name;
}
```

→ 右侧面板自动定位到该块，高亮对应 tab。

### 预设切换

顶部预设选择器（"经典""现代""简洁""商务"）：

- 切换预设 = 覆盖当前所有块样式为新预设的值
- 如果当前已有手动修改（isDirty），弹出确认框
- 切换后允许用户在各块上继续微调，选择器显示"自定义"

### 自动保存

```
用户拖动滑块/选颜色 → 修改内存状态 → 编辑器预览更新
                                  → debounce 300ms → PUT /template-styles/{id}
```

面板底部显示 "已保存 X 分钟前"，网络异常时显示"保存失败，稍后重试"。

### 输入校验

| 场景 | 反馈 |
|---|---|
| 字号超出范围（6-72） | 输入框红色抖动 + tooltip |
| 颜色值不合法 | fallback 黑色，控件显示 ⚠️ |
| FPDF 不支持该属性 | 控件旁显示 ⚠️ 图标 + tooltip |
| 所有变更 | 50ms debounce 刷新编辑器 |

## 渲染层架构

### CSSGenerator

`BlockStyle → CSS 规则字符串`——所有预览和 WeasyPrint PDF 共用：

```typescript
function generateBlockCSS(blockName: string, style: BlockStyle): string;
```

输出示例：
```css
.td-resume-h1 { font-family: Georgia, serif; font-size: 28pt; font-weight: 700; color: #1a1a1a; text-align: center; margin-bottom: 16pt; }
.td-resume-h2 { font-size: 14pt; font-weight: 600; color: #1e3a8a; border-bottom: 2pt solid #1e3a8a; margin-bottom: 8pt; }
.td-resume-p  { font-size: 10pt; line-height: 1.5; color: #334155; margin-bottom: 4pt; }
.td-resume-ul { font-size: 10pt; line-height: 1.4; padding-left: 20pt; list-style-type: disc; }
```

### TemplatePreview 改造

当前 `TemplatePreview` 硬编码 `page`/`header` 两个 slot 的 class。改造后：

1. 接收 `BlockStyles` 而非 `TemplateStyleConfig`
2. 调用 `CSSGenerator` 生成 CSS 文本
3. 在样张 HTML 的 `<style>` 中注入
4. 每个块的 HTML 元素使用对应的 `.td-resume-{block}` class

### PDF 渲染（Python 侧）

同样从 `TemplateStyleConfig.blocks` 生成 CSS 文本，写入 PDF HTML 的 `<style>`。

新增 `services/sidecar/src/typedance_sidecar/style_renderer.py`：

```python
def generate_block_css(block_name: str, style: dict) -> str:
    """BlockStyle dict → CSS rule"""
    ...

def generate_full_css(blocks: dict) -> str:
    """遍历所有块，组合完整 CSS"""
    ...
```

FPDF 兜底路径新增 `FPDFStyleAdapter`，将 `BlockStyle` 逐属性映射到 FPDF API。尚未覆盖的属性静默忽略。

## 组件树

```
features/templates/
├── components/
│   ├── TemplateLibrary.tsx          # 不变——入口编排
│   ├── TemplateDetail.tsx           # 改——替换旧 class input → StylePanel
│   ├── TemplatePreview.tsx          # 改——CSSGenerator + <style> 注入
│   │
│   ├── style-panel/                 # 新建——样式配置面板
│   │   ├── StylePanel.tsx           # 右面板容器
│   │   ├── BlockSelector.tsx        # 块类型切换
│   │   ├── BlockStyleEditor.tsx     # 单个块完整属性编辑
│   │   ├── sections/
│   │   │   ├── TypographySection.tsx
│   │   │   ├── ColorSection.tsx
│   │   │   ├── SpacingSection.tsx
│   │   │   ├── AlignmentSection.tsx
│   │   │   └── BorderSection.tsx
│   │   ├── controls/
│   │   │   ├── FontFamilySelect.tsx
│   │   │   ├── FontSizeInput.tsx
│   │   │   ├── LineHeightInput.tsx
│   │   │   ├── FontWeightSelect.tsx
│   │   │   ├── LetterSpacingInput.tsx
│   │   │   ├── TextTransformToggle.tsx
│   │   │   ├── ColorPicker.tsx
│   │   │   ├── AlignmentToggle.tsx
│   │   │   ├── SpacingPair.tsx
│   │   │   └── BorderEditor.tsx
│   │   ├── PresetSelector.tsx
│   │   └── StyleStatusBar.tsx
│   │
│   # pdf-class-policy/ 已移除
│
├── style-engine/                    # 新建
│   ├── types.ts                     # BlockStyle 类型
│   ├── css-generator.ts             # BlockStyle → CSS
│   ├── fonts.ts                     # 系统字体映射
│   └── presets.ts                   # 预设数据集
│
└── data.ts                          # 改——去掉旧 defaultClassicA4Style
```

## 预设方案

每个模板至少包含 3 套预设：

| 预设 | 风格特征 | h1 | h2 | p |
|---|---|---|---|---|
| 经典 | 常规商务 | 24pt, bold, #1a1a1a, 居中 | 14pt, bold, #1e3a8a, 下划线 | 10pt, 1.5, #334155 |
| 现代 | 简洁干净 | 26pt, 600, #0f172a, 居中 | 13pt, 600, #475569, 下边距 | 10pt, 1.6, #475569 |
| 简洁 | 极简通风 | 22pt, 700, #0a0a0a, 居中 | 12pt, 700, #0a0a0a, 大间距 | 10pt, 1.7, #525252 |

预设作为 JSON 存储在 `style-engine/presets.ts`，每个模板独立维护。

## 数据流

```
用户操作属性控件
  → setBlockStyles (React state)
  → CSSGenerator → <style> 注入 → 编辑器预览即时刷新
  → debounce 300ms → PUT /template-styles/{id} → sidecar 持久化

编辑器内点击
  → onSelectionUpdate
  → getActiveBlockType(editor)
  → setActiveBlock → StylePanel 联动跳转
```

## 影响范围

| 层 | 文件 | 改动量 |
|---|---|---|
| contracts | `packages/contracts/src/index.ts` | 替换 TemplateStyleSlot → BlockStyle，更新 schema |
| frontend (新建) | `style-panel/*`, `style-engine/*` | ~15 个新文件 |
| frontend (改造) | `TemplateDetail`, `TemplatePreview`, `TemplateLibrary`, `data.ts` | 中等 |
| sidecar (Python) | `models.py`, `main.py`, 新增 `style_renderer.py` | 中等 |
| PdfClassPolicy | 前端 `classPolicy.ts`、侧边 `template_policy.py`、API 端点、Pydantic model | 整体移除 |
| sidecar (测试) | `test_template_library.py` | 更新适配新 schema |

## 待确认

- 字体列表：中英文简历常用的系统字体列表需确认。
- 预设数量：3 套是否够，是否需要"商务"等更多预设。
- 面板默认展开哪些折叠组：全部展开还是只展开"排版"。
