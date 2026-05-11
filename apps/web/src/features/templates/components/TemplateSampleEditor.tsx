import { Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ResumeDocJson, ResumeEditorChange } from "../../workspace/editor"
import { ResumeRichTextEditor } from "../../workspace/components/ResumeRichTextEditor"
import type { UiLanguage } from "../../workspace/types"
import type { TemplateSampleContent } from "../types"

type TemplateSampleEditorProps = {
  sample: TemplateSampleContent
  uiLanguage: UiLanguage
  status: string
  onChange: (sample: TemplateSampleContent) => void
  onSave: () => void
}

export function TemplateSampleEditor({
  sample,
  uiLanguage,
  status,
  onChange,
  onSave,
}: TemplateSampleEditorProps) {
  const handleChange = (change: ResumeEditorChange) => {
    onChange({
      ...sample,
      doc_json: change.docJson,
      plain_text_snapshot: change.plainText,
    })
  }

  return (
    <section className="td-template-sample-editor">
      <div className="td-template-library-heading">
        <div>
          <p className="td-eyebrow">Template sample</p>
          <h2>样张内容</h2>
        </div>
        <Button type="button" onClick={onSave}>
          <Save data-icon="inline-start" />
          保存样张
        </Button>
      </div>
      <p>{sample.name[uiLanguage]} 会用于模板库缩略图和详情预览，不会修改当前简历。</p>
      <ResumeRichTextEditor
        ariaLabel="Template sample content"
        docJson={sample.doc_json as ResumeDocJson}
        onChange={handleChange}
      />
      <p aria-live="polite">{status}</p>
    </section>
  )
}
