"""使用 Tauri 官方 CLI 从设计源图生成桌面图标。"""

from pathlib import Path
import shutil
import subprocess


def main():
    tauri_dir = Path(__file__).resolve().parent
    repo_root = tauri_dir.parents[2]
    icons_dir = tauri_dir / "icons"
    source = icons_dir / "typedance-source.png"
    output_dir = repo_root / "node_modules" / ".cache" / "typedance-icons"
    corepack = shutil.which("corepack")

    if corepack is None:
        raise SystemExit("未找到 corepack，请先安装项目要求的 Node.js 与 pnpm。")
    if not source.is_file():
        raise SystemExit(f"图标设计源图不存在：{source}")

    subprocess.run(
        [
            corepack,
            "pnpm",
            "--filter",
            "@typedance/desktop",
            "exec",
            "tauri",
            "icon",
            str(source),
            "--output",
            str(output_dir),
        ],
        cwd=repo_root,
        check=True,
    )

    for name in (
        "32x32.png",
        "128x128.png",
        "128x128@2x.png",
        "icon.png",
        "icon.ico",
        "icon.icns",
    ):
        shutil.copyfile(output_dir / name, icons_dir / name)
        print(f"Updated {icons_dir / name}")


if __name__ == "__main__":
    main()
