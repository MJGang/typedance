import { useState, useCallback } from "react";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { UiLanguage } from "../../workspace/types";
import type { ResumeDocJson, ResumeEditorChange } from "../../workspace/editor";
import type { BlockType, BlockStyle, TemplateStyleConfig } from "../types";
import { ResumeRichTextEditor } from "../../workspace/components/ResumeRichTextEditor";
import { StylePanel } from "./style-panel/StylePanel";
import { generateFullCSS, generateBlockCSS } from "../style-engine/css-generator";
import type { TemplateSampleContent, ResumeTemplateDefinition } from "../types";

type TemplateDetailProps = {
  template: ResumeTemplateDefinition;
  sample: TemplateSampleContent;
  styleConfig: TemplateStyleConfig;
  uiLanguage: UiLanguage;
  onBack: () => void;
  onStyleChange: (style: TemplateStyleConfig) => void;
  styleStatus: string;
};

/**
 * Maps block style names to TipTap-generated HTML element selectors,
 * scoped within .td-template-editor-wrapper so template preview styles
 * apply to the read-only TipTap editor.
 */
function generateElementCSS(blocks: Record<string, BlockStyle>): string {
  const ELEMENT_MAP: Record<string, string[]> = {
    heading1: ["h1"],
    heading2: ["h2"],
    heading3: ["h3"],
    paragraph: ["p"],
    bulletList: ["ul", "li"],
    orderedList: ["ol", "li"],
  };

  const rules: string[] = [];
  for (const [blockName, style] of Object.entries(blocks)) {
    const elements = ELEMENT_MAP[blockName];
    if (!elements) continue;

    const blockCSS = generateBlockCSS(blockName, style);
    if (!blockCSS) continue;

    const selectors = elements
      .map((el) => `.td-template-editor-wrapper ${el}`)
      .join(", ");
    rules.push(blockCSS.replace(`.td-resume-${blockName}`, selectors));
  }
  return rules.join("\n\n");
}

export function TemplateDetail({
  template,
  sample,
  styleConfig,
  uiLanguage,
  onBack,
  onStyleChange,
  styleStatus,
}: TemplateDetailProps) {
  const [activeBlock, setActiveBlock] = useState<BlockType>("paragraph");
  const [sampleDoc, setSampleDoc] = useState(sample.doc_json);

  const cssText = generateFullCSS(styleConfig.blocks ?? {});
  const elementCssText = generateElementCSS(styleConfig.blocks ?? {});

  const handleSelectionUpdate = useCallback((blockName: string) => {
    const validBlocks: BlockType[] = ["heading1", "heading2", "heading3", "paragraph", "bulletList", "orderedList"];
    if (validBlocks.includes(blockName as BlockType)) {
      setActiveBlock(blockName as BlockType);
    }
  }, []);

  const handleSampleChange = useCallback((change: ResumeEditorChange) => {
    setSampleDoc(change.docJson as Record<string, unknown>);
  }, []);

  return (
    <section className="td-template-detail">
      <div className="td-template-detail-header">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          返回模板库
        </Button>
        <Badge>{template.status === "built-in" ? "当前可用" : "规划中"}</Badge>
      </div>

      <div className="td-template-detail-grid">
        <div className="td-template-editor-wrapper">
          <style>{cssText}</style>
          <style>{elementCssText}</style>
          <ResumeRichTextEditor
            ariaLabel="Template sample preview"
            docJson={sampleDoc as ResumeDocJson}
            onChange={handleSampleChange}
            onSelectionUpdate={handleSelectionUpdate}
            editable={false}
          />
        </div>
        <StylePanel
          styleConfig={styleConfig}
          onChange={onStyleChange}
          activeBlock={activeBlock}
          onActiveBlockChange={setActiveBlock}
          uiLanguage={uiLanguage}
        />
      </div>
      <p aria-live="polite" className="td-style-status">{styleStatus}</p>
    </section>
  );
}
