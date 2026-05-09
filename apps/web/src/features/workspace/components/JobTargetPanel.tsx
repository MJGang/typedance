import { CheckCircle2, SearchCheck } from "lucide-react"
import type { JobTarget, WorkspaceCopy } from "../types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

type JobTargetPanelProps = {
  copy: WorkspaceCopy
  jobTarget: JobTarget
  isOpen: boolean
}

export function JobTargetPanel({ copy, jobTarget, isOpen }: JobTargetPanelProps) {
  return (
    <aside id="job-target-panel" className="td-panel td-job-panel" aria-hidden={!isOpen}>
      <section className="td-section">
        <div className="td-section-heading">
          <span className="td-icon-box">
            <SearchCheck />
          </span>
          <div>
            <h2>{copy.jobRailTitle}</h2>
            <p>{copy.jobRailDescription}</p>
          </div>
        </div>

        <div className="td-job-card">
          <div>
            <h3>{jobTarget.title}</h3>
            <p>{jobTarget.company}</p>
          </div>
          <strong>{jobTarget.matchScore}%</strong>
        </div>

        <div className="td-compact-grid">
          <div>
            <span>Salary</span>
            <strong>{jobTarget.salary}</strong>
          </div>
          <div>
            <span>Experience</span>
            <strong>{jobTarget.experience}</strong>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {jobTarget.keywords.map((keyword) => (
            <Badge key={keyword} variant="outline">
              {keyword}
            </Badge>
          ))}
        </div>
      </section>

      <Separator />

      <section className="td-section">
        <h3>{copy.requirements}</h3>
        <ul className="td-check-list">
          {jobTarget.requirements.map((requirement) => (
            <li key={requirement}>
              <CheckCircle2 />
              {requirement}
            </li>
          ))}
        </ul>
      </section>

      <Separator />

      <section className="td-section">
        <h3>{copy.versions}</h3>
        <div className="grid gap-2">
          <Button type="button" variant="secondary" className="justify-between">
            <span>全栈工程师 · 当前</span>
            <span>Ready soon</span>
          </Button>
          <Button type="button" variant="outline" className="justify-between">
            <span>产品工程师 · 草稿</span>
            <span>62%</span>
          </Button>
        </div>
      </section>
    </aside>
  )
}
