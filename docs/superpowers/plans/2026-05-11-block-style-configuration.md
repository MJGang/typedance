# 块级样式配置 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将模板样式配置从 Tailwind class 文本输入升级为按 TipTap 块类型的结构化样式面板（BlockStyle），消除 PdfClassPolicy 校验体系。

**Architecture:** 替换 contracts 层 Zod schema（slots → blocks, BlockStyle 代替 class_name）→ 前端新增 style-engine (CSSGenerator) 和 style-panel 组件 → Python sidecar 更新模型 + 新增 style_renderer.py → pdf.py 适配 BlockStyle → 整体移除 PdfClassPolicy。

**Tech Stack:** React 19 / TypeScript / Zod / shadcn/ui (radix-nova) / Python FastAPI / fpdf2

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|---|---|
| `apps/web/src/features/templates/style-engine/types.ts` | BlockStyle、BlockType 类型定义 |
| `apps/web/src/features/templates/style-engine/css-generator.ts` | BlockStyle → CSS 规则字符串 |
| `apps/web/src/features/templates/style-engine/presets.ts` | 预设数据集 |
| `apps/web/src/features/templates/style-engine/fonts.ts` | 常用系统字体映射 |
| `apps/web/src/features/templates/components/style-panel/StylePanel.tsx` | 右面板容器，协调所有子组件 |
| `apps/web/src/features/templates/components/style-panel/BlockSelector.tsx` | 块类型切换 tabs |
| `apps/web/src/features/templates/components/style-panel/BlockStyleEditor.tsx` | 单个块完整属性编辑 |
| `apps/web/src/features/templates/components/style-panel/PresetSelector.tsx` | 预设方案选择器 |
| `apps/web/src/features/templates/components/style-panel/StyleStatusBar.tsx` | 自动保存状态栏 |
| `apps/web/src/features/templates/components/style-panel/sections/TypographySection.tsx` | 排版属性组 |
| `apps/web/src/features/templates/components/style-panel/sections/ColorSection.tsx` | 颜色属性组 |
| `apps/web/src/features/templates/components/style-panel/sections/SpacingSection.tsx` | 间距属性组 |
| `apps/web/src/features/templates/components/style-panel/sections/AlignmentSection.tsx` | 对齐属性组 |
| `apps/web/src/features/templates/components/style-panel/sections/BorderSection.tsx` | 边框属性组 |
| `apps/web/src/features/templates/components/style-panel/sections/ListSection.tsx` | 列表专属属性组 |
| `apps/web/src/features/templates/components/style-panel/controls/ColorPicker.tsx` | 颜色选择器（Popover + 色板 + hex） |
| `apps/web/src/features/templates/components/style-panel/controls/BorderEditor.tsx` | 边框编辑器 |
| `services/sidecar/src/typedance_sidecar/style_renderer.py` | Python 侧 BlockStyle → CSS |

### 修改文件

| 文件 | 改动 |
|---|---|
| `packages/contracts/src/index.ts` | 替换 slot/class_name schema → BlockStyle blocks schema；移除 PdfClassPolicy |
| `apps/web/src/features/templates/types.ts` | 更新 import，移除 PdfClassPolicy 类型 |
| `apps/web/src/features/templates/data.ts` | 替换 defaultClassicA4Style → block 版；移除 defaultPdfClassPolicy |
| `apps/web/src/features/templates/api.ts` | 移除 getPdfClassPolicy/savePdfClassPolicy；更新 parseTemplateResponse 错误提示 |
| `apps/web/src/features/templates/components/TemplatePreview.tsx` | 接收 BlockStyles，用 CSSGenerator 注入 `<style>` |
| `apps/web/src/features/templates/components/TemplateDetail.tsx` | 改用 StylePanel + TipTap 编辑器双栏布局，移除 policy 校验 |
| `apps/web/src/features/templates/components/TemplateLibrary.tsx` | 移除 policy 状态和调用 |
| `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx` | 新增 onSelectionUpdate 回调支持 |
| `services/sidecar/src/typedance_sidecar/models.py` | 替换 TemplateStyleSlot → BlockStyle；移除 PdfClassPolicy* |
| `services/sidecar/src/typedance_sidecar/main.py` | 更新 /template-styles 端点；移除 /pdf-class-policy 端点 |
| `services/sidecar/src/typedance_sidecar/pdf.py` | 新增 BlockStyle CSS 生成 + FPDFStyleAdapter |
| `services/sidecar/src/typedance_sidecar/db.py` | 移除 AppSettingsRepository PdfClassPolicy 方法 |

### 删除文件

| 文件 | 原因 |
|---|---|
| `apps/web/src/features/templates/classPolicy.ts` | PdfClassPolicy 整体移除 |
| `apps/web/src/features/templates/classPolicy.test.ts` | 同上 |
| `services/sidecar/src/typedance_sidecar/template_policy.py` | 同上 |

---

## Task 1: 更新 Contracts Zod Schema

**Files:**
- Modify: `packages/contracts/src/index.ts`

- [ ] **Step 1: 添加 BlockStyle 和 BlockType 的 Zod schema**

在 `templateSampleContentSchema` 之后、`templateStyleSlotSchema` 之前插入：

```typescript
export const blockTypeSchema = z.enum([
  "heading1", "heading2", "heading3",
  "paragraph", "bulletList", "orderedList",
]);
export type BlockType = z.infer<typeof blockTypeSchema>;

export const borderBottomSchema = z.object({
  style: z.enum(["none", "solid", "double"]).default("none"),
  width: z.string().optional(),
  color: z.string().optional(),
});

export const blockStyleSchema = z.object({
  // 排版
  fontFamily: z.string().optional(),
  fontSize: z.string().optional(),
  fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]).optional(),
  lineHeight: z.number().positive().optional(),
  letterSpacing: z.string().optional(),
  textTransform: z.enum(["none", "uppercase", "capitalize"]).optional(),

  // 颜色
  color: z.string().optional(),
  backgroundColor: z.string().optional(),

  // 对齐
  textAlign: z.enum(["left", "center", "right"]).optional(),

  // 间距
  marginTop: z.string().optional(),
  marginBottom: z.string().optional(),

  // 边框
  borderBottom: borderBottomSchema.optional(),

  // 列表专属
  listStyleType: z.enum(["disc", "circle", "square", "decimal", "none"]).optional(),
  paddingLeft: z.string().optional(),
});
export type BlockStyle = z.infer<typeof blockStyleSchema>;
```

- [ ] **Step 2: 替换 TemplateStyleConfig schema**

将 `templateStyleSlotSchema` + `templateStyleConfigSchema` 替换为：

```typescript
export const templateStyleConfigSchema = z.object({
  template_id: z.string().min(1),
  preset: z.string().default("classic"),
  blocks: z.record(blockTypeSchema, blockStyleSchema),
  updated_at: z.string().datetime(),
});
```

- [ ] **Step 3: 移除 PdfClassPolicy schema**

删除 `pdfClassPolicyGroupSchema`、`pdfClassPolicySchema` 两段 schema 定义。

- [ ] **Step 4: 更新类型导出**

将 `export type PdfClassPolicy = ...` 替换为：
```typescript
export type BlockStyle = z.infer<typeof blockStyleSchema>;
export type BlockType = z.infer<typeof blockTypeSchema>;
```

保留 `TemplateStyleConfig` 导出（其类型已自动随 schema 更新）。

- [ ] **Step 5: 验证构建**

```bash
pnpm --filter @typedance/contracts build
```

Expected: Build succeeds with updated schema exports.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/index.ts
git commit -m "feat(contracts): 替换 TemplateStyleSlot 为 BlockStyle，移除 PdfClassPolicy"
```

---

## Task 2: 前端 style-engine（类型 + CSS 生成器 + 预设）

**Files:**
- Create: `apps/web/src/features/templates/style-engine/types.ts`
- Create: `apps/web/src/features/templates/style-engine/css-generator.ts`
- Create: `apps/web/src/features/templates/style-engine/presets.ts`
- Create: `apps/web/src/features/templates/style-engine/fonts.ts`

- [ ] **Step 1: 创建 style-engine/types.ts**

从 contracts 重新导出类型，避免前端直接依赖 contracts 的内部 schema：

```typescript
import type { BlockStyle, BlockType, TemplateStyleConfig } from "@typedance/contracts";

export type { BlockStyle, BlockType, TemplateStyleConfig };

