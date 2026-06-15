export interface FontOption {
  value: string;
  label: Record<"zh-CN" | "en-US", string>;
  stack: string;
}

export const MICROSOFT_YAHEI_FONT_VALUE = "\"Microsoft YaHei\"";
export const SEGOE_UI_FONT_VALUE = "\"Segoe UI\"";
export const ARIAL_FONT_VALUE = "Arial";

const NOTO_SANS_SC_FONT_VALUE = "'Noto Sans SC'";
const NOTO_SERIF_SC_FONT_VALUE = "'Noto Serif SC'";
const SIMSUN_FONT_VALUE = "SimSun";
const GEORGIA_FONT_VALUE = "Georgia";
const TIMES_NEW_ROMAN_FONT_VALUE = "'Times New Roman'";
const HELVETICA_NEUE_FONT_VALUE = "'Helvetica Neue'";
const GENERIC_FAMILIES = new Set(["serif", "sans-serif"]);
const SERIF_FONT_VALUES = new Set([
  GEORGIA_FONT_VALUE,
  TIMES_NEW_ROMAN_FONT_VALUE,
  NOTO_SERIF_SC_FONT_VALUE,
  SIMSUN_FONT_VALUE,
]);

export function buildFontFamilyStack(selectedValues: string[]): string | undefined {
  const values = uniqueFontValues(selectedValues)
    .filter((font) => !GENERIC_FAMILIES.has(font));

  if (values.length === 0) return undefined;

  const genericFamily = values.every((font) => SERIF_FONT_VALUES.has(font)) ? "serif" : "sans-serif";
  return [...values, genericFamily].join(", ");
}

export const MICROSOFT_YAHEI_FONT_STACK = buildFontFamilyStack([
  MICROSOFT_YAHEI_FONT_VALUE,
  SEGOE_UI_FONT_VALUE,
  ARIAL_FONT_VALUE,
]) ?? "";

export const COMMON_FONTS: FontOption[] = [
  {
    value: MICROSOFT_YAHEI_FONT_VALUE,
    label: { "zh-CN": "Microsoft YaHei", "en-US": "Microsoft YaHei" },
    stack: MICROSOFT_YAHEI_FONT_STACK,
  },
  {
    value: NOTO_SANS_SC_FONT_VALUE,
    label: { "zh-CN": "思源黑体", "en-US": "Noto Sans SC" },
    stack: buildFontFamilyStack([NOTO_SANS_SC_FONT_VALUE, MICROSOFT_YAHEI_FONT_VALUE, SEGOE_UI_FONT_VALUE, ARIAL_FONT_VALUE]) ?? "",
  },
  {
    value: SEGOE_UI_FONT_VALUE,
    label: { "zh-CN": "Segoe UI", "en-US": "Segoe UI" },
    stack: buildFontFamilyStack([SEGOE_UI_FONT_VALUE, ARIAL_FONT_VALUE]) ?? "",
  },
  {
    value: ARIAL_FONT_VALUE,
    label: { "zh-CN": "Arial", "en-US": "Arial" },
    stack: buildFontFamilyStack([ARIAL_FONT_VALUE]) ?? "",
  },
  {
    value: HELVETICA_NEUE_FONT_VALUE,
    label: { "zh-CN": "Helvetica Neue", "en-US": "Helvetica Neue" },
    stack: buildFontFamilyStack([HELVETICA_NEUE_FONT_VALUE, ARIAL_FONT_VALUE]) ?? "",
  },
  {
    value: GEORGIA_FONT_VALUE,
    label: { "zh-CN": "Georgia", "en-US": "Georgia" },
    stack: buildFontFamilyStack([GEORGIA_FONT_VALUE]) ?? "",
  },
  {
    value: TIMES_NEW_ROMAN_FONT_VALUE,
    label: { "zh-CN": "Times New Roman", "en-US": "Times New Roman" },
    stack: buildFontFamilyStack([TIMES_NEW_ROMAN_FONT_VALUE]) ?? "",
  },
  {
    value: NOTO_SERIF_SC_FONT_VALUE,
    label: { "zh-CN": "思源宋体", "en-US": "Noto Serif SC" },
    stack: buildFontFamilyStack([NOTO_SERIF_SC_FONT_VALUE, SIMSUN_FONT_VALUE]) ?? "",
  },
  {
    value: SIMSUN_FONT_VALUE,
    label: { "zh-CN": "SimSun", "en-US": "SimSun" },
    stack: buildFontFamilyStack([SIMSUN_FONT_VALUE]) ?? "",
  },
];

export function parseFontFamilySelection(fontFamily: string | undefined): string[] {
  if (!fontFamily) return [];

  const availableValues = new Set(COMMON_FONTS.map((font) => font.value));
  return uniqueFontValues(splitFontFamily(fontFamily))
    .filter((font) => availableValues.has(font));
}

export function moveFontFamilySelection(selectedValues: string[], fontValue: string, direction: -1 | 1): string[] {
  const values = [...selectedValues];
  const index = values.indexOf(fontValue);
  const nextIndex = index + direction;

  if (index < 0 || nextIndex < 0 || nextIndex >= values.length) return values;

  [values[index], values[nextIndex]] = [values[nextIndex], values[index]];
  return values;
}

function uniqueFontValues(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const rawValue of values) {
    const value = rawValue.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }

  return result;
}

function splitFontFamily(fontFamily: string): string[] {
  const values: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (const char of fontFamily) {
    if ((char === "'" || char === "\"") && quote === null) {
      quote = char;
      current += char;
      continue;
    }
    if (quote === char) {
      quote = null;
      current += char;
      continue;
    }
    if (char === "," && quote === null) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}
