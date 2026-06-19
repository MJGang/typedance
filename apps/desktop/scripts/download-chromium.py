"""下载发布版 Chromium，并生成 Tauri 运行时可读取的资源清单。"""

from __future__ import annotations

import argparse
import importlib.util
import json
import shutil
import tempfile
import urllib.request
import zipfile
from importlib.metadata import version
from pathlib import Path


DEFAULT_RESOURCES_DIR = (
    Path(__file__).resolve().parents[1] / "src-tauri" / "resources" / "ms-playwright"
)
MANIFEST_NAME = "chromium-manifest.json"
CHROME_FOR_TESTING_BASE_URL = (
    "https://storage.googleapis.com/chrome-for-testing-public"
)


def resolve_chromium_executable(resources_dir: Path) -> Path:
    candidates = sorted(resources_dir.glob("chromium-*/chrome-win*/chrome.exe"))
    if len(candidates) != 1:
        rendered_candidates = ", ".join(str(path) for path in candidates) or "none"
        raise RuntimeError(
            "Expected exactly one Chromium executable under "
            f"{resources_dir}, found: {rendered_candidates}"
        )
    return candidates[0]


def write_manifest(
    resources_dir: Path,
    executable: Path,
    playwright_version: str,
    browser_version: str,
    revision: str,
) -> Path:
    manifest_path = resources_dir / MANIFEST_NAME
    manifest = {
        "playwrightVersion": playwright_version,
        "browserVersion": browser_version,
        "revision": revision,
        "chromiumExecutable": executable.relative_to(resources_dir).as_posix(),
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest_path


def playwright_browsers_json() -> Path:
    package_spec = importlib.util.find_spec("playwright")
    if not package_spec or not package_spec.submodule_search_locations:
        raise RuntimeError("Playwright is not installed in the active Python environment")
    package_dir = Path(next(iter(package_spec.submodule_search_locations)))
    return package_dir / "driver" / "package" / "browsers.json"


def read_chromium_descriptor(browsers_json: Path) -> dict[str, str]:
    metadata = json.loads(browsers_json.read_text(encoding="utf-8"))
    chromium = next(
        (browser for browser in metadata.get("browsers", []) if browser.get("name") == "chromium"),
        None,
    )
    if not chromium or not chromium.get("revision") or not chromium.get("browserVersion"):
        raise RuntimeError(f"Chromium metadata is missing from {browsers_json}")
    return {
        "revision": str(chromium["revision"]),
        "browserVersion": str(chromium["browserVersion"]),
    }


def chromium_download_url(browser_version: str) -> str:
    return f"{CHROME_FOR_TESTING_BASE_URL}/{browser_version}/win64/chrome-win64.zip"


def download_archive(url: str, archive_path: Path) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "TypeDance release builder"})
    with urllib.request.urlopen(request, timeout=60) as response, archive_path.open("wb") as output:
        total = int(response.headers.get("Content-Length", "0"))
        downloaded = 0
        next_report = 10
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
            downloaded += len(chunk)
            if total:
                percentage = downloaded * 100 // total
                if percentage >= next_report:
                    print(f"[download-chromium] {min(percentage, 100)}%")
                    next_report += 10


def extract_archive(archive_path: Path, destination: Path) -> None:
    destination_root = destination.resolve()
    with zipfile.ZipFile(archive_path) as archive:
        for member in archive.infolist():
            member_path = (destination / member.filename).resolve()
            if member_path != destination_root and destination_root not in member_path.parents:
                raise RuntimeError(f"Unsafe Chromium archive entry: {member.filename}")
        archive.extractall(destination)


def install_chromium(resources_dir: Path) -> Path:
    descriptor = read_chromium_descriptor(playwright_browsers_json())
    if resources_dir.exists():
        shutil.rmtree(resources_dir)
    resources_dir.mkdir(parents=True)

    print(f"[download-chromium] output={resources_dir}")
    download_url = chromium_download_url(descriptor["browserVersion"])
    print(f"[download-chromium] source={download_url}")

    temporary_archive = tempfile.NamedTemporaryFile(
        dir=resources_dir.parent,
        prefix="typedance-chromium-",
        suffix=".zip",
        delete=False,
    )
    archive_path = Path(temporary_archive.name)
    temporary_archive.close()
    try:
        download_archive(download_url, archive_path)
        extract_archive(
            archive_path,
            resources_dir / f"chromium-{descriptor['revision']}",
        )
    finally:
        archive_path.unlink(missing_ok=True)

    executable = resolve_chromium_executable(resources_dir)
    manifest_path = write_manifest(
        resources_dir,
        executable,
        version("playwright"),
        descriptor["browserVersion"],
        descriptor["revision"],
    )
    print(f"[download-chromium] executable={executable}")
    print(f"[download-chromium] manifest={manifest_path}")
    return executable


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_RESOURCES_DIR,
        help="Chromium 资源输出目录",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    install_chromium(args.output.resolve())


if __name__ == "__main__":
    main()
