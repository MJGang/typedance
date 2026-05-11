import type { TemplateSampleContent, TemplateStyleConfig } from "../types";
import { generateFullCSS } from "../style-engine/css-generator";

type TemplatePreviewProps = {
  sample: TemplateSampleContent;
  styleConfig: TemplateStyleConfig;
  scale?: "card" | "detail";
};

type TemplateNode = {
  type?: string;
  text?: string;
  attrs?: { level?: number };
  marks?: { type?: string }[];
  content?: TemplateNode[];
};

function nodeBlockType(node: TemplateNode): string {
  if (node.type === "heading") {
    const level = node.attrs?.level ?? 2;
    if (level >= 1 && level <= 3) return `heading${level}`;
    return "paragraph";
  }
  if (node.type === "bulletList") return "bulletList";
  if (node.type === "orderedList") return "orderedList";
  return "paragraph";
}

export function TemplatePreview({ sample, styleConfig, scale = "card" }: TemplatePreviewProps) {
  const cssText = generateFullCSS(styleConfig.blocks ?? {});
  const content = Array.isArray(sample.doc_json.content) ? (sample.doc_json.content as TemplateNode[]) : [];

  return (
    <div className={`td-template-preview td-template-preview-${scale}`}>
      <style>{cssText}</style>
      <article className="td-template-paper" aria-label="A4 template sample preview">
        {content.map((node, index) => renderNode(node, `${node.type ?? "node"}-${index}`))}
      </article>
    </div>
  );
}

function renderNode(node: TemplateNode, key: string) {
  const text = collectText(node);
  const blockClass = `td-resume-${nodeBlockType(node)}`;

  if (node.type === "heading") {
    const level = node.attrs?.level ?? 2;
    const Tag = level === 1 ? "h3" : level === 2 ? "h4" : "h5";
    return <Tag key={key} className={blockClass}>{text}</Tag>;
  }

  if (node.type === "bulletList" || node.type === "orderedList") {
    const Tag = node.type === "bulletList" ? "ul" : "ol";
    return (
      <Tag key={key} className={blockClass}>
        {(node.content ?? []).map((item, index) => (
          <li key={`${key}-${index}`} className={blockClass}>{collectText(item)}</li>
        ))}
      </Tag>
    );
  }

  return <p key={key} className={blockClass}>{text}</p>;
}

function collectText(node: TemplateNode): string {
  if (typeof node.text === "string") return node.text;
  return (node.content ?? []).map(collectText).filter(Boolean).join("");
}
