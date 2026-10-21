# 工程协作流程

本仓库是个人项目。用户描述问题和期望结果后，Codex 默认完成定位、实现、验证、自查、提交、推送功能分支、创建 PR，跟进 CI 和评审；检查通过后自动合并并安全同步本地 `main`。授权见根目录 [AGENTS.md](../AGENTS.md)，步骤见 [typedance-delivery](../.agents/skills/typedance-delivery/SKILL.md)。

## 日常任务

例如：“修复切换模板时侧栏闪动。验收标准：宽度不变、列表位置不跳、编辑内容保留。按项目默认流程交付。”

不必重复提醒测试、commit、push、创建或合并 PR。PR 保留变更记录和 CI 结果，常规任务在检查通过后由 Codex 自动合并。用户明确要求先验收或存在未决产品问题时保留 PR；打标签和发布客户端单独授权。只要求调研或讨论时保持只读。

## 验证与 PR

```sh
corepack pnpm verify:change --base origin/main --plan
corepack pnpm verify:change --base origin/main
```

`--plan` 只展示计划。默认包含分支提交与本地改动；`--head HEAD` 仅验证提交范围。每个 PR 和 main 的 push 都运行 `PR Verification`，同一 PR 的新提交取消旧验证，纯文档不安装应用依赖。覆盖范围与人工验收见 [验证与验收](../.agents/skills/typedance-delivery/references/verification.md)。

CI 不调用付费模型、不使用发布密钥，与已有 tag 发布流水线分别运行。若要强制合并前通过验证，需要在 GitHub 分支规则中设置必需检查；提交工作流文件本身不修改远端分支规则。

自动合并由执行任务的 Codex 在当前会话内完成：读取当前 head 的检查与评审，使用预期 SHA 约束 squash merge，确认合并后快进同步本地 `main`，再检查主分支 CI。这不要求启用 GitHub 的 Auto-merge 仓库开关。同步时保留用户未提交内容；本地分叉或改动重叠时报告阻塞。

## 并行任务

每个独立任务用一个聊天、worktree 和 `codex/` 分支。共享接口先确定，依赖任务按顺序合并。worktree 不隔离端口、用户数据和数据库，启动服务前明确端口与任务数据目录。避免多个任务同时修改同一批共享文件。

## 自动评审与持续跟进

仓库的 Code Review Rules 提供项目评审指引。连接 GitHub 后，可在 Codex 仓库设置和个人偏好中开启 Automatic review，也可在 PR 中发送 `@codex review`。仓库文件不能代替账户服务设置。

当前会话内，Codex 跟进 CI 与评审并修复本次任务引入的问题。跨会话需要实际后台任务；明确目标 PR、触发条件和终止条件后再创建。建议提示词：

> 跟进指定 PR 的当前 head、CI 和评审反馈。仅修复该任务引入的问题，验证后推送功能分支；当前 head 检查通过、自查完成且没有阻塞性评审时按仓库约定自动合并，安全同步本地 main 并核对主分支 CI，不打标签或发布。状态未变或没有可执行事项时保持安静。只在需要用户决定、遇到外部阻塞或交付完成时通知；PR 已关闭且未合并时停止，已合并则在完成同步及主分支检查后停止。

本地后台任务需要电脑和应用保持运行，先手动验证提示词与环境，再安排周期执行。本次流程不默认创建每日全仓优化任务。

## 公开参考

- [OpenAI：使用技能加速开源维护](https://developers.openai.com/blog/skills-agents-sdk)
- [GitHub PR 评审](https://learn.chatgpt.com/docs/third-party/github)
- [Worktree](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [后台任务](https://learn.chatgpt.com/docs/automations?surface=app)
