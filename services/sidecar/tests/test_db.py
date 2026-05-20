from concurrent.futures import ThreadPoolExecutor

from typedance_sidecar.db import TemplateSampleRepository, connect
from typedance_sidecar.models import TemplateSampleContent


def test_repository_connection_can_be_used_across_worker_threads(tmp_path):
    repo = TemplateSampleRepository(connect(tmp_path / "typedance.sqlite"))
    sample = TemplateSampleContent(
        id="threaded-sample",
        name={"zh-CN": "线程测试", "en-US": "Thread test"},
        target_language="zh-CN",
        doc_json={"type": "doc", "content": []},
        plain_text_snapshot="",
    )
    repo.save(sample)

    with ThreadPoolExecutor(max_workers=1) as executor:
        result = executor.submit(repo.get, "threaded-sample").result()

    assert result is not None
    assert result.id == "threaded-sample"
