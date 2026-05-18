import type { BlockStyle } from "./types";

const LIST_BLOCKS = new Set(["bulletList", "orderedList"]);
const TEXT_STYLE_KEYS = new Set([
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "textTransform",
  "color",
  "backgroundColor",
  "textAlign",
]);
const LIST_STRUCTURE_KEYS = new Set(["marginTop", "marginBottom", "listStyleType", "paddingLeft"]);

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

function pickStyle(style: BlockStyle, keys: Set<string>): BlockStyle {
  return Object.fromEntries(
    Object.entries(style).filter(([key, value]) => keys.has(key) && value !== undefined),
  ) as BlockStyle;
}

function generateListTextCSS(blockName: string, style: BlockStyle): string {
  const blockCSS = generateBlockCSS(`${blockName}Text`, pickStyle(style, TEXT_STYLE_KEYS));
  return blockCSS;
}

function generateListStructureCSS(blockName: string, style: BlockStyle): string {
  return generateBlockCSS(blockName, pickStyle(style, LIST_STRUCTURE_KEYS));
}

export function generateFullCSS(blocks: Record<string, BlockStyle>): string {
  return Object.entries(blocks)
    .flatMap(([name, style]) => (
      LIST_BLOCKS.has(name)
        ? [generateListStructureCSS(name, style), generateListTextCSS(name, style)]
        : [generateBlockCSS(name, style)]
    ))
    .filter(Boolean)
    .join("\n\n");
}

// 元素映射表：block type name → TipTap 输出的 HTML 元素
const ELEMENT_MAP: Record<string, string[]> = {
  heading1: ["h1"],
  heading2: ["h2"],
  heading3: ["h3"],
  paragraph: ["p"],
  bulletList: ["ul"],
  orderedList: ["ol"],
};

const LIST_TEXT_ELEMENT_MAP: Record<string, string[]> = {
  bulletList: ["ul li p"],
  orderedList: ["ol li p"],
};

/**
 * 将模板样式 CSS 映射到 HTML 元素选择器，作用域限制在分页容器内。
 * 与 generateFullCSS() 不同，这里输出的是 h1/h2/p/ul/li 对应的 CSS，
 * 而非 .td-resume-{name} 类选择器。
 */
export function generateWorkspaceCSS(
  blocks: Record<string, BlockStyle>,
  scope = ".rm-with-pagination",
): string {
  const rules: string[] = [];
  for (const [blockName, style] of Object.entries(blocks)) {
    const elements = ELEMENT_MAP[blockName];
    if (!elements) continue;

    const structureCSS = LIST_BLOCKS.has(blockName) ? generateListStructureCSS(blockName, style) : generateBlockCSS(blockName, style);
    if (structureCSS) {
      const selectors = elements.map((el) => `${scope} ${el}`).join(", ");
      rules.push(structureCSS.replace(`.td-resume-${blockName}`, selectors));
    }

    if (LIST_BLOCKS.has(blockName)) {
      const textCSS = generateListTextCSS(blockName, style);
      const textElements = LIST_TEXT_ELEMENT_MAP[blockName] ?? [];
      if (textCSS && textElements.length > 0) {
        const selectors = textElements.map((el) => `${scope} ${el}`).join(", ");
        rules.push(textCSS.replace(`.td-resume-${blockName}Text`, selectors));
      }
    }
  }
  return rules.join("\n\n");
}
