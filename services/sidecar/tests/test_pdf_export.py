from pathlib import Path

from fastapi.testclient import TestClient

from typedance_sidecar.main import app


def test_export_pdf_creates_file(tmp_path, monkeypatch):
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

    response = client.post(f"/exports/pdf/{created['id']}")

    assert response.status_code == 201
    pdf_path = Path(response.json()["file_path"])
    assert pdf_path.exists()
    assert pdf_path.suffix == ".pdf"
    assert pdf_path.stat().st_size > 0


def test_export_pdf_with_chinese_content(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)
    created = client.post(
        "/resume-versions",
        json={
            "title": "张三 - 全栈开发工程师简历",
            "target_language": "zh-CN",
            "plain_text_snapshot": "负责 TypeDance 首版简历工作台的产品与工程落地。"
        },
    ).json()

    response = client.post(f"/exports/pdf/{created['id']}")

    assert response.status_code == 201
    pdf_path = Path(response.json()["file_path"])
    assert pdf_path.exists()
    assert pdf_path.suffix == ".pdf"
    assert pdf_path.stat().st_size > 0

    # Verify PDF embeds a CJK font (Microsoft YaHei) confirming Chinese characters render correctly
    raw = pdf_path.read_bytes()
    assert b"MicrosoftYaHei" in raw, "PDF should embed Microsoft YaHei font for Chinese characters"
    assert b"Identity-H" in raw, "PDF should use CID font encoding for CJK"
