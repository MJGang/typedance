"""BlockStyle dict → CSS rule generation for PDF rendering."""

from .models import TemplateStyleConfig


def _css_value(key: str, value: object) -> str | None:
    if value is None:
        return None
    # Dict keys come from BlockStyle.model_dump(by_alias=True) → camelCase
    mapper = {
        "fontFamily": "font-family",
        "fontSize": "font-size",
        "fontWeight": "font-weight",
        "lineHeight": "line-height",
        "letterSpacing": "letter-spacing",
        "textTransform": "text-transform",
        "color": "color",
        "backgroundColor": "background-color",
        "textAlign": "text-align",
        "marginTop": "margin-top",
        "marginBottom": "margin-bottom",
        "listStyleType": "list-style-type",
        "paddingLeft": "padding-left",
    }
    css_prop = mapper.get(key)
    if css_prop is None:
        return None
    return f"{css_prop}: {value};"


def generate_block_css(block_name: str, style: dict) -> str:
    """BlockStyle dict → single CSS rule."""
    rules: list[str] = []
    for key, value in style.items():
        if key == "borderBottom" and isinstance(value, dict):
            bs = value
            if bs.get("style") and bs["style"] != "none":
                rules.append(f"  border-bottom-style: {bs['style']};")
                if bs.get("width"):
                    rules.append(f"  border-bottom-width: {bs['width']};")
                if bs.get("color"):
                    rules.append(f"  border-bottom-color: {bs['color']};")
            continue
        css = _css_value(key, value)
        if css:
            rules.append(f"  {css}")

    if not rules:
        return ""
    return f".td-resume-{block_name} {{\n" + "\n".join(rules) + "\n}"


def generate_full_css(blocks: dict[str, dict]) -> str:
    """Iterate all blocks and compose full CSS string."""
    rules = []
    for name, style in blocks.items():
        rule = generate_block_css(name, style)
        if rule:
            rules.append(rule)
    return "\n\n".join(rules)
