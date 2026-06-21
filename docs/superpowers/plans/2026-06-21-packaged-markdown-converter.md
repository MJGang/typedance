# 安装版 Markdown 转换器实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Windows 安装版无需源码仓库或全局 Node.js 即可导入 Markdown 简历，并保证所有桌面来源响应都包含 CORS 头。

**Architecture:** 将现有 `@typedance/resume-markdown` CLI 构建成 Node SEA 外部二进制，由桌面运行时把绝对路径传给 Python Sidecar。Sidecar 开发模式继续调用仓库 CLI，发布模式直接调用已打包转换器；FastAPI 应用由最外层 CORS 中间件包装。

**Tech Stack:** Node.js 24 SEA、esbuild、postject、Tauri 2、Rust、FastAPI/Starlette、Pytest、PowerShell、NSIS

---

## 文件结构

- 新建 `scripts/release/build-markdown-converter.mjs`：仅负责将 Markdown CLI 构建成 Windows x64 SEA。
- 修改 `scripts/release/build-agent-host.mjs`：导出复用的 SEA 构建与 Windows SDK 定位能力，不改变 Agent Host 产物。
- 修改 `services/sidecar/src/typedance_sidecar/markdown_doc_json.py`：根据显式发布路径或开发 CLI 组装转换命令。
- 修改 `services/sidecar/src/typedance_sidecar/cli.py`：接收并保存转换器绝对路径。
- 修改 `services/sidecar/src/typedance_sidecar/main.py`：最外层包装 CORS。
- 修改 `apps/desktop/src-tauri/src/runtime.rs`：定位转换器并传给 Sidecar。
- 修改 `apps/desktop/src-tauri/tauri.release.conf.json` 与发布脚本：构建并打包第三个外部二进制。
- 修改 `scripts/release/smoke-release-runtime.ps1`：真实创建文档并上传 Markdown。
- 新建或修改对应测试，覆盖每个边界。

### Task 1：Sidecar 显式转换器命令

**Files:**
- Create: `services/sidecar/tests/test_markdown_doc_json.py`
- Modify: `services/sidecar/tests/test_cli.py`
- Modify: `services/sidecar/src/typedance_sidecar/markdown_doc_json.py`
- Modify: `services/sidecar/src/typedance_sidecar/cli.py`

- [ ] **Step 1: 写失败测试**

测试设置 `TYPEDANCE_MARKDOWN_CONVERTER_PATH` 为临时可执行文件，替换 `subprocess.run` 后断言命令第一项就是该绝对路径、没有 `node` 和仓库 CLI；CLI 测试新增 `--markdown-converter-path` 并断言环境变量已设置。Windows 测试同时断言 `creationflags == subprocess.CREATE_NO_WINDOW`。

- [ ] **Step 2: 验证测试按预期失败**

Run: `rtk pytest services/sidecar/tests/test_markdown_doc_json.py services/sidecar/tests/test_cli.py -q`

Expected: FAIL，原因是发布转换器配置与 CLI 参数尚不存在。

- [ ] **Step 3: 最小实现**

在 `TiptapMarkdownDocJsonConverter` 初始化时读取显式路径：配置存在时命令为 `[converter_path]`，否则才使用 `[node_executable, cli_path]`。`subprocess.run` 在 Windows 传入 `creationflags=subprocess.CREATE_NO_WINDOW`，其他平台传 0。CLI 新增必填发布参数的可选定义：

```python
parser.add_argument("--markdown-converter-path")
if args.markdown_converter_path:
    os.environ["TYPEDANCE_MARKDOWN_CONVERTER_PATH"] = args.markdown_converter_path
```

- [ ] **Step 4: 验证测试通过**

Run: `rtk pytest services/sidecar/tests/test_markdown_doc_json.py services/sidecar/tests/test_cli.py -q`

Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git commit -am "fix(sidecar): 支持发布版 Markdown 转换器"`

### Task 2：错误响应覆盖 CORS

**Files:**
- Modify: `services/sidecar/tests/test_cors.py`
- Modify: `services/sidecar/src/typedance_sidecar/main.py`

- [ ] **Step 1: 写失败测试**

构造会抛出 `RuntimeError` 的 FastAPI 内部应用，用生产代码导出的 `with_cors()` 包装，并通过 `TestClient(..., raise_server_exceptions=False)` 请求；断言状态码 500 且响应头为：

```python
assert response.headers["access-control-allow-origin"] == "http://tauri.localhost"
```

- [ ] **Step 2: 验证测试按预期失败**

Run: `rtk pytest services/sidecar/tests/test_cors.py -q`

Expected: FAIL，500 响应没有 CORS 头或 `with_cors` 尚不存在。

- [ ] **Step 3: 最小实现**

将当前 FastAPI 实例命名为 `fastapi_app`，所有路由注册到内部实例，最后执行：

```python
def with_cors(application):
    return CORSMiddleware(
        application,
        allow_origins=ALLOWED_ORIGINS,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=EXPOSED_HEADERS,
    )

