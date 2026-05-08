import { FileDown, HardDrive, Plus } from "lucide-react";
import { useState } from "react";
import type { ResumeVersion } from "@typedance/contracts";
import { renderResumeHtml } from "@typedance/resume-renderer";
import { createResumeVersion, exportResumePdf } from "./api";
import "./styles.css";

function makeDraftResume(snapshot: string): ResumeVersion {
  const now = new Date().toISOString();
  return {
    id: "draft",
    title: "我的目标岗位简历",
    target_language: "zh-CN",
    template_id: "classic-a4",
    doc_json: { type: "doc", content: [] },
    plain_text_snapshot: snapshot,
    source_refs: [],
    accepted_edit_ids: [],
    created_at: now,
    updated_at: now
  };
}

export function App() {
  const [text, setText] = useState("张三\n全栈开发者\n\n负责 TypeDance 首版简历工作台的产品与工程落地。");
  const [savedResume, setSavedResume] = useState<ResumeVersion | null>(null);
  const [status, setStatus] = useState("Local draft");
  const resume = makeDraftResume(text);
  const preview = renderResumeHtml(savedResume ?? resume);

  async function handleCreateVersion() {
    setStatus("Saving...");
    const created = await createResumeVersion({
      title: resume.title,
      target_language: resume.target_language,
      template_id: resume.template_id,
      doc_json: resume.doc_json,
      plain_text_snapshot: resume.plain_text_snapshot
    });
    setSavedResume(created);
    setStatus(`Saved ${created.id.slice(0, 14)}`);
  }

  async function handleExportPdf() {
    if (!savedResume) {
      await handleCreateVersion();
      setStatus("Saved. Export again.");
      return;
    }
    setStatus("Exporting PDF...");
    const exported = await exportResumePdf(savedResume.id);
    setStatus(`Exported ${exported.file_path}`);
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <strong>TypeDance</strong>
        <span className="local"><HardDrive size={16} /> {status}</span>
        <button type="button" onClick={handleCreateVersion}>
          <Plus size={16} /> Save version
        </button>
        <button type="button" onClick={handleExportPdf}>
          <FileDown size={16} /> Export PDF
        </button>
      </header>
      <aside className="rail">
        <h2>目标岗位</h2>
        <p>先粘贴 JD，下一阶段会接入岗位解析、关键词和匹配评分。</p>
        <dl>
          <dt>Version</dt>
          <dd>{savedResume?.id ?? "Draft"}</dd>
          <dt>Language</dt>
          <dd>{resume.target_language}</dd>
        </dl>
      </aside>
      <section className="editor">
        <textarea aria-label="Resume text" value={text} onChange={(event) => setText(event.target.value)} />
      </section>
      <aside className="insights">
        <h2>质量概览</h2>
        <p>Slice 1 检查可编辑、可预览、可保存和可导出。证据链与 Review Gate 将在后续切片加入。</p>
        <div className="metric">
          <span>Editable</span>
          <strong>Ready</strong>
        </div>
        <div className="metric">
          <span>A4 Preview</span>
          <strong>Ready</strong>
        </div>
      </aside>
      <section className="preview" aria-label="A4 resume preview">
        <iframe title="A4 resume preview" srcDoc={preview} />
      </section>
    </main>
  );
}
