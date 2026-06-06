from uuid import uuid4

from .models import utc_now
from .revision_models import SourceResumeCanvas, SourceResumeCanvasNode
from .source_canvas_doc_json import source_canvas_hash


class BlankSourceResumeCanvasBuilder:
    def blank(
        self,
        *,
        document_id: str,
        source_id: str,
        title: str = "新简历",
    ) -> SourceResumeCanvas:
        now = utc_now()
        node_id = "node_blank_start"
        doc_json = {
            "type": "doc",
            "content": [
                {
                    "type": "heading",
                    "attrs": {
                        "level": 1,
                        "canvasNodeId": node_id,
                        "sourceBlockId": source_id,
                    },
                    "content": [{"type": "text", "text": title}],
                }
            ],
        }
        return SourceResumeCanvas(
            id=f"canvas_{uuid4().hex}",
            document_id=document_id,
            old_resume_source_id=source_id,
            version=1,
            source_snapshot_hash=source_canvas_hash(doc_json),
            doc_json=doc_json,
            node_map=[
                SourceResumeCanvasNode(
                    canvas_node_id=node_id,
                    source_block_id=source_id,
                    node_type="heading",
                    text=title,
                    source_span={},
                )
            ],
            module_anchors=[],
            created_at=now,
            updated_at=now,
        )
