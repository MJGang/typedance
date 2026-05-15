# PDF 导出重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PDF 导出从 Tauri Rust WebView + `window.print()` 迁移到 Python sidecar，使用 Playwright 生成 PDF，Chromium 构建时下载并打包进 MSI。

**Architecture:** Sidecar 接管 PDF 生成职责。Python/Playwright 管理 Chromium 进程，`page.pdf()` 完成渲染输出。前端统一走 sidecar HTTP API 触发下载，不再区分 Tauri/Web 模式。Rust 端移除 WebView 导出代码和关联依赖。

**Tech Stack:** Python/Playwright, FastAPI, React/TypeScript, Tauri 2, pytest + pytest-mock

---

### Task 1: 添加 playwright 依赖到 sidecar

**Files:**
- Modify: `services/sidecar/pyproject.toml`
- Modify: `services/sidecar/src/typedance_sidecar/pdf.py`

- [ ] **Step 1: 更新 pyproject.toml**

在 `[project] dependencies` 中添加 playwright，在 `[project.optional-dependencies] dev` 中添加 pytest-mock：

```toml
[project]
dependencies = [
  "fastapi>=0.115.0",
  "pydantic>=2.7.0",
  "uvicorn>=0.30.0",
  "playwright>=1.40.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.2.0", "httpx>=0.27.0", "pytest-mock>=3.14.0"]
```

- [ ] **Step 2: 安装依赖并下载 Chromium（开发用）**

```bash
cd services/sidecar
pip install -e ".[dev]"
playwright install chromium
```

Expected: playwright 安装成功，Chromium 下载到 `%USERPROFILE%\AppData\Local\ms-playwright`

- [ ] **Step 3: 提交**

```bash
git add services/sidecar/pyproject.toml services/sidecar/src/typedance_sidecar/pdf.py
git commit -m "build(sidecar): 添加 playwright 依赖"
```

---

### Task 2: 重构 sidecar/pdf.py — 添加 Playwright PDF 导出

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/pdf.py`

- [ ] **Step 1: 在 pdf.py 顶部添加 Playwright 导入**

```python
from playwright.sync_api import sync_playwright
```

- [ ] **Step 2: 添加 `_resolve_browser_config()` 函数**

在 `escape_html()` 之前插入：

```python
import os


def _resolve_browser_config() -> dict:
    """返回传给 playwright.chromium.launch() 的参数

    优先级：
    1. TYPEDANCE_CHROMIUM_PATH 环境变量（打包模式，由 Tauri 设置）
    2. 回退到系统浏览器（开发模式，使用已安装的 Edge/Chrome）
    """
    env_path = os.environ.get("TYPEDANCE_CHROMIUM_PATH")
    if env_path:
        return {"executable_path": env_path}
    return {"channel": "msedge"}
```

- [ ] **Step 3: 添加全局单例和 `_get_browser()` + `render_and_export_pdf()`**

在文件末尾添加：

```python
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


def cleanup_browser():
    """应用关闭时清理 Chromium 进程"""
    global _browser, _pw
    if _browser:
        _browser.close()
        _browser = None
    if _pw:
        _pw.stop()
        _pw = None
```

- [ ] **Step 4: 删除旧的 `export_resume_pdf()` 函数**

删除该函数（原抛出 `RuntimeError` 的占位函数）：

```python
# 删除整个 export_resume_pdf 函数:
# def export_resume_pdf(...): ...
```

- [ ] **Step 5: 提交**

```bash
git add services/sidecar/src/typedance_sidecar/pdf.py
git commit -m "feat(sidecar): 添加 Playwright PDF 导出函数"
```

---

### Task 3: 更新 sidecar/main.py — 改写导出端点和生命周期管理

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/main.py`

- [ ] **Step 1: 更新导入**

将 `from .pdf import export_resume_pdf` 改为：

```python
from .pdf import render_and_export_pdf, cleanup_browser
```

- [ ] **Step 2: 添加 FastAPI shutdown 事件**

在 `app` 定义后面添加：

```python
app.add_event_handler("shutdown", cleanup_browser)
```

