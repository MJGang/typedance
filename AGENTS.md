# AGENTS.md

本文件定义本仓库中智能体协作与提交规范。

## Git Commit Message 规范

- 必须使用 Conventional Commits 格式：`type(scope): subject`
- `subject` 优先使用中文，简洁明确，不使用随意描述
- 常用 `type`：
  - `feat`：新功能/新增能力
  - `fix`：缺陷修复
  - `docs`：文档更新
  - `refactor`：重构（不改变外部行为）
  - `chore`：杂项维护
  - `test`：测试相关
  - `perf`：性能优化
- 示例：
  - `feat(editor): 新增简历段落智能改写入口`
  - `fix(pdf): 修复导出分页错位问题`
  - `docs(requirements): 补充V1范围边界说明`

## 文档与计划语言规范

- 面向本仓库协作的说明文档、实施计划、需求文档、评审记录与交付总结，默认必须使用中文。
- 命令、代码、路径、API 名称、错误输出、英文专有名词可保留原文，避免为了翻译而降低准确性。
- 如果用户明确要求英文，或文档目标读者是外部英文受众，才使用英文。

## React 开发规范

- 在编写或重构 React 代码时，必须使用 `build-web-apps:react-best-practices` skill。
- 目标是保证组件结构、状态管理、性能与可维护性符合最佳实践。

## shadcn/ui 使用规范

- 在新增或调整 `shadcn/ui` 组件时，必须使用 `build-web-apps:shadcn` skill。
- 优先遵循项目现有组件风格与用法，避免脱离设计系统的自定义实现。
- 本项目的 `shadcn/ui` 风格固定为 Maia：`apps/web/components.json` 中的 `style` 必须保持为 `radix-maia`。
- 新增或更新 `shadcn/ui` 官方组件时，必须通过官方 CLI 执行，例如 `pnpm dlx shadcn@latest add button input select tabs`；不得凭记忆手写或复制非官方来源的 `src/components/ui/*` 组件源码。
- 更新已有官方组件前，必须先预览影响范围：使用 `pnpm dlx shadcn@latest add <components> --dry-run`，必要时再用 `pnpm dlx shadcn@latest add <component> --diff <path>` 检查差异；确认后才可使用 `--overwrite --yes` 覆盖。
- 业务界面中的通用按钮、输入框、下拉框、Tab、开关、复选框、单选框、弹窗、菜单、提示等控件，默认必须组合使用 `@/components/ui/*` 中的官方组件；只有色板、画布、拖拽 handle、富文本编辑器内部特殊控件等确有交互需求的场景，才允许使用原生元素或局部自定义样式。
- `apps/web/src/components/ui/*` 目录视为 shadcn 官方组件源码区。除 CLI 生成/覆盖、官方组件必要兼容修补外，不得随意改动；若必须本地修补，需在交付说明中明确说明原因和影响。
- 每次涉及 `shadcn/ui` 组件新增、更新或风格切换后，必须运行 `pnpm dlx shadcn@latest info --json` 确认 `style` 与组件清单，并至少运行 `pnpm --filter @typedance/web build`；涉及交互或测试环境兼容时，还必须运行 `pnpm --filter @typedance/web test`。

## 框架与 API 文档规范（Context7）

- 只要涉及库、框架、SDK、API、CLI 工具或云服务的使用、配置、迁移、排错，必须先通过 Context7 查询最新官方文档，再编写代码。
- 严禁仅凭历史记忆直接写实现，避免使用过时 API 或已废弃方法。
- 在涉及框架或 API 的开发任务中，必须使用 `context7` skill。

## 样式规范

每个组件的样式尽量使用tailwindcss实现，尽量少往style.css里写，style.css是全局的一些样式定义。