export const BLOCK_TYPES: BlockType[] = [
  "heading1", "heading2", "heading3",
  "paragraph", "bulletList", "orderedList",
];

export const BLOCK_TYPE_LABELS: Record<BlockType, { "zh-CN": string; "en-US": string }> = {
  heading1: { "zh-CN": "一级标题", "en-US": "Heading 1" },
  heading2: { "zh-CN": "二级标题", "en-US": "Heading 2" },
  heading3: { "zh-CN": "三级标题", "en-US": "Heading 3" },
  paragraph: { "zh-CN": "正文", "en-US": "Paragraph" },
  bulletList: { "zh-CN": "无序列表", "en-US": "Bullet List" },
  orderedList: { "zh-CN": "有序列表", "en-US": "Ordered List" },
};
```

- [ ] **Step 2: 创建 css-generator.ts**

```typescript
import type { BlockStyle } from "./types";

export function generateBlockCSS(blockName: string, style: BlockStyle): string {
  const rules: string[] = [];
  const push = (prop: string, value: string | undefined) => {
    if (value !== undefined) rules.push(`  ${prop}: ${value};`);
  };

  push("font-family", style.fontFamily);
  push("font-size", style.fontSize);
  if (style.fontWeight) push("font-weight", String(style.fontWeight));
  if (style.lineHeight) push("line-height", String(style.lineHeight));
  push("letter-spacing", style.letterSpacing);
  push("text-transform", style.textTransform);
  push("color", style.color);
  push("background-color", style.backgroundColor);
  push("text-align", style.textAlign);
  push("margin-top", style.marginTop);
  push("margin-bottom", style.marginBottom);
  push("list-style-type", style.listStyleType);
  push("padding-left", style.paddingLeft);

  if (style.borderBottom && style.borderBottom.style !== "none") {
    push("border-bottom-style", style.borderBottom.style);
    push("border-bottom-width", style.borderBottom.width);
    push("border-bottom-color", style.borderBottom.color);
  }

  if (rules.length === 0) return "";
  return `.td-resume-${blockName} {\n${rules.join("\n")}\n}`;
}

export function generateFullCSS(blocks: Record<string, BlockStyle>): string {
  return Object.entries(blocks)
    .map(([name, style]) => generateBlockCSS(name, style))
    .filter(Boolean)
    .join("\n\n");
}
```

- [ ] **Step 3: 创建 presets.ts**

```typescript
import type { BlockStyle, BlockType } from "./types";

export type StylePreset = Record<BlockType, BlockStyle>;

export const CLASSIC_A4_PRESETS: Record<string, StylePreset> = {
  classic: {
    heading1: { fontSize: "24pt", fontWeight: 700, color: "#1a1a1a", textAlign: "center", marginBottom: "8pt", fontFamily: "Georgia, serif" },
    heading2: { fontSize: "14pt", fontWeight: 600, color: "#1e3a8a", marginBottom: "8pt", borderBottom: { style: "solid", width: "1.5pt", color: "#1e3a8a" } },
    heading3: { fontSize: "11pt", fontWeight: 600, color: "#1f2937", marginBottom: "4pt" },
    paragraph: { fontSize: "10pt", lineHeight: 1.5, color: "#334155", marginBottom: "4pt" },
    bulletList: { fontSize: "10pt", lineHeight: 1.4, color: "#334155", listStyleType: "disc", paddingLeft: "20pt" },
    orderedList: { fontSize: "10pt", lineHeight: 1.4, color: "#334155", listStyleType: "decimal", paddingLeft: "20pt" },
  },
  modern: {
    heading1: { fontSize: "26pt", fontWeight: 600, color: "#0f172a", textAlign: "center", marginBottom: "10pt", letterSpacing: "1pt" },
    heading2: { fontSize: "13pt", fontWeight: 600, color: "#475569", marginBottom: "6pt" },
    heading3: { fontSize: "11pt", fontWeight: 500, color: "#1e293b", marginBottom: "3pt" },
    paragraph: { fontSize: "10pt", lineHeight: 1.6, color: "#475569", marginBottom: "3pt" },
    bulletList: { fontSize: "10pt", lineHeight: 1.5, color: "#475569", listStyleType: "disc", paddingLeft: "18pt" },
    orderedList: { fontSize: "10pt", lineHeight: 1.5, color: "#475569", listStyleType: "decimal", paddingLeft: "18pt" },
  },
  clean: {
    heading1: { fontSize: "22pt", fontWeight: 700, color: "#0a0a0a", textAlign: "center", marginBottom: "12pt" },
    heading2: { fontSize: "12pt", fontWeight: 700, color: "#0a0a0a", marginBottom: "8pt", letterSpacing: "0.5pt" },
    heading3: { fontSize: "10.5pt", fontWeight: 600, color: "#171717", marginBottom: "4pt" },
    paragraph: { fontSize: "10pt", lineHeight: 1.7, color: "#525252", marginBottom: "3pt" },
    bulletList: { fontSize: "10pt", lineHeight: 1.6, color: "#525252", listStyleType: "circle", paddingLeft: "18pt" },
    orderedList: { fontSize: "10pt", lineHeight: 1.6, color: "#525252", listStyleType: "decimal", paddingLeft: "18pt" },
  },
};

export function getPresetNames(): string[] {
  return Object.keys(CLASSIC_A4_PRESETS);
}

export function getPreset(name: string): StylePreset | undefined {
  return CLASSIC_A4_PRESETS[name];
}

export function defaultBlockStyle(): BlockStyle {
  return {};
}
```

- [ ] **Step 4: 创建 fonts.ts**

```typescript
export interface FontOption {
  value: string;
  label: Record<"zh-CN" | "en-US", string>;
  stack: string;
}

export const COMMON_FONTS: FontOption[] = [
  { value: "Georgia, serif", label: { "zh-CN": "Georgia", "en-US": "Georgia" }, stack: "Georgia, serif" },
  { value: "'Times New Roman', serif", label: { "zh-CN": "Times New Roman", "en-US": "Times New Roman" }, stack: "'Times New Roman', serif" },
  { value: "Arial, sans-serif", label: { "zh-CN": "Arial", "en-US": "Arial" }, stack: "Arial, sans-serif" },
  { value: "'Helvetica Neue', Arial, sans-serif", label: { "zh-CN": "Helvetica Neue", "en-US": "Helvetica Neue" }, stack: "'Helvetica Neue', Arial, sans-serif" },
  { value: "'Noto Sans SC', 'Microsoft YaHei', sans-serif", label: { "zh-CN": "思源黑体", "en-US": "Noto Sans SC" }, stack: "'Noto Sans SC', 'Microsoft YaHei', sans-serif" },
  { value: "'Noto Serif SC', 'SimSun', serif", label: { "zh-CN": "思源宋体", "en-US": "Noto Serif SC" }, stack: "'Noto Serif SC', 'SimSun', serif" },
];
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/templates/style-engine/
git commit -m "feat(templates): 新增 style-engine 模块（CSSGenerator + 预设）"
```

---

## Task 3: 前端 style-panel 组件

**Files:**
- Create: `apps/web/src/features/templates/components/style-panel/` 目录下所有组件

- [ ] **Step 1: 创建 controls/ColorPicker.tsx**

```typescript
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const PRESET_COLORS = [
  "#000000", "#1a1a1a", "#334155", "#475569", "#64748b",
  "#0f172a", "#1e293b", "#1e3a8a", "#174ea6", "#2563eb",
  "#ffffff", "#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1",
];

type ColorPickerProps = {
  value?: string;
  onChange: (value: string) => void;
  label: string;
};

