# 当前能力与 Codex 对照

审计基线：TypeDance 12689b2fdd5a4abf8383a496fe66714bf438de2b；本地 Codex b4ad33d1a3c10c9652dd57f7afd7a949f8f26895。现有长任务运行、压缩、检查点、权限等待和实模验证已交付，本次不重复建立另一套实现。

| 能力 | 当前证据与缺口 | Codex 来源 | 处置 |
|---|---|---|---|
| 流式执行、取消、运行中补充输入 | Core/Host/Web 已有完整链路及回归 | core/src/session/turn.rs、input_queue | 保留，新增状态需保持原有顺序与 Markdown 边界 |
| 长任务与压缩 | 已有 23 轮响应、5 次压缩的实模证据 | turn.rs、compact.rs、context_window.rs | 保留并使后续普通对话继承权威历史 |
| 跨轮模型历史 | Host buildConversationModelHistory 只回放 assistant_delta 和 user_input_applied，丢失工具调用/结果及 Core 压缩视图 | core/src/session/rollout_reconstruction.rs、session/mod.rs 检查点 | 关键缺口：建立唯一的检查点历史路径；旧数据通过一次性迁移处理 |
| 中断恢复 | Core/Host resume_from_run_id 已存在，Web 无入口 | rollout_reconstruction、daemon_recovery、thread resume | 关键缺口：显式恢复 UI，并重新取得当前编辑快照 |
| 通用权限 | Core 等待审批；Host 默认投影为 harness_event，Web 无对应决策界面 | tools/orchestrator.rs:203-225、TUI approvals | 关键缺口：关联 run/request 的决策通道与可恢复展示 |
| 结构化提问 | awaiting_user_input 状态存在，但没有 model 可调用的提问工具和回答链路 | tools/handlers/request_user_input.rs:78-151、protocol/request_user_input.rs | 关键缺口：Core 原生提问、Host 受范围约束的回答接口、Web 问答卡 |
| 计划及压缩进度 | Core 有 plan.updated/context.compacted，Web 没有具体展示 | tools/handlers/plan.rs、tui/history_cell/plans.rs | 关键缺口：低干扰地展示真实状态与当前计划 |
| 模型暂时故障 | 适配器正确识别 401、截断和断流，但没有有界重试 | core/src/responses_retry.rs:55-160 | 补齐：只重试可重试故障，不重放工具或绕过权限，等待可取消 |
| 编辑完成核查 | 单次 editor 操作已返回 persisted/current inspect；结束前没有总核验 | turn.rs Stop hooks、Goal completion audit | 补齐：Host 提供当前编辑状态证据，业务规则不进 Core |
| 资料、图片、语音、画布变换 | 已有授权资料、图片与本地语音路径；画布变换走共享 Sidecar | 以产品实际用途为准 | 保留并覆盖新增交互的兼容性与权限回归 |

## 适用性判断

目标是补齐当前 AI 编辑器的关键闭环，不照搬全部编码代理功能。通用终端/任意文件写入、自动后台画布修改、多代理同时改同一文档、插件市场及跨会话隐式记忆，均不是当前场景的必要前提；它们会引入额外执行权限、编辑冲突或个人资料长期留存决策。当前优先使用授权上下文、明确的恢复与交互，保持单一业务变换路径。不能将这些领域差异误报为已实现对应功能。

## 已核实的实现细节

- Codex request_user_input 把结构化问题发给宿主，等待响应后返回 tool output；接受的答案还可记录为保留上下文，不能只把问题当最终回答输出。
- Codex 模型重试有最大次数、退避和服务端时间建议，并发布重连信息；不能无限重试所有错误，也不能把观察超时当任务完成。
- TypeDance EditorSession 只校验和接收当前编辑器快照/事务响应；写入操作在 resume-tools 中通过 Sidecar prepare 后交给 Frontend，并返回当前 inspect。新增完成核查应复用这些实际证据。

## 实模验收发现的确定性编辑问题

对一个文本节点中间执行 text.replace 时，Sidecar 的正确结果可能包含多个相邻、标记相同的文本节点。ProseMirror 的 JSON 解码保留这些边界，但原生事务会合并它们，导致原来的严格 eq 校验误报“编辑结果与准备事务不一致”。前端现在在解析目标文档后统一使用 Fragment.fromArray 递归规范化，再计算和校验同一原生事务；不修改正文、标记、授权或业务变换规则，不增加错误后的替代执行路径。真实 Sidecar 生成结果的回归同时覆盖纯文本、加粗、引用位置和撤销/重做。

参考已查询的 ProseMirror 官方模型文档：Fragment.fromArray 将相邻同标记文本合并。该规则属于 Frontend 的原生编辑器模型规范，不属于 Harness Core 或 Host 的业务规则。
