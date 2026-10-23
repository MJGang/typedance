from pathlib import Path

from .import_resume_file_text import SUPPORTED_IMPORT_EXTENSIONS, ImportResumeFileError, extract_import_resume_file_text

TEXT_EXTENSIONS = {"json", "jsonl", "csv", "tsv", "yaml", "yml", "xml", "html", "css", "js", "jsx", "ts", "tsx", "py", "java", "rs", "go", "sql", "log", "toml", "ini", "sh", "ps1", "c", "cpp", "h"}


def extract_attachment_text(data: bytes, filename: str) -> str:
    extension = Path(filename).suffix.lower().lstrip(".")
    if extension in SUPPORTED_IMPORT_EXTENSIONS:
        text = extract_import_resume_file_text(data, filename=filename)
    elif extension in TEXT_EXTENSIONS:
        try:
            text = data.decode("utf-8-sig").strip()
        except UnicodeDecodeError as exc:
            raise ImportResumeFileError("文本附件需要使用 UTF-8 编码") from exc
    else:
        raise ImportResumeFileError("支持 PDF、Word、Markdown、文本、代码及常见文本数据文件")
    if not text or "\x00" in text:
        raise ImportResumeFileError("文件没有可读取的文本；扫描件请改用图片")
    if len(text) > 120_000:
        raise ImportResumeFileError("附件文本超过 12 万字符，请拆分后发送")
    return text
