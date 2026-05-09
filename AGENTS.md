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

## 框架与 API 文档规范（Context7）

- 只要涉及库、框架、SDK、API、CLI 工具或云服务的使用、配置、迁移、排错，必须先通过 Context7 查询最新官方文档，再编写代码。
- 严禁仅凭历史记忆直接写实现，避免使用过时 API 或已废弃方法。
- 在涉及框架或 API 的开发任务中，必须使用 `context7` skill。
