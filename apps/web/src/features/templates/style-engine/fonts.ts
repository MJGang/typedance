export interface FontOption {
  value: string;
  label: Record<"zh-CN" | "en-US", string>;
  stack: string;
}

export const COMMON_FONTS: FontOption[] = [
  { value: "Georgia, serif", label: { "zh-CN": "Georgia", "en-US": "Georgia" }, stack: "Georgia, serif" },
  { value: "'Times New Roman', serif", label: { "zh-CN": "Times New Roman", "en-US": "Times New Roman" }, stack: "'Times New Roman', serif" },
  { value: "Arial, sans-serif", label: { "zh-CN": "Arial", "en-US": "Arial" }, stack: "Arial, sans-serif" },
  { value: "'Helvetica Neue', Arial, sans-serif", label: { "zh-CN": "Helvetica Neue", "en-US": "Helvetica Neue" }, stack: "'Helvetica Neue', Arial, sans-serif" },
  { value: "'Noto Sans SC', 'Microsoft YaHei', sans-serif", label: { "zh-CN": "思源黑体", "en-US": "Noto Sans SC" }, stack: "'Noto Sans SC', 'Microsoft YaHei', sans-serif" },
  { value: "'Noto Serif SC', 'SimSun', serif", label: { "zh-CN": "思源宋体", "en-US": "Noto Serif SC" }, stack: "'Noto Serif SC', 'SimSun', serif" },
];
