import type { BlockStyle, BlockType, TemplateStyleConfig } from "@typedance/contracts";

export type { BlockStyle, BlockType, TemplateStyleConfig };

export const BLOCK_TYPES: BlockType[] = [
  "heading1", "heading2", "heading3",
  "paragraph", "bulletList", "orderedList",
];

export const BLOCK_TYPE_LABELS: Record<BlockType, { "zh-CN": string; "en-US": string }> = {
  heading1: { "zh-CN": "标题1", "en-US": "Heading 1" },
  heading2: { "zh-CN": "标题2", "en-US": "Heading 2" },
  heading3: { "zh-CN": "标题3", "en-US": "Heading 3" },
  paragraph: { "zh-CN": "正文", "en-US": "Paragraph" },
  bulletList: { "zh-CN": "无序列表", "en-US": "Bullet List" },
  orderedList: { "zh-CN": "有序列表", "en-US": "Ordered List" },
};
