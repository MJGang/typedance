import type { BlockStyle, Heading2DecorationStyle, TemplateStyleConfig } from "@typedance/contracts"

export const HEADING_PREFIX_CLASS = "td-heading-prefix"
export const HEADING_CONTENT_CLASS = "td-heading-content"
export const HEADING_SUFFIX_CLASS = "td-heading-suffix"

const LIST_BLOCKS = new Set(["bulletList", "orderedList"])
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
])
const LIST_STRUCTURE_KEYS = new Set(["marginTop", "marginBottom", "listStyleType", "paddingLeft"])

const CSS_PROP_MAP: Record<string, string> = {
  fontFamily: "font-family",
  fontSize: "font-size",
  fontWeight: "font-weight",
  lineHeight: "line-height",
  letterSpacing: "letter-spacing",
  textTransform: "text-transform",
  color: "color",
  backgroundColor: "background-color",
  textAlign: "text-align",
  marginTop: "margin-top",
  marginBottom: "margin-bottom",
  listStyleType: "list-style-type",
  paddingLeft: "padding-left",
}

const ELEMENT_MAP: Record<string, string[]> = {
  heading1: ["h1"],
  heading2: ["h2"],
  heading3: ["h3"],
  paragraph: ["p"],
  bulletList: ["ul"],
  orderedList: ["ol"],
}

const LIST_TEXT_ELEMENT_MAP: Record<string, string[]> = {
  bulletList: ["ul li", "ul li p"],
  orderedList: ["ol li", "ol li p"],
}

export function mixHexWithWhite(color: string, accentWeight = 0.12): string {
  const normalized = color.slice(1)
  const channels = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16))
  return `#${channels
    .map((channel) => Math.round(channel * accentWeight + 255 * (1 - accentWeight)).toString(16).padStart(2, "0"))
    .join("")}`
}

function generateBlockCSS(selector: string, style: BlockStyle): string {
  const rules: string[] = []
  for (const [key, value] of Object.entries(style)) {
    if (key === "borderBottom" && typeof value === "object" && value !== null) {
      const border = value as { style?: string; width?: string; color?: string }
      if (border.style && border.style !== "none") {
        rules.push(`  border-bottom-style: ${border.style};`)
        if (border.width) rules.push(`  border-bottom-width: ${border.width};`)
        if (border.color) rules.push(`  border-bottom-color: ${border.color};`)
      }
      continue
    }

    const property = CSS_PROP_MAP[key]
    if (property && value !== undefined && value !== null) {
      rules.push(`  ${property}: ${value};`)
    }
  }

  return rules.length > 0 ? `${selector} {\n${rules.join("\n")}\n}` : ""
}

function pickStyle(style: BlockStyle, keys: Set<string>): BlockStyle {
  return Object.fromEntries(
    Object.entries(style).filter(([key, value]) => keys.has(key) && value !== undefined),
  ) as BlockStyle
}

function generateListCSS(structureSelector: string, textSelector: string, style: BlockStyle): string[] {
  return [
    generateBlockCSS(structureSelector, pickStyle(style, LIST_STRUCTURE_KEYS)),
    generateBlockCSS(textSelector, pickStyle(style, TEXT_STYLE_KEYS)),
  ].filter(Boolean)
}

function generateNestedListCSS(scope: string): string {
  return [
    `${scope} li > ul, ${scope} li > ol {\n  margin-top: 0.25em;\n  margin-bottom: 0.25em;\n  padding-left: 1.5em;\n}`,
    `${scope} ul ul {\n  list-style-type: circle;\n  padding-left: 1.5em;\n}`,
    `${scope} ul ul ul {\n  list-style-type: square;\n  padding-left: 1.5em;\n}`,
    `${scope} ol ol {\n  list-style-type: lower-alpha;\n  padding-left: 1.5em;\n}`,
    `${scope} ol ol ol {\n  list-style-type: lower-roman;\n  padding-left: 1.5em;\n}`,
  ].join("\n\n")
}

