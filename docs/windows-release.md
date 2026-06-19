# Windows 发布指南

TypeDance 当前发布目标是 Windows x64 的未签名 NSIS 当前用户安装包。仓库根目录的 `pnpm release` 是本机与 CI 共用的唯一构建入口。

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

在仓库根目录执行：

```powershell
pnpm release
```

该命令会依次完成发布规则测试、项目测试与构建、Agent Host SEA、Python Sidecar 单文件、固定 Chromium、Rust 测试、Tauri NSIS 打包和发布运行时健康检查。任何一步失败都会停止，不会生成一个被误认为可发布的最终产物。

成功后得到：

```text
artifacts/release/TypeDance_<version>_x64-setup.exe
artifacts/release/TypeDance_<version>_x64-setup.exe.sha256
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

## `.env` 与凭据边界

- 发布流程不会读取仓库 `.env`，也不会把 `.env`、私钥、证书、SQLite 数据库或 `.git` 内容加入安装包。
- Agent Host 发布版不会向上搜索 `.env`；只有开发者显式设置 `TYPEDANCE_ENV_FILE` 时才会读取指定文件。
- 桌面运行时只向子进程传递白名单环境变量，不转发构建机的模型密钥或 `.env` 路径。
- API Key 应由安装后的“AI 设置”页面配置，保存在当前用户的应用数据目录，不写入安装包。

当前安装包未进行代码签名，Windows 首次运行时可能显示信誉或安全提示。这不影响本地验证；对外正式分发前应另行配置代码签名。
