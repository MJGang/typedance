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

源码仓库 `MJGang/typedance` 已公开，客户端更新产物发布到该仓库的 GitHub Releases。客户端通过匿名 HTTPS 检查更新。本机构建前设置：

```powershell
$env:TYPEDANCE_UPDATE_REPOSITORY = "MJGang/typedance"
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

## 构建耗时与缓存

`0.1.1` 的成功发布基线为 18 分 41 秒，其中 Rust 的测试与正式编译约 6 分 21 秒，NSIS 的 LZMA 压缩约 5 分 8 秒。原流程分别使用 debug/test 和 release profile，且只在版本标签下写缓存。

当前流程统一通过 `pnpm release:rust-test` 执行 release profile 的原生测试，启用与桌面生产构建相同的 `tauri/custom-protocol` feature。`main` 的代码检查通过后会执行同一命令，预热 Rust release 依赖缓存；版本发布使用相同的 `shared-key` 读取默认分支缓存。应用自身仍由 Cargo 按当前源码重新构建，不缓存或复用历史安装包。

版本标签不能直接读取其他标签创建的缓存，因此首次默认分支预热必须成功完成。Rust 工具链、依赖或编译选项变更仍可能触发重新编译，不能保证每次发布都达到固定耗时。

NSIS 默认使用 ZLIB，减少安装包生成时间；代价是安装包可能大于 LZMA。压缩不会改变包含的运行文件、更新公钥或更新签名校验。每次构建会保存 `artifacts/release/timings.json`，并在 Actions Summary 中展示各阶段耗时和退出码；失败阶段也会记录。

需要验证完整打包或比较压缩算法时，在 Actions 中手动运行 **Release Windows**。也可使用：

```powershell
gh workflow run release-windows.yml --ref main -f compare_compression=true
```

手动运行执行完整测试、签名构建、运行时健康检查和安装卸载检查，产物只保留为 Actions artifacts，不创建或覆盖 GitHub Release。启用比较时，基于同一批已经编译的运行文件分别执行 LZMA 和 ZLIB 打包，不再次编译 Rust；结果保存在 `artifacts/release/nsis-benchmark.json`。对比实验的耗时应单独计算，不计作正常发布路径的耗时。

## 验证安装与卸载

关闭正在运行的 TypeDance，并确认系统中没有已安装的 TypeDance，然后执行：

```powershell
pnpm release:smoke
```

脚本会静默安装、启动应用并验证未配置账号时的登录门禁；另外在临时目录中单独启动已安装的 Python Sidecar 与 Agent Host，验证健康状态、本机访问凭据、内置 Chromium 和语音运行时。验收令牌由 `pnpm release:rust-test` 构建的 `local-service-token` 工具生成，与正式登录复用 `account/token.rs`，不在脚本中另行生成；该工具不随客户端安装。随后静默卸载，并确认卸载不会删除用户数据。检测到已有安装时会直接中止，避免覆盖真实用户环境。

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

脚本读取根 `package.json` 的版本，以 `v<version>` 创建 GitHub Release，并上传安装包、SHA-256 文件、更新签名与 `latest.json`。正式发布前应确认对应提交和版本标签已经推送。

也可以推送匹配版本的 `v*` 标签，由 `.github/workflows/release-windows.yml` 在干净的 Windows runner 中重新执行 `pnpm release` 并发布产物。

CI 需要在源码仓库的 Actions 配置以下内容：

- variable `TYPEDANCE_UPDATE_REPOSITORY`：`MJGang/typedance`。
- secret `TAURI_SIGNING_PRIVATE_KEY`：私钥文件内容；以及可选的 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。

工作流通过 `contents: write` 授权的 `github.token` 发布到本仓库，不需要额外的发布 token。

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
- API Key 由登录后的“AI 设置”页面配置，按账号保存在 Windows 凭据管理器，不写入安装包。

当前安装包未进行代码签名，Windows 首次运行时可能显示信誉或安全提示。这不影响本地验证；对外正式分发前应另行配置代码签名。