app = with_cors(fastapi_app)
```

- [ ] **Step 4: 验证 CORS 与 Sidecar 全量测试**

Run: `rtk pytest services/sidecar/tests -q`

Expected: 全部 PASS。

- [ ] **Step 5: 提交**

Run: `git commit -am "fix(sidecar): 保留异常响应 CORS 头"`

### Task 3：构建并接入 Node SEA 转换器

**Files:**
- Create: `scripts/release/build-markdown-converter.mjs`
- Modify: `scripts/release/build-agent-host.mjs`
- Modify: `scripts/release/release-lib.test.mjs`
- Modify: `scripts/release-windows.ps1`
- Modify: `apps/desktop/src-tauri/tauri.release.conf.json`
- Modify: `apps/desktop/src-tauri/src/runtime.rs`

- [ ] **Step 1: 写失败的发布规则和 Rust 路径测试**

发布规则测试要求 `externalBin` 精确包含 `typedance-sidecar`、`typedance-agent-host`、`typedance-markdown-converter`，并要求发布脚本调用 `build-markdown-converter.mjs`。Rust 测试要求 `ReleasePaths` 中的转换器路径为资源目录下的 `typedance-markdown-converter.exe`。

- [ ] **Step 2: 验证测试按预期失败**

Run: `corepack pnpm release:test`

Run: `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`

Expected: 两组测试均因转换器未接入而 FAIL。

- [ ] **Step 3: 实现 SEA 构建**

复用 Agent Host 已验证的 SEA 流程：esbuild 将 `packages/resume-markdown/src/cli.js` 打包为 CJS，Node 24 生成 blob，复制 `process.execPath`、移除签名并用 postject 注入。输出固定为：

```text
apps/desktop/src-tauri/binaries/typedance-markdown-converter-x86_64-pc-windows-msvc.exe
```

发布脚本在 Sidecar 构建前调用该脚本；Tauri 将其列入 `externalBin`。

- [ ] **Step 4: 接入桌面运行时**

`ReleasePaths` 增加 `markdown_converter_path`，启动前验证文件存在，并将参数追加到 Sidecar：

```rust
OsString::from("--markdown-converter-path"),
paths.markdown_converter_path.clone().into_os_string(),
```

- [ ] **Step 5: 验证构建单元**

Run: `node scripts/release/build-markdown-converter.mjs`

Run: `corepack pnpm release:test`

Run: `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`

Expected: SEA 大于 10 MB，规则测试与 Rust 测试全部 PASS。

- [ ] **Step 6: 提交**

Run: `git add scripts apps/desktop && git commit -m "feat(release): 打包 Markdown 转换器"`

### Task 4：真实导入发布冒烟测试

**Files:**
- Modify: `scripts/release/release-lib.test.mjs`
- Modify: `scripts/release/smoke-release-runtime.ps1`

- [ ] **Step 1: 写失败的静态规则测试**

断言冒烟脚本包含 `/documents` 创建请求、`sources/import-file` multipart 上传、201 校验、`source_resume_canvas` 校验和 `Access-Control-Allow-Origin` 校验。

- [ ] **Step 2: 验证规则测试失败**

Run: `corepack pnpm release:test`

Expected: FAIL，当前冒烟脚本只请求文档列表。

- [ ] **Step 3: 实现真实运行时冒烟**

应用健康后创建唯一临时文档；在临时目录写入包含标题和列表的 Markdown；使用 `Invoke-WebRequest -Form` 不可依赖 Windows PowerShell 5.1，因此用 `System.Net.Http.MultipartFormDataContent` 上传。断言 201、CORS 头、返回源 ID，并请求 workspace-view 断言 `source_resume_canvas.old_resume_source_id` 等于源 ID。finally 中删除临时文件，应用用户数据仍由安装冒烟的现有保留策略处理。

- [ ] **Step 4: 验证规则测试通过**

Run: `corepack pnpm release:test`

Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git commit -am "test(release): 覆盖安装版 Markdown 导入"`

### Task 5：完整发布与安装验证

**Files:**
- Verify only

- [ ] **Step 1: 运行完整测试和构建**

Run: `corepack pnpm test`

Run: `corepack pnpm build`

Expected: 全部 PASS。

- [ ] **Step 2: 检查敏感文件与差异**

Run: `git diff --check`

Run: `rg -n '\.env|API_KEY|auth\.json|typedance\.sqlite' apps/desktop/src-tauri/tauri.release.conf.json scripts/release scripts/release-windows.ps1`

Expected: 无新增敏感资源读取或打包输入。

- [ ] **Step 3: 生成新安装包**

Run: `corepack pnpm release`

Expected: 生成 `artifacts/release/TypeDance_0.1.0_x64-setup.exe` 和匹配的 SHA-256 文件。

- [ ] **Step 4: 运行真实安装、导入、卸载验证**

先关闭当前用户手动安装的 TypeDance，卸载旧版本但保留 `%APPDATA%/app.typedance.desktop` 数据，再运行：

Run: `corepack pnpm release:smoke`

Expected: 安装成功、Markdown 导入返回 201、工作区画布存在、无终端窗口、后台进程正常退出、卸载后用户数据保留。

- [ ] **Step 5: 汇总与最终提交**

Run: `git status --short --branch`

Expected: 工作区干净；交付新安装包绝对路径、SHA-256、验证结果和提交列表。
