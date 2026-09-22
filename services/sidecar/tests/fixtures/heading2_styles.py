from copy import deepcopy


BASE_BLOCKS = {
    "heading1": {"fontSize": "28px", "fontWeight": 700, "color": "#1a1a1a", "textAlign": "center"},
    "heading2": {
        "decorationStyle": "minimal-line",
        "fontSize": "18px",
        "fontWeight": 600,
        "lineHeight": 1.5,
        "color": "#213547",
        "marginTop": "18px",
        "marginBottom": "10px",
    },
    "heading3": {"fontSize": "15px", "fontWeight": 600, "color": "#213547"},
    "paragraph": {"fontSize": "12px", "lineHeight": 1.5, "color": "#334155"},
    "bulletList": {"fontSize": "12px", "listStyleType": "disc", "paddingLeft": "20px"},
    "orderedList": {"fontSize": "12px", "listStyleType": "decimal", "paddingLeft": "20px"},
}

HEADING2_DOC_JSON = {
    "type": "doc",
    "content": [
        {
            "type": "heading",
            "attrs": {"level": 2},
            "content": [
                {"type": "text", "text": "教育", "marks": [{"type": "bold"}]},
                {
                    "type": "text",
                    "text": "经历",
                    "marks": [
                        {"type": "underline"},
                        {"type": "inlineStyle", "attrs": {"color": "#123456", "backgroundColor": "#fedcba"}},
                    ],
                },
            ],
        },
        {"type": "paragraph", "content": [{"type": "text", "text": "示例正文用于验证标题与后续内容不会重叠。"}]},
    ],
}


def template_style_payload(
    decoration_style: str = "minimal-line",
    *,
    accent_color: str = "#174EA6",
    template_id: str = "classic-a4",
) -> dict:
    blocks = deepcopy(BASE_BLOCKS)
    blocks["heading2"]["decorationStyle"] = decoration_style
    return {
        "template_id": template_id,
        "preset": "classic" if template_id == "classic-a4" else "",
        "theme": {"accentColor": accent_color},
        "blocks": blocks,
        "updated_at": "2026-06-05T00:00:00.000Z",
    }
