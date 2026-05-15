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
    Path(__file__).resolve().parents[1] / "src-tauri" / "resources" / "ms-playwright"
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
