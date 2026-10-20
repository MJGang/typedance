# TypeDance 应用图标

图标采用纸张折成的白色 T 字形，保留原有蓝色，结合轻微流动的笔画，表达排版与文档创作。外侧圆角为透明背景，兼顾桌面与托盘的小尺寸显示。

设计源图为 `typedance-source.png`，由内置 imagegen 生成，保留原始 RGBA 与透明通道。下方提示词是本次生成的完整输入。

`icon.ico` 用于 Windows 程序、系统托盘和 NSIS 安装包；PNG 与 ICNS 同源生成，默认桌面配置也引用这套图标。

更新源图后，在仓库根目录执行：

```powershell
python apps/desktop/src-tauri/make_ico.py
```

脚本调用项目当前版本的 Tauri 官方 CLI，将中间产物保存到 `node_modules/.cache/typedance-icons`，只复制桌面端需要的图标文件。

## 生成提示词

```text
Use case: logo-brand.
Asset type: production Windows desktop application icon and system tray icon for TypeDance, a typography and resume document editor.
Primary request: replace a featureless solid blue placeholder with one original, refined, memorable app icon.
Subject: a single bold white T-shaped letterform constructed from a lightly folded paper ribbon. The broad top bar and substantial descending stem make the T instantly recognizable; the lower end has a gentle flowing bend that suggests dancing typography. Keep this as one cohesive simple silhouette.
Scene/backdrop: a rich blue rounded-square app tile, using the existing #3b82f6 blue as the base with a restrained blue tonal transition. Genuinely transparent outside the tile, including its rounded corners.
Style/medium: precise, minimal, vector-like raster design. Smooth confident curves, optical balance, mostly flat white surfaces, just one subtle pale-blue folded overlap if helpful. Professional creative-tool identity.
Composition/framing: square 1024 x 1024 canvas, straight-on single centered icon. Tile fills about 90 percent of the canvas width and height; white T fills about 60 percent. The icon must remain legible at 16, 24, and 32 pixels. Strong white-on-blue contrast and sufficiently thick strokes, no delicate details.
Constraints: exactly one finished icon. No wordmark, no product name text, no slogan, no sparkle or star badge, no document microtext, no extra symbols, no detached decorative marks, no surrounding mockup or presentation board, no perspective, no watermark. No exterior drop shadow or fake transparency checkerboard. Preserve real alpha outside the rounded-square silhouette.
```
