import type { BlockStyle, BlockType } from "../../../style-engine/types";
import { TypographySection } from "./sections/TypographySection";
import { ColorSection } from "./sections/ColorSection";
import { SpacingSection } from "./sections/SpacingSection";
import { AlignmentSection } from "./sections/AlignmentSection";
import { BorderSection } from "./sections/BorderSection";
import { ListSection } from "./sections/ListSection";

type BlockStyleEditorProps = {
  blockType: BlockType;
  value: BlockStyle;
  onChange: (style: BlockStyle) => void;
};

export function BlockStyleEditor({ blockType, value, onChange }: BlockStyleEditorProps) {
  const isList = blockType === "bulletList" || blockType === "orderedList";

  return (
    <div className="td-block-style-editor">
      <TypographySection value={value} onChange={onChange} />
      <ColorSection value={value} onChange={onChange} />
      <SpacingSection value={value} onChange={onChange} />
      <AlignmentSection value={value} onChange={onChange} />
      <BorderSection value={value} onChange={onChange} />
      {isList && <ListSection value={value} onChange={onChange} />}
    </div>
  );
}
