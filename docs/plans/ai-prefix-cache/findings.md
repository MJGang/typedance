# 源码与验证发现

- 当前 DeepSeek adapter 把 developer 和 contextual 一起合并进 system；动态资料变化会更早破坏前缀。
- 当前模型消息不保存 reasoning_content，需核查官方工具调用回传要求和 DeepSeek Harness 实现。
- DeepSeek Harness 没有 .codegraph，使用限定范围的 rg 和文件读取；TypeDance 原工作区有索引。
- 初始提交 37f2fa0，主工作区存在用户的无关改动。

## DeepSeek Harness 对照（本机 22ddee3792402c3e70ec5f86a63c3e3e895a2f60）
- `packages/core/agent-loop/src/runtime-context.ts`：RuntimeContextProjection 只在内容变化时追加 user 角色快照，清空时明确告知旧快照失效；不反写历史。
- `packages/core/system-prompt/src/index.ts:232`：工具按 code-unit 名称排序，跨机器稳定。
- `packages/compaction/compaction-basic/src/summarizer.ts`：压缩保留原 system、tools 与历史，只在尾部追加压缩指令。
- `packages/llm/llm-deepseek/src/serialize.ts`：保留推理块及工具证据；该版本使用 Messages API，TypeDance 使用 Chat Completions，借鉴机制而非照搬协议。
- Context7 官方文档：缓存匹配从第 0 token 开始；携带 tools 时应回传历史 reasoning_content。

## 实施选择
- Core 将 contextual 作为带来源标记的内部 user 快照追加到历史，按来源比较，只追加变更/移除项；任务计划变化不再导致整份工作区资料重发。
- 保留逐轮 reasoningContent 并计入预算；Adapter 仅在工具请求中回传。
- Adapter 稳定工具顺序与重名映射；压缩保留工具声明与选择策略，Core 拒绝压缩输出的任何工具调用，不进入执行路径。

## 实模纠偏
- 第一版在压缩时设置 tool_choice=none，真实 DeepSeek 回包的 prompt token 明显减少且缓存命中为 0。只保留 schemas 仍不足以证明提供商前缀一致。
- 再次对照 DSH summarizeWithLlm：它沿用原 tools，不在辅助调用上更改工具策略。已移除 none 设置，使用相同 auto 策略和尾部禁止工具的摘要指令；Core 原有拒绝工具调用的保护保留，随后重新测量。
