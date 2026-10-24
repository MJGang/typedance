from io import BytesIO

import pytest
from fastapi.testclient import TestClient

from typedance_sidecar.attachment_text import extract_attachment_text
from typedance_sidecar.import_resume_file_text import ImportResumeFileError
from typedance_sidecar.main import app


def test_reads_text_and_code_without_executing_it():
    assert extract_attachment_text(b"print('hello')", "example.py") == "print('hello')"
    assert extract_attachment_text("中文附件".encode(), "notes.md") == "中文附件"


@pytest.mark.parametrize("data,name", [(b"binary", "archive.zip"), (b"\xff", "code.py"), (b"", "empty.md"), (b"a\x00b", "nul.txt"), (b"a" * 120001, "large.txt")], ids=["unsupported", "encoding", "empty", "nul", "length"])
def test_rejects_unsupported_binary_empty_and_oversized_text(data, name):
    with pytest.raises(ImportResumeFileError):
        extract_attachment_text(data, name)


def test_upload_returns_extracted_text_and_rejects_size_and_unknown_types():
    client = TestClient(app)
    response = client.post("/files/extract-text", files={"file": ("notes.txt", BytesIO("只读取文本".encode()), "text/plain")})
    assert response.status_code == 200
    assert response.json() == {"text": "只读取文本"}
    assert client.post("/files/extract-text", files={"file": ("unknown.zip", b"x")}).status_code == 422
    assert client.post("/files/extract-text", files={"file": ("huge.txt", b"x" * (10 * 1024 * 1024 + 1))}).status_code == 413
