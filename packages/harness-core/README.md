# Harness Core 上下文预算

Runtime 只负责通用的模型循环、工具、权限、历史和上下文预算。宿主通过 `runAgentTurn.contextWindow` 为本次运行提供模型容量与产品预算；配置写入检查点，互相并行的运行不会共享可变预算。

宿主需要在运行中调整生成选项时，提供可选 `runAgentTurn.resolveModelConfiguration`。Runtime 在每个模型循环步的压缩判断前等待它，按当前配置更新 `modelOptions`、`modelConfigurationKey` 和 `contextWindow`，再决定预算与输出上限；成功压缩后重新进入循环，保证摘要等待期间的设置变化在下一次普通请求前生效，并重新检查预算。回调没有返回的字段保留本次运行的值，部分 `contextWindow` 覆盖当前运行预算。配置改变会使旧测量按指纹失效，配置不变则继续复用前缀测量。回调不进入检查点；取消会立即停止等待，解析或持久化失败时保留已有历史和已生效配置。

- `maxInputTokens` 是产品输入上限，`modelContextTokens` 是模型的输入加输出总容量。
- `reservedOutputTokens` 同时限制普通模型请求的 `maxOutputTokens`；摘要请求单独使用 `summaryTokens`。
- 硬输入预算是 `min(maxInputTokens, modelContextTokens - reservedOutputTokens)`；未提供模型容量时只应用产品输入上限。
- 软压缩线是 `min(maxInputTokens * compactAtRatio, 硬输入预算 - growthHeadroomTokens)`。输出预留与下一步工具增量余量分别计算。

每次 provider 返回实际输入用量后，检查点保存该次请求的输入量、本地估算、模型/配置/system/tools 指纹和已测消息前缀指纹。下一次请求只在配置与已测前缀完全一致时，使用“已测实际输入 + 新增片段估算”。新增 assistant 思考、工具参数和图片仍计入增长，不对整份中文/图片输入盲目套缩放倍率。改写前缀、改变模型或配置、替换历史后重新建立测量。

`restoreCheckpointHistory()` 返回 `messages`、`inputIds` 和可选 `inputMeasurement`。宿主跨轮传递历史时，也应把 `inputMeasurement` 传入下一次 `runAgentTurn`；显式 `resumeFromRunId` 会从检查点恢复。`modelConfigurationKey` 可由宿主表达模型适配器的请求格式或连接配置版本，Core 不解释其中的服务商含义。没有实际测量时，使用保守估算。

`model.call.started.input_tokens` 保留原始粗估，`predicted_input_tokens` 给出压缩判断使用的预测，`input_calibrated` 标记预测是否复用了实际测量。provider 回报的 usage 仍是实际费用与缓存命中的依据。

压缩请求保持原工具目录和历史前缀；摘要指令追加到末尾，Core 拒绝执行摘要中的工具调用。摘要失败、取消或持久化失败时保留原历史；成功替换历史后旧测量失效，首次后续调用重新建立测量。
