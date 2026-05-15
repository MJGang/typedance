# PDF 导出重构：Rust WebView → Python/Playwright

## 概述

将 PDF 导出从 Tauri Rust 端（隐藏 WebView + `window.print()`）迁移到 Python sidecar，使用 Playwright 生成 PDF。Chromium 在构建时下载，打包进 Tauri MSI 安装包，用户安装即用，无需额外下载。

## 动机

- 当前 Rust WebView 方案依赖 `window.print()` 系统对话框，无法自动化
- 导出 PDF 是业务逻辑，应属于 sidecar 职责范畴
- Playwright 提供 `page.pdf()` 无头 PDF 生成，输出质量高且可编程

## 架构变化

```
Before:
  Web Frontend → Tauri IPC → Rust (隐藏 WebView + window.print())

After:
  Web Frontend → Sidecar HTTP POST → Python/Playwright Chromium → PDF
```

## Chromium 打包策略

### 构建管道

```
pnpm build
  ├── contracts / resume-renderer / web (不变)
  ├── scripts/download-chromium.py (新增)
  │     └── playwright install chromium → apps/desktop/src-tauri/resources/ms-playwright/
  ├── PyInstaller 打包 sidecar → binaries/
  └── cargo tauri build (resources/ 自动打包进 MSI)
```

### 下载脚本

新增 `apps/desktop/scripts/download-chromium.py`：

```python
"""在 Tauri 构建前运行，下载 Chromium 到 resources 目录"""
import os, subprocess
from pathlib import Path

RESOURCES_DIR = Path(__file__).resolve().parents[2] / "src-tauri" / "resources"
RESOURCES_DIR.mkdir(parents=True, exist_ok=True)
os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(RESOURCES_DIR)
subprocess.run(["playwright", "install", "chromium"], check=True)
```

### Tauri 配置

`tauri.conf.json` 中新增：

```json
{
  "bundle": {
    "resources": {
      "resources/ms-playwright/**": "ms-playwright/"
    }
  }
}
```

### 运行时 Chromium 发现策略

```python
import os, sys
from pathlib import Path

def _resolve_browser_config() -> dict:
    """返回传给 playwright.chromium.launch() 的参数

    优先级：
    1. TYPEDANCE_CHROMIUM_PATH 环境变量（打包模式，由 Tauri 设置）
    2. 回退到系统浏览器（开发模式，使用已安装的 Edge/Chrome）
    """
    env_path = os.environ.get("TYPEDANCE_CHROMIUM_PATH")
    if env_path:
        return {"executable_path": env_path}

    # Dev mode: use system-installed browser
    return {"channel": "msedge"}
```

Tauri Rust 端在启动 sidecar 时，通过环境变量传入资源路径：

```rust
// lib.rs —— 启动 sidecar 前设置 Chromium 路径
let resource_dir = app.path().resource_dir().map_err(|e| e.to_string())?;
let chromium_dir = resource_dir.join("ms-playwright");
// 找到实际的 chromium-XXXX 目录
let chromium_exe = find_chromium_exe(&chromium_dir)?;
```

### 开发模式

开发者只需执行 `playwright install chromium` 一次（或直接使用系统 Edge 无需额外安装），Sidecar 自动在 `%USERPROFILE%\AppData\Local\ms-playwright` 发现浏览器。

## Sidecar PDF API 设计

### 端点和响应

```
POST /exports/pdf/{resume_id}
Content-Type: application/json
Response: application/pdf (stream)
Content-Disposition: attachment; filename="resume-{title}.pdf"
```

### 实现

`services/sidecar/src/typedance_sidecar/pdf.py` — 改造现有模块：

```python
from playwright.sync_api import sync_playwright

_pw = None
_browser = None

def _get_browser():
    """全局单例，复用 Chromium 进程"""
    global _pw, _browser
    if _browser is None:
        _pw = sync_playwright().start()
        config = _resolve_browser_config()
        _browser = _pw.chromium.launch(**config)
    return _browser

def render_and_export_pdf(
    resume: ResumeVersion,
    template_style: TemplateStyleConfig | None,
    output_path: Path,
) -> Path:
    """生成 styled HTML → Playwright 渲染 → PDF 文件"""
    html = render_resume_html(resume, template_style)
    browser = _get_browser()
    page = browser.new_page()
    page.set_content(html, wait_until="networkidle")
    page.pdf(path=str(output_path), format="A4", print_background=True)
    page.close()
    return output_path
```

`services/sidecar/src/typedance_sidecar/main.py` — 替换现有 501 端点：

