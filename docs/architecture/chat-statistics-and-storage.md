# 对话统计与流式持久化

## 数据口径

Harness Core 记录模型调用开始、首 token、接收进度和结束。进度事件最多每秒一条，结束前补齐最后一段；思考、回复和工具参数均计入接收量，工具只在完整参数到达后执行。Agent Host 从这些事件和工具事件重建当前对话统计，Frontend 在执行中每秒获取一次，调用和工具边界立即获取，切换对话时中止旧请求。定时更新局限在状态栏组件，统计事件不会拆分思考或 Markdown 段落。

模型、工具耗时包含正在执行的调用，首 token 延迟在实际收到输出后更新。已接收字符数是当前调用的实际接收量。TPS 使用已经回报的输出 token 数除以对应解码时间（模型调用耗时减去首 token 延迟），多次调用按解码时间加权；它包含思考输出，不按字符猜测，不附加 `~`。Token 累计和缓存命中只使用服务端回报，未回报时明确显示待回报。上下文占用仍可使用带 `~` 的预算估算；这不属于计费用量。

DeepSeek Chat Completions 的 `stream_options.include_usage` 不提供逐 token 的精确 token 数或 TPS。实际测试的 514 个 SSE 事件中，513 个 `usage` 为 null，只有结束事件回报完整用量。参考的 DeepSeek Harness `StatsPills.tsx` 和 `session-stats/projection.ts` 同样从完成调用的 `usage.outputTokens` 和客户端时间计算平均 TPS。

## 唯一持久化路径

对话、消息、运行和事件由 Agent Host 保存到数据目录下的 `agent-host/store.sqlite`，使用 Node.js 24 内置 SQLite、WAL 和 `synchronous=NORMAL`。每次只写变更记录，事件按运行索引；数据库写入成功后才更新内存并发布事件。数据库事务可承受进程中断，机器突然掉电仍受 NORMAL 同步策略的限制。Harness 检查点继续独立保存在 `agent-host/checkpoints/`，Sidecar 不参与 AI 编排和事件存储。

启动时通过一个事务把 `store.json` 导入 SQLite，成功标记与数据一起提交，原 JSON 保留为备份。事务失败会回滚，修复源文件后可重试；已有其他数据的数据库拒绝导入，防止覆盖。成功后不会再次读取旧 JSON 或双写。旧 `AGENT_HOST_STORE_FILE` 仅指明一次性迁移源，新数据库路径由 `AGENT_HOST_DATABASE_FILE` 指定。资料引用对应的用户本地文件不受迁移或删除对话影响。

## 真实 API 对照（2026-10-26）

使用临时注入的真实凭据、相同 `deepseek-flash` 请求、15 MB 合成历史和 22,000 条历史事件。凭据不落盘，合成提示词不包含用户简历。每个测试限制 512 个输出 token，因此截断后 Host 会正确标记任务未完成；以下结果只验证吞吐，不作为任务完成验收。

| 条件 | 直接读流 | Host 原整文件同步写盘 | Host SQLite | Host 内存 |
| --- | ---: | ---: | ---: | ---: |
| Off，57 输入 token | 130.6 tok/s（另一次 144.8） | 4.92 tok/s | 131.4 tok/s | 133.1 tok/s |
| High，39,282 输入 token | 140.8 tok/s | 未重复慢速基线 | 139.8 tok/s | 未测 |

旧路径输出 512 tokens 用时 104.8 秒（首 token 0.81 秒），与用户观察到的约 5 tok/s 一致。Off 的 SQLite 调用用时 4.29 秒（首 token 0.39 秒），High 为 4.11 秒（首 token 0.45 秒）；健康检查 p95 分别为 4.25 ms 和 5.27 ms。High 直接调用为冷前缀，SQLite 调用缓存命中 39,040/39,282；首 token 差异不能全部归于本地优化，TPS 已扣除首 token 时间。本轮实测没有承诺固定 200 tok/s。

另按 Chat Completions、Messages、Messages、Chat Completions 的顺序进行交叉对照：相同 key、Flash、High、82 输入 tokens、512 输出 tokens，分别为 146.9、150.4、133.0、153.4 tok/s。两次 Messages 回报的 `service_tier` 均为 `standard`；本轮没有观测到 Messages 固定更快，也未复现 200+ tok/s，不能只凭官方默认协议不同推断速度差异。Messages 的字段与计费口径独立按其协议读取，没有把缓存输入重复计入输出。

真实浏览器同时执行两个对话，模型分别回报约 114.1 和 120.1 tok/s；第二个对话的可见回复在 2.287 秒内发生 77 次 DOM 更新，按回报 token 数折算约 119.8 tok/s，与状态栏一致，两个任务均正常完成。Windows SEA 已实际构建并验证创建对话、强制结束后重启、读取原对话和 SQLite `integrity_check=ok`。这些检查不等同于发布安装包或在用户当前客户端中完成升级。

另将用户当前历史只读迁移到隔离测试数据库，8 个对话、22 条消息、10 个运行、24,772 个事件逐条比对一致；源 JSON 的 SHA-256 前后不变。测试数据库在验证后删除，未改写用户正在使用的历史或模型配置。

原始测量记录位于本地忽略目录 `artifacts/tps-real/`，浏览器截图位于 `artifacts/output/playwright/real-api-*.png`。回归覆盖统计刷新、并行对话隔离、迁移回滚、源文件保留、增量写入、重启恢复及中断工具不重放。
