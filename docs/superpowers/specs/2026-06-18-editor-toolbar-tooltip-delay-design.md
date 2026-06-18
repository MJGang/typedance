# 编辑器顶部工具栏 Tooltip 延迟设计

## 背景

当前站点级 `TooltipProvider` 的默认 `delayDuration` 为 `0`，鼠标经过编辑器顶部工具栏按钮时，提示会立即出现，并可能遮挡其上方的标题栏按钮。用户希望仅降低顶部编辑工具栏提示的打扰，不改变站点其他区域的 Tooltip 行为。

## 方案

在 `ResumeRichTextEditor` 的顶部格式工具栏范围内增加局部 `TooltipProvider`，设置 `delayDuration={500}`。Radix Tooltip 会优先使用最近的 Provider，因此工具栏按钮延迟 500ms 后显示提示，站点级 Provider 及侧栏、卡片等其他提示继续保持现状。

不修改 `apps/web/src/components/ui/tooltip.tsx` 的默认值，也不在每个 `Tooltip` 上重复配置延迟。

## 交互规则

- 指针在顶部工具栏按钮上持续停留满 500ms 后显示 Tooltip。
- 在延迟结束前移开指针时，不显示 Tooltip。
- Tooltip 显示后的关闭行为、键盘聚焦行为和按钮点击行为保持 Radix Tooltip 现有语义。
- 工具栏中的图标按钮、下拉按钮、颜色选择器、分栏按钮及工具栏尾部注入的 Tooltip 都由同一局部 Provider 管理。
- 站点其他区域的 Tooltip 不受影响。

## 代码边界

本次仅涉及 Frontend 展示层，不涉及 Harness Core、TS Agent Host 或 Python Sidecar，也不改变业务数据与 AI 编排。

预计修改：

- `apps/web/src/components/editor-toolbar.tsx`：由 `EditorToolbar` 统一提供工具栏语义与固定为 500ms 的 Tooltip 作用域。
- `apps/web/src/components/editor-toolbar.test.tsx`：验证工具栏作用域覆盖外层即时显示设置。
- `apps/web/src/features/workspace/components/ResumeRichTextEditor.tsx`：将顶部工具栏接入局部 Tooltip 作用域。

## 验证

- 运行编辑器工具栏相关 Vitest 测试。
- 运行 `@typedance/web` 构建，确认类型检查与打包通过。
- 在桌面工作台中悬停顶部工具栏按钮，确认短暂经过不会弹出提示，持续悬停后正常出现。

## 非目标

- 不调整 Tooltip 的位置、外观、动画或层级。
- 不修改全站 Tooltip 默认延迟。
- 不重构工具栏按钮或编辑器状态逻辑。
