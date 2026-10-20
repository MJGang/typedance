# Windows 发布指南

TypeDance 当前发布目标是 Windows x64 的 NSIS 当前用户安装包，提供经过更新签名验证的客户端升级。仓库根目录的 `pnpm release` 是本机与 CI 共用的唯一构建入口。更新签名与 Windows Authenticode 代码签名分别管理。

## 构建前准备

在 Windows x64 环境准备以下工具：

- Node.js 24 x64，并启用 Corepack
- 仓库声明的 pnpm 10.11.0
- 可执行 `cargo` 的 Rust MSVC 工具链
- `uv`，用于创建固定的 Python 3.11 发布环境
- 首次构建所需的网络访问，用于安装依赖和下载固定版本 Chromium

安装仓库依赖：

```powershell
corepack enable
pnpm install --frozen-lockfile
```

可先检查关键工具：

```powershell
node --version
pnpm --version
cargo --version
uv --version
```

## 构建安装包

当前源码仓库是私有仓库。客户端通过匿名 HTTPS 检查更新，因此更新产物必须发布到独立的公开仓库；无需公开源码。准备一个带默认分支的公开仓库（创建时初始化 README 即可），然后设置：

```powershell
$env:TYPEDANCE_UPDATE_REPOSITORY = "<公开仓库的 owner/repo>"
```

该配置会在构建时写入客户端，用于更新清单和更新日志地址。未配置的开发构建显示「更新服务尚未配置」；正式构建缺少配置或仓库不能匿名访问时会直接中止。

先配置更新签名私钥。当前开发机的私钥保存在仓库外的 `%USERPROFILE%\.typedance\release-keys\updater.key`，对应公钥已配置在 `apps/desktop/src-tauri/tauri.conf.json`。不要提交私钥，也不要为每次构建重新生成密钥。

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.typedance\release-keys\updater.key"
```

如果私钥有密码，还需设置 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。更换签名密钥前必须规划现有客户端的信任迁移；已安装客户端只信任自身内置公钥。

构建前编辑 `docs/release-notes.md`，其内容将作为客户端更新说明写入版本清单。

在仓库根目录执行：

```powershell
pnpm release
```

该命令会依次完成发布规则测试、项目测试与构建、Agent Host SEA、Python Sidecar 单文件、固定 Chromium、Rust 测试、Tauri NSIS 打包和发布运行时健康检查。任何一步失败都会停止，不会生成一个被误认为可发布的最终产物。

成功后得到：

```text
artifacts/release/TypeDance_<version>_x64-setup.exe
artifacts/release/TypeDance_<version>_x64-setup.exe.sha256
artifacts/release/TypeDance_<version>_x64-setup.exe.sig
artifacts/release/latest.json
```

版本必须在根 `package.json`、`apps/desktop/package.json`、`tauri.conf.json` 和 `Cargo.toml` 中保持一致。

## 验证安装与卸载

关闭正在运行的 TypeDance，并确认系统中没有已安装的 TypeDance，然后执行：

```powershell
pnpm release:smoke
```

脚本会静默安装、启动应用、检查 Python Sidecar 与 Agent Host 健康状态、验证内置 Chromium、等待托管退出、静默卸载，并确认卸载不会删除用户数据。检测到已有安装时会直接中止，避免覆盖真实用户环境。

也可以手动校验安装包哈希：

```powershell
Get-FileHash artifacts/release/TypeDance_<version>_x64-setup.exe -Algorithm SHA256
```

## 发布 GitHub Release

本机已经构建并验证产物后，可使用已登录的 GitHub CLI 发布当前版本：

```powershell
gh auth status
pnpm release:publish
```

脚本读取根 `package.json` 的版本，以 `v<version>` 创建 GitHub Release，并上传安装包与 SHA-256 文件。正式发布前应确认对应提交和版本标签已经推送。

也可以推送匹配版本的 `v*` 标签，由 `.github/workflows/release-windows.yml` 在干净的 Windows runner 中重新执行 `pnpm release` 并发布产物。

CI 需要在源码仓库的 Actions 配置以下内容：

- variable `TYPEDANCE_UPDATE_REPOSITORY`：公开发布仓库的 `owner/repo`。
- secret `TAURI_SIGNING_PRIVATE_KEY`：私钥文件内容；以及可选的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。
- secret `TYPEDANCE_RELEASE_TOKEN`：对公开发布仓库拥有 Contents 写权限的 GitHub token。源码仓库的默认 `github.token` 无法向另一个仓库发布 Release。

构建会先匿名验证发布仓库可访问。发布只上传安装包、校验文件、签名与版本清单；私钥和 token 不会打包进应用。

## 客户端更新流程

- 「设置 → 客户端更新」读取已安装客户端的真实版本，检查构建时指定的公开发布仓库的最新 `latest.json`。
- 启动自动检查默认开启，可在本机设置中关闭；自动检查不会自动下载、安装或重启，也不弹出阻断式提醒。
- 更新包使用官方 Tauri updater 下载并验证 `.sig`；下载可以取消，关闭设置弹窗后仍会继续。
- 下载完成后点击「重启并更新」，确认后先保存所有待提交画布；保存失败会阻止安装。Windows 安装前结束托管子进程，再启动 NSIS 更新并重新打开应用。
- 浏览器预览中保留更新页并说明需要桌面客户端，不模拟新版本或下载结果。
- GitHub 尚无 Release 或缺少版本清单时会显示检查失败，不会误报「已是最新」。
- 未提供公开更新仓库时明确提示未配置，不会请求私有源码仓库或内置 GitHub 凭据。

设置界面保留 Maia 风格。`Tabs` 和 `Switch` 官方组件经过必要的本地修补：向 Radix 转发 `orientation`，并使用当前 Radix 实际提供的 `data-orientation` / `data-state` 属性，修复竖向布局、键盘导航和开关显示；未切换组件风格。

首次启用线上升级前，需要发布包含 `.exe`、`.exe.sig` 和 `latest.json` 的版本。旧安装包不会自动获得此前未实现的检查更新入口。

## `.env` 与凭据边界

- 发布流程不会读取仓库 `.env`，也不会把 `.env`、私钥、证书、SQLite 数据库或 `.git` 内容加入安装包。
- Agent Host 发布版不会向上搜索 `.env`；只有开发者显式设置 `TYPEDANCE_ENV_FILE` 时才会读取指定文件。
- 桌面运行时只向子进程传递白名单环境变量，不转发构建机的模型密钥或 `.env` 路径。
- API Key 应由安装后的“AI 设置”页面配置，保存在当前用户的应用数据目录，不写入安装包。

当前安装包未进行代码签名，Windows 首次运行时可能显示信誉或安全提示。这不影响本地验证；对外正式分发前应另行配置代码签名。
