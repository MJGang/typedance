import { useId, useMemo } from "react"
import type { EditorTransaction } from "@typedance/contracts"
import { generateWorkspaceTemplateCSS } from "@typedance/resume-renderer"
import { ResumeRichTextEditor } from "../workspace/components/ResumeRichTextEditor"
import type { ResumeDocJson } from "../workspace/editor"
import { defaultClassicA4Style } from "../templates/data"
import { documentMargins, documentTemplateStyle } from "./documentLayout"

export default function EditorTransactionPreview({ transaction }: { transaction: EditorTransaction }) {
  const id = `editor-preview-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const doc = transaction.doc_json as ResumeDocJson
  const style = useMemo(() => documentTemplateStyle(doc, transaction.before_template_style ?? defaultClassicA4Style), [doc, transaction.before_template_style])
  const css = useMemo(() => generateWorkspaceTemplateCSS(style, `#${id} .rm-with-pagination`), [style, id])
  return <div id={id} className="max-h-96 overflow-auto rounded-lg border border-border">
    <div className="w-[794px] origin-top-left">
      <ResumeRichTextEditor ariaLabel="修改后的简历预览" docJson={doc} templateStyle={style} cssText={css} marginConfig={documentMargins(doc)} editable={false} toolbarVisible={false} onChange={() => {}} />
    </div>
  </div>
}
