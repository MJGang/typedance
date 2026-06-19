import argparse
import logging
import os
from collections.abc import Sequence
from pathlib import Path

import uvicorn


def configure_logging(data_dir: Path) -> None:
    log_directory = data_dir / "logs"
    log_directory.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=log_directory / "sidecar.log",
        encoding="utf-8",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        force=True,
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="typedance-sidecar")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4317)
    parser.add_argument("--data-dir", required=True)
    parser.add_argument("--browser-path", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    os.environ["TYPEDANCE_DATA_DIR"] = args.data_dir
    os.environ["TYPEDANCE_CHROMIUM_PATH"] = args.browser_path
    configure_logging(Path(args.data_dir))
    uvicorn.run(
        "typedance_sidecar.main:app",
        host=args.host,
        port=args.port,
        log_config=None,
        access_log=False,
    )


if __name__ == "__main__":
    main()