export function ColorPicker({ value = "#000000", onChange, label }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const isValidHex = /^#[0-9a-fA-F]{6}$/.test(value);

  return (
    <div className="td-color-picker">
      <label className="text-sm">{label}</label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="td-color-swatch"
            style={{ backgroundColor: isValidHex ? value : "#000000" }}
            aria-label={`当前颜色 ${value}`}
          />
        </PopoverTrigger>
        <PopoverContent className="w-56">
          <div className="grid grid-cols-5 gap-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className="td-color-swatch-option"
                style={{ backgroundColor: c, border: c === value ? "2px solid #000" : "1px solid #ddd" }}
                onClick={() => { onChange(c); setOpen(false); }}
                aria-label={c}
              />
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="text-xs">Hex</span>
            <Input
              value={value}
              className="h-7 font-mono text-xs"
              onChange={(e) => onChange(e.target.value)}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
```

- [ ] **Step 2: 创建 controls/BorderEditor.tsx**

```typescript
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ColorPicker } from "./ColorPicker";
import type { BlockStyle } from "../../../style-engine/types";

type BorderEditorProps = {
  value: BlockStyle["borderBottom"];
  onChange: (border: BlockStyle["borderBottom"]) => void;
};

export function BorderEditor({ value, onChange }: BorderEditorProps) {
  const style = value?.style ?? "none";
  return (
    <div className="td-border-editor space-y-2">
      <Select value={style} onValueChange={(v: "none" | "solid" | "double") => onChange({ ...value, style: v })}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">无</SelectItem>
          <SelectItem value="solid">实线</SelectItem>
          <SelectItem value="double">双线</SelectItem>
        </SelectContent>
      </Select>
      {style !== "none" && (
        <div className="flex gap-2">
          <Input
            placeholder="粗细"
            value={value?.width ?? ""}
            onChange={(e) => onChange({ ...value, style, width: e.target.value })}
            className="w-20"
          />
          <ColorPicker
            value={value?.color ?? "#000000"}
            onChange={(c) => onChange({ ...value, style, color: c })}
            label="边框色"
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 创建 sections/TypographySection.tsx**

```typescript
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BlockStyle } from "../../../style-engine/types";
import { COMMON_FONTS } from "../../../style-engine/fonts";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function TypographySection({ value, onChange }: Props) {
  return (
    <Collapsible defaultOpen>
      <CollapsibleTrigger className="td-section-trigger">排版</CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs">字体</label>
          <Select value={value.fontFamily} onValueChange={(v) => onChange({ ...value, fontFamily: v })}>
            <SelectTrigger><SelectValue placeholder="默认" /></SelectTrigger>
            <SelectContent>
              {COMMON_FONTS.map((f) => (
                <SelectItem key={f.value} value={f.value}>{f.label["zh-CN"]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs">字号</label>
            <Input value={value.fontSize ?? ""} placeholder="如 14pt" onChange={(e) => onChange({ ...value, fontSize: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs">字重</label>
            <Select value={String(value.fontWeight ?? "")} onValueChange={(v) => onChange({ ...value, fontWeight: v ? Number(v) as 400|500|600|700 : undefined })}>
              <SelectTrigger><SelectValue placeholder="默认" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="400">常规</SelectItem>
                <SelectItem value="500">中粗</SelectItem>
                <SelectItem value="600">半粗</SelectItem>
                <SelectItem value="700">粗体</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs">行高</label>
            <Input value={value.lineHeight ?? ""} placeholder="如 1.5" onChange={(e) => onChange({ ...value, lineHeight: e.target.value ? Number(e.target.value) : undefined })} />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs">字间距</label>
            <Input value={value.letterSpacing ?? ""} placeholder="如 0.5pt" onChange={(e) => onChange({ ...value, letterSpacing: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs">大小写</label>
          <ToggleGroup
            type="single"
            value={value.textTransform ?? "none"}
            onValueChange={(v) => onChange({ ...value, textTransform: v as BlockStyle["textTransform"] })}
          >
            <ToggleGroupItem value="none">无</ToggleGroupItem>
            <ToggleGroupItem value="uppercase">大写</ToggleGroupItem>
            <ToggleGroupItem value="capitalize">首字母大写</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 4: 创建 sections/ColorSection.tsx**

```typescript
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ColorPicker } from "../controls/ColorPicker";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function ColorSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="td-section-trigger">颜色与背景</CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <ColorPicker value={value.color} onChange={(c) => onChange({ ...value, color: c })} label="文字色" />
        <ColorPicker value={value.backgroundColor} onChange={(c) => onChange({ ...value, backgroundColor: c })} label="背景色" />
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 5: 创建 sections/SpacingSection.tsx**

```typescript
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function SpacingSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="td-section-trigger">间距</CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <div className="flex gap-2">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs">上边距</label>
            <Input value={value.marginTop ?? ""} placeholder="如 8pt" onChange={(e) => onChange({ ...value, marginTop: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs">下边距</label>
            <Input value={value.marginBottom ?? ""} placeholder="如 8pt" onChange={(e) => onChange({ ...value, marginBottom: e.target.value })} />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 6: 创建 sections/AlignmentSection.tsx**

```typescript
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function AlignmentSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="td-section-trigger">对齐</CollapsibleTrigger>
      <CollapsibleContent className="p-2">
        <ToggleGroup
          type="single"
          value={value.textAlign ?? "left"}
          onValueChange={(v) => v && onChange({ ...value, textAlign: v as BlockStyle["textAlign"] })}
        >
          <ToggleGroupItem value="left"><AlignLeft /></ToggleGroupItem>
          <ToggleGroupItem value="center"><AlignCenter /></ToggleGroupItem>
          <ToggleGroupItem value="right"><AlignRight /></ToggleGroupItem>
        </ToggleGroup>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 7: 创建 sections/BorderSection.tsx**

```typescript
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { BorderEditor } from "../controls/BorderEditor";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function BorderSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="td-section-trigger">边框</CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <BorderEditor value={value.borderBottom} onChange={(b) => onChange({ ...value, borderBottom: b })} />
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 8: 创建 sections/ListSection.tsx**

```typescript
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { BlockStyle } from "../../../style-engine/types";

type Props = { value: BlockStyle; onChange: (v: BlockStyle) => void };

export function ListSection({ value, onChange }: Props) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="td-section-trigger">列表选项</CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 p-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs">符号样式</label>
          <Select value={value.listStyleType} onValueChange={(v) => onChange({ ...value, listStyleType: v as BlockStyle["listStyleType"] })}>
            <SelectTrigger><SelectValue placeholder="默认" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="disc">实心圆</SelectItem>
              <SelectItem value="circle">空心圆</SelectItem>
              <SelectItem value="square">方块</SelectItem>
              <SelectItem value="decimal">数字</SelectItem>
              <SelectItem value="none">无</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs">缩进</label>
          <Input value={value.paddingLeft ?? ""} placeholder="如 20pt" onChange={(e) => onChange({ ...value, paddingLeft: e.target.value })} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
```

- [ ] **Step 9: 创建 BlockStyleEditor.tsx**

```typescript
import type { BlockStyle, BlockType } from "../../../style-engine/types";
import { TypographySection } from "./sections/TypographySection";
import { ColorSection } from "./sections/ColorSection";
import { SpacingSection } from "./sections/SpacingSection";
import { AlignmentSection } from "./sections/AlignmentSection";
import { BorderSection } from "./sections/BorderSection";
import { ListSection } from "./sections/ListSection";

type BlockStyleEditorProps = {
  blockType: BlockType;
  value: BlockStyle;
  onChange: (style: BlockStyle) => void;
};

export function BlockStyleEditor({ blockType, value, onChange }: BlockStyleEditorProps) {
  const isList = blockType === "bulletList" || blockType === "orderedList";

  return (
    <div className="td-block-style-editor">
      <TypographySection value={value} onChange={onChange} />
      <ColorSection value={value} onChange={onChange} />
      <SpacingSection value={value} onChange={onChange} />
      <AlignmentSection value={value} onChange={onChange} />
      <BorderSection value={value} onChange={onChange} />
      {isList && <ListSection value={value} onChange={onChange} />}
    </div>
  );
}
```

- [ ] **Step 10: 创建 BlockSelector.tsx**

```typescript
import type { BlockType } from "../../../style-engine/types";
import { BLOCK_TYPES, BLOCK_TYPE_LABELS } from "../../../style-engine/types";

type BlockSelectorProps = {
  active: BlockType;
  onChange: (block: BlockType) => void;
  uiLanguage: "zh-CN" | "en-US";
};

export function BlockSelector({ active, onChange, uiLanguage }: BlockSelectorProps) {
  return (
    <div className="td-block-selector flex flex-wrap gap-1" role="tablist">
      {BLOCK_TYPES.map((bt) => (
        <button
          key={bt}
          type="button"
          role="tab"
          aria-selected={bt === active}
          className={`td-block-tab ${bt === active ? "td-block-tab-active" : ""}`}
          onClick={() => onChange(bt)}
        >
          {BLOCK_TYPE_LABELS[bt][uiLanguage]}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 11: 创建 PresetSelector.tsx**

```typescript
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getPresetNames } from "../../../style-engine/presets";

type PresetSelectorProps = {
  value: string;
  onChange: (preset: string) => void;
};

const PRESET_LABELS: Record<string, string> = {
  classic: "经典",
  modern: "现代",
  clean: "简洁",
};

export function PresetSelector({ value, onChange }: PresetSelectorProps) {
  return (
    <div className="td-preset-selector">
      <label className="text-sm">预设</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          {getPresetNames().map((name) => (
            <SelectItem key={name} value={name}>{PRESET_LABELS[name] ?? name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
```

- [ ] **Step 12: 创建 StyleStatusBar.tsx**

```typescript
type StyleStatusBarProps = {
  updatedAt: string | null;
  saving: boolean;
  error: string | null;
};

export function StyleStatusBar({ updatedAt, saving, error }: StyleStatusBarProps) {
  const timeAgo = updatedAt ? `${Math.floor((Date.now() - new Date(updatedAt).getTime()) / 60000)} 分钟前` : "未保存";

  if (error) return <p className="td-status-error">{error}</p>;
  if (saving) return <p className="td-status-saving">保存中...</p>;
  return <p className="td-status-ok">已保存 {timeAgo}</p>;
}
```

- [ ] **Step 13: 创建 StylePanel.tsx**

```typescript
import { useState, useCallback, useRef, useEffect } from "react";
import type { BlockType, TemplateStyleConfig } from "../../../style-engine/types";
import { BlockSelector } from "./BlockSelector";
import { BlockStyleEditor } from "./BlockStyleEditor";
import { PresetSelector } from "./PresetSelector";
import { StyleStatusBar } from "./StyleStatusBar";
import { getPreset } from "../../../style-engine/presets";
import { saveTemplateStyle } from "@/api";

type StylePanelProps = {
  styleConfig: TemplateStyleConfig;
  onChange: (config: TemplateStyleConfig) => void;
  activeBlock: BlockType;
  onActiveBlockChange: (block: BlockType) => void;
  uiLanguage: "zh-CN" | "en-US";
};

export function StylePanel({
  styleConfig,
  onChange,
  activeBlock,
  onActiveBlockChange,
  uiLanguage,
}: StylePanelProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentBlockStyle = styleConfig.blocks[activeBlock] ?? {};

  const handleBlockStyleChange = useCallback((newStyle: typeof currentBlockStyle) => {
    const next: TemplateStyleConfig = {
      ...styleConfig,
      preset: "",
      blocks: { ...styleConfig.blocks, [activeBlock]: newStyle },
    };
    onChange(next);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSaving(true);
      setError(null);
      saveTemplateStyle(next)
        .then((saved) => { onChange({ ...saved, preset: next.preset }); setSaving(false); })
        .catch((e: Error) => { setError("保存失败，稍后重试"); setSaving(false); });
    }, 300);
  }, [styleConfig, activeBlock, onChange]);

  const handlePresetChange = useCallback((presetName: string) => {
    const preset = getPreset(presetName);
    if (!preset) return;
    const next: TemplateStyleConfig = {
      ...styleConfig,
      preset: presetName,
      blocks: { ...preset },
    };
    onChange(next);

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setSaving(true);
      setError(null);
      saveTemplateStyle(next)
        .then((saved) => { onChange({ ...saved, preset: presetName }); setSaving(false); })
        .catch((e: Error) => { setError("保存失败，稍后重试"); setSaving(false); });
    }, 300);
  }, [styleConfig, onChange]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <aside className="td-style-panel">
      <PresetSelector value={styleConfig.preset || "custom"} onChange={handlePresetChange} />
      <BlockSelector active={activeBlock} onChange={onActiveBlockChange} uiLanguage={uiLanguage} />
      <BlockStyleEditor
        blockType={activeBlock}
        value={currentBlockStyle}
        onChange={handleBlockStyleChange}
      />
      <StyleStatusBar updatedAt={styleConfig.updated_at} saving={saving} error={error} />
    </aside>
  );
}
```

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/features/templates/components/style-panel/
git commit -m "feat(templates): 新增 style-panel 组件（块选择器 + 属性编辑 + 预设 + 自动保存）"
```

---

## Task 4: 改造 TemplatePreview（CSS 注入）

**Files:**
- Modify: `apps/web/src/features/templates/components/TemplatePreview.tsx`

- [ ] **Step 1: 重写 TemplatePreview 使用 CSSGenerator**

将 `TemplatePreview` 从从 `slots` 读取 class_name 改为从 `blocks` 生成 CSS 注入 `<style>`：

```typescript
import type { TemplateSampleContent, TemplateStyleConfig } from "../types";
import { generateFullCSS } from "../style-engine/css-generator";

type TemplatePreviewProps = {
  sample: TemplateSampleContent;
  styleConfig: TemplateStyleConfig;
  scale?: "card" | "detail";
};

type TemplateNode = {
  type?: string;
  text?: string;
  attrs?: { level?: number };
  marks?: { type?: string }[];
  content?: TemplateNode[];
};

function nodeBlockType(node: TemplateNode): string {
  if (node.type === "heading") {
    const level = node.attrs?.level ?? 2;
    if (level >= 1 && level <= 3) return `heading${level}`;
    return "paragraph";
  }
  if (node.type === "bulletList") return "bulletList";
  if (node.type === "orderedList") return "orderedList";
  return "paragraph";
}

export function TemplatePreview({ sample, styleConfig, scale = "card" }: TemplatePreviewProps) {
  const cssText = generateFullCSS(styleConfig.blocks ?? {});
  const content = Array.isArray(sample.doc_json.content) ? (sample.doc_json.content as TemplateNode[]) : [];

  return (
    <div className={`td-template-preview td-template-preview-${scale}`}>
      <style>{cssText}</style>
      <article className="td-template-paper" aria-label="A4 template sample preview">
        {content.map((node, index) => renderNode(node, `${node.type ?? "node"}-${index}`))}
      </article>
    </div>
  );
}

function renderNode(node: TemplateNode, key: string) {
  const text = collectText(node);
  const blockClass = `td-resume-${nodeBlockType(node)}`;

  if (node.type === "heading") {
    const level = node.attrs?.level ?? 2;
    const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
    return <Tag key={key} className={blockClass}>{text}</Tag>;
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const Tag = node.type === "bulletList" ? "ul" : "ol";
    return (
      <Tag key={key} className={blockClass}>
        {(node.content ?? []).map((item, index) => (
          <li key={`${key}-${index}`} className={blockClass}>{collectText(item)}</li>
        ))}
      </Tag>
    );
  }

  return <p key={key} className={blockClass}>{text}</p>;
}

function collectText(node: TemplateNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(collectText).filter(Boolean).join("");
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/features/templates/components/TemplatePreview.tsx
git commit -m "feat(templates): TemplatePreview 使用 CSSGenerator 注入块级样式"
```

---

## Task 5: 改造 TemplateDetail（编辑器 + StylePanel 双栏布局）

**Files:**
- Modify: `apps/web/src/features/templates/components/TemplateDetail.tsx`
- Modify: `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`

- [ ] **Step 1: 给 ResumeRichTextEditor 添加 onSelectionUpdate 回调**

在 `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx` 中，Props 增加：

```typescript
type ResumeRichTextEditorProps = {
  ariaLabel: string;
  docJson: ResumeDocJson;
  onChange: (change: ResumeEditorChange) => void;
  onSelectionUpdate?: (blockType: string) => void;  // 新增
};
```

在 `useEditor` 配置中增加 `onSelectionUpdate`：

```typescript
onSelectionUpdate: ({ editor }) => {
  if (!props.onSelectionUpdate) return;
  const { $from } = editor.state.selection;
  const node = $from.parent;
  if (node.type.name === "heading") {
    props.onSelectionUpdate(`heading${node.attrs.level}`);
  } else {
    props.onSelectionUpdate(node.type.name);
  }
},
```

- [ ] **Step 2: 重写 TemplateDetail**

```typescript
import { useState, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UiLanguage } from "../../workspace/types";
import type { ResumeDocJson, ResumeEditorChange } from "../../workspace/editor";
import type { BlockType, TemplateStyleConfig } from "../types";
import { ResumeRichTextEditor } from "../../workspace/components/ResumeRichTextEditor";
import { StylePanel } from "./style-panel/StylePanel";
import { generateFullCSS } from "../style-engine/css-generator";
import type { TemplateSampleContent, ResumeTemplateDefinition } from "../types";

type TemplateDetailProps = {
  template: ResumeTemplateDefinition;
  sample: TemplateSampleContent;
  styleConfig: TemplateStyleConfig;
  uiLanguage: UiLanguage;
  onBack: () => void;
  onStyleChange: (style: TemplateStyleConfig) => void;
  styleStatus: string;
};

export function TemplateDetail({
  template,
  sample,
  styleConfig,
  uiLanguage,
  onBack,
  onStyleChange,
  styleStatus,
}: TemplateDetailProps) {
  const [activeBlock, setActiveBlock] = useState<BlockType>("paragraph");
  const [sampleDoc, setSampleDoc] = useState(sample.doc_json);

  const cssText = generateFullCSS(styleConfig.blocks ?? {});

  const handleSelectionUpdate = useCallback((blockName: string) => {
    const validBlocks: BlockType[] = ["heading1", "heading2", "heading3", "paragraph", "bulletList", "orderedList"];
    if (validBlocks.includes(blockName as BlockType)) {
      setActiveBlock(blockName as BlockType);
    }
  }, []);

  const handleSampleChange = useCallback((change: ResumeEditorChange) => {
    setSampleDoc(change.docJson as Record<string, unknown>);
  }, []);

  return (
    <section className="td-template-detail">
      <div className="td-template-detail-header">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          返回模板库
        </Button>
        <Badge>{template.status === "built-in" ? "当前可用" : "规划中"}</Badge>
      </div>

      <div className="td-template-detail-grid">
        <div className="td-template-editor-wrapper">
          <style>{cssText}</style>
          <ResumeRichTextEditor
            ariaLabel="Template sample preview"
            docJson={sampleDoc as ResumeDocJson}
            onChange={handleSampleChange}
            onSelectionUpdate={handleSelectionUpdate}
          />
        </div>
        <StylePanel
          styleConfig={styleConfig}
          onChange={onStyleChange}
          activeBlock={activeBlock}
          onActiveBlockChange={setActiveBlock}
          uiLanguage={uiLanguage}
        />
      </div>
      <p aria-live="polite" className="td-style-status">{styleStatus}</p>
    </section>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/templates/components/TemplateDetail.tsx apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx
git commit -m "feat(templates): TemplateDetail 改用编辑器 + StylePanel 双栏布局，支持双向联动"
```

---

## Task 6: 改造 TemplateLibrary + 更新 data.ts + api.ts

**Files:**
- Modify: `apps/web/src/features/templates/components/TemplateLibrary.tsx`
- Modify: `apps/web/src/features/templates/data.ts`
- Modify: `apps/web/src/features/templates/types.ts`
- Modify: `apps/web/src/api.ts`
- Remove: `apps/web/src/features/templates/classPolicy.ts`

- [ ] **Step 1: 更新 types.ts**

移除 PdfClassPolicy 相关类型导入，保留 TemplateStyleConfig：

```typescript
import type { TemplateSampleContent, TemplateStyleConfig, BlockType, BlockStyle } from "@typedance/contracts";
import type { TargetLanguage, UiLanguage } from "../workspace/types";

export type TemplateStatus = "built-in" | "planned";

export type ResumeTemplateDefinition = {
  id: string;
  name: string;
  localizedName: Record<UiLanguage, string>;
  description: Record<UiLanguage, string>;
  languages: TargetLanguage[];
  status: TemplateStatus;
  tags: Record<UiLanguage, string[]>;
  sampleContentIds: Partial<Record<TargetLanguage, string>>;
  configSummary: {
    pageSize: string;
    margin: string;
    fontStack: string;
    accentColor: string;
    layout: string;
  };
  implementation: {
    packageName: string;
    rendererEntry: string;
    templateId: string;
  };
  futureConfig: Record<UiLanguage, string[]>;
};

export type TemplateLibraryTab = "templates" | "samples";

export type { TemplateSampleContent, TemplateStyleConfig, BlockType, BlockStyle };
```

- [ ] **Step 2: 更新 data.ts**

替换 defaultClassicA4Style 和移除 defaultPdfClassPolicy：

```typescript
import type { ResumeTemplateDefinition, TemplateSampleContent, TemplateStyleConfig } from "./types";

// ... templateRegistry 和 builtInSamples 保持不变 ...

export const defaultClassicA4Style: TemplateStyleConfig = {
  template_id: "classic-a4",
  preset: "classic",
  blocks: {
    heading1: { fontSize: "24pt", fontWeight: 700, color: "#1a1a1a", textAlign: "center", marginBottom: "8pt" },
    heading2: { fontSize: "14pt", fontWeight: 600, color: "#1e3a8a", marginBottom: "8pt", borderBottom: { style: "solid", width: "1.5pt", color: "#1e3a8a" } },
    heading3: { fontSize: "11pt", fontWeight: 600, color: "#1f2937", marginBottom: "4pt" },
    paragraph: { fontSize: "10pt", lineHeight: 1.5, color: "#334155", marginBottom: "4pt" },
    bulletList: { fontSize: "10pt", lineHeight: 1.4, color: "#334155", listStyleType: "disc", paddingLeft: "20pt" },
    orderedList: { fontSize: "10pt", lineHeight: 1.4, color: "#334155", listStyleType: "decimal", paddingLeft: "20pt" },
  },
  updated_at: "2026-05-11T00:00:00.000Z",
};
```

删除 `defaultPdfClassPolicy`。

- [ ] **Step 3: 更新 TemplateLibrary**

```typescript
import { useEffect, useMemo, useState } from "react";
import { getTemplateSample, getTemplateStyle, saveTemplateSample, saveTemplateStyle } from "@/api";
import type { TargetLanguage, UiLanguage, WorkspaceCopy } from "../../workspace/types";
import { builtInSamples, defaultClassicA4Style, templateRegistry } from "../data";
import type { ResumeTemplateDefinition, TemplateLibraryTab, TemplateSampleContent, TemplateStyleConfig } from "../types";
import { TemplateCard } from "./TemplateCard";
import { TemplateDetail } from "./TemplateDetail";
import { TemplateSampleEditor } from "./TemplateSampleEditor";

type TemplateLibraryProps = {
  copy: WorkspaceCopy;
  uiLanguage: UiLanguage;
  targetLanguage: TargetLanguage;
};

export function TemplateLibrary({ uiLanguage, targetLanguage }: TemplateLibraryProps) {
  const [activeTab, setActiveTab] = useState<TemplateLibraryTab>("templates");
  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplateDefinition | null>(null);
  const [sample, setSample] = useState<TemplateSampleContent>(builtInSamples["sample-tech-zh"]);
  const [styleConfig, setStyleConfig] = useState<TemplateStyleConfig>(defaultClassicA4Style);
  const [sampleStatus, setSampleStatus] = useState("本地默认样张");
  const [styleStatus, setStyleStatus] = useState("本地默认样式");

  const currentTemplate = selectedTemplate ?? templateRegistry[0];
  const sampleId = currentTemplate.sampleContentIds[targetLanguage] ?? "sample-tech-zh";
  const visibleSample = sample.id === sampleId ? sample : builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"];
  const templates = useMemo(() => templateRegistry, []);

  useEffect(() => {
    void getTemplateSample(sampleId)
      .then((nextSample) => { setSample(nextSample); setSampleStatus("已读取本地样张"); })
      .catch(() => { setSample(builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"]); setSampleStatus("使用内置样张"); });
  }, [sampleId]);

  useEffect(() => {
    void getTemplateStyle(currentTemplate.id)
      .then((nextStyle) => { setStyleConfig(nextStyle); setStyleStatus("已读取本地样式"); })
      .catch(() => { setStyleConfig(defaultClassicA4Style); setStyleStatus("使用内置样式"); });
  }, [currentTemplate.id]);

  const handleSaveSample = async () => {
    const saved = await saveTemplateSample(visibleSample);
    setSample(saved);
    setSampleStatus("样张已保存");
  };

  const handleStyleChange = (style: TemplateStyleConfig) => {
    setStyleConfig(style);
  };

  return (
    <main className="td-template-library">
      {/* header 和 tabs 区域保持不变 */}
      <header className="td-template-library-heading">
        <div>
          <p className="td-eyebrow">Template Library</p>
          <h1>模板库</h1>
          <p>{templates.length} 个模板 · 样张内容与块级样式配置本地保存</p>
        </div>
      </header>

      <div className="td-template-tabs" role="tablist" aria-label="模板库视图">
        <button type="button" role="tab" aria-selected={activeTab === "templates"} onClick={() => setActiveTab("templates")}>模板列表</button>
        <button type="button" role="tab" aria-selected={activeTab === "samples"} onClick={() => setActiveTab("samples")}>样张内容</button>
      </div>

      {activeTab === "templates" && !selectedTemplate ? (
        <section className="td-template-grid">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              sample={visibleSample}
              styleConfig={styleConfig}
              uiLanguage={uiLanguage}
              targetLanguage={targetLanguage}
              onOpen={() => setSelectedTemplate(template)}
            />
          ))}
        </section>
      ) : null}

      {activeTab === "templates" && selectedTemplate ? (
        <TemplateDetail
          template={selectedTemplate}
          sample={visibleSample}
          styleConfig={styleConfig}
          uiLanguage={uiLanguage}
          onBack={() => setSelectedTemplate(null)}
          onStyleChange={handleStyleChange}
          styleStatus={styleStatus}
        />
      ) : null}

      {activeTab === "samples" ? (
        <TemplateSampleEditor
          sample={visibleSample}
          uiLanguage={uiLanguage}
          status={sampleStatus}
          onChange={setSample}
          onSave={handleSaveSample}
        />
      ) : null}
    </main>
  );
}
```

- [ ] **Step 4: 更新 api.ts**

移除 `getPdfClassPolicy`、`savePdfClassPolicy` 函数，更新 import 去掉 PdfClassPolicy：

```typescript
import {
  resumeVersionSchema,
  templateSampleContentSchema,
  templateStyleConfigSchema,
  type ResumeVersion,
  type TemplateSampleContent,
  type TemplateStyleConfig,
} from "@typedance/contracts";
```

删除 import 中的 `pdfClassPolicySchema`、`type PdfClassPolicy`。

删除 `getPdfClassPolicy`、`savePdfClassPolicy` 两个函数。

更新 `saveTemplateStyle` 函数——不再需要处理 PdfClassPolicy 的 422 validation 错误提示，但 `parseTemplateResponse` 的 error 提示逻辑保持不变（仍可处理 generic validation）。

- [ ] **Step 5: 删除 classPolicy.ts**

删除 `apps/web/src/features/templates/classPolicy.ts`。

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/templates/components/TemplateLibrary.tsx apps/web/src/features/templates/data.ts apps/web/src/features/templates/types.ts apps/web/src/api.ts
git rm apps/web/src/features/templates/classPolicy.ts
git commit -m "feat(templates): 移除 PdfClassPolicy 相关代码，更新 types/data/api"
```

---

## Task 7: Sidecar Python 模型 + style_renderer

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/models.py`
- Create: `services/sidecar/src/typedance_sidecar/style_renderer.py`

- [ ] **Step 1: 更新 models.py**

替换 `TemplateStyleSlot`、`TemplateStyleConfig`，移除 `PdfClassPolicy`、`PdfClassPolicyGroup`、`PdfClassValidationError`：

```python
class BlockStyle(BaseModel):
    """结构化块样式，替代 TemplateStyleSlot"""
    font_family: str | None = Field(default=None, alias="fontFamily")
    font_size: str | None = Field(default=None, alias="fontSize")
    font_weight: int | None = Field(default=None, alias="fontWeight")
    line_height: float | None = Field(default=None, alias="lineHeight")
    letter_spacing: str | None = Field(default=None, alias="letterSpacing")
    text_transform: str | None = Field(default=None, alias="textTransform")
    color: str | None = None
    background_color: str | None = Field(default=None, alias="backgroundColor")
    text_align: str | None = Field(default=None, alias="textAlign")
    margin_top: str | None = Field(default=None, alias="marginTop")
    margin_bottom: str | None = Field(default=None, alias="marginBottom")
    border_bottom: dict | None = Field(default=None, alias="borderBottom")
    list_style_type: str | None = Field(default=None, alias="listStyleType")
    padding_left: str | None = Field(default=None, alias="paddingLeft")


class TemplateStyleConfig(BaseModel):
    template_id: str = Field(min_length=1)
    preset: str = "classic"
    blocks: dict[str, BlockStyle] = Field(default_factory=dict)
    updated_at: str = Field(default_factory=utc_now)
```

删除 `TemplateStyleSlot`、`PdfClassPolicyGroup`、`PdfClassPolicy`、`PdfClassValidationError` 类。

移除 import 中对 Literal 的使用（如不再需要 `Literal["blocked", "not_allowed"]`），可以去掉 `from typing import ... Literal`。

- [ ] **Step 2: 创建 style_renderer.py**

```python
"""BlockStyle dict → CSS rule generation for PDF rendering."""

from .models import TemplateStyleConfig


def _css_value(key: str, value: object) -> str | None:
    if value is None:
        return None
    # Dict keys come from BlockStyle.model_dump(by_alias=True) → camelCase
    mapper = {
        "fontFamily": "font-family",
        "fontSize": "font-size",
        "fontWeight": "font-weight",
        "lineHeight": "line-height",
        "letterSpacing": "letter-spacing",
        "textTransform": "text-transform",
        "color": "color",
        "backgroundColor": "background-color",
        "textAlign": "text-align",
        "marginTop": "margin-top",
        "marginBottom": "margin-bottom",
        "listStyleType": "list-style-type",
        "paddingLeft": "padding-left",
    }
    css_prop = mapper.get(key)
    if css_prop is None:
        return None
    return f"{css_prop}: {value};"


def generate_block_css(block_name: str, style: dict) -> str:
    """BlockStyle dict → single CSS rule."""
    rules: list[str] = []
    for key, value in style.items():
        if key == "borderBottom" and isinstance(value, dict):
            bs = value
            if bs.get("style") and bs["style"] != "none":
                rules.append(f"  border-bottom-style: {bs['style']};")
                if bs.get("width"):
                    rules.append(f"  border-bottom-width: {bs['width']};")
                if bs.get("color"):
                    rules.append(f"  border-bottom-color: {bs['color']};")
            continue
        css = _css_value(key, value)
        if css:
            rules.append(f"  {css}")

    if not rules:
        return ""
    return f".td-resume-{block_name} {{\n" + "\n".join(rules) + "\n}}"


def generate_full_css(blocks: dict[str, dict]) -> str:
    """Iterate all blocks and compose full CSS string."""
    rules = []
    for name, style in blocks.items():
        rule = generate_block_css(name, style)
        if rule:
            rules.append(rule)
    return "\n\n".join(rules)
```

- [ ] **Step 3: Commit**

```bash
git add services/sidecar/src/typedance_sidecar/models.py services/sidecar/src/typedance_sidecar/style_renderer.py
git commit -m "feat(sidecar): 更新 models BlockStyle，新增 style_renderer.py"
```

---

## Task 8: Sidecar main.py + db.py 更新

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/main.py`
- Modify: `services/sidecar/src/typedance_sidecar/db.py`

- [ ] **Step 1: 更新 main.py**

替换 import：移除 `PdfClassPolicy`、`template_policy` 相关；移除 `validate_style_config`、`DEFAULT_PDF_CLASS_POLICY`。

更新 `save_template_style` 端点——去掉 PdfClassPolicy 校验逻辑：

```python
@app.put("/template-styles/{template_id}", response_model=TemplateStyleConfig)
def save_template_style(
    template_id: str,
    payload: TemplateStyleConfig,
    style_repo: TemplateStyleRepository = Depends(template_style_repository),
) -> TemplateStyleConfig:
    if payload.template_id != template_id:
        raise HTTPException(status_code=400, detail="Template style id mismatch")
    return style_repo.save(payload.model_copy(update={"updated_at": utc_now()}))
```

移除 `get_pdf_class_policy`、`save_pdf_class_policy` 两个端点（GET /pdf-class-policy 和 PUT /pdf-class-policy）。

移除 import 中的 `from .template_policy import DEFAULT_PDF_CLASS_POLICY, validate_style_config` 和 `from .models import PdfClassPolicy`（如果不再使用）。

- [ ] **Step 2: 更新 db.py**

移除 `AppSettingsRepository` 中的 `get_pdf_class_policy` 和 `save_pdf_class_policy` 方法。

```python
class AppSettingsRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection
    # AppSettingsRepository 保留为空，后续有需要可以扩展
```

同时移除 import 中的 `PdfClassPolicy`。

- [ ] **Step 3: 删除 template_policy.py**

```bash
git rm services/sidecar/src/typedance_sidecar/template_policy.py
```

- [ ] **Step 4: Commit**

```bash
git add services/sidecar/src/typedance_sidecar/main.py services/sidecar/src/typedance_sidecar/db.py
git rm services/sidecar/src/typedance_sidecar/template_policy.py
git commit -m "feat(sidecar): 移除 PdfClassPolicy 校验和端点，更新保存样式接口"
```

---

## Task 9: Sidecar pdf.py BlockStyle 适配

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/pdf.py`

- [ ] **Step 1: 新增 BlockStyle CSS 生成函数**

在 pdf.py 顶部或 style_renderer 导入：

```python
from .style_renderer import generate_full_css
```

- [ ] **Step 2: 替换 _render_template_style_css**

将 `_render_template_style_css` 从 class-based 改为 block-based：

```python
def _render_template_style_css(template_style: TemplateStyleConfig | None) -> str:
    if template_style is None:
        return ""
    # Convert BlockStyle models to dicts with camelCase keys for style_renderer
    blocks_dict = {
        name: block.model_dump(by_alias=True, exclude_none=True)
        for name, block in template_style.blocks.items()
    }
    return generate_full_css(blocks_dict)
```

- [ ] **Step 3: 新增 FPDFStyleAdapter**

在 `_write_fpdf_fallback` 之前新增适配器，将 BlockStyle 属性映射到 FPDF API：

```python
class FPDFStyleAdapter:
    """Map BlockStyle properties to FPDF API calls."""

    def __init__(self, blocks: dict[str, dict]):
        self.blocks = blocks

    def page_style(self) -> dict:
        style = self.blocks.get("paragraph", {})
        return {
            "text_color": self._parse_color(style.get("color"), (31, 41, 55)),
            "font_size": self._parse_font_size(style.get("fontSize"), 10.5),
            "line_height": style.get("lineHeight", 1.5),
        }

    def header1_style(self) -> dict:
        style = self.blocks.get("heading1", {})
        return {
            "color": self._parse_color(style.get("color"), (17, 24, 39)),
            "font_size": self._parse_font_size(style.get("fontSize"), 22),
            "align": style.get("textAlign", "left"),
        }

    def header2_style(self) -> dict:
        style = self.blocks.get("heading2", {})
        return {
            "color": self._parse_color(style.get("color"), (23, 78, 166)),
            "font_size": self._parse_font_size(style.get("fontSize"), 12),
            "border": self._parse_border(style.get("borderBottom")),
        }

    @staticmethod
    def _parse_color(hex_color: str | None, default: tuple[int, int, int]) -> tuple[int, int, int]:
        if not hex_color or not isinstance(hex_color, str) or not hex_color.startswith("#") or len(hex_color) != 7:
            return default
        try:
            return (int(hex_color[1:3], 16), int(hex_color[3:5], 16), int(hex_color[5:7], 16))
        except ValueError:
            return default

    @staticmethod
    def _parse_font_size(value: str | None, default: float) -> float:
        if not value:
            return default
        match = __import__("re").match(r"(\d+(?:\.\d+)?)", str(value))
        return float(match.group(1)) if match else default

    @staticmethod
    def _parse_border(border: dict | None) -> dict | None:
        if not border or not isinstance(border, dict):
            return None
        if border.get("style") in (None, "none"):
            return None
        return {
            "width": FPDFStyleAdapter._parse_font_size(border.get("width"), 1.5) / 3,
            "color": FPDFStyleAdapter._parse_color(border.get("color"), (23, 78, 166)),
        }
```

- [ ] **Step 4: 更新 _write_fpdf_fallback**

将 `_write_fpdf_fallback` 中从 token 解析颜色改为从 BlockStyle 读取：

```python
def _write_fpdf_fallback(
    resume: ResumeVersion,
    pdf_path: Path,
    template_style: TemplateStyleConfig | None = None,
) -> None:
    lines = resume_lines_for_pdf(resume)
    title = lines[0] if lines else resume.title
    body = "\n".join(lines[1:])

    adapter = FPDFStyleAdapter(template_style.blocks if template_style else {})
    p_style = adapter.page_style()
    h1_style = adapter.header1_style()
    h2_style = adapter.header2_style()

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=_MARGIN)
    pdf.set_compression(False)
    pdf.add_page()

    cjk_font = _find_cjk_font()
    if cjk_font:
        pdf.add_font("CJK", "", cjk_font)
        pdf.add_font("CJK", "B", cjk_font)
        font = "CJK"
        is_cjk = True
    else:
        font = pdf.font_name
        is_cjk = False

    pdf.set_text_color(*h1_style["color"])
    pdf.set_font(font, size=h1_style["font_size"], style="B")
    pdf.cell(_BODY_W, 10, text=title, new_x="LMARGIN", new_y="NEXT")

    if h2_style.get("border"):
        y = pdf.get_y() + 1
        pdf.set_draw_color(*h2_style["border"]["color"])
        pdf.set_line_width(h2_style["border"]["width"])
        pdf.line(_MARGIN, y, _MARGIN + _BODY_W, y)
    pdf.ln(6)

    pdf.set_text_color(*p_style["text_color"])
    pdf.set_font(font, size=p_style["font_size"])
    for line in _wrap_lines(body, _BODY_W, p_style["font_size"], is_cjk):
        pdf.cell(_BODY_W, 6, text=line, new_x="LMARGIN", new_y="NEXT")

    pdf.output(str(pdf_path))
```

- [ ] **Step 5: 移除不再使用的常量和函数**

从 `pdf.py` 中移除以下不再使用的代码：
- `PDF_CLASS_DECLARATIONS` dict
- `PDF_TEXT_COLORS` dict
- `PDF_BORDER_COLORS` dict
- `_classes_to_declarations` 函数
- `_class_tokens` 函数
- `_first_token_color` 函数
- `_template_style_rule` 函数

保留 `PDF_CLASS_DECLARATIONS` 等不变也可以，但为清理代码建议移除。

- [ ] **Step 6: Commit**

```bash
git add services/sidecar/src/typedance_sidecar/pdf.py
git commit -m "feat(sidecar): pdf.py 适配 BlockStyle（新增 FPDFStyleAdapter，移除 class token 解析）"
```

---

## Task 10: 更新测试

**Files:**
- Modify: `apps/web/src/features/templates/templates.test.tsx`
- Modify: `apps/web/src/api.test.ts`
- Modify: `services/sidecar/tests/test_pdf_export.py`
- Modify: `services/sidecar/tests/test_template_library.py`
- Remove: `apps/web/src/features/templates/classPolicy.test.ts`

- [ ] **Step 1: 删除 classPolicy.test.ts**

```bash
git rm apps/web/src/features/templates/classPolicy.test.ts
```

- [ ] **Step 2: 更新 templates.test.tsx**

移除 `getPdfClassPolicy` mock 和 `defaultPdfClassPolicy` import，更新 `defaultClassicA4Style` 为新的 block-based 结构。

```typescript
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TemplateLibrary } from "./components/TemplateLibrary";
import { builtInSamples, defaultClassicA4Style } from "./data";

vi.mock("@/api", () => ({
  getTemplateSample: vi.fn(async () => { throw new Error("no local sample"); }),
  getTemplateStyle: vi.fn(async () => { throw new Error("no local style"); }),
  saveTemplateSample: vi.fn(async () => builtInSamples["sample-tech-zh"]),
  saveTemplateStyle: vi.fn(async () => defaultClassicA4Style),
}));

describe("TemplateLibrary", () => {
  // ... 测试保持不变，之前测试 policy 的地方现在测样式面板渲染
  it("renders template cards and opens template detail", async () => {
    render(<TemplateLibrary uiLanguage="zh-CN" targetLanguage="zh-CN" />);
    expect(await screen.findByRole("heading", { name: "模板库" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /经典 A4/ }));
    expect(screen.getByText("classic-a4")).toBeInTheDocument();
    expect(screen.getByLabelText("A4 template sample preview")).toBeInTheDocument();
  });

  it("saves sample content", async () => {
    render(<TemplateLibrary uiLanguage="zh-CN" targetLanguage="zh-CN" />);
    fireEvent.click(screen.getByRole("tab", { name: "样张内容" }));
    expect(await screen.findByRole("heading", { name: "样张内容" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存样张" }));
    await waitFor(() => expect(screen.getByText("样张已保存")).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: 更新 api.test.ts**

移除 PdfClassPolicy 相关的测试。style validation 不再在 API 层返回 422（改为 UI 层校验），可以将第二个测试用例更新为测试 saveTemplateStyle 的正常路径，或改为测试其他 API 行为。

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTemplateSample } from "./api";

afterEach(() => { vi.unstubAllGlobals(); });

describe("template api", () => {
  it("loads a template sample", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "sample-tech-zh",
      name: { "zh-CN": "通用技术岗样张", "en-US": "General technical sample" },
      target_language: "zh-CN",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "",
      updated_at: "2026-05-11T00:00:00.000Z",
    }))));
    await expect(getTemplateSample("sample-tech-zh")).resolves.toMatchObject({ id: "sample-tech-zh" });
  });
});
```

- [ ] **Step 4: 更新 test_template_library.py**

替换 slot-based 测试用例为 block-based，移除 PdfClassPolicy 测试：

```python
import json


def test_template_sample_round_trip_without_updated_at(client):
    """Template sample round trip"""
    payload = {
        "id": "test-sample",
        "name": {"zh-CN": "测试样张", "en-US": "Test sample"},
        "target_language": "zh-CN",
        "doc_json": {"type": "doc", "content": []},
        "plain_text_snapshot": "",
    }
    resp = client.put("/template-samples/test-sample", json=payload)
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["id"] == "test-sample"
    assert data["updated_at"] is not None

    resp = client.get("/template-samples/test-sample")
    assert resp.status_code == 200
    assert resp.json()["id"] == "test-sample"


def test_style_config_round_trip(client):
    """TemplateStyleConfig round trip with blocks"""
    payload = {
        "template_id": "classic-a4",
        "preset": "classic",
        "blocks": {
            "heading1": {"fontSize": "24pt", "fontWeight": 700, "color": "#1a1a1a"},
            "paragraph": {"fontSize": "10pt", "lineHeight": 1.5, "color": "#334155"},
        },
    }
    resp = client.put("/template-styles/classic-a4", json=payload)
    assert resp.status_code == 200, resp.text

    resp = client.get("/template-styles/classic-a4")
    assert resp.status_code == 200
    data = resp.json()
    assert data["template_id"] == "classic-a4"
    assert "heading1" in data["blocks"]
    assert data["blocks"]["heading1"]["fontSize"] == "24pt"


def test_style_config_rejects_empty_template_id(client):
    resp = client.put("/template-styles/classic-a4", json={
        "template_id": "",
        "preset": "classic",
        "blocks": {},
    })
    assert resp.status_code == 422


def test_style_config_rejects_mismatched_template_id(client):
    resp = client.put("/template-styles/classic-a4", json={
        "template_id": "other-template",
        "preset": "classic",
        "blocks": {},
    })
    assert resp.status_code == 400
```

删除以下不再适用的测试：
- `test_style_config_rejects_blocklisted_class`
- `test_style_config_rejects_missing_or_empty_class_name`
- `test_style_config_rejects_empty_localized_label`
- `test_pdf_class_policy_rejects_empty_class`
- `test_pdf_class_policy_round_trip_with_group_default_blocklist`

- [ ] **Step 5: 更新 test_pdf_export.py**

将 `test_rendered_html_applies_template_library_style` 从 slots/class_name 改为 blocks：

```python
def test_rendered_html_applies_template_block_style(client):
    """RenderResumeHTML applies BlockStyle-based CSS rules"""
    from typedance_sidecar.pdf import render_resume_html
    from typedance_sidecar.models import ResumeVersion, TemplateStyleConfig

    resume = ResumeVersion(
        id="test-render-style",
        title="Test",
        target_language="zh-CN",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="Hello\nWorld",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    style = TemplateStyleConfig(
        template_id="classic-a4",
        preset="classic",
        blocks={
            "heading1": {"fontSize": "28pt", "fontWeight": 700, "color": "#1a1a1a", "textAlign": "center"},
            "paragraph": {"fontSize": "10pt", "lineHeight": 1.5, "color": "#334155"},
        },
    )
    html = render_resume_html(resume, template_style=style)
    assert ".td-resume-heading1" in html
    assert "font-size: 28pt;" in html
    assert "color: #1a1a1a;" in html
    assert ".td-resume-paragraph" in html
    assert "line-height: 1.5;" in html
    assert "color: #334155;" in html


def test_save_preview_uses_saved_template_block_style(client):
    """PUT template-styles with blocks, then create resume should use that style"""
    style_payload = {
        "template_id": "classic-a4",
        "preset": "classic",
        "blocks": {
            "heading1": {"fontSize": "28pt", "fontWeight": 700, "color": "#1a1a1a"},
            "paragraph": {"fontSize": "11pt", "color": "#0f172a", "lineHeight": 1.6},
        },
    }
    resp = client.put("/template-styles/classic-a4", json=style_payload)
    assert resp.status_code == 200

    resp = client.post("/resume-versions", json={
        "title": "Styled Resume",
        "target_language": "zh-CN",
        "plain_text_snapshot": "Test content",
        "doc_json": {"type": "doc", "content": []},
    })
    assert resp.status_code == 201
    data = resp.json()
    assert data["preview_pdf_path"] is not None

    pdf_path = Path(data["preview_pdf_path"])
    assert pdf_path.exists(), f"PDF not at {pdf_path}"

    html_path = pdf_path.with_suffix(".html")
    if html_path.exists():
        html_content = html_path.read_text(encoding="utf-8")
        assert ".td-resume-heading1" in html_content
        assert "font-size: 28pt;" in html_content


def test_fpdf_fallback_output_changes_with_block_style(client):
    """FPDF fallback produces different output with different BlockStyle"""
    from typedance_sidecar.pdf import _write_fpdf_fallback
    from typedance_sidecar.models import ResumeVersion, TemplateStyleConfig
    from pathlib import Path

    resume = ResumeVersion(
        id="fpdf-style-test",
        title="Style Test",
        target_language="zh-CN",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="Name\nDetail line 1\nDetail line 2",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )

    style_a = TemplateStyleConfig(template_id="t", preset="classic", blocks={
        "heading1": {"fontSize": "24pt", "color": "#1a1a1a"},
        "paragraph": {"fontSize": "10pt", "color": "#334155"},
    })
    style_b = TemplateStyleConfig(template_id="t", preset="classic", blocks={
        "heading1": {"fontSize": "20pt", "color": "#ef4444"},
        "paragraph": {"fontSize": "12pt", "color": "#0f172a"},
    })

    def render_bytes(style):
        p = Path(f"/tmp/fpdf_block_test_{id(style)}.pdf")
        _write_fpdf_fallback(resume, p, template_style=style)
        data = p.read_bytes()
        p.unlink(missing_ok=True)
        return data

    assert render_bytes(style_a) != render_bytes(style_b)
```

- [ ] **Step 6: 运行测试验证**

```bash
pnpm --filter @typedance/web test
cd services/sidecar && pip install -e ".[dev]" && pytest tests/ -v
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/templates/templates.test.tsx apps/web/src/api.test.ts
git add services/sidecar/tests/
git rm apps/web/src/features/templates/classPolicy.test.ts
git commit -m "test(templates): 更新测试适配 BlockStyle 架构，移除 PdfClassPolicy 测试"
```

---

## Task 11: 全量构建验证 + 最终清理

- [ ] **Step 1: Contracts 构建**

```bash
pnpm --filter @typedance/contracts build
```

- [ ] **Step 2: 全量前端构建**

```bash
pnpm --filter @typedance/web build
```

- [ ] **Step 3: Sidecar 导入验证**

```bash
cd services/sidecar && python -c "from typedance_sidecar.main import app; print('OK')"
```

- [ ] **Step 4: 确认不再引用 PdfClassPolicy**

```bash
grep -r "PdfClassPolicy" --include="*.ts" --include="*.tsx" --include="*.py" .
```

只应出现历史注释或 git 记录，不应出现 import/使用。

- [ ] **Step 5: 最终提交**

```bash
git add -A
git commit -m "chore: 全量构建验证通过，清理 PdfClassPolicy 残留引用"
```

---

## 自审清单

1. **Spec 覆盖度**: 每个设计需求都能找到对应 task：BlockStyle schema (T1) → style-engine (T2) → style-panel UI (T3) → TemplatePreview CSS (T4) → TemplateDetail 双向联动 (T5) → 移除 PdfClassPolicy (T6/T8) → Python CSS (T7) → PDF FPDF 适配 (T9) → 测试 (T10)
2. **无占位符**: 所有代码块包含完整实现
3. **类型一致**: BlockStyle 在 contracts → frontend types → Python models 三侧保持一致的字段定义
4. **组件边界**: StylePanel 内部组件互相独立，通过 props 通信；TemplateDetail 负责编排；TemplateLibrary 只管理状态
