import type { BlockStyle } from "./types";

export function generateBlockCSS(blockName: string, style: BlockStyle): string {
  const rules: string[] = [];
  const push = (prop: string, value: string | undefined) => {
    if (value !== undefined) rules.push(`  ${prop}: ${value};`);
  };

  push("font-family", style.fontFamily);
  push("font-size", style.fontSize);
  if (style.fontWeight) push("font-weight", String(style.fontWeight));
  if (style.lineHeight) push("line-height", String(style.lineHeight));
  push("letter-spacing", style.letterSpacing);
  push("text-transform", style.textTransform);
  push("color", style.color);
  push("background-color", style.backgroundColor);
  push("text-align", style.textAlign);
  push("margin-top", style.marginTop);
  push("margin-bottom", style.marginBottom);
  push("list-style-type", style.listStyleType);
  push("padding-left", style.paddingLeft);

  if (style.borderBottom && style.borderBottom.style !== "none") {
    push("border-bottom-style", style.borderBottom.style);
    push("border-bottom-width", style.borderBottom.width);
    push("border-bottom-color", style.borderBottom.color);
  }

  if (rules.length === 0) return "";
  return `.td-resume-${blockName} {\n${rules.join("\n")}\n}`;
}

export function generateFullCSS(blocks: Record<string, BlockStyle>): string {
  return Object.entries(blocks)
    .map(([name, style]) => generateBlockCSS(name, style))
    .filter(Boolean)
    .join("\n\n");
}
