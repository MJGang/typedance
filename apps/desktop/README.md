# TypeDance Desktop

`apps/desktop` 是 TypeDance 的 Tauri 2 桌面壳层，负责窗口、系统路径、对话框、单实例，以及 Python Sidecar 和 Agent Host 的生命周期管理。简历与工作区业务逻辑仍由 `services/sidecar` 提供，AI 编排由 `packages/agent-host` 提供。

开发模式由仓库根目录统一启动：

```powershell
pnpm dev
```

Windows x64 发布版使用 NSIS 当前用户安装包，并将下列运行时一并打包：

- Python Sidecar 的 PyInstaller 单文件程序
- Agent Host 的 Node.js SEA 单文件程序
- 固定版本的 Playwright Chromium
- Resume 插件资源

手动构建、安装冒烟和 GitHub Release 发布命令见 [Windows 发布指南](../../docs/windows-release.md)。发布资源使用显式白名单，构建不会把仓库 `.env`、证书、数据库或开发目录打入安装包。
