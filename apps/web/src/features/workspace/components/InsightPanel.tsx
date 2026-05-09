import { AlertTriangle, Bot, ChevronDown, ClipboardCheck, ShieldCheck } from "lucide-react"
import type { EvidenceCard, ReviewGateResult, RunState, WorkspaceCopy } from "../types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

type InsightPanelProps = {
  copy: WorkspaceCopy
  text: string
  runState: RunState
  reviewGate: ReviewGateResult
  evidenceCards: EvidenceCard[]
  matchScore: number
  evidenceCoverage: number
}

export function InsightPanel({
  copy,
  text,
  runState,
  reviewGate,
  evidenceCards,
  matchScore,
  evidenceCoverage,
}: InsightPanelProps) {
  const issues = [...reviewGate.blockers, ...reviewGate.warnings]

  return (
    <aside className="td-panel td-insight-panel">
      <section className="td-section">
        <div className="td-section-heading">
          <span className={reviewGate.status === "ready" ? "td-icon-box success" : "td-icon-box attention"}>
            {reviewGate.status === "ready" ? <ShieldCheck /> : <AlertTriangle />}
          </span>
          <div>
            <h2>{copy.reviewGate}</h2>
            <p>{reviewGate.status === "ready" ? "Ready to export" : "Export requires explicit review"}</p>
          </div>
        </div>

        <div className="td-gate-status" data-status={reviewGate.status}>
          <strong>{reviewGate.status.replace("_", " ")}</strong>
          <span>
            {reviewGate.blockers.length} blockers · {reviewGate.warnings.length} warnings
          </span>
        </div>

        {issues.length ? (
          <ul className="td-issue-list">
            {issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
      </section>

      <Separator />

      <section className="td-section">
        <h2>{copy.insights}</h2>
        <div className="td-metric">
          <span>{copy.match}</span>
          <strong>{matchScore}%</strong>
        </div>
        <div className="td-metric">
          <span>{copy.coverage}</span>
          <strong>{evidenceCoverage}%</strong>
        </div>
        <div className="td-metric">
          <span>{copy.risk}</span>
          <strong>{reviewGate.status === "ready" ? "Low" : "Medium"}</strong>
        </div>
      </section>

      <Separator />

      <section className="td-section">
        <h2>{copy.suggestion}</h2>
        <div className="td-suggestion-card">
          <div className="td-run-state">
            <Bot />
            <span aria-live="polite">{runState}</span>
          </div>
          <p>建议把“负责落地”改写为包含范围、证据来源和结果边界的 bullet，避免生成未经证实的新经历。</p>
          <div className="td-suggestion-actions">
            <Button type="button" variant="outline">{copy.accept}</Button>
            <Button type="button" variant="outline">{copy.editAccept}</Button>
            <Button type="button" variant="outline">{copy.rerun}</Button>
            <Button type="button" variant="outline">{copy.reject}</Button>
          </div>
        </div>
      </section>

      <Separator />

      <section className="td-section">
        <h2>Evidence Cards</h2>
        <div className="grid gap-2">
          {evidenceCards.map((card) => (
            <article className="td-evidence-card" key={card.id}>
              <div>
                <Badge variant={card.type === "external_background" ? "secondary" : "outline"}>{card.type}</Badge>
                <strong>{card.title}</strong>
              </div>
              <p>{card.excerpt}</p>
              <small>{card.confidence.replace("_", " ")}</small>
            </article>
          ))}
        </div>
      </section>

      <Separator />

      <section className="td-section">
        <Button type="button" variant="outline" className="w-full justify-between">
          <ClipboardCheck data-icon="inline-start" />
          {copy.contextPreview}
          <ChevronDown data-icon="inline-end" />
        </Button>
        <dl className="td-context-list">
          <dt>Selected text</dt>
          <dd>{text.split("\n").filter(Boolean).slice(2, 4).join(" ")}</dd>
          <dt>Evidence sent</dt>
          <dd>{evidenceCards.filter((card) => card.type !== "external_background").length} cards, 0 secrets removed</dd>
          <dt>Provider</dt>
          <dd>Local preview · cloud confirmation required</dd>
        </dl>
      </section>
    </aside>
  )
}
