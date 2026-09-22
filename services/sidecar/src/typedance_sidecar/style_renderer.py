"""Strict template style to CSS generation shared by HTML and PDF export."""

from math import floor

from .models import Heading2DecorationStyle, TemplateStyleConfig


HEADING_PREFIX_CLASS = "td-heading-prefix"
HEADING_CONTENT_CLASS = "td-heading-content"
HEADING_SUFFIX_CLASS = "td-heading-suffix"
LIST_BLOCKS = {"bulletList", "orderedList"}
TEXT_STYLE_KEYS = {
    "fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing",
    "textTransform", "color", "backgroundColor", "textAlign",
}
LIST_STRUCTURE_KEYS = {"marginTop", "marginBottom", "listStyleType", "paddingLeft"}
CSS_PROP_MAP = {
    "fontFamily": "font-family", "fontSize": "font-size", "fontWeight": "font-weight",
    "lineHeight": "line-height", "letterSpacing": "letter-spacing",
    "textTransform": "text-transform", "color": "color",
    "backgroundColor": "background-color", "textAlign": "text-align",
    "marginTop": "margin-top", "marginBottom": "margin-bottom",
    "listStyleType": "list-style-type", "paddingLeft": "padding-left",
}


def mix_hex_with_white(color: str, accent_weight: float = 0.12) -> str:
    normalized = color[1:]
    channels = [int(normalized[offset : offset + 2], 16) for offset in (0, 2, 4)]
    mixed = [floor(channel * accent_weight + 255 * (1 - accent_weight) + 0.5) for channel in channels]
    return "#" + "".join(f"{channel:02x}" for channel in mixed)


def _generate_block_css(selector: str, style: dict[str, object]) -> str:
    rules: list[str] = []
    for key, value in style.items():
        if key == "borderBottom" and isinstance(value, dict):
            border_style = value.get("style")
            if border_style and border_style != "none":
                rules.append(f"  border-bottom-style: {border_style};")
                if value.get("width"):
                    rules.append(f"  border-bottom-width: {value['width']};")
                if value.get("color"):
                    rules.append(f"  border-bottom-color: {value['color']};")
            continue
        css_property = CSS_PROP_MAP.get(key)
        if css_property is not None and value is not None:
            rules.append(f"  {css_property}: {value};")
    return f"{selector} {{\n" + "\n".join(rules) + "\n}" if rules else ""


def _pick_style(style: dict[str, object], keys: set[str]) -> dict[str, object]:
    return {key: value for key, value in style.items() if key in keys and value is not None}


def _generate_list_css(structure_selector: str, text_selector: str, style: dict[str, object]) -> list[str]:
    return [
        rule
        for rule in (
            _generate_block_css(structure_selector, _pick_style(style, LIST_STRUCTURE_KEYS)),
            _generate_block_css(text_selector, _pick_style(style, TEXT_STYLE_KEYS)),
        )
        if rule
    ]


def _generate_nested_list_css(scope: str) -> str:
    return "\n\n".join([
        f"{scope} li > ul, {scope} li > ol {{\n  margin-top: 0.25em;\n  margin-bottom: 0.25em;\n  padding-left: 1.5em;\n}}",
        f"{scope} ul ul {{\n  list-style-type: circle;\n  padding-left: 1.5em;\n}}",
        f"{scope} ul ul ul {{\n  list-style-type: square;\n  padding-left: 1.5em;\n}}",
        f"{scope} ol ol {{\n  list-style-type: lower-alpha;\n  padding-left: 1.5em;\n}}",
        f"{scope} ol ol ol {{\n  list-style-type: lower-roman;\n  padding-left: 1.5em;\n}}",
    ])


def _generate_heading_decoration_css(
    heading_selector: str,
    style: Heading2DecorationStyle,
    accent_color: str,
) -> str:
    styled_heading = f'{heading_selector}[data-heading-style="{style}"]'
    prefix = f"{styled_heading} > .{HEADING_PREFIX_CLASS}"
    suffix = f"{styled_heading} > .{HEADING_SUFFIX_CLASS}"
    soft_color = mix_hex_with_white(accent_color)
    common = f"""{heading_selector} {{
  --td-heading-accent: {accent_color};
  --td-heading-accent-soft: {soft_color};
  position: relative;
  isolation: isolate;
  z-index: 0;
  break-after: avoid;
  break-inside: avoid;
}}
{heading_selector} > .{HEADING_PREFIX_CLASS},
{heading_selector} > .{HEADING_SUFFIX_CLASS} {{
  pointer-events: none;
  user-select: none;
}}
{heading_selector} > .{HEADING_CONTENT_CLASS} {{
  position: relative;
  z-index: 1;
}}"""
    variants: dict[Heading2DecorationStyle, str] = {
        "minimal-line": f"""{styled_heading} {{
  display: block;
  padding-bottom: 5px;
}}
{prefix} {{
  display: none;
}}
{suffix} {{
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  border-radius: 999px;
  background: var(--td-heading-accent);
}}""",
        "accent-wash": f"""{styled_heading} {{
  display: block;
  padding: 5px 10px 5px 14px;
}}
{prefix} {{
  position: absolute;
  top: 4px;
  left: 0;
  width: 4px;
  height: calc(100% - 8px);
  z-index: 1;
  border-radius: 999px;
  background: var(--td-heading-accent);
}}
{suffix} {{
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--td-heading-accent-soft), transparent);
}}""",
        "dot-ribbon": f"""{styled_heading} {{
  display: block;
  padding: 0 0 4px 22px;
}}
{prefix} {{
  position: absolute;
  top: 0.7em;
  left: 0;
  width: 10px;
  height: 10px;
  transform: translateY(-50%);
  border-radius: 999px;
  background: var(--td-heading-accent);
}}
{suffix} {{
  position: absolute;
  bottom: 0;
  left: 18px;
  width: min(118px, 45%);
  height: 8px;
  z-index: 0;
  border-radius: 3px;
  background: var(--td-heading-accent-soft);
}}""",
    }
    return f"{common}\n\n{variants[style]}"


def generate_template_css(config: TemplateStyleConfig) -> str:
    rules: list[str] = []
    blocks = config.blocks.model_dump(by_alias=True, exclude_none=True)
    for block_name, style in blocks.items():
        if block_name in LIST_BLOCKS:
            rules.extend(_generate_list_css(
                f".td-resume-{block_name}",
                f".td-resume-{block_name}Text",
                style,
            ))
        else:
            rule = _generate_block_css(f".td-resume-{block_name}", style)
            if rule:
                rules.append(rule)
    rules.append(_generate_heading_decoration_css(
        ".td-resume-heading2",
        config.blocks.heading2.decoration_style,
        config.theme.accent_color,
    ))
    rules.append(_generate_nested_list_css(".td-resume-page"))
    return "\n\n".join(rules)
