# 安装版 Markdown 转换器修复设计

## 问题与目标

Windows 安装版从旧简历导入 Markdown 文件时，Python Sidecar 会在初始化源简历画布时创建 `TiptapMarkdownDocJsonConverter`。当前默认实现向上查找 `pnpm-workspace.yaml`，再调用源码仓库中的 `packages/resume-markdown/src/cli.js`。安装目录不包含源码工作区，因此接口抛出 `MarkdownDocJsonError: Unable to locate TypeDance workspace root` 并返回 500。

浏览器同时将该失败显示为 CORS 错误：FastAPI 内部注册的 `CORSMiddleware` 没有覆盖由外层错误中间件生成的未处理异常响应，500 响应缺少 `Access-Control-Allow-Origin`。

本次修复目标：

- 安装版不依赖源码仓库、全局 Node.js 或用户环境即可完成 Markdown 简历导入。
- 开发版与安装版共用同一套 `@typedance/resume-markdown` 转换逻辑。
- `http://tauri.localhost` 发起的成功、业务错误和未处理错误响应均携带正确 CORS 响应头。
- 发布冒烟测试真实覆盖安装版文件导入，不再只检查健康接口。

## 架构边界

该能力属于 Python Sidecar 的确定性业务数据处理：Sidecar 负责导入文件、提取文本并初始化源简历画布。Markdown 到 TipTap JSON 的算法继续由通用的 `@typedance/resume-markdown` 包实现；桌面壳层只负责定位和传递发布资源路径，不承载业务转换逻辑。

Harness Core 与 Agent Host 不参与本次调用链，不做改动。

## 方案

### 独立转换器可执行文件

新增发布构建步骤，将 `packages/resume-markdown/src/cli.js` 及其依赖打包，并使用当前发布流水线已经采用的 Node SEA 机制生成 `typedance-markdown-converter.exe`。该程序仍通过标准输入接收 JSON、通过标准输出返回 JSON，保持现有 Python 适配器协议不变。

转换器作为 Tauri `externalBin` 随安装包发布。桌面运行时解析其安装路径，并通过 Sidecar 的 `--markdown-converter-path` 启动参数传入。Sidecar CLI 将该路径写入进程内的 `TYPEDANCE_MARKDOWN_CONVERTER_PATH` 配置；`TiptapMarkdownDocJsonConverter` 优先使用这个明确路径。

开发环境仍可调用仓库内的 Node CLI，但这条路径只服务源码运行；发布环境没有兼容性猜测或仓库搜索 fallback。发布模式缺少转换器时应在启动或调用处给出明确错误。

### 进程行为

Python 使用 `subprocess.run` 调用转换器。Windows 下必须启用无窗口创建标志，避免每次导入时闪出终端。转换器保持短生命周期，继承现有 15 秒超时和标准错误捕获。

### CORS 错误响应

将 FastAPI 路由应用作为内部应用，再由 `CORSMiddleware` 在最外层包装。允许来源保持显式列表：开发地址和 `http://tauri.localhost`。这样即使内部应用抛出未处理异常，最终 500 响应仍经过 CORS 层；该调整只改善错误可见性，不吞掉异常，也不把 500 改写成成功响应。

## 数据流

1. 前端向 Sidecar 的 `import-file` 接口上传文件。
2. Sidecar 保存原文件并提取文本。
3. `SourceCanvasInitializer` 请求 Markdown 转换。
4. Python 适配器启动安装目录中的 `typedance-markdown-converter.exe`，通过标准输入输出交换 JSON。
5. Sidecar 标注 TipTap 节点、保存源简历画布并返回 201。
6. 若任一步骤失败，Sidecar 记录原始异常并返回错误；最外层 CORS 包装保证桌面 WebView 能读取响应，而不是只得到误导性的 CORS 报错。

## 测试与验收

- 单元测试：显式转换器路径可在不存在 `pnpm-workspace.yaml` 的目录中工作；Windows 子进程配置不会打开控制台。
- API 回归测试：从 `http://tauri.localhost` 上传 Markdown 文件可返回 201，并生成源简历画布。
- CORS 回归测试：内部未处理异常返回 500 时仍包含 `Access-Control-Allow-Origin: http://tauri.localhost`。
- 发布规则测试：Tauri 配置包含转换器外部二进制，发布构建脚本在缺失产物时失败。
- 安装包冒烟测试：安装应用后，创建临时文档并通过真实 Sidecar 上传 Markdown 文件，验证 201、CORS 响应头和工作区画布；随后正常卸载并确认后台进程退出。
- 完整验证：Sidecar 测试、发布规则测试、Rust 测试、`pnpm release` 和 `pnpm release:smoke` 全部通过。

## 安全与发布约束

- 转换器构建输入采用显式文件集合，不包含 `.env`、用户配置、凭据或工作区数据。
- Sidecar 子进程环境继续使用桌面运行时白名单，不向转换器传递模型密钥。
- 安装包仍为未签名 NSIS current-user 安装包；本次不改变版本发布或签名策略。