```python
@app.post("/exports/pdf/{resume_id}")
def export_pdf(
    resume_id: str,
    repo: ResumeRepository = Depends(resume_repository),
    style_repo: TemplateStyleRepository = Depends(template_style_repository),
):
    resume = repo.get(resume_id)
    if resume is None:
        raise HTTPException(status_code=404)

    style = style_repo.get(resume.template_id) if resume.template_id else None
    exports_dir = app_data_dir() / "files" / "exports"
    exports_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = exports_dir / f"{resume_id}.pdf"

    render_and_export_pdf(resume, style, pdf_path)

    filename = f"resume-{resume.title or resume_id}.pdf"
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=filename,
        content_disposition_type="attachment",
    )

@app.on_event("shutdown")
def _cleanup_browser():
    global _browser, _pw
    if _browser:
        _browser.close()
    if _pw:
        _pw.stop()
```

### 现有函数保留不变

- `render_resume_html()` — HTML 生成逻辑
- `resume_lines_for_pdf()` — 文本提取
- `escape_html()`, `_render_doc_body()` 等内部函数

仅删除已弃用的 `export_resume_pdf()`（原抛出 `RuntimeError` 的占位函数）。

## 前端调用链路调整

### API 层 (`apps/web/src/api.ts`)

```typescript
// 之前：区分 Tauri/Web 两条路径
export async function exportResumePdf(
  resumeId: string,
  htmlContent?: string,
): Promise<{ file_path: string; preview_pdf_url: string }>

// 之后：统一走 Sidecar HTTP，触发下载
export async function exportResumePdf(
  resumeId: string,
  title: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}/exports/pdf/${resumeId}`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(`Export failed: ${response.status}`);

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `resume-${title}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
```

### 组件层 (`WorkspacePage.tsx`)

```typescript
const handleExportPdf = useCallback(async () => {
  if (!id || !resume) return;
  try {
    await exportResumePdf(id, resume.title);
  } catch {
    // 错误提示
  }
}, [id, resume]);
```

### 移除的文件和代码

| 文件 | 变更 |
|------|------|
| `apps/web/src/tauri.ts` | 移除 `exportPdfViaTauri()`（保留 `isTauri()`） |
| `apps/web/src/tauri.test.ts` | 删除 |
| `apps/desktop/src-tauri/src/pdf.rs` | 整个文件删除 |
| `apps/desktop/src-tauri/src/lib.rs` | 移除 `mod pdf`、`PrintCache`、`register_uri_scheme_protocol`、`export_pdf` 命令 |
| `apps/desktop/src-tauri/Cargo.toml` | 移除 `url` crate 依赖 |
| `apps/desktop/src-tauri/capabilities/default.json` | 移除 `"print-pdf-*"` window 引用 |

## 依赖变更

### `services/sidecar/pyproject.toml`

```toml
[project]
dependencies = [
  "fastapi>=0.115.0",
  "pydantic>=2.7.0",
  "uvicorn>=0.30.0",
  "playwright>=1.40.0",   # 新增
]
```

## 测试策略

### 单元测试 (pytest)

Playwright 调用通过 `pytest-mock` 隔离，不启动真实浏览器：

```python
# conftest.py
@pytest.fixture
def mock_playwright(mocker):
    mock_page = mocker.MagicMock()
    mock_browser = mocker.MagicMock()
    mock_browser.new_page.return_value = mock_page
    mock_chromium = mocker.MagicMock()
    mock_chromium.launch.return_value = mock_browser
    mock_pw = mocker.MagicMock()
    mock_pw.chromium = mock_chromium
    mocker.patch("typedance_sidecar.pdf.sync_playwright", return_value=mock_pw)
    return mock_page
```

| 测试 | 覆盖范围 |
|------|---------|
| `test_render_and_export_pdf` | HTML 生成 → Playwright page.set_content 调用 → page.pdf 调用 → PDF 文件写入 |
| `test_render_resume_html` | 已有，验证 TipTap JSON → HTML + BlockStyle CSS 正确性 |
| `test_export_endpoint_returns_pdf` | HTTP 端点返回 200 + application/pdf + attachment header |
| `test_browser_reuse` | 多次导出复用同一 Chromium 实例 |

## PDF 预览兼容

现有 `/previews/{resume_id}.pdf` 端点保留不变，仍然在保存简历时生成预览。但预览的生成方式从 `export_resume_pdf()`（现抛出 `RuntimeError`）改为新 Playwright 路径。`with_preview_pdf()` 将适配调用 `render_and_export_pdf()`。
