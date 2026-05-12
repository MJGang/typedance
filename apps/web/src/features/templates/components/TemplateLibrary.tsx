import { useEffect, useMemo, useState } from "react"
import { createResumeVersion, getTemplateSample, saveTemplateSample } from "@/api"
import { useNavigate } from "react-router-dom"
import type { TargetLanguage, UiLanguage } from "../../workspace/types"
import { builtInSamples, defaultClassicA4Style, templateRegistry } from "../data"
import type { TemplateLibraryTab, TemplateSampleContent } from "../types"
import { TemplateCard } from "./TemplateCard"
import { TemplateSampleEditor } from "./TemplateSampleEditor"

type TemplateLibraryProps = {
  uiLanguage?: UiLanguage
  targetLanguage?: TargetLanguage
}

export function TemplateLibrary({ uiLanguage = "zh-CN", targetLanguage = "zh-CN" }: TemplateLibraryProps) {
  const [activeTab, setActiveTab] = useState<TemplateLibraryTab>("templates")
  const [sample, setSample] = useState<TemplateSampleContent>(builtInSamples["sample-tech-zh"])
  const [sampleStatus, setSampleStatus] = useState("本地默认样张")

  const currentTemplate = templateRegistry[0]
  const sampleId = currentTemplate.sampleContentIds[targetLanguage] ?? "sample-tech-zh"
  const visibleSample = sample.id === sampleId ? sample : builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"]
  const navigate = useNavigate()

  const handleApply = async (templateId: string) => {
    const sampleId = currentTemplate.sampleContentIds[targetLanguage] ?? "sample-tech-zh"
    const sample = builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"]
    const resume = await createResumeVersion({
      title: "未命名简历",
      target_language: targetLanguage,
      template_id: templateId,
      doc_json: sample.doc_json,
      plain_text_snapshot: sample.plain_text_snapshot,
    })
    navigate(`/workspace/${resume.id}`)
  }

  const templates = useMemo(() => templateRegistry, [])

  useEffect(() => {
    void getTemplateSample(sampleId)
      .then((nextSample) => { setSample(nextSample); setSampleStatus("已读取本地样张"); })
      .catch(() => { setSample(builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"]); setSampleStatus("使用内置样张"); })
  }, [sampleId])

  const handleSaveSample = async () => {
    const saved = await saveTemplateSample(visibleSample)
    setSample(saved)
    setSampleStatus("样张已保存")
  }

  return (
    <main className="td-template-library">
      <header className="td-template-library-heading">
        <div>
          <p className="td-eyebrow">Template Library</p>
          <h1>模板库</h1>
          <p>{templates.length} 个模板 · 样张内容与块级样式配置本地保存</p>
        </div>
      </header>

      <div className="td-template-tabs" role="tablist" aria-label="模板库视图">
        <button type="button" role="tab" aria-selected={activeTab === "templates"} onClick={() => setActiveTab("templates")}>模板列表</button>
        <button type="button" role="tab" aria-selected={activeTab === "samples"} onClick={() => setActiveTab("samples")}>样张内容</button>
      </div>

      {activeTab === "templates" ? (
        <section className="td-template-grid">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              sample={visibleSample}
              styleConfig={defaultClassicA4Style}
              uiLanguage={uiLanguage}
              targetLanguage={targetLanguage}
              onApply={() => handleApply(template.id)}
            />
          ))}
        </section>
      ) : null}

      {activeTab === "samples" ? (
        <TemplateSampleEditor
          sample={visibleSample}
          uiLanguage={uiLanguage}
          status={sampleStatus}
          onChange={setSample}
          onSave={handleSaveSample}
        />
      ) : null}
    </main>
  )
}
