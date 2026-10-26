# AI 缓存业务基准

`ai-prefix-cache.mjs` 保留小型通用历史基准；`ai-cache-efficiency.mjs` 使用真实 Host、Runtime、简历工具、Sidecar 的能力查询/inspect/prepare，比较更接近编辑任务的输入增量与缓存成本。

它用独立的合成文档和 headless EditorSession 客户端执行 Sidecar 准备好的事务，校验原文/修订号后保存到单独 JSON，再确认 `persisted:true`。它没有浏览器、ProseMirror、用户审批 UI 或真实页面渲染，不能替代这些验收。

## 准备

每个 checkout 都应安装依赖。使用其自有 Sidecar，并通过环境指定独立数据目录和端口，避免读取个人生产数据。Node 需要通过已安装的 `tsx` loader 导入目标 checkout 的 TypeScript。

先运行不消耗模型额度的闭环：

```powershell
rtk proxy node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs scripts/benchmarks/ai-cache-efficiency.mjs --root . --profile baseline --sidecar-url http://127.0.0.1:5517 --verify-fixture --out artifacts/ai-cache/fixture.json
rtk proxy node --test scripts/benchmarks/ai-cache-efficiency.test.mjs
```

`--verify-fixture` 只调用实际 Sidecar：查询目录、定位文本替换能力、prepare、确认版本、写文件、读取实际文件并 inspect。输入 Key 之前运行，失败时先解决服务或合成文档问题。

## 真实 API 比较

从安全终端把 Key 临时注入 `DEEPSEEK_API_KEY`，或通过 stdin 传入，不写入脚本、`.env`、报告或 Git。可用 `DEEPSEEK_MODEL` 选择模型，默认 `deepseek-flash`。

```powershell
rtk proxy node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs scripts/benchmarks/ai-cache-efficiency.mjs --root E:/workspaces/typedance --profile baseline --sidecar-url http://127.0.0.1:5517 --effort off --trial before-1 --out artifacts/ai-cache/before-1.json
rtk proxy node --import ./node_modules/.pnpm/tsx@4.22.4/node_modules/tsx/dist/loader.mjs scripts/benchmarks/ai-cache-efficiency.mjs --root E:/workspaces/typedance-cache-efficiency --profile optimized --sidecar-url http://127.0.0.1:5518 --effort off --trial after-1 --out artifacts/ai-cache/after-1.json
```

`baseline` 明确使用旧 Host 默认运行配置；`optimized` 调用新 `modelRuntimeConfiguration` 并通过 Host resolver 绑定到本轮。这个区别是对照实验条件，没有给产品增加旧接口兼容。两边 Sidecar 必须分别对应目标源码，不能只切 TypeScript checkout。

默认 3 轮：准确替换岗位、准确替换工作方式、最后一轮关闭数据库并重建 Host/Runtime 后读取现状。断言最终文档只包含指定的两处文本变化，其余段落、顺序、格式不变；允许相同格式的相邻文本叶节点分片不同，因为它不改变内容或格式。断言修改落盘且模型回报最新事实。每轮最多 24 模型步骤，整组最多 72 请求，单次 provider 超时 90 秒；异常也保存已收到的 usage 和具体失败。

可用 `--turns 3..12` 延长只读追问，建议自然累积对照跑 8–10 轮。中间轮依次核对不同项目的资料和顺序，最后一轮重启；不会重复发送填充资料。`--input-budget N --compact-ratio R` 覆盖本组运行预算，用于预算消融或强制压缩；配合 `--require-compaction`，没有完成压缩会使基准失败，不能把没有压缩的试验称为压缩验证。预算应允许静态前缀、保留用户消息和摘要装入，过低的预算会正确失败；不要为通过实验向上下文灌入重复填充。

对照至少交错运行 3 次，固定文档、任务、模型、effort、运行预算/变更因素。脚本每组注入新的随机 trial ID 隔离跨组缓存；组内历史复用属于正常行为。`--trial` 仅作标签，不能强制复用已有随机前缀。

## 读取报告

- `totals.all` 是整组实际累计，必须保留；`afterFirst`、每轮、response/compaction、冷首请求、资料更新、压缩后首请求和重启是解释用分桶。
- `cacheMissTokens` 是未缓存输入，不直接等于本次新增内容；命中率按真实输入 token 加权，缺失 usage 的调用单独计数。
- 同时比较 prompt/hit/miss/output、调用次数、模型耗时、TTFT、压缩次数、工具原始 output 字符数以及精确内容/落盘断言。字符数不是最终 provider tokens。
- `reasoningCoverage` 分别记录收到非空思考和后续请求携带非空思考。Low/High 若没有生成非空思考，报告会明确未覆盖，不能用参数成功代替推理回放验收。
- headless 客户端和生成的合成内容只用于这个脚本。正式验收还应覆盖真实浏览器编辑、拒绝审批、`persisted:false`、运行中手动编辑、图像、布局/导出和压缩后的最新 revision。

报告包含合成答案和内部测试标识。不要将真实用户文档作为此脚本的 fixture，也不要把生成的数据库或 checkpoints 提交到仓库。