- [ ] **Step 3: 重写 `/exports/pdf/{resume_id}` 端点**

替换现有的 `export_pdf` 函数：

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
```

- [ ] **Step 4: 修改 `with_preview_pdf()` 函数**

将 `export_resume_pdf()` 调用改为 `render_and_export_pdf()`，移除 `try/except RuntimeError`：

```python
def with_preview_pdf(
    resume: ResumeVersion,
    request: Request,
    style_repo: TemplateStyleRepository,
) -> ResumeVersion:
    try:
        template_style = style_repo.get(resume.template_id)
        pdf_path = render_and_export_pdf(resume, template_style, preview_pdf_dir())
        preview_url = str(request.url_for("get_preview_pdf", resume_id=resume.id))
        return resume.model_copy(update={"preview_pdf_path": str(pdf_path), "preview_pdf_url": preview_url})
    except Exception:
        logger.warning("PDF preview generation failed")
        return resume
```

- [ ] **Step 5: 提交**

```bash
git add services/sidecar/src/typedance_sidecar/main.py
git commit -m "feat(sidecar): 重写 PDF 导出端点为 Playwright 驱动 + 附件下载"
```

---

### Task 4: 更新测试

**Files:**
- Modify: `services/sidecar/tests/test_pdf_export.py`

- [ ] **Step 1: 添加 mock_playwright fixture 到 conftest.py**

检查 `services/sidecar/tests/conftest.py` 是否存在。如果不存在则创建。如果已存在，添加 fixture。

```python
# services/sidecar/tests/conftest.py
"""Shared fixtures for sidecar tests."""

from collections.abc import Generator
from unittest.mock import MagicMock

import pytest
from pytest_mock import MockerFixture


@pytest.fixture
def mock_playwright(mocker: MockerFixture) -> MagicMock:
    """Mock Playwright sync API to avoid launching a real browser."""
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

- [ ] **Step 2: 添加 render_and_export_pdf 测试**

```python
def test_render_and_export_pdf_writes_pdf_file(tmp_path, mock_playwright):
    """render_and_export_pdf 生成 HTML → 调用 Playwright → 写入 PDF 文件"""
    from typedance_sidecar.pdf import render_and_export_pdf, _get_browser

    resume = ResumeVersion(
        id="test-pdf-write",
        title="Test",
        template_id="classic-a4",
        target_language="zh-CN",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="Hello World",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )
    pdf_path = tmp_path / "output.pdf"

    result = render_and_export_pdf(resume, None, pdf_path)

    assert result == pdf_path
    assert pdf_path.exists()

    # verify Playwright was called correctly
    mock_page = mock_playwright
    mock_page.set_content.assert_called_once()
    call_args, _ = mock_page.set_content.call_args
    assert "<html" in call_args[0].lower() or "Hello World" in call_args[0]
    mock_page.pdf.assert_called_once_with(path=str(pdf_path), format="A4", print_background=True)
    mock_page.close.assert_called_once()
```

- [ ] **Step 3: 更新 `test_save_generates_preview_pdf`**

将 monkeypatch 的目标从 `export_resume_pdf` 改为 `render_and_export_pdf`：

```python
def test_save_generates_preview_pdf(tmp_path, monkeypatch):
    from typedance_sidecar import main as sidecar_main

    def fake_render_and_export_pdf(resume, template_style, output_path):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    monkeypatch.setattr(sidecar_main, "render_and_export_pdf", fake_render_and_export_pdf)
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "plain_text_snapshot": "Built reliable PDF export."
        },
    )
    assert response.status_code == 201
    created = response.json()
    preview_path = Path(created["preview_pdf_path"])
    assert preview_path.exists()
    assert preview_path.suffix == ".pdf"
    assert preview_path.stat().st_size > 0
    assert created["preview_pdf_url"].endswith(f"/previews/{created['id']}.pdf")

    preview_response = client.get(created["preview_pdf_url"])
    assert preview_response.status_code == 200
    assert preview_response.headers["content-type"] == "application/pdf"
```