function generateHeadingDecorationCSS(
  headingSelector: string,
  style: Heading2DecorationStyle,
  accentColor: string,
): string {
  const styledHeading = `${headingSelector}[data-heading-style="${style}"]`
  const prefix = `${styledHeading} > .${HEADING_PREFIX_CLASS}`
  const content = `${styledHeading} > .${HEADING_CONTENT_CLASS}`
  const suffix = `${styledHeading} > .${HEADING_SUFFIX_CLASS}`
  const softColor = mixHexWithWhite(accentColor)
  const common = `${headingSelector} {
  --td-heading-accent: ${accentColor};
  --td-heading-accent-soft: ${softColor};
  position: relative;
  isolation: isolate;
  z-index: 0;
  break-after: avoid;
  break-inside: avoid;
}
${headingSelector} > .${HEADING_PREFIX_CLASS},
${headingSelector} > .${HEADING_SUFFIX_CLASS} {
  pointer-events: none;
  user-select: none;
}
${headingSelector} > .${HEADING_CONTENT_CLASS} {
  position: relative;
  z-index: 1;
}`

  const variants: Record<Heading2DecorationStyle, string> = {
    "minimal-line": `${styledHeading} {
  display: block;
  padding-bottom: 5px;
}
${prefix} {
  display: none;
}
${suffix} {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  border-radius: 999px;
  background: var(--td-heading-accent);
}`,
    "accent-wash": `${styledHeading} {
  display: block;
  padding: 5px 10px 5px 14px;
}
${prefix} {
  position: absolute;
  top: 4px;
  left: 0;
  width: 4px;
  height: calc(100% - 8px);
  z-index: 1;
  border-radius: 999px;
  background: var(--td-heading-accent);
}
${suffix} {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  border-radius: 4px;
  background: linear-gradient(90deg, var(--td-heading-accent-soft), transparent);
}`,
    "dot-ribbon": `${styledHeading} {
  display: block;
  padding: 0 0 4px 22px;
}
${prefix} {
  position: absolute;
  top: 0.7em;
  left: 0;
  width: 10px;
  height: 10px;
  transform: translateY(-50%);
  border-radius: 999px;
  background: var(--td-heading-accent);
}
${suffix} {
  position: absolute;
  bottom: 0;
  left: 18px;
  width: min(118px, 45%);
  height: 8px;
  z-index: 0;
  border-radius: 3px;
  background: var(--td-heading-accent-soft);
}`,
  }

  return `${common}\n\n${variants[style]}`
}

export function generateTemplateCSS(config: TemplateStyleConfig): string {
  const rules: string[] = []
  for (const [blockName, style] of Object.entries(config.blocks)) {
    if (LIST_BLOCKS.has(blockName)) {
      rules.push(...generateListCSS(
        `.td-resume-${blockName}`,
        `.td-resume-${blockName}Item, .td-resume-${blockName}Text`,
        style,
      ))
    } else {
      const blockCSS = generateBlockCSS(`.td-resume-${blockName}`, style)
      if (blockCSS) rules.push(blockCSS)
    }
  }

  rules.push(generateHeadingDecorationCSS(
    ".td-resume-heading2",
    config.blocks.heading2.decorationStyle,
    config.theme.accentColor,
  ))
  rules.push(generateNestedListCSS(".td-resume-page"))
  return rules.join("\n\n")
}

export function generateWorkspaceTemplateCSS(
  config: TemplateStyleConfig,
  scope = ".rm-with-pagination",
): string {
  const rules: string[] = []
  for (const [blockName, style] of Object.entries(config.blocks)) {
    const elements = ELEMENT_MAP[blockName]
    if (!elements) continue

    if (LIST_BLOCKS.has(blockName)) {
      const structureSelector = elements.map((element) => `${scope} ${element}`).join(", ")
      const textSelector = (LIST_TEXT_ELEMENT_MAP[blockName] ?? [])
        .map((element) => `${scope} ${element}`)
        .join(", ")
      rules.push(...generateListCSS(structureSelector, textSelector, style))
    } else {
      const selector = elements.map((element) => `${scope} ${element}`).join(", ")
      const blockCSS = generateBlockCSS(selector, style)
      if (blockCSS) rules.push(blockCSS)
    }
  }

  rules.push(generateHeadingDecorationCSS(
    `${scope} h2`,
    config.blocks.heading2.decorationStyle,
    config.theme.accentColor,
  ))
  rules.push(generateNestedListCSS(scope))
  return rules.join("\n\n")
}
