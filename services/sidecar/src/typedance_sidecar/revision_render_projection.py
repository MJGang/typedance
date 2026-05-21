from html import escape
from typing import Any
from uuid import uuid4

from .models import utc_now
from .resume_pack import default_pack_registry
from .revision_models import DocumentModule, DraftVersion, RenderProjection
from .revision_pack import PackRegistry, PackRegistryError


PROFILE_TEXT_LIMITS = {
    "default-a4": 3600,
    "compact-a4": 2800,
    "ats": 5200,
}


class RenderProjectionError(Exception):
    pass


class DraftProjectionBuilder:
    def __init__(self, pack_registry: PackRegistry | None = None) -> None:
        self.pack_registry = pack_registry or default_pack_registry()

    def build(
        self,
        draft: DraftVersion,
        modules: list[DocumentModule],
        *,
        render_profile: str | None = None,
        projection_id: str | None = None,
    ) -> RenderProjection:
        profile = self._resolve_profile(draft.pack_id, render_profile)
        visible_modules = sorted(
            [module for module in modules if module.visibility == "visible"],
            key=lambda module: module.order,
        )
        doc_json = self._build_doc_json(visible_modules)
        html = self._build_html(visible_modules, profile)
        warnings = self._build_warnings(visible_modules, profile)

        return RenderProjection(
            id=projection_id or f"render_{uuid4().hex}",
            draft_id=draft.id,
            render_profile=profile,
            html=html,
            doc_json=doc_json,
            layout_warnings=warnings,
            created_at=utc_now(),
        )

    def _resolve_profile(self, pack_id: str, render_profile: str | None) -> str:
        try:
            pack = self.pack_registry.get(pack_id)
        except PackRegistryError as exc:
            raise RenderProjectionError(str(exc)) from exc

        profile = render_profile or pack.render_mapping.default_profile
        if profile not in pack.render_mapping.supported_profiles:
            raise RenderProjectionError(f"Unsupported render profile: {profile}")
        return profile

    def _build_doc_json(self, modules: list[DocumentModule]) -> dict[str, Any]:
        content: list[dict[str, Any]] = []
        for module in modules:
            content.extend(self._module_to_doc_nodes(module))
        return {"type": "doc", "content": content}

    def _module_to_doc_nodes(self, module: DocumentModule) -> list[dict[str, Any]]:
        if module.type == "BasicInfo":
            return self._basic_info_nodes(module)

        nodes = [self._heading(module.title, 2)]
        lines = self._module_lines(module)
        if lines:
            nodes.append(self._bullet_list(lines))
        return nodes

    def _basic_info_nodes(self, module: DocumentModule) -> list[dict[str, Any]]:
        name = self._text_value(module.data.get("name")) or module.title
        headline = self._text_value(module.data.get("headline"))
        contact_parts = [
            self._text_value(module.data.get("phone")),
            self._text_value(module.data.get("email")),
            self._text_value(module.data.get("location")),
        ]
        links = module.data.get("links")
        if isinstance(links, list):
            contact_parts.extend(self._text_value(link) for link in links)

        contact = " | ".join(part for part in contact_parts if part)
        nodes = [self._heading(name, 1)]
        if headline:
            nodes.append(self._paragraph(headline))
        if contact:
            nodes.append(self._paragraph(contact))
        return nodes

    def _module_lines(self, module: DocumentModule) -> list[str]:
        items = module.data.get("items")
        if isinstance(items, list):
            return [
                line
                for item in items
                for line in self._item_lines(item)
                if line
            ]

        return [
            line
            for key, value in module.data.items()
            for line in self._field_lines(key, value)
            if line
        ]

    def _item_lines(self, item: object) -> list[str]:
        if isinstance(item, str):
            return [item.strip()] if item.strip() else []

        if not isinstance(item, dict):
            return []

        heading_parts = [
            self._text_value(item.get("title")),
            self._text_value(item.get("role")),
            self._text_value(item.get("company")),
            self._text_value(item.get("organization")),
            self._text_value(item.get("time_range")),
        ]
        heading = " / ".join(part for part in heading_parts if part)
        lines = [heading] if heading else []

        description = self._text_value(item.get("description"))
        if description:
            lines.append(description)

        bullets = item.get("bullets")
        if isinstance(bullets, list):
            lines.extend(self._text_value(bullet) for bullet in bullets if self._text_value(bullet))

        return lines

    def _field_lines(self, key: str, value: object) -> list[str]:
        if value is None or value == "":
            return []
        if isinstance(value, list):
            return [self._text_value(item) for item in value if self._text_value(item)]
        if isinstance(value, dict):
            return [
                f"{key}.{child_key}: {self._text_value(child_value)}"
                for child_key, child_value in value.items()
                if self._text_value(child_value)
            ]
        text = self._text_value(value)
        return [f"{key}: {text}"] if text else []

    def _build_html(self, modules: list[DocumentModule], render_profile: str) -> str:
        body = "\n".join(self._module_to_html(module) for module in modules)
        if not body:
            body = '<p class="td-empty-draft">暂无可渲染内容</p>'

        return f"""<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <style>
      body {{ margin: 0; font-family: "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif; color: #1f2937; }}
      .td-revision-render {{ font-size: 11px; line-height: 1.55; }}
      .td-module {{ margin: 0 0 12px; }}
      .td-module h1 {{ font-size: 24px; margin: 0 0 6px; text-align: center; }}
      .td-module h2 {{ font-size: 15px; margin: 12px 0 6px; border-bottom: 1px solid #d1d5db; }}
      .td-module p {{ margin: 0 0 4px; }}
      .td-module ul {{ margin: 0; padding-left: 18px; }}
      .td-module li {{ margin: 0 0 4px; }}
      .td-empty-draft {{ color: #6b7280; }}
    </style>
  </head>
  <body>
    <article class="td-revision-render" data-render-profile="{escape(render_profile)}">
      {body}
    </article>
  </body>
</html>"""

    def _module_to_html(self, module: DocumentModule) -> str:
        attrs = (
            f'data-module-id="{escape(module.id)}" '
            f'data-module-type="{escape(module.type)}"'
        )
        if module.type == "BasicInfo":
            return f'<section class="td-module td-module-basic-info" {attrs}>{self._basic_info_html(module)}</section>'

        lines = self._module_lines(module)
        body = "".join(f"<li>{escape(line)}</li>" for line in lines)
        list_html = f"<ul>{body}</ul>" if body else ""
        return (
            f'<section class="td-module" {attrs}>'
            f"<h2>{escape(module.title)}</h2>"
            f"{list_html}"
            "</section>"
        )

    def _basic_info_html(self, module: DocumentModule) -> str:
        nodes = self._basic_info_nodes(module)
        rendered = []
        for node in nodes:
            node_type = node["type"]
            text = self._node_text(node)
            if node_type == "heading":
                rendered.append(f"<h1>{escape(text)}</h1>")
            elif text:
                rendered.append(f"<p>{escape(text)}</p>")
        return "".join(rendered)

    def _build_warnings(
        self,
        modules: list[DocumentModule],
        render_profile: str,
    ) -> list[dict[str, Any]]:
        warnings: list[dict[str, Any]] = []
        if not modules:
            warnings.append(
                {
                    "code": "empty_draft",
                    "message": "当前草稿没有可见模块，无法形成可投递简历。",
                    "severity": "warning",
                }
            )

        total_text = "\n".join(
            text
            for module in modules
            for text in [self._module_text(module)]
            if text
        )
        limit = PROFILE_TEXT_LIMITS.get(render_profile, PROFILE_TEXT_LIMITS["default-a4"])
        if len(total_text) > limit:
            warnings.append(
                {
                    "code": "content_may_overflow",
                    "message": "当前内容可能超过默认版式承载范围。",
                    "severity": "warning",
                    "details": {"text_length": len(total_text), "limit": limit},
                }
            )

        for module in modules:
            if module.status in {"needs_review", "needs_confirmation", "weak"}:
                warnings.append(
                    {
                        "code": "module_needs_attention",
                        "message": f"{module.title} 仍需要处理后再导出。",
                        "severity": "warning",
                        "target": {"module_id": module.id, "module_type": module.type},
                    }
                )

        return warnings

    def _module_text(self, module: DocumentModule) -> str:
        if module.type == "BasicInfo":
            return " ".join(self._node_text(node) for node in self._basic_info_nodes(module))
        return " ".join(self._module_lines(module))

    def _heading(self, text: str, level: int) -> dict[str, Any]:
        return {
            "type": "heading",
            "attrs": {"level": level},
            "content": [{"type": "text", "text": text}],
        }

    def _paragraph(self, text: str) -> dict[str, Any]:
        return {"type": "paragraph", "content": [{"type": "text", "text": text}]}

    def _bullet_list(self, lines: list[str]) -> dict[str, Any]:
        return {
            "type": "bulletList",
            "content": [
                {
                    "type": "listItem",
                    "content": [self._paragraph(line)],
                }
                for line in lines
            ],
        }

    def _node_text(self, node: dict[str, Any]) -> str:
        content = node.get("content")
        if not isinstance(content, list):
            return ""
        return "".join(
            child.get("text", "")
            for child in content
            if isinstance(child, dict) and isinstance(child.get("text"), str)
        )

    def _text_value(self, value: object) -> str:
        if value is None:
            return ""
        if isinstance(value, str):
            return value.strip()
        if isinstance(value, int | float):
            return str(value)
        return ""
