# Codex 源码对应关系与边界

对照版本：E:/workspaces/codex，b4ad33d1a3c10c9652dd57f7afd7a949f8f26895（2026-10-22）。以下位置均已直接阅读。

| 能力 | Codex 实现依据 | TypeDance 落点 |
|---|---|---|
| 持续循环 | core/src/session/turn.rs:460、558、609、723；工具后继续采样、无后续才尝试结束 | Core 移除固定八轮上限，提供显式资源预算，保留取消 |
| 压缩触发 | core/src/session/context_window.rs:53-128；turn.rs:664-704 | Core 根据输入预算和观测 usage 触发摘要，工具与约束计入估算 |
| 摘要交接 | prompts/templates/compact/prompt.md；core/src/compact.rs:390-437 | Core 使用模型生成进度、决策、约束、待办与引用摘要，不用机械截断冒充摘要 |
| 约束重建 | core/src/compact.rs:84-114；core/src/session/mod.rs:4552 | Host 提供当前 developer/contextual，Core 每次组装都保留并在压缩后重建 |
| 目标保真 | ext/goal/templates/goals/continuation.md:9-46；ext/goal/src/tool.rs:279 | 保存原始任务与后续指令，加入通用范围保真和证据要求；不把普通 turn 伪装成自动 Goal |
| 检查点与恢复 | core/src/session/mod.rs:4281-4459；rollout_reconstruction.rs:189；daemon_recovery.rs:22 | Core 定义可序列化检查点和显式恢复 API，Host 承担文件 I/O；新 run 恢复，终态不可复活 |
| 中断工具 | daemon_recovery.rs 的保守恢复条件；保留历史与现实核查要求 | 在调用前记工具状态；恢复时将未知结果明确回填，让模型重新检查，不自动重放副作用 |
| 计划 | core/src/tools/handlers/plan.rs:65-98 | Core 原生 update_plan，保存计划并发出既有 plan.updated 事件；不将计划等同完成证明 |
| 结束前检查 | core/src/session/turn.rs:723-759；Goal completion audit 模板 | Core 提供可取消的完成检查回调，拒绝结束时注入检查反馈并继续 |

职责：Core 只保存和执行通用任务、提示、工具、计划、使用量和生命周期；Host 负责模型设置、文件持久化和恢复入口；Sidecar 与 Frontend 不新增编排职责。

现状：Core 的 maxModelPasses=8，轮内 conversation/contextual 是局部变量；取消已贯穿 AbortSignal；工具权限在 agent loop 中仍直接失败。Host 存储 UI 事件，但现有历史回放没有完整工具响应。恢复设计必须保存完整模型历史，而不能使用拼接的 UI 文本冒充。

实施结果：已移除八轮上限，检查点保存完整模型历史；恢复 API 使用检查点并由 Host 提供当前约束。权限依据 Codex core/src/tools/orchestrator.rs:203-225 的等待审批后执行思路调整为挂起与继续，拒绝返回模型。普通聊天的历史展示回放与显式任务恢复用途不同；恢复不使用 UI 拼接文本。

额外核查：Codex compact.rs:349-369 对 ResponseIncomplete 停止压缩；DeepSeek 官方文档区分 finish_reason=length 与正常结束。适配器现将截断标为通用 incomplete，Core 不安装截断摘要，也不执行未完成响应里的工具。

注意：Codex 的远端压缩属于 provider 能力，本次使用可观察的本地摘要路径思想；不复制服务端未知算法。模型审计仍是模型行为，不宣称程序已理解所有业务验收条件。
