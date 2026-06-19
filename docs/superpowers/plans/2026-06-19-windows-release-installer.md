# Windows Release Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加 `pnpm release`，生成不含 `.env` 或构建机凭据、可在干净 Windows x64 环境独立运行的 TypeDance NSIS 安装包及 SHA-256 文件，并支持 `pnpm release:publish` 发布 GitHub Release。

**Architecture:** Tauri 只负责安装、单实例和两个本地进程的生命周期；Python Sidecar 使用 PyInstaller 冻结，Agent Host 使用 esbuild + Node.js 24 SEA 冻结，Chromium 作为 Tauri resource 分发。模型密钥由 Agent Host 在用户数据目录管理，Release 运行时不自动搜索开发 `.env`。

**Tech Stack:** Tauri 2、Rust、PowerShell 7/Windows PowerShell、pnpm 10、Node.js 24 SEA、esbuild、postject、TypeScript、Vitest、Python 3.11、PyInstaller 6、FastAPI、Playwright Chromium、GitHub Actions、NSIS

---

## 文件结构

### 新增文件

- `scripts/release/release-lib.mjs`：版本、平台、敏感路径和产物命名的纯函数。
- `scripts/release/release-lib.test.mjs`：使用 Node 内置 test runner 验证发布规则。
- `scripts/release/build-agent-host.mjs`：esbuild、SEA blob、签名移除、postject 和插件资源准备。
- `scripts/release/build-sidecar.ps1`：创建发布虚拟环境并执行 PyInstaller。
- `scripts/release/smoke-installer.ps1`：静默安装、启动、健康检查和卸载。
- `scripts/release-windows.ps1`：本机与 CI 唯一发布入口。
- `packages/contracts/src/workbench/model-settings.ts`：前端与 Agent Host 共用的脱敏模型设置契约。
- `packages/agent-host/src/model-settings.ts`：模型设置和认证文件的读写、合并与脱敏。
- `packages/agent-host/tests/model-settings.test.ts`：设置持久化与密钥不外泄测试。
- `apps/web/src/features/settings/AiSettingsDialog.tsx`：真实 AI 设置弹窗。
- `apps/web/src/features/settings/AiSettingsDialog.test.tsx`：加载、保存、清除和错误状态测试。
- `services/sidecar/src/typedance_sidecar/cli.py`：冻结后可执行入口。
- `services/sidecar/tests/test_cli.py`：CLI 参数到环境和 Uvicorn 的映射测试。
- `services/sidecar/typedance-sidecar.spec`：PyInstaller 构建清单。
- `apps/desktop/src-tauri/src/runtime.rs`：Sidecar 启动、健康检查和退出清理。
- `apps/desktop/src-tauri/tauri.release.conf.json`：仅供 Release 构建使用的 NSIS、externalBin 和 resources 覆盖配置。
- `apps/desktop/src-tauri/tests/release_config.rs`：Tauri 发布配置静态约束测试。
- `.github/workflows/release-windows.yml`：标签触发的 Windows Release workflow。

### 修改文件

- `package.json`：增加 `release`、`release:publish`、`release:test` 与构建依赖。
- `pnpm-lock.yaml`：锁定 esbuild、postject 和 Tauri single-instance 插件相关依赖。
- `packages/contracts/src/index.ts`、`packages/contracts/tests/contracts.test.ts`：导出并验证模型设置契约。
- `packages/agent-host/src/model/deepseek.ts`：每次 run 动态解析模型配置，缺少密钥时返回受控错误。
- `packages/agent-host/src/index.ts`：增加健康检查和模型设置 HTTP 路由。
- `packages/agent-host/src/cli.ts`：移除向上搜索 `.env`，接入用户目录设置和明确的插件目录。
- `packages/agent-host/tests/agent-host.test.ts`、`packages/agent-host/tests/deepseek.test.ts`：覆盖新路由和延迟配置。
- `apps/web/src/agentHost.ts`：增加模型设置 API helper。
- `apps/web/src/features/revision/WorkbenchSidebar.tsx`：用真实设置弹窗替换静态输入框。
- `services/sidecar/pyproject.toml`：增加固定 Release 构建依赖。
- `apps/desktop/scripts/download-chromium.py`：参数化目标目录并写入浏览器清单。
- `apps/desktop/src-tauri/Cargo.toml`、`Cargo.lock`：增加单实例与健康检查依赖。
- `apps/desktop/src-tauri/src/lib.rs`：接入 runtime 模块和退出清理。
- `apps/desktop/src-tauri/tauri.conf.json`：保持不依赖发布二进制的开发态基础配置。
- `apps/desktop/src-tauri/capabilities/default.json`：登记 Agent Host sidecar。
- `apps/desktop/README.md`、`docs/README.md`：发布与故障排查说明。
- `.gitignore`：忽略发布中间目录和最终产物。