- [ ] **Step 4: 更新 `test_save_preview_uses_saved_template_block_style`**

同样将 `export_resume_pdf` 改为 `render_and_export_pdf`：

```python
def test_save_preview_uses_saved_template_block_style(tmp_path, monkeypatch):
    captured: dict[str, object] = {}
    from typedance_sidecar import main as sidecar_main

    def fake_render_and_export_pdf(resume, template_style, output_path):
        captured["template_id"] = template_style.template_id if template_style else None
        if template_style and template_style.blocks and "heading1" in template_style.blocks:
            captured["heading1_size"] = template_style.blocks["heading1"].font_size
        else:
            captured["heading1_size"] = None
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"%PDF-1.4\n")
        return output_path

    monkeypatch.setattr(sidecar_main, "render_and_export_pdf", fake_render_and_export_pdf)
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    style_response = client.put(
        "/template-styles/classic-a4",
        json={
            "template_id": "classic-a4",
            "preset": "classic",
            "blocks": {
                "heading1": {"fontSize": "28pt", "fontWeight": 700, "color": "#1a1a1a"},
                "paragraph": {"fontSize": "10pt", "lineHeight": 1.5, "color": "#334155"},
            },
        },
    )
    assert style_response.status_code == 200

    response = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "template_id": "classic-a4",
            "plain_text_snapshot": "Built reliable PDF export.",
        },
    )
    assert response.status_code == 201
    assert captured == {
        "template_id": "classic-a4",
        "heading1_size": "28pt",
    }
```

- [ ] **Step 5: 重写 `test_export_pdf_returns_501_outside_tauri` 为测试新端点**

原来测试的是 501，现在改为测试端点返回 PDF 文件：

```python
def test_export_pdf_returns_pdf_download(tmp_path, monkeypatch, mock_playwright):
    """POST /exports/pdf/{id} 返回 200 + PDF 附件下载"""
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    created = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "plain_text_snapshot": "Built reliable PDF export."
        },
    ).json()

    # mock 让 Playwright 写入一个伪 PDF 文件
    def fake_pdf_side_effect(**kwargs):
        path = kwargs.get("path")
        if path:
            Path(path).write_bytes(b"%PDF-1.4\n")

    mock_page = mock_playwright
    mock_page.pdf.side_effect = fake_pdf_side_effect

    response = client.post(f"/exports/pdf/{created['id']}")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "attachment" in response.headers["content-disposition"]
```

- [ ] **Step 6: 验证 `test_render_and_export_pdf` 测试中的 `_get_browser()` 能工作**

在 mock 下 `_get_browser()` 应返回 mock 对象，不需要真实 Chromium。

```python
def test_get_browser_with_mock(mock_playwright):
    """_get_browser 在 mock 下返回 mock browser 对象"""
    from typedance_sidecar.pdf import _get_browser
    browser = _get_browser()
    assert browser is not None
```

- [ ] **Step 7: 运行全部侧试确认通过**

```bash
cd services/sidecar
pytest -v
```

Expected: 所有测试通过（mock 版 Playwright 不需要真实浏览器）

- [ ] **Step 8: 提交**

```bash
git add services/sidecar/tests/
git commit -m "test(sidecar): 更新 PDF 导出测试为 Playwright mock 接口"
```

---

