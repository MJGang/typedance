# AI 缓存优化实测

基线 TypeDance `37f2fa01ffd3652cbaf9ac5c7c52a6e41a815cf0`；参考本地 DeepSeek Harness `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`，远端为 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness/tree/22ddee3792402c3e70ec5f86a63c3e3e895a2f60)。各组 usage、分轮统计和合成答案见[机器可读结果](ai-prefix-cache-2026-10-25.json)。

## 源码依据与实现

| DeepSeek Harness 源码 | 借鉴的机制 | TypeDance 实现 |
|---|---|---|
| `packages/core/agent-loop/src/runtime-context.ts` 的 RuntimeContextProjection | 动态资料变化时追加 user 快照；不变化时省略；移除时明确旧快照失效 | Core `model/context-projection.ts` 按来源追加更新或移除标记；同一来源的多项贡献完整保留。任务计划使用独立来源，更新计划不再重写 system 或整份资料 |
| `packages/core/system-prompt/src/index.ts` 的 orderTools | 按名称作与区域设置无关的工具排序 | DeepSeek adapter 在工具名称映射和声明前统一排序，重名转换不再受注册顺序影响 |
| `packages/llm/llm-deepseek/src/serialize.ts` 的 assistant | 回放推理和工具历史 | 模型消息与检查点保留 reasoningContent；Chat Completions 工具请求回传 reasoning_content；上下文估算计入推理 |
| `packages/compaction/compaction-basic/src/summarizer.ts` 的 summarizeWithLlm | 沿用原 system、tools、历史，只在尾部追加摘要指令 | 压缩保留相同工具声明和选择策略，计算完整工具预算；Core 拒绝压缩返回的工具调用并保留原历史 |

DSH 当前使用 Messages API，TypeDance 使用 Chat Completions，本次没有迁移协议。通过 Context7 查询的官方[缓存文档](https://api-docs.deepseek.com/guides/kv_cache)和[思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode)分别确认前缀匹配及 tools 请求的推理历史回传要求。

Core 仅增加通用资料投影、推理历史与预算机制；提供商序列化仍归 Agent Host。Sidecar、业务编辑规则与 Frontend 没有新增 AI 编排。

## 测量条件

- 使用用户指定的真实凭据，模型 `deepseek-flash`，分别测试 Off 和 Low。凭据只通过 stdin 进入进程，没有写入测试数据、代码或配置。
- 使用真实 Agent Host、Harness、DeepSeek adapter、API SSE；业务资料为合成简历，资料读取工具为测试只读工具，不触及用户文件或实际画布。
- 每组三轮：创建并完成两步计划、读取岗位；修订资料后重新读取；重新建立 Host/Runtime 和磁盘存储对象，再承接历史读取。每轮检查最新岗位、完成状态和工具证据。
- 每组在固定插件指令前加入唯一试验标识，避免上一组服务端缓存污染；资料没有填充。Off 两组采用先基线后优化、先优化后基线的相反顺序。
- 命中率按 `sum(prompt_cache_hit_tokens) / sum(prompt_tokens)` 计算；“首个请求之后”排除每组唯一的冷启动首请求。未命中 token 使用提供商原始计数。

## 结果

| 模式与组别 | 请求数 | 整体命中率 | 首个请求之后 | 未命中 token | 模型请求总耗时 / 平均首 token |
|---|---:|---:|---:|---:|---:|
| Off 基线 1 | 8 | 60.71% | 68.60% | 11,102 | 14,089ms / 685ms |
| Off 优化 1 | 8 | 82.78% | 90.23% | 6,872 | 5,567ms / 588ms |
| Off 优化 2 | 8 | 82.81% | 90.26% | 6,856 | 6,147ms / 662ms |
| Off 基线 2 | 8 | 60.69% | 68.58% | 11,110 | 5,958ms / 647ms |
| Low 基线 | 8 | 60.89% | 68.79% | 11,180 | 20,389ms / 584ms |
| Low 优化 | 8 | 82.57% | 89.95% | 7,051 | 5,305ms / 555ms |

Off 首组未命中 token 减少 38.1%，第二组减少 38.3%；Low 减少 36.9%。Off 两组在磁盘重建后的第三轮均约 97.2%，Low 约 96.8%。所有合成场景均读取到修订后的岗位，没有重复业务写入。

缓存收益不能等同于固定延迟收益：第二组 Off 优化的总耗时和平均首 token 略高于基线，样本和服务端波动不足以证明稳定加速。保留旧快照也使 Off 首组总输入从 28,254 增至 39,896（约 41.2%）；高命中率没有隐藏这项代价。达到预算时仍需压缩，不能无限追加旧资料。

## 压缩纠偏与验证

首版尝试在压缩时设置 `tool_choice=none`，真实请求的 prompt 数从相同场景下的约 6,352 变为约 5,705，缓存命中为 0。保持工具声明并不足以证明提供商输入一致。再次对照 DSH 的 summarizeWithLlm 后，保持 `auto` 及原声明，尾部摘要指令要求不调用工具，Core 遇到工具输出直接失败且不执行。

修正后的受控压缩请求命中 3,840 / 6,352 token（60.45%），其中尾部包含此前未发送的修订资料。压缩后请求输入降至约 3,709，三轮最终全部完成；该组因摘要后计划更新共 10 次请求，不与普通 8 次请求组作总耗时比较。压缩会有一次前缀重建成本；它用于控制输入体积。

## 复现与回归

运行 `scripts/benchmarks/ai-prefix-cache.mjs --root <checkout> --out <report.json>`，通过进程级 `DEEPSEEK_API_KEY` 或 stdin 注入凭据，使用 `node --import <tsx loader 的 file URL>` 启动。`--effort low` 开启推理，`--compact` 缩小预算以触发压缩。对照时在优化 worktree 运行脚本并将 `--root` 指向保持基线的另一个 checkout。每次运行使用独立磁盘数据目录；单次 API 请求超时 90 秒，模型最多 10 步。

- Core：前缀保留、按来源变化/清空/重新添加、重复来源、推理预算、压缩前缀与工具一致、摘要工具不执行。
- Host：重建实例后保留模型推理与工具历史，更新资料不重写旧前缀；提问、手动批准、编辑回执、权限和中断恢复回归。
- 原有进程集成测试会实际杀死并重启 Host，通过 HTTP/SSE 检查原目标、已完成工具和不确定工具恢复；该项使用受控模型，实模磁盘重建场景与它分别记录。Low 实模磁盘检查点重读后仍有 2 条完整的推理历史。

本机 `corepack pnpm verify:change --base origin/main` 完整通过：构建、全部应用回归、验证脚本 6 项和发布脚本 16 项。完整运行时应用测试 917 项全部通过；补充摘要工具拒绝用例后，Core 全包 64 项再次通过，最终各包共 918 个不同用例（Host 105、Web 406、Sidecar 261）。JSON 校验、脚本语法和 diff 检查通过，待提交文件凭据扫描为 0。远端 CI 与合并状态以关联 PR 为准。

不将受控缓存场景描述为数小时稳定性、实际用户画布编辑或客户端安装验收。
