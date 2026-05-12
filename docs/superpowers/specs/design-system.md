# TypeDance Design System

> 2026-05-12 — Professional B2B SaaS 简历编辑工具

## 设计方向

- **风格**: Minimalism（极简）+ Flat Design（扁平）— 干净、留白、无装饰性效果
- **氛围**: 专业、可信、克制、功能优先
- **对标**: Linear, Notion, Supabase — 工具感而非营销感

## 配色

| Token | Value | Usage |
|-------|-------|-------|
| `--color-primary` | #2563EB (blue-600) | 按钮、链接、选中态 |
| `--color-primary-hover` | #1D4ED8 (blue-700) | 按钮 hover |
| `--color-primary-subtle` | #EFF6FF (blue-50) | 浅色背景高亮 |
| `--color-surface` | #FFFFFF | 卡片、面板 |
| `--color-bg` | #F8FAFC (slate-50) | 页面背景 |
| `--color-text` | #0F172A (slate-900) | 正文 |
| `--color-text-secondary` | #475569 (slate-600) | 次要文字 |
| `--color-text-muted` | #94A3B8 (slate-400) | 辅助文字 |
| `--color-border` | #E2E8F0 (slate-200) | 边框、分割线 |
| `--color-border-hover` | #CBD5E1 (slate-300) | 边框 hover |
| `--color-destructive` | #EF4444 (red-500) | 删除、错误 |
| `--color-success` | #22C55E (green-500) | 成功状态 |

**暗色模式**（预留，先用 shadcn 默认暗色方案）:
- 背景: #0F172A (slate-900)
- 卡片: #1E293B (slate-800)
- 边框: #334155 (slate-700)

## 字体

| Role | Font | Fallback |
|------|------|----------|
| UI | Geist Variable (已引入) | system-ui, sans-serif |
| 中文 | Geist / Noto Sans SC | Microsoft YaHei, PingFang SC |

已通过 `@fontsource-variable/geist` 引入，保持现状。无需额外字体加载。

## 间距

基于 TailwindCSS 4 的 spacing scale:
- 页面: `p-6` (24px)
- 卡片: `p-4` (16px)
- 紧凑: `p-3` (12px)
- 网格: `gap-4` (16px)

## 圆角

- 按钮/输入: `rounded-md` (6px) — shadcn 默认
- 卡片: `rounded-lg` (8px)
- 弹窗/下拉: `rounded-xl` (12px)

## 阴影

使用 shadcn 默认 shadow 系统:
- 卡片: `shadow-sm`
- 下拉菜单: `shadow-md`
- 弹窗: `shadow-lg`
- 浮动窗口: `shadow-xl`

## 组件风格

### 按钮
- 主要按钮: primary bg + white text, 无图标前缀除非必要
- 次要按钮: outline variant (shadcn 默认)
- 危险操作: destructive variant
- 图标按钮: ghost variant + icon only

### 卡片
- 白色背景 + border + shadow-sm
- hover: border 变深或轻微 shadow 提升
- cursor-pointer 在可点击卡片上

### 表单
- Label + Input + helper text 垂直排列
- shadcn Input 默认样式
- Focus ring: ring-2 ring-primary

### 导航
- 侧边栏: shadcn Sidebar collapsible
- 当前页高亮: isActive + 浅蓝背景
- 菜单项: 图标 + 文字

### 弹窗/模态框
- shadcn Dialog
- 标题 + 内容 + 可选操作按钮
- 不透明背景，关闭按钮右上角

## 页面布局

### 首页（简历列表）
- 标题: 24px semibold (text-2xl font-semibold)
- 新建按钮: 右上角 primary
- 卡片网格: grid-cols-2 sm:grid-cols-3 lg:grid-cols-4, gap-4
- 空态: 居中 flex column

### 工作台
- 左侧编辑器: flex-1
- 右侧面板: w-80 border-l
- 编辑器顶部工具栏: border-b px-4 py-2, flex items-center
- 工具按钮: ghost variant

## 图标

仅使用 lucide-react（已引入），风格统一为 24x24 viewBox。
- 导航: 常规 weight
- 操作按钮: inline-start

## 国际化

- 全界面统一语言（zh-CN 或 en-US），不混搭
- 通过 `uiLanguage` 状态切换
- 所有用户可见文本走 i18n

## shadcn/ui 集成

已有组件直接使用（不重新包装）:
- Button, Badge, Input, Select, Dialog, DropdownMenu
- Tabs, TabsList, TabsTrigger, TabsContent
- Sidebar, SidebarContent, SidebarMenu, SidebarMenuButton 等
- TooltipProvider
