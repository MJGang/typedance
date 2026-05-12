import { useEffect, useMemo, useState } from "react"
import { createResumeVersion, getTemplateSample, getTemplateStyle, saveTemplateSample, saveTemplateStyle } from "@/api"
import { useNavigate } from "react-router-dom"
import type { TargetLanguage, UiLanguage } from "../../workspace/types"
import { builtInSamples, defaultClassicA4Style, templateRegistry } from "../data"
import type { ResumeTemplateDefinition, TemplateLibraryTab, TemplateSampleContent, TemplateStyleConfig } from "../types"
import { TemplateCard } from "./TemplateCard"
import { TemplateDetail } from "./TemplateDetail"
import { TemplateSampleEditor } from "./TemplateSampleEditor"

type TemplateLibraryProps = {
  uiLanguage: UiLanguage
  targetLanguage: TargetLanguage
}

export function TemplateLibrary({ uiLanguage, targetLanguage }: TemplateLibraryProps) {
  const [activeTab, setActiveTab] = useState<TemplateLibraryTab>("templates")
  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplateDefinition | null>(null)
  const [sample, setSample] = useState<TemplateSampleContent>(builtInSamples["sample-tech-zh"])
  const [styleConfig, setStyleConfig] = useState<TemplateStyleConfig>(defaultClassicA4Style)
  const [sampleStatus, setSampleStatus] = useState("本地默认样张")
  const [styleStatus, setStyleStatus] = useState("本地默认样式")

  const currentTemplate = selectedTemplate ?? templateRegistry[0]
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

  useEffect(() => {
    void getTemplateStyle(currentTemplate.id)
      .then((nextStyle) => { setStyleConfig(nextStyle); setStyleStatus("已读取本地样式"); })
      .catch(() => { setStyleConfig(defaultClassicA4Style); setStyleStatus("使用内置样式"); })
  }, [currentTemplate.id])

  const handleSaveSample = async () => {
    const saved = await saveTemplateSample(visibleSample)
    setSample(saved)
    setSampleStatus("样张已保存")
  }

  const handleStyleChange = (style: TemplateStyleConfig) => {
    setStyleConfig(style)
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

      {activeTab === "templates" && !selectedTemplate ? (
        <section className="td-template-grid">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              sample={visibleSample}
              styleConfig={styleConfig}
              uiLanguage={uiLanguage}
              targetLanguage={targetLanguage}
              onOpen={() => setSelectedTemplate(template)}
              onApply={() => handleApply(template.id)}
            />
          ))}
        </section>
      ) : null}

      {activeTab === "templates" && selectedTemplate ? (
        <TemplateDetail
          template={selectedTemplate}
          sample={visibleSample}
          styleConfig={styleConfig}
          uiLanguage={uiLanguage}
          onBack={() => setSelectedTemplate(null)}
          onStyleChange={handleStyleChange}
          styleStatus={styleStatus}
        />
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
