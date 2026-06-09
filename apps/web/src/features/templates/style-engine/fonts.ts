export interface FontOption {
  value: string;
  label: Record<"zh-CN" | "en-US", string>;
  stack: string;
}

export const VUE_DOC_FONT_STACK = "Quotes, -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Oxygen, Ubuntu, Cantarell, \"Fira Sans\", \"Droid Sans\", \"Helvetica Neue\", sans-serif";
export const MICROSOFT_YAHEI_FONT_STACK = "\"Microsoft YaHei\", \"Segoe UI\", Arial, sans-serif";

export const COMMON_FONTS: FontOption[] = [
  { value: VUE_DOC_FONT_STACK, label: { "zh-CN": "系统界面", "en-US": "System UI" }, stack: VUE_DOC_FONT_STACK },
  { value: MICROSOFT_YAHEI_FONT_STACK, label: { "zh-CN": "Microsoft YaHei", "en-US": "Microsoft YaHei" }, stack: MICROSOFT_YAHEI_FONT_STACK },
  { value: "Georgia, serif", label: { "zh-CN": "Georgia", "en-US": "Georgia" }, stack: "Georgia, serif" },
  { value: "'Times New Roman', serif", label: { "zh-CN": "Times New Roman", "en-US": "Times New Roman" }, stack: "'Times New Roman', serif" },
  { value: "Arial, sans-serif", label: { "zh-CN": "Arial", "en-US": "Arial" }, stack: "Arial, sans-serif" },
  { value: "'Helvetica Neue', Arial, sans-serif", label: { "zh-CN": "Helvetica Neue", "en-US": "Helvetica Neue" }, stack: "'Helvetica Neue', Arial, sans-serif" },
  { value: "'Noto Sans SC', 'Microsoft YaHei', sans-serif", label: { "zh-CN": "思源黑体", "en-US": "Noto Sans SC" }, stack: "'Noto Sans SC', 'Microsoft YaHei', sans-serif" },
  { value: "'Noto Serif SC', 'SimSun', serif", label: { "zh-CN": "思源宋体", "en-US": "Noto Serif SC" }, stack: "'Noto Serif SC', 'SimSun', serif" },
];