### Task 5: 更新前端 — api.ts 和 WorkspacePage.tsx

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/features/workspace/WorkspacePage.tsx`
- Modify: `apps/web/src/tauri.ts`

- [ ] **Step 1: 重写 api.ts 的 `exportResumePdf`**

```typescript
export async function exportResumePdf(
  resumeId: string,
  title: string,
): Promise<void> {
  const response = await fetch(`${baseUrl}/exports/pdf/${resumeId}`, {
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Failed to export PDF: ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `resume-${title}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: 更新 WorkspacePage.tsx 的 `handleExportPdf`**

将原来：

```typescript
const handleExportPdf = useCallback(async () => {
  if (!id) return
  try {
    const htmlContent = renderStyledHtml(docJson, styleConfig.blocks ?? {}, resume?.target_language ?? "zh-CN")
    const result = await exportResumePdf(id, htmlContent)
    if (result.preview_pdf_url) {
      window.open(result.preview_pdf_url, "_blank")
    }
  } catch {
    // PDF export failed silently
  }
}, [id, docJson, styleConfig, resume])
```

改为：

```typescript
const handleExportPdf = useCallback(async () => {
  if (!id || !resume) return
  try {
    await exportResumePdf(id, resume.title)
  } catch {
    // PDF export failed silently
  }
}, [id, resume])
```

同时可以移除未使用的导入：

```typescript
// 删除这一行（如果其他地方也未使用）
// import { renderStyledHtml } from "@typedance/resume-renderer"
```

- [ ] **Step 3: 清理 `tauri.ts`**

移除 `exportPdfViaTauri()` 函数，保留 `isTauri()`：

```typescript
export function isTauri(): boolean {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ !== undefined;
}

// 删除 exportPdfViaTauri 函数
```

- [ ] **Step 4: 删除 `tauri.test.ts`**

```bash
git rm apps/web/src/tauri.test.ts
```

- [ ] **Step 5: 提交**

```bash
git add apps/web/src/api.ts apps/web/src/features/workspace/WorkspacePage.tsx apps/web/src/tauri.ts
git commit -m "refactor(web): 统一 PDF 导出走 Sidecar HTTP，移除 Tauri IPC 路径"
```

---

### Task 6: 清理 Rust 端

**Files:**
- Delete: `apps/desktop/src-tauri/src/pdf.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/capabilities/default.json`

- [ ] **Step 1: 删除 `pdf.rs` 文件**

```bash
git rm apps/desktop/src-tauri/src/pdf.rs
```

- [ ] **Step 2: 简化 `lib.rs`**

移除 `mod pdf;`、`PrintCache` 管理、`register_uri_scheme_protocol`、以及 `export_pdf` 命令注册：

```rust
use tauri_plugin_shell::ShellExt;

mod pdf;  // ← 删除这一行

#[tauri::command]
async fn check_sidecar_health(app: tauri::AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar("typedance-sidecar")
        .map_err(|error| error.to_string())?
        .arg("--health")
        .output()
        .await
        .map_err(|error| error.to_string())?;

    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(pdf::PrintCache(std::sync::Mutex::new(            // ← 删除
            std::collections::HashMap::new(),                      // ← 删除
        )))                                                        // ← 删除
        .register_uri_scheme_protocol("typedance", |ctx, request| { // ← 删除
            let path = request.uri().path().trim_start_matches('/').to_string();  // ← 删除
            let handle = ctx.app_handle();                          // ← 删除
            let cache = handle.state::<pdf::PrintCache>();          // ← 删除
            let body = cache                                        // ← 删除
                .0                                                  // ← 删除
                .lock()                                             // ← 删除
                .ok()                                               // ← 删除
                .and_then(|map| map.get(&path).cloned())            // ← 删除
                .unwrap_or_else(|| format!("<h1>404: {} not found</h1>", path));  // ← 删除
                                                                    // ← 删除
            tauri::http::Response::builder()                        // ← 删除
                .header("Content-Type", "text/html; charset=utf-8") // ← 删除
                .body(body.into_bytes())                            // ← 删除
                .unwrap()                                           // ← 删除
        })                                                          // ← 删除
        .invoke_handler(tauri::generate_handler![check_sidecar_health, pdf::export_pdf])  // ← 删除 , pdf::export_pdf
        .run(tauri::generate_context!())
        .expect("error while running TypeDance");
}
```

简化后：

```rust
use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn check_sidecar_health(app: tauri::AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar("typedance-sidecar")
        .map_err(|error| error.to_string())?
        .arg("--health")
        .output()
        .await
        .map_err(|error| error.to_string())?;

    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![check_sidecar_health])
        .run(tauri::generate_context!())
        .expect("error while running TypeDance");
}
```

- [ ] **Step 3: 从 Cargo.toml 移除 `url` 依赖**

```toml
[dependencies]
tauri = { version = "2", features = ["devtools"] }
url = "2"           # ← 删除
tauri-plugin-shell = "2"
```

- [ ] **Step 4: 从 capabilities/default.json 移除 `print-pdf-*`**

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main TypeDance desktop window permissions",
  "windows": ["main", "print-pdf-*"],     // ← 改为 ["main"]
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "binaries/typedance-sidecar",
          "sidecar": true,
          "args": true
        }
      ]
    }
  ]
}
```

- [ ] **Step 5: 验证 Rust 代码编译**

```bash
cd apps/desktop/src-tauri
cargo check
```

Expected: 编译成功，无 pdf.rs 相关错误

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src-tauri/src/lib.rs apps/desktop/src-tauri/Cargo.toml apps/desktop/src-tauri/capabilities/default.json
git commit -m "refactor(desktop): 移除 Rust WebView PDF 导出代码，PDF 导出已移至 Sidecar"
```

---

### Task 7: 创建 Chromium 构建下载脚本

**Files:**
- Create: `apps/desktop/scripts/download-chromium.py`
- Modify: `apps/desktop/src-tauri/tauri.conf.json`

- [ ] **Step 1: 创建下载脚本**

```python
"""在 Tauri 构建前运行，下载 Chromium 到 resources 目录。

用法: python scripts/download-chromium.py
由 pnpm build 或 CI 管道调用。

注意：需要先 pip install playwright 并确保 Python 环境可用。
"""
import os
import subprocess
import sys
from pathlib import Path

RESOURCES_DIR = (
    Path(__file__).resolve().parents[1] / "src-tauri" / "resources"
)


def main() -> None:
    RESOURCES_DIR.mkdir(parents=True, exist_ok=True)
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(RESOURCES_DIR)

    print(f"[download-chromium] PLAYWRIGHT_BROWSERS_PATH={RESOURCES_DIR}")
    print("[download-chromium] Running playwright install chromium...")

    result = subprocess.run(
        [sys.executable, "-m", "playwright", "install", "chromium"],
        capture_output=False,
    )

    if result.returncode != 0:
        print(f"[download-chromium] FAILED (exit code {result.returncode})", file=sys.stderr)
        sys.exit(result.returncode)

    # 列出下载结果
    chromium_dirs = list(RESOURCES_DIR.glob("chromium-*/chrome-win/chrome.exe"))
    if chromium_dirs:
        print(f"[download-chromium] Chromium installed at: {chromium_dirs[0]}")
    else:
        print("[download-chromium] WARNING: Chromium executable not found in expected path", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 更新 tauri.conf.json**

添加 `bundle.resources` 配置：

```json
{
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": [],
    "icon": [],
    "resources": {
      "resources/ms-playwright/**": "ms-playwright/"
    }
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/scripts/download-chromium.py apps/desktop/src-tauri/tauri.conf.json
git commit -m "build(desktop): 添加 Chromium 下载脚本和 Tauri resource 配置"
```

---

### Task 8: 最终验证

- [ ] **Step 1: 运行所有 Python 测试**

```bash
cd services/sidecar
pytest -v
```

Expected: 全部通过

- [ ] **Step 2: 运行前端测试**

```bash
pnpm --filter @typedance/web test
```

Expected: 全部通过

- [ ] **Step 3: 运行最终 lint**

```bash
pnpm lint
```

Expected: 无错误

---

### Task 迁移后仍需保留的代码

| 文件 | 状态 | 说明 |
|------|------|------|
| `apps/web/src/tauri.ts` | 保留 `isTauri()` | 未来可能用于 Tauri 特定功能（文件选择、系统通知等） |
| `services/sidecar/src/typedance_sidecar/pdf.py` | 保留 `render_resume_html()` | HTML 生成逻辑不变，被 `render_and_export_pdf()` 调用 |
| `services/sidecar/src/typedance_sidecar/style_renderer.py` | 不变 | CSS 生成逻辑 |
| `apps/desktop/src-tauri/src/lib.rs` | 保留 `check_sidecar_health` | Sidecar 健康检查仍然需要 |
