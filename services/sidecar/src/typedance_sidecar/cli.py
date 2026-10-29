import argparse
import logging
import json
import os
from collections.abc import Sequence
from pathlib import Path

import uvicorn
from .local_access import require_local_token


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
    parser.add_argument("--browser-path")
    parser.add_argument("--markdown-converter-path")
    parser.add_argument("--migrate-local-data", action="store_true")
    parser.add_argument("--source-data-dir")
    parser.add_argument("--entries-json")
    parser.add_argument("--exclude-json", default="[]")
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.migrate_local_data:
        if not args.source_data_dir or args.entries_json is None:
            parser.error("Migration requires --source-data-dir and --entries-json")
        entries = json.loads(args.entries_json)
        excluded = json.loads(args.exclude_json)
        if not isinstance(entries, list) or not isinstance(excluded, list) or not all(isinstance(value, str) for value in [*entries, *excluded]):
            parser.error("Migration entries and exclusions must be JSON string arrays")
        from .account_migration import migrate_local_data
        from .account_migration_paths import rebase_sidecar_file_references

        source = Path(args.source_data_dir)
        target = Path(args.data_dir)
        result = migrate_local_data(
            source, target, entries, excluded,
            prepare_target=lambda staging: rebase_sidecar_file_references(staging / "typedance.sqlite", source, target),
        )
        print(json.dumps(result, ensure_ascii=False))
        return
    require_local_token(os.environ.get("TYPEDANCE_LOCAL_TOKEN"))
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        parser.error("The local service must bind to a loopback address")
    if not args.browser_path:
        parser.error("Service mode requires --browser-path")
    os.environ["TYPEDANCE_DATA_DIR"] = args.data_dir
    os.environ["TYPEDANCE_CHROMIUM_PATH"] = args.browser_path
    if args.markdown_converter_path:
        os.environ["TYPEDANCE_MARKDOWN_CONVERTER_PATH"] = args.markdown_converter_path
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
