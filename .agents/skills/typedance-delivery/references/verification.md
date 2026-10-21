# 验证与验收

根目录 `corepack pnpm verify:change --base origin/main` 根据 Git 改动选择检查；CI 使用同一个脚本，显式传入目标提交。

| 改动范围 | 自动检查 |
| --- | --- |
| `docs/` 下 Markdown/文本、`AGENTS.md`、README、PR 模板、交付技能及验证脚本 | diff 空白检查、验证脚本自身的行为测试 |
| 其他文件，包括插件 Prompt、未知类型、依赖和 CI 配置 | 上述检查，加根目录已有的 `build`、`test`、`release:test` |

重命名同时检查原路径和新路径，删除代码或把代码移入文档目录也会触发代码检查。未知路径按运行代码处理。脚本不证明原生窗口、安装包或视觉布局正确。

## 环境

- Node.js 24、Corepack、`pnpm@10.11.0`；运行 `corepack pnpm install --frozen-lockfile`。
- 代码检查需要 Python 3.11+：`python -m pip install "./services/sidecar[dev]"`，以及 `python -m playwright install chromium`。
- PR 验证使用 Windows runner，不需要发布签名密钥。
- 前端测试使用 1～2 个 worker，控制 jsdom 的并发资源占用；保留现有测试断言与超时限制。
- Windows 检查进程使用当前 worktree 的 `node_modules/.cache/typedance-verify/tmp` 作为临时目录，避免本机系统临时区的 esbuild 文件清理权限问题；不修改全局环境变量。
- 仅文档及交付脚本检查可直接运行 `node scripts/verify-change.mjs --base origin/main`，无需安装应用依赖。

## 按行为补充

| 受影响部分 | 补充证据 |
| --- | --- |
| 前端交互、路由、侧栏尺寸 | 相关组件测试和真实浏览器操作；尺寸与布局记录实际 DOM/截图。必要时运行 `corepack pnpm --filter @typedance/web test:e2e`。 |
| shadcn/ui 官方组件 | 遵守根 AGENTS.md 的 CLI 预览、Maia 风格检查、构建与测试要求。 |
| 画布、模板、HTML/PDF | 对照前端预览和实际导出，核对分页、列宽与文本完整性。 |
| Sidecar、Agent Host、Harness | 相关用例与跨进程请求/事件的发送、传递和消费。 |
| Tauri、托盘、安装、更新 | Windows 原生检查与实际桌面/安装验证；网页预览不作为桌面行为证据。发布另行授权。 |
| 性能 | 相同场景的修改前后数据与测量条件；没有测量不宣称收益。 |

针对性 lint 可按改动文件执行；根目录已有 `corepack pnpm lint`。涉及权限、删除或持久化时，优先覆盖可能导致数据损失或越权的行为。
