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

## React 开发规范

- 在编写或重构 React 代码时，必须使用 `build-web-apps:react-best-practices` skill。
- 目标是保证组件结构、状态管理、性能与可维护性符合最佳实践。

## shadcn/ui 使用规范

- 在新增或调整 `shadcn/ui` 组件时，必须使用 `build-web-apps:shadcn` skill。
- 优先遵循项目现有组件风格与用法，避免脱离设计系统的自定义实现。
