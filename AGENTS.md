# AGENTS.md

本文件定义本仓库中智能体协作与提交规范。

## 默认交付约定

- 用户要求实现功能、修复问题或优化现有行为时，默认授权完成本次任务的定位、实现、必要验证、自查、commit、推送功能分支和创建 PR，无需逐步提醒或重复确认。用户明确指定的范围和交付方式优先。
- 实施任务必须读取并使用仓库技能 [typedance-delivery](.agents/skills/typedance-delivery/SKILL.md)。调研、讨论、解释与只读评审不触发代码修改或远端写入。
- 使用 `codex/` 功能分支；有无关改动或需要并行工作时，使用独立 worktree，只暂存本次任务的文件或改动块，不覆盖、清理或提交用户的未完成内容。
- 默认交付到 PR，合并主分支、打发布标签和发布客户端需要用户另行授权。已明确授权的操作不重复询问；仓库规则不替代执行环境和远端权限。
- 创建 PR 后继续检查当前 head 的 CI 与评审反馈，修复本次任务引入的问题并重新验证。遇到外部权限、环境故障、既有失败或需产品决策的问题时，报告具体证据及下一步，不将未通过的验证描述为完成。
- 完成标准：验收条件满足，适用检查通过，改动已提交并推送，PR 已创建，最终报告包含 PR 链接、验证结果和仍需人工验收的事项。
- 同一会话内跟进 CI 和评审；跨会话持续跟进需要实际建立后台任务或 CI 触发器，不得仅凭交付约定宣称会持续运行。

## Code Review Rules

- 检查 Harness Core、TS Agent Host、Python Sidecar 与 Frontend 的职责边界；发现跨层业务规则时指出具体调用与应归属的层。
- 上下文解绑不得删除用户本地真实文件；画布关联、自动保存与导出变更关注内容丢失和预览/导出不一致。
- 检查业务规则是否收敛到唯一实现，避免新增旧入口、双轨流程和长期兼容分支。格式与机械检查交给验证脚本和 CI。

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

## 业务逻辑演进规范

- 代码中禁止新增对原有业务逻辑、旧版本流程、旧字段、旧数据结构或旧接口行为的兼容处理。
- 变更业务逻辑时，必须直接切换到新的唯一实现，移除旧分支、旧入口、fallback、双轨判断、legacy adapter、旧版本特判与临时兼容层。
- 历史数据或旧状态需要处理时，应通过一次性迁移、清理脚本或明确的数据修正方案完成，不得在运行时代码中长期保留兼容逻辑。
- 发现已有旧版本兼容代码时，除非当前任务范围明确排除，否则应优先删除或改造为当前业务规则下的单一路径。

## Harness / Agent Host / Sidecar 架构边界

- 每次涉及 AI、Harness、Agent Host、Python Sidecar、工作台、上下文、对话、插件或画布能力的编码前，必须先明确本次改动属于哪一层，并检查是否越界。
- `Harness Core` 必须保持可独立发布的通用 Agent Runtime，禁止出现 TypeDance、Resume、Pack、Workspace、Python API、画布、简历等业务概念；只允许包含 model loop、tool registry、plugin registry、permission engine、memory、event stream、run lifecycle 等通用能力。
- `TS Agent Host` 是 TypeDance 侧 AI 能力宿主，可以知道当前 pack、插件绑定、Conversation、Message、Run、RunEvent、模型设置与上下文引用；可以把 Python Sidecar 能力包装为 Harness tools；不得实现 Python 业务逻辑或把业务数据规则写死在 TS 侧。
- `Python Sidecar` 只负责业务数据、本机资源与确定性能力，包括 Workspace、ContextSource、Canvas、Artifact、本地文件/文件夹只读访问、网页链接信息抓取、导出等；禁止知道 skill 选择、agent run、thinking、model、conversation、plugin routing 等 AI 编排概念。
- `Frontend` 可以同时调用 Python Sidecar 和 TS Agent Host：业务数据、画布和上下文走 Python；AI 设置、插件、对话、run stream 和事件展示走 TS Agent Host；页面组件不得承载 AI orchestration。
- `ContextSource` 表示 AI 可参考的额外资料来源，只支持授权后的只读读取；从上下文移除本地文件或文件夹时只是解除引用，绝不删除用户本地真实文件或目录。
- 任何新增代码如果引入跨层概念，必须先说明理由；默认应视为架构违规，并优先调整到正确层级。

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

## Windows PowerShell 命令规范

- 在 PowerShell 的 `-Command` 字符串中执行 `rg`、`Select-String` 等搜索命令时，如果正则包含管道符 `|`，必须把正则整体放在单引号中，例如 `rg -n 'AI|agent|prompt' services apps`；不要写成 `rg -n "AI|agent|prompt"` 后再嵌入外层双引号，否则 PowerShell 可能把 `|` 当作管道解析。
- 需要在外层双引号内传递复杂正则时，优先使用单引号包裹内部正则；如果内部正则本身需要单引号，再改用 here-string 或拆成多次 `rg`，不要反复尝试同一个会被 PowerShell 误解析的命令。

## 样式规范

每个组件的样式尽量使用tailwindcss实现，尽量少往style.css里写，style.css是全局的一些样式定义。
