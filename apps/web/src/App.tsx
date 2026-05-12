import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createResumeVersion, exportResumePdf } from "./api"
import { computeReviewGate, copy, evidenceCards, initialResumeText, jobTarget, makeDraftResume } from "./features/workspace/data"
import { makeResumeDocFromText, type ResumeEditorChange } from "./features/workspace/editor"
import { getSavedPreference, getSystemPrefersDark, resolveTheme } from "./features/workspace/theme"
import type { RunState, TargetLanguage, ThemePreference, UiLanguage, WorkspaceSection } from "./features/workspace/types"
import { WorkspaceLayout } from "./features/workspace/components/WorkspaceLayout"
import { JobTargetPanel } from "./features/workspace/components/JobTargetPanel"
import { ResumeCanvas } from "./features/workspace/components/ResumeCanvas"
import { InsightPanel } from "./features/workspace/components/InsightPanel"
import { QuickActions } from "./features/workspace/components/QuickActions"
import { TemplateLibrary } from "./features/templates/components/TemplateLibrary"
import "./styles.css"
import type { ResumeVersion } from "@typedance/contracts"

export function App() {
  const [text, setText] = useState(initialResumeText)
  const [docJson, setDocJson] = useState(() => makeResumeDocFromText(initialResumeText))
  const [savedResume, setSavedResume] = useState<ResumeVersion | null>(null)
  const [status, setStatus] = useState("Local draft")
  const [runState, setRunState] = useState<RunState>("waiting_user_confirmation")
  const [uiLanguage, setUiLanguage] = useState<UiLanguage>(() =>
    getSavedPreference("typedance.uiLanguage", "zh-CN", ["zh-CN", "en-US"])
  )
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>("zh-CN")
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    getSavedPreference("typedance.theme", "system", ["light", "dark", "system"])
  )
  const [systemPrefersDark, setSystemPrefersDark] = useState(getSystemPrefersDark)
  const [activeSection, setActiveSection] = useState<WorkspaceSection>("workspace")
  const [isJobPanelOpen, setIsJobPanelOpen] = useState(true)

  const t = copy[uiLanguage]
  const draftKey = useMemo(() => JSON.stringify({ text, docJson, targetLanguage }), [docJson, targetLanguage, text])
  const draftKeyRef = useRef(draftKey)
  const resume = useMemo(() => makeDraftResume(text, targetLanguage, docJson), [docJson, targetLanguage, text])
  const previewPdfUrl = savedResume?.preview_pdf_url ?? null
  const reviewGate = useMemo(() => computeReviewGate(text), [text])
  const resolvedTheme = resolveTheme(themePreference, systemPrefersDark)
  const evidenceCoverage = Math.round((evidenceCards.filter((card) => card.type !== "external_background").length / 4) * 100)

  useEffect(() => {
    draftKeyRef.current = draftKey
  }, [draftKey])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.classList.toggle("dark", resolvedTheme === "dark")
  }, [resolvedTheme])

  useEffect(() => {
    window.localStorage.setItem("typedance.theme", themePreference)
  }, [themePreference])

  useEffect(() => {
    window.localStorage.setItem("typedance.uiLanguage", uiLanguage)
  }, [uiLanguage])

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return undefined
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches)
    media.addEventListener("change", handleChange)
    return () => media.removeEventListener("change", handleChange)
  }, [])

  const handleCreateVersion = useCallback(async () => {
    const requestDraftKey = draftKey
    setStatus("Saving...")
    const created = await createResumeVersion({
      title: resume.title,
      target_language: resume.target_language,
      template_id: resume.template_id,
      doc_json: resume.doc_json,
      plain_text_snapshot: resume.plain_text_snapshot,
    })

    if (draftKeyRef.current !== requestDraftKey) {
      setStatus("Saved older draft; current draft has changed.")
      return null
    }

    setSavedResume(created)
    setStatus(`Saved ${created.id.slice(0, 14)}`)
    return created
  }, [draftKey, resume])

  const handleExportPdf = useCallback(async () => {
    if (!savedResume) {
      const created = await handleCreateVersion()
      if (created) {
        setStatus("Saved. Export again after Review Gate.")
      }
      return
    }

    setStatus("Exporting PDF...")
    const exported = await exportResumePdf(savedResume.id)
    // Update savedResume so A4 preview points to the latest PDF
    setSavedResume((prev) =>
      prev
        ? { ...prev, preview_pdf_path: exported.file_path, preview_pdf_url: exported.preview_pdf_url }
        : prev,
    )
    setStatus(`Exported ${exported.file_path}`)
  }, [handleCreateVersion, savedResume])

  const handleRunAction = useCallback(() => {
    setRunState("running")
    window.setTimeout(() => setRunState("completed"), 700)
  }, [])

  const handleEditorChange = useCallback((change: ResumeEditorChange) => {
    setText(change.plainText)
    setDocJson(change.docJson)
    setSavedResume(null)
    setRunState("waiting_user_confirmation")
  }, [])

  const handleTargetLanguageChange = useCallback((language: TargetLanguage) => {
    setSavedResume(null)
    setRunState("waiting_user_confirmation")
    setTargetLanguage(language)
  }, [])

  const handleToggleJobPanel = useCallback(() => {
    setIsJobPanelOpen((isOpen) => !isOpen)
  }, [])

  return (
    <WorkspaceLayout
      copy={t}
      activeSection={activeSection}
      status={status}
      reviewGate={reviewGate}
      onSectionChange={setActiveSection}
      onSave={handleCreateVersion}
      onExport={handleExportPdf}
      settings={{
        copy: t,
        uiLanguage,
        themePreference,
        onUiLanguageChange: setUiLanguage,
        onThemePreferenceChange: setThemePreference,
      }}
    >
      {activeSection === "templates" ? (
        <TemplateLibrary uiLanguage={uiLanguage} targetLanguage={targetLanguage} />
      ) : (
        <main className="td-workspace-shell" data-job-panel={isJobPanelOpen ? "open" : "closed"}>
          <JobTargetPanel copy={t} jobTarget={jobTarget} isOpen={isJobPanelOpen} />
          <ResumeCanvas
            copy={t}
            docJson={docJson}
            previewPdfUrl={previewPdfUrl}
            title={savedResume?.title ?? resume.title}
            targetLanguage={targetLanguage}
            reviewGate={reviewGate}
            isJobPanelOpen={isJobPanelOpen}
            onEditorChange={handleEditorChange}
            onTargetLanguageChange={handleTargetLanguageChange}
            onRunAction={handleRunAction}
            onToggleJobPanel={handleToggleJobPanel}
          />
          <InsightPanel
            copy={t}
            text={text}
            runState={runState}
            reviewGate={reviewGate}
            evidenceCards={evidenceCards}
            matchScore={jobTarget.matchScore}
            evidenceCoverage={evidenceCoverage}
          />
          <QuickActions />
        </main>
      )}
    </WorkspaceLayout>
  )
}
