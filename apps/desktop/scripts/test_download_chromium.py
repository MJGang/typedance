from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).with_name("download-chromium.py")
SPEC = importlib.util.spec_from_file_location("download_chromium", SCRIPT_PATH)
assert SPEC and SPEC.loader
download_chromium = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(download_chromium)


class DownloadChromiumTests(unittest.TestCase):
    def test_resolve_chromium_executable_requires_exactly_one_browser(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            resources_dir = Path(temporary_directory)
            executable = resources_dir / "chromium-1234" / "chrome-win" / "chrome.exe"
            executable.parent.mkdir(parents=True)
            executable.touch()

            self.assertEqual(
                executable,
                download_chromium.resolve_chromium_executable(resources_dir),
            )

            duplicate = resources_dir / "chromium-5678" / "chrome-win64" / "chrome.exe"
            duplicate.parent.mkdir(parents=True)
            duplicate.touch()

            with self.assertRaisesRegex(RuntimeError, "exactly one Chromium executable"):
                download_chromium.resolve_chromium_executable(resources_dir)

    def test_write_manifest_records_relative_executable_and_version(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            resources_dir = Path(temporary_directory)
            executable = resources_dir / "chromium-1234" / "chrome-win" / "chrome.exe"
            executable.parent.mkdir(parents=True)
            executable.touch()

            manifest_path = download_chromium.write_manifest(
                resources_dir,
                executable,
                "1.60.0",
                "148.0.7778.96",
                "1223",
            )

            self.assertEqual(
                {
                    "playwrightVersion": "1.60.0",
                    "browserVersion": "148.0.7778.96",
                    "revision": "1223",
                    "chromiumExecutable": "chromium-1234/chrome-win/chrome.exe",
                },
                json.loads(manifest_path.read_text(encoding="utf-8")),
            )

    def test_reads_chromium_descriptor_from_playwright_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            browsers_json = Path(temporary_directory) / "browsers.json"
            browsers_json.write_text(
                json.dumps(
                    {
                        "browsers": [
                            {"name": "firefox", "revision": "1", "browserVersion": "2"},
                            {
                                "name": "chromium",
                                "revision": "1223",
                                "browserVersion": "148.0.7778.96",
                            },
                        ]
                    }
                ),
                encoding="utf-8",
            )

            self.assertEqual(
                {"revision": "1223", "browserVersion": "148.0.7778.96"},
                download_chromium.read_chromium_descriptor(browsers_json),
            )
            self.assertEqual(
                "https://storage.googleapis.com/chrome-for-testing-public/"
                "148.0.7778.96/win64/chrome-win64.zip",
                download_chromium.chromium_download_url("148.0.7778.96"),
            )


if __name__ == "__main__":
    unittest.main()
