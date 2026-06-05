import hashlib
import json
from typing import Any


def source_canvas_hash(doc_json: dict[str, Any]) -> str:
    payload = json.dumps(doc_json, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()
