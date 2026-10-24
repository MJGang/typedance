# Harness Core 长任务执行与恢复

本次实现参考本地 Codex `b4ad33d1a3c10c9652dd57f7afd7a949f8f26895`。逐项源码映射见 [调研记录](plans/codex-long-task/findings.md)。实现采用持续模型/工具循环、结构化任务状态、模型摘要交接、可恢复检查点和结束前检查的思路；没有将未知的服务端压缩算法或模型训练行为视为已复现能力。

## 职责

- Core 保存原始任务、计划、模型历史、待处理输入、工具执行状态和使用量，执行通用循环、压缩、审批等待与完成检查。
- Agent Host 提供最新的业务提示与上下文、模型适配器，以及检查点的本地原子写入和恢复入口。
- Sidecar 不参与模型编排。本次不修改 Frontend，也不添加恢复按钮。

## 默认行为

固定八轮上限已移除。工具结果回填后继续采样，模型结束且没有待处理用户输入时尝试完成；外部取消可中断模型、工具等待、压缩和完成检查。可通过 `limits.maxModelSteps`、`limits.maxTotalTokens` 设置显式预算，预算包含恢复前的使用量和压缩请求，不因新用户输入而重置。未设置的预算不构成隐含上限。

每次请求都包含通用执行约束、原始任务与当前计划，并保留宿主提供的 developer/contextual 内容。原始任务作为来源记录，用户后续明确修改优先。Core 不把结构化业务 context 或 skill 文件自行转成业务提示词。直接传入的 system 消息会归入稳定指令区，避免被历史压缩删除。

`update_plan` 是原生 `system` 工具，不受业务插件工具列表控制，也不能由插件覆盖。参数采用现有 `items: [{ id, title, status }]` 契约，id 唯一、最多一个 `in_progress`。计划保存到检查点并发出 `plan.updated`；计划本身不是验收证明。

工具需要审批时 run 保持 `awaiting_permission`。批准仅执行对应调用一次；拒绝把未获授权的结果返回模型，由模型调整方案；等待期间取消仍立即生效。权限决定不从检查点跨进程复用。Core 支持该机制；宿主或插件需要提供相应的审批交互。

## 上下文窗口

`contextWindow` 的默认配置是应用输入预算，不是对任意模型上下文容量的声明：

| 配置 | 默认值 | 用途 |
|---|---:|---|
| `maxInputTokens` | 64,000 | 输入预算，需由宿主按模型容量和输出预留调整 |
| `compactAtRatio` | 0.75 | 达到预算比例时发起摘要 |
| `summaryTokens` | 4,096 | 摘要请求的输出上限 |
| `retainedUserTokens` | 16,000 | 压缩后按时间倒序选择最近用户消息的预算 |
| `toolOutputTokens` | 8,000 | 工具文本进入模型历史的预算；图片完整保留并计入整体预算 |

估算包含规则、上下文、工具声明、消息、调用参数与图片占用，并用 provider 返回的输入 usage 校正后续判断。它不是精确 tokenizer；图片按固定保守值估算。原始工具输出仍通过事件提供，进入模型历史的超长文本会带明确截断标记。

压缩使用同一模型的独立请求，关闭工具，要求交接进度、关键决策、约束、用户偏好、剩余工作与关键证据。摘要不作为用户可见回答输出，但通过 observer 纳入模型观测。有效摘要与保留的用户消息替换旧历史；旧工具交换整体进入摘要，不保留孤立的 tool 消息。开发者与上下文约束从当前结构化状态重建。

只有摘要完成、非空、释放足够空间并成功持久化后才安装替换历史。摘要失败、被截断、要求调用工具或没有缩小到阈值内时停止本次 run，保留原模型历史。单次输入、不可压缩的规则/资料或一批工具输出已经超出整体输入预算时，也明确报错而不静默丢弃用户要求。

适配器未收到官方 SSE 完成标记 `[DONE]` 时，将断流视为失败；`finish_reason=length` 等未完成响应不会被当成成功摘要，也不会执行其中的工具调用。

## 检查点与恢复

Core 默认使用 `MemoryHarnessCheckpointStore`。宿主 CLI 使用 `JsonFileHarnessCheckpointStore`，位于当前数据目录的 `agent-host/checkpoints/`；通过临时文件、flush 和原子替换保存，并复用 Host 现有的 Windows 文件替换重试。数据读取经过统一契约校验。删除对话会删除其应用生成的检查点，不触碰用户引用的本地文件。

检查点保存完整模型历史、原始目标、计划、已接收/待处理输入、累计预算、压缩次数、尚未完成的工具调用与正在执行的调用标识。在模型/工具边界和接受补充输入时持久化；工具开始前写入执行标识，结果保存后才移除。

显式恢复创建一个新的 run。新 run 必须使用相同 agent 与能力策略；使用宿主新提供的指令和业务上下文，不把旧权限或旧编辑会话直接复活。已保存结果不重放。崩溃时正在执行的工具会得到“可能已生效”的模型可见结果，尚未开始的工具得到“未执行”的结果；模型必须检查权威现状后决定后续操作。

```ts
const next = runtime.createRun({
  user_message: "继续并核实当前状态",
  capability_policy: previousPolicy,
});
await runtime.runAgentTurn({
  runId: next.id,
  agentId,
  resumeFromRunId: interruptedRunId,
  messages: [{ role: "user", content: "继续并核实当前状态" }],
  prompt: freshlyBuiltPrompt,
});
```

Host 的已有创建 run 接口支持 `resume_from_run_id`，恢复源必须属于当前工作区下的同一对话，且已经失败或取消：

```http
POST /workspaces/{workspaceId}/conversations/{conversationId}/runs
Authorization: Bearer {currentHostToken}
Content-Type: application/json

{
  "pack_id": "resume",
  "message": { "content": "继续并核实当前状态" },
  "resume_from_run_id": "arun_1",
  "mutation_mode": "review",
  "context": {}
}
```

涉及活动画布时，调用方应像普通创建 run 一样提供当前 `context.editor_snapshot`。恢复不会自动重新发起画布写操作。运行中进程退出后，Host 仍会将旧 run 标记失败；恢复后产生新 run 和 `run.resumed` 事件。

## 完成检查与证据边界

`completionCheck({ checkpoint, output, signal })` 是可选的通用结束检查接口。返回 `{ complete: false, message }` 会把反馈加入上下文并继续执行，返回 `{ complete: true }` 才允许本次结束。回调可以由宿主接入确定性验收；Core 不实现简历、画布或导出规则。

Host 当前未安装业务专用的完成检查。默认的证据审计提示仍依赖模型遵守，不能描述为所有业务目标都由程序自动验证。本次也没有把普通用户请求自动创建为 Codex 式跨 turn Goal，或增加自动后台目标续跑。

## 验证

- Core 行为测试覆盖超过八轮、反复压缩、最新规则与用户要求保留、完整工具配对、摘要失败及保存失败的历史保留、计划恢复、权限批准/拒绝、取消和显式预算。
- Host 集成测试通过两个真实 Node 进程和带鉴权的 HTTP/SSE：强制终止第一个进程，在第二个进程中恢复；核查已完成工具不重放、结果不确定的调用不重放，以及原始任务和已保存证据保留；跨对话恢复被拒绝。
- 补充实模烟测使用当前配置被服务端 401 拒绝，未完成真实模型验证。不能将自动化测试表述为数小时任务成功率或绝不跑偏的证明。