---

### Task 1: 发布规则纯函数与版本一致性

**Files:**
- Create: `scripts/release/release-lib.mjs`
- Create: `scripts/release/release-lib.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: 写版本和敏感路径失败测试**

```js
import test from "node:test"
import assert from "node:assert/strict"
import {
  assertReleaseVersions,
  findForbiddenReleasePaths,
  releaseArtifactNames,
} from "./release-lib.mjs"

test("accepts one version across npm, Tauri and Cargo", () => {
  assert.equal(assertReleaseVersions({ root: "0.1.0", desktop: "0.1.0", tauri: "0.1.0", cargo: "0.1.0" }), "0.1.0")
})

test("rejects a mismatched release version", () => {
  assert.throws(() => assertReleaseVersions({ root: "0.1.0", desktop: "0.1.0", tauri: "0.1.1", cargo: "0.1.0" }), /tauri=0\.1\.1/)
})

test("rejects secrets and development state from bundle inputs", () => {
  assert.deepEqual(findForbiddenReleasePaths(["resources/plugins/resume/plugin.json", ".env", "certs/app.pfx", "data/typedance.sqlite"]), [".env", "certs/app.pfx", "data/typedance.sqlite"])
})

test("uses stable NSIS artifact names", () => {
  assert.deepEqual(releaseArtifactNames("0.1.0"), ["TypeDance_0.1.0_x64-setup.exe", "TypeDance_0.1.0_x64-setup.exe.sha256"])
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test scripts/release/release-lib.test.mjs`

Expected: FAIL，提示 `release-lib.mjs` 不存在。

- [ ] **Step 3: 实现纯函数**

`release-lib.mjs` 导出：

```js
const forbidden = [/(^|[/\\])\.env(?:\.|$)/i, /\.(?:pem|pfx|p12|key)$/i, /(?:^|[/\\])typedance\.sqlite$/i, /(?:^|[/\\])\.git(?:[/\\]|$)/i]

export function assertReleaseVersions(versions) {
  const entries = Object.entries(versions)
  const expected = entries[0]?.[1]
  const mismatch = entries.find(([, value]) => value !== expected)
  if (!expected || mismatch) throw new Error(`Release versions must match: ${entries.map(([name, value]) => `${name}=${value}`).join(", ")}`)
  return expected
}

export function findForbiddenReleasePaths(paths) {
  return paths.filter((path) => forbidden.some((pattern) => pattern.test(path)))
}

export function releaseArtifactNames(version) {
  const installer = `TypeDance_${version}_x64-setup.exe`
  return [installer, `${installer}.sha256`]
}
```

- [ ] **Step 4: 增加 `release:test` 并验证通过**

```json
"release:test": "node --test scripts/release/*.test.mjs"
```

Run: `corepack pnpm release:test`

Expected: 4 tests PASS。

- [ ] **Step 5: 提交**

```powershell
git add package.json scripts/release/release-lib.mjs scripts/release/release-lib.test.mjs
git commit -m "test(release): 固化安装包发布规则"
```

### Task 2: 模型设置共享契约

**Files:**
- Create: `packages/contracts/src/workbench/model-settings.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

- [ ] **Step 1: 写脱敏设置契约测试**

```ts
it("validates redacted agent-host model settings", () => {
  expect(modelSettingsResponseSchema.parse({
    provider: "deepseek",
    model: "deepseek-v4-flash",
    base_url: "https://api.deepseek.com",
    api_key: { configured: true, preview: "...a9f2" },
  }).api_key.preview).toBe("...a9f2")
  expect(() => modelSettingsResponseSchema.parse({ api_key: { configured: true, value: "secret" } })).toThrow()
})
```

- [ ] **Step 2: 运行契约测试确认失败**

Run: `corepack pnpm --filter @typedance/contracts test`

Expected: FAIL，提示 schema 尚未导出。

- [ ] **Step 3: 创建 schema 并导出**

```ts
import { z } from "zod"

export const modelSettingsResponseSchema = z.object({
  provider: z.literal("deepseek"),
  model: z.string().min(1),
  base_url: z.string().url(),
  api_key: z.object({ configured: z.boolean(), preview: z.string().nullable() }),
})

export const modelSettingsUpdateSchema = z.object({
  model: z.string().trim().min(1),
  base_url: z.string().url(),
  api_key: z.string().trim().min(1).optional(),
})

export type ModelSettingsResponse = z.infer<typeof modelSettingsResponseSchema>
export type ModelSettingsUpdate = z.infer<typeof modelSettingsUpdateSchema>
```

- [ ] **Step 4: 运行测试和构建**

Run: `corepack pnpm --filter @typedance/contracts test && corepack pnpm --filter @typedance/contracts build`

Expected: tests PASS，TypeScript build 成功。

- [ ] **Step 5: 提交**

```powershell
git add packages/contracts
git commit -m "feat(contracts): 新增模型设置契约"
```

### Task 3: Agent Host 本机模型设置与健康路由

**Files:**
- Create: `packages/agent-host/src/model-settings.ts`
- Create: `packages/agent-host/tests/model-settings.test.ts`
- Modify: `packages/agent-host/src/index.ts`
- Modify: `packages/agent-host/tests/agent-host.test.ts`

- [ ] **Step 1: 写持久化、脱敏和路由失败测试**

```ts
it("stores auth separately and never returns the full key", async () => {
  const settings = createFileModelSettings(tempDir)
  await settings.update({ model: "deepseek-v4-flash", base_url: "https://api.deepseek.com", api_key: "sk-secret-a9f2" })
  expect(await settings.get()).toEqual({ provider: "deepseek", model: "deepseek-v4-flash", base_url: "https://api.deepseek.com", api_key: { configured: true, preview: "...a9f2" } })
  expect(await readFile(join(tempDir, "agent-host", "auth.json"), "utf8")).toContain("sk-secret-a9f2")
})

it("serves health and redacted model settings", async () => {
  const health = await fetch(`${server.url}/health`)
  expect(await health.json()).toEqual({ status: "ok", service: "agent-host" })
  const settings = await fetch(`${server.url}/settings/model`)
  expect((await settings.json()).api_key).not.toHaveProperty("value")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `corepack pnpm --filter @typedance/agent-host test`

Expected: FAIL，提示模型设置模块和路由不存在。

- [ ] **Step 3: 实现原子写入与设置服务**

实现 `createFileModelSettings(dataDir)`，公开 `get()`、`update(payload)`、`clearApiKey()`、`resolve()`；配置写入 `agent-host/config.json`，认证写入 `agent-host/auth.json`。写入使用同目录临时文件后 `rename()`，API 响应仅返回末四位预览。

```ts
export type ResolvedModelSettings = {
  provider: "deepseek"
  model: string
  baseUrl: string
  apiKey: string | undefined
}
```

- [ ] **Step 4: 在 HTTP server 中挂载路由**

将 `AgentHostServerOptions` 扩展为可选 `modelSettings`，增加：

```text
GET    /health
GET    /settings/model
PUT    /settings/model
DELETE /settings/model/api-key
```

PUT body 必须通过 `modelSettingsUpdateSchema` 校验；解析错误返回 400，文件错误返回 500，错误正文不得包含 API Key。

- [ ] **Step 5: 验证测试与构建**

Run: `corepack pnpm --filter @typedance/agent-host test && corepack pnpm --filter @typedance/agent-host build`

Expected: tests PASS，build 成功。

- [ ] **Step 6: 提交**

```powershell
git add packages/agent-host/src packages/agent-host/tests
git commit -m "feat(agent-host): 增加本机模型设置"
```

### Task 4: DeepSeek 延迟配置与显式环境边界

**Files:**
- Modify: `packages/agent-host/src/model/deepseek.ts`
- Modify: `packages/agent-host/tests/deepseek.test.ts`
- Modify: `packages/agent-host/src/cli.ts`

- [ ] **Step 1: 写无密钥启动和运行时刷新测试**

```ts
it("resolves credentials when a run starts", async () => {
  let apiKey: string | undefined
  const adapter = createDeepSeekModelAdapter({ resolveSettings: async () => ({ apiKey, baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-v4-flash" }), fetch })
  apiKey = "sk-runtime"
  await collect(adapter.stream(request))
  expect(fetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: expect.objectContaining({ authorization: "Bearer sk-runtime" }) }))
})

it("reports a controlled configuration error without a key", async () => {
  const adapter = createDeepSeekModelAdapter({ resolveSettings: async () => ({ apiKey: undefined, baseUrl: "https://api.deepseek.com", defaultModel: "deepseek-v4-flash" }) })
  await expect(collect(adapter.stream(request))).rejects.toThrow("请先在 AI 设置中配置 API Key")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `corepack pnpm --filter @typedance/agent-host test -- deepseek.test.ts`

Expected: FAIL，旧 adapter 在创建时要求字符串密钥。

- [ ] **Step 3: 实现每次 stream 动态解析设置**

`createDeepSeekModelAdapter` 接收 `resolveSettings()`，在 `stream()` 开始时取得 `apiKey`、`baseUrl` 与默认模型。禁止将密钥写入 error、log 或 final output。

- [ ] **Step 4: 删除 `.env` 向上搜索**

从 `cli.ts` 删除 `findUp(".env")`。仅当显式设置 `TYPEDANCE_ENV_FILE` 时读取指定文件；Release 启动不传该变量。CLI 使用 `TYPEDANCE_DATA_DIR` 创建模型设置服务，并把 `TYPEDANCE_PLUGIN_ROOT` 作为必需的 Release 插件根目录。

- [ ] **Step 5: 运行 Agent Host 全套验证**

Run: `corepack pnpm --filter @typedance/agent-host test && corepack pnpm --filter @typedance/agent-host build`

Expected: tests PASS，缺少密钥不会阻止 server 启动。

- [ ] **Step 6: 提交**

```powershell
git add packages/agent-host
git commit -m "fix(agent-host): 隔离发布版模型凭据"
```

### Task 5: 前端真实 AI 设置弹窗

**Required skills at execution:** `build-web-apps:react-best-practices`、`build-web-apps:shadcn`

**Files:**
- Modify: `apps/web/src/agentHost.ts`
- Create: `apps/web/src/features/settings/AiSettingsDialog.tsx`
- Create: `apps/web/src/features/settings/AiSettingsDialog.test.tsx`
- Modify: `apps/web/src/features/revision/WorkbenchSidebar.tsx`

- [ ] **Step 1: 写用户行为测试**

```tsx
it("loads redacted settings and saves a replacement key", async () => {
  vi.mocked(getModelSettings).mockResolvedValue({ provider: "deepseek", model: "deepseek-v4-flash", base_url: "https://api.deepseek.com", api_key: { configured: true, preview: "...a9f2" } })
  render(<AiSettingsDialog open onOpenChange={() => undefined} />)
  expect(await screen.findByText("已配置 ····a9f2")).toBeInTheDocument()
  await user.type(screen.getByLabelText("API Key"), "sk-new")
  await user.click(screen.getByRole("button", { name: "保存" }))
  expect(updateModelSettings).toHaveBeenCalledWith(expect.objectContaining({ api_key: "sk-new" }))
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `corepack pnpm --filter @typedance/web test -- AiSettingsDialog.test.tsx`

Expected: FAIL，组件和 API helper 不存在。

- [ ] **Step 3: 增加 API helper**

在 `agentHost.ts` 增加 `getModelSettings()`、`updateModelSettings()`、`clearModelApiKey()`，响应统一使用共享 Zod schema 解析。

- [ ] **Step 4: 实现弹窗并替换占位输入框**

弹窗复用现有 `Dialog`、`Input`、`Button` 和 `sonner`。打开时加载脱敏状态；API Key 输入始终为空，不回填旧值；保存成功后重新加载；“清除密钥”必须二次确认。将 `WorkbenchSidebar` 中现有静态 AI 设置表单替换为该组件。

- [ ] **Step 5: 运行 Web 验证**

Run: `corepack pnpm --filter @typedance/web test && corepack pnpm --filter @typedance/web build`

Expected: tests PASS，build 成功。

- [ ] **Step 6: 提交**

```powershell
git add apps/web/src
git commit -m "feat(settings): 接入本机模型配置"
```

### Task 6: Agent Host Node SEA 构建

**Files:**
- Create: `scripts/release/build-agent-host.mjs`
- Modify: `scripts/release/release-lib.test.mjs`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: 写 SEA 配置和资源测试**

测试 `createSeaConfig()` 只包含一个 CommonJS main，输出位于 `artifacts/release/staging/agent-host`，插件复制清单只包含 `plugins/resume/**`，且不接受 `.env`。

- [ ] **Step 2: 运行测试确认失败**

Run: `corepack pnpm release:test`

Expected: FAIL，SEA helper 尚未实现。

- [ ] **Step 3: 安装固定构建依赖**

Run: `corepack pnpm add -Dw esbuild@0.27.2 postject@1.0.0-alpha.6`

Expected: `package.json` 与 lockfile 记录直接依赖。

- [ ] **Step 4: 实现 SEA builder**

脚本必须：

1. 校验 `win32/x64` 和 Node major 24；
2. esbuild `packages/agent-host/src/cli.ts`，设置 `bundle: true`、`platform: "node"`、`format: "cjs"`、`target: "node24"`、`sourcemap: false`；
3. 写 `sea-config.json` 并执行 `node --experimental-sea-config`；
4. 复制 `process.execPath` 为 `apps/desktop/src-tauri/binaries/typedance-agent-host-x86_64-pc-windows-msvc.exe`；
5. 使用 `signtool remove /s` 移除 Node 原签名；
6. 使用本地 `postject` 注入 `NODE_SEA_BLOB`；
7. 复制 `plugins/resume` 到 `apps/desktop/src-tauri/resources/plugins/resume`；
8. 校验所有输出非空且资源审计通过。

- [ ] **Step 5: 构建并启动 SEA 冒烟**

Run: `node scripts/release/build-agent-host.mjs`

Expected: 生成非空 Agent Host exe；传入临时数据目录和插件目录后，`GET http://127.0.0.1:4327/health` 返回 200，进程可正常终止。

- [ ] **Step 6: 提交**

```powershell
git add package.json pnpm-lock.yaml scripts/release apps/desktop/src-tauri/resources
git commit -m "feat(release): 构建 Agent Host 单文件"
```

### Task 7: Python Sidecar 可执行入口与 PyInstaller

**Files:**
- Create: `services/sidecar/src/typedance_sidecar/cli.py`
- Create: `services/sidecar/tests/test_cli.py`
- Create: `services/sidecar/typedance-sidecar.spec`
- Create: `scripts/release/build-sidecar.ps1`
- Modify: `services/sidecar/pyproject.toml`

- [ ] **Step 1: 写 CLI 参数映射测试**

```py
def test_cli_sets_release_paths_before_starting_uvicorn(tmp_path, monkeypatch):
    run = Mock()
    monkeypatch.setattr("typedance_sidecar.cli.uvicorn.run", run)
    main(["--port", "4317", "--data-dir", str(tmp_path / "data"), "--browser-path", str(tmp_path / "chromium")])
    assert os.environ["TYPEDANCE_DATA_DIR"] == str(tmp_path / "data")
    assert os.environ["PLAYWRIGHT_BROWSERS_PATH"] == str(tmp_path / "chromium")
    run.assert_called_once_with("typedance_sidecar.main:app", host="127.0.0.1", port=4317, log_level="info")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk pytest services/sidecar/tests/test_cli.py -q`

Expected: FAIL，CLI 模块不存在。

- [ ] **Step 3: 实现 CLI 与 Release dependency group**

CLI 使用 `argparse` 接收 `--host`、`--port`、`--data-dir`、`--browser-path`，设置环境后调用 Uvicorn。`pyproject.toml` 增加 `release = ["pyinstaller==6.14.1"]`。

- [ ] **Step 4: 创建 PyInstaller spec**

spec 入口为 `src/typedance_sidecar/cli.py`，包含 `typedance_sidecar`、FastAPI、Uvicorn、MCP、Playwright 和 `sharepoint-to-text` 所需 hidden imports/data；最终 `EXE` 名称为 `typedance-sidecar`，console 关闭。Chromium 明确不进入 PyInstaller analysis。

- [ ] **Step 5: 实现 PowerShell builder 并验证**

builder 在 `artifacts/release/python` 创建隔离 venv，安装当前 sidecar 与 `[release]`，先构建 one-folder 并运行健康冒烟，再构建 one-file，复制到 `apps/desktop/src-tauri/binaries/typedance-sidecar-x86_64-pc-windows-msvc.exe`。

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release/build-sidecar.ps1`

Expected: 生成非空 Sidecar exe，启动后 `/health` 返回 200。

- [ ] **Step 6: 提交**

```powershell
git add services/sidecar scripts/release/build-sidecar.ps1
git commit -m "feat(release): 构建 Python Sidecar 单文件"
```

### Task 8: 固定 Chromium 资源

**Files:**
- Modify: `apps/desktop/scripts/download-chromium.py`
- Create: `apps/desktop/scripts/test_download_chromium.py`
- Modify: `.gitignore`

- [ ] **Step 1: 写目录与清单测试**

测试传入目标目录后设置 `PLAYWRIGHT_BROWSERS_PATH`，仅安装 Chromium，并写出包含 Playwright 版本、browser directory 和 `chrome.exe` 相对路径的 `manifest.json`。

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk pytest apps/desktop/scripts/test_download_chromium.py -q`

Expected: FAIL，旧脚本不支持参数和 manifest。

- [ ] **Step 3: 重写 Chromium 准备脚本**

CLI 接收 `--output apps/desktop/src-tauri/resources/ms-playwright`；下载前清空该受控目录；执行 `python -m playwright install chromium`；递归定位唯一的 `chrome.exe`；任何歧义或缺失均返回非零。

- [ ] **Step 4: 下载并验证资源**

Run: `python apps/desktop/scripts/download-chromium.py --output apps/desktop/src-tauri/resources/ms-playwright`

Expected: `manifest.json` 与非空 `chrome.exe` 存在。

- [ ] **Step 5: 提交**

```powershell
git add .gitignore apps/desktop/scripts
git commit -m "feat(release): 固定 Chromium 发布资源"
```

### Task 9: Tauri 双 Sidecar 生命周期

**Files:**
- Create: `apps/desktop/src-tauri/src/runtime.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/Cargo.lock`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: 写 runtime 参数和清理单元测试**

测试 Sidecar 参数包含 Tauri app data dir、Chromium resource path、Agent Host plugin root 与 loopback 地址；测试启动第二个服务失败时第一个 child 被 kill。

- [ ] **Step 2: 运行 Rust 测试确认失败**

Run: `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

Expected: FAIL，`runtime` 模块不存在。

- [ ] **Step 3: 增加依赖**

使用官方 CLI/当前版本增加 `tauri-plugin-single-instance = "2"` 与启用 rustls 的 `reqwest`。single-instance 插件必须在 setup 阶段最先注册。

- [ ] **Step 4: 实现 RuntimeState**

`RuntimeState` 持有两个 `CommandChild`。Release 下的 `start()` 依次 spawn `typedance-sidecar` 与 `typedance-agent-host`，每个服务在 15 秒内以 200ms 间隔请求 `/health`。命令通过 `.env()` 显式传入路径；不传 `TYPEDANCE_ENV_FILE`。debug build 继续由根 `pnpm dev` 启动开发服务，不重复 spawn 发布二进制。`stop()` 对两个 child 调用 kill 并清空状态。

- [ ] **Step 5: 接入 Tauri setup 与退出事件**

主窗口配置为初始隐藏；后台服务就绪后 `show()` 并聚焦。失败时使用 dialog plugin 显示服务名和错误摘要，然后停止已有子进程并退出。`RunEvent::ExitRequested` 和 `RunEvent::Exit` 都调用幂等 `stop()`。

- [ ] **Step 6: 更新 capability 并验证**

增加 `binaries/typedance-agent-host` sidecar allow entry；保留现有 dialog/open/save/opener 权限。

Run: `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml && rtk cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`

Expected: tests PASS，cargo check 成功。

- [ ] **Step 7: 提交**

```powershell
git add apps/desktop/src-tauri
git commit -m "feat(desktop): 管理本地服务生命周期"
```

### Task 10: Tauri Release 配置覆盖层与 NSIS 静态约束

**Files:**
- Create: `apps/desktop/src-tauri/tauri.release.conf.json`
- Create: `apps/desktop/src-tauri/tests/release_config.rs`
- Delete: `apps/desktop/src-tauri/binaries/typedance-sidecar-x86_64-pc-windows-msvc.exe`（仅删除现有 0 字节占位版本，真实产物保持 gitignored）
- Modify: `.gitignore`

- [ ] **Step 1: 写发布配置失败测试**

测试基础 `tauri.conf.json` 不声明 externalBin；Release 覆盖层满足 `targets == ["nsis"]`、两个 externalBin、Chromium/plugin resources、图标、`windows[0].visible == false`。发布脚本单独断言构建前所有 external binary 非空。

- [ ] **Step 2: 运行测试确认失败**

Run: `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test release_config`

Expected: FAIL，Release 覆盖层尚不存在。

- [ ] **Step 3: 创建 Release 配置覆盖层**

设置：

```json
"bundle": {
  "active": true,
  "targets": ["nsis"],
  "externalBin": ["binaries/typedance-sidecar", "binaries/typedance-agent-host"],
  "icon": ["icons/icon.ico"],
  "resources": ["resources/ms-playwright/**/*", "resources/plugins/**/*"]
}
```

覆盖层提供完整窗口配置并设置 `"visible": false`。NSIS 安装模式使用 per-user，安装包名由构建后归一化步骤处理。基础配置继续服务 `tauri dev`，不引用发布二进制。

- [ ] **Step 4: 运行静态测试**

Run: `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --test release_config`

Expected: PASS。

- [ ] **Step 5: 提交**

```powershell
git add apps/desktop/src-tauri
git commit -m "feat(desktop): 配置 NSIS 发布资源"
```

### Task 11: `pnpm release` 主脚本与安装冒烟

**Files:**
- Create: `scripts/release-windows.ps1`
- Create: `scripts/release/smoke-installer.ps1`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: 增加命令入口**

```json
"release": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-windows.ps1",
"release:publish": "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-windows.ps1 -Publish"
```

- [ ] **Step 2: 实现 fail-fast 主脚本**

脚本参数仅包含 `[switch]$Publish`。设置 `$ErrorActionPreference = "Stop"`，依次执行：平台/工具检查、版本检查、工作区检查、相关测试、Web/Agent Host build、Agent Host SEA、Sidecar PyInstaller、Chromium、Cargo test/check、使用 `tauri.release.conf.json` 的 Tauri NSIS build、产物复制、SHA-256、敏感路径审计、安装冒烟。

最终目录固定为 `artifacts/release/windows-x64/`。任何失败删除本次最终目录，但保留 `artifacts/release/logs/`。

- [ ] **Step 3: 实现安装冒烟脚本**

使用 NSIS `/S` 静默安装到临时 per-user 目录，启动 `TypeDance.exe`，轮询 `4317/health` 和 `4327/health`。两个服务返回 200 后，通过 Sidecar API 创建临时 document，并调用 `/documents/{id}/export/pdf` 传入最小 `source_doc_json`，断言响应为非空 PDF，以实际启动随包 Chromium。然后关闭应用并执行卸载器 `/S`，确认程序目录删除且临时用户数据哨兵文件仍存在。

- [ ] **Step 4: 实现发布模式**

`-Publish` 先执行完整本地构建与冒烟，再检查 `gh auth status`，使用 `v<version>` 标签和 `gh release create`/`gh release upload --clobber` 发布安装包及校验文件。若同名远端资产存在且 SHA-256 不同，停止并要求显式删除旧 Release，禁止静默覆盖不同内容。

- [ ] **Step 5: 运行本地发布**

Run: `corepack pnpm release`

Expected: `artifacts/release/windows-x64/TypeDance_0.1.0_x64-setup.exe` 与 `.sha256` 存在，安装冒烟通过，输出中没有任何 API Key。

- [ ] **Step 6: 提交**

```powershell
git add package.json .gitignore scripts
git commit -m "feat(release): 增加一键 Windows 发布"
```

### Task 12: GitHub Release workflow

**Files:**
- Create: `.github/workflows/release-windows.yml`

- [ ] **Step 1: 创建标签触发 workflow**

```yaml
name: Release Windows
on:
  push:
    tags:
      - "v*"
permissions:
  contents: write
jobs:
  release-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: "24"
          cache: pnpm
      - uses: actions/setup-python@v6
        with:
          python-version: "3.11"
      - uses: dtolnay/rust-toolchain@stable
      - run: corepack enable
      - run: corepack pnpm install --frozen-lockfile
      - run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/release-windows.ps1
      - run: gh release create $env:GITHUB_REF_NAME artifacts/release/windows-x64/* --generate-notes
        env:
          GH_TOKEN: ${{ github.token }}
```

- [ ] **Step 2: 增加 workflow 静态校验**

在 `release-lib.test.mjs` 读取 workflow，断言只在 `v*` tag 触发、runner 为 Windows、Node 24、没有 `DEEPSEEK_API_KEY`/`.env`、权限只有 `contents: write`。

- [ ] **Step 3: 运行发布规则测试**

Run: `corepack pnpm release:test`

Expected: workflow tests PASS。

- [ ] **Step 4: 提交**

```powershell
git add .github/workflows/release-windows.yml scripts/release/release-lib.test.mjs
git commit -m "ci(release): 自动发布 Windows 安装包"
```

### Task 13: 文档与最终验证

**Files:**
- Modify: `apps/desktop/README.md`
- Modify: `docs/README.md`

- [ ] **Step 1: 更新中文发布文档**

记录 `pnpm release`、`pnpm release:publish`、前置工具、产物目录、未签名 SmartScreen 提示、GitHub tag 规则、API Key 本机配置、构建失败日志位置，以及 `.env` 永不进入 Release 的保证。

- [ ] **Step 2: 运行完整测试**

Run: `rtk pnpm test`

Expected: 所有 package tests PASS。

- [ ] **Step 3: 运行 Web 与 Rust 构建**

Run: `rtk pnpm build`

Expected: workspace production builds 成功。

Run: `rtk cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`

Expected: Rust tests PASS。

- [ ] **Step 4: 生成并人工检查最终安装包**

Run: `corepack pnpm release`

Expected: NSIS 与 SHA-256 产物存在；静默安装、启动、双健康检查、退出、卸载和用户数据保留全部通过。

- [ ] **Step 5: 敏感信息最终审计**

列出 staging、安装目录和最终 artifacts 的相对路径，调用 `findForbiddenReleasePaths()`；输出只能包含文件路径，不读取文件内容。

Expected: 0 forbidden paths；`.env`、证书、开发数据库和 `.git` 均不存在。

- [ ] **Step 6: 提交文档**

```powershell
git add apps/desktop/README.md docs/README.md
git commit -m "docs(release): 补充 Windows 发布指南"
```

## Self-Review

- **Spec coverage:** Task 1/11 覆盖 `pnpm release` 与产物审计；Task 2-5 覆盖用户本机模型设置和 `.env` 隔离；Task 6-8 覆盖 Agent Host、Python Sidecar 和 Chromium；Task 9-10 覆盖 Tauri 生命周期与 NSIS；Task 12 覆盖 GitHub Release；Task 13 覆盖安装、PDF 依赖、卸载和文档。
- **Boundary check:** Tauri 只负责 OS 与进程生命周期；Agent Host 负责 AI 设置和模型调用；Python Sidecar 负责业务数据与 PDF；Harness Core 无改动。
- **Type consistency:** `ModelSettingsResponse`、`ModelSettingsUpdate`、`ResolvedModelSettings`、`createFileModelSettings()`、`GET/PUT/DELETE /settings/model` 在契约、Host 和 Web 中名称一致。
- **Security check:** Release 构建不读取 `.env`；Agent Host 仅在显式 `TYPEDANCE_ENV_FILE` 时读取开发环境文件；审计不读取或输出秘密内容。
- **Scope check:** Windows x64/NSIS/未签名是唯一发布目标；MSI、自动更新、签名和其他平台未混入实施范围。
