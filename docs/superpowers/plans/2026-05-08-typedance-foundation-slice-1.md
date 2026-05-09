# TypeDance Foundation Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the initial TypeDance monorepo and deliver Slice 1: users can create or edit a resume, see an A4 preview, persist it locally through the sidecar, and export a controlled PDF artifact.

**Architecture:** Use the structure already proposed in `docs/engineering-plan.md`: `apps/web` owns the React workspace UI, `services/sidecar` owns local persistence and PDF rendering APIs, and `packages/contracts` defines the shared JSON Schemas that drive generated TypeScript and Python models. Tauri is represented by a scaffolded `apps/desktop` shell configuration in this slice, but full installer packaging waits until the web and sidecar are demonstrably useful.

**Tech Stack:** pnpm workspaces, Vite, React, TypeScript, Vitest, Playwright, FastAPI, Pydantic, SQLite, pytest, WeasyPrint, JSON Schema, Tauri 2 configuration.

---

## File Structure

- Create `package.json`: root scripts for install, lint, test, dev, and build.
- Create `pnpm-workspace.yaml`: workspace package discovery.
- Create `apps/web`: Vite React app with workspace shell, editor state, A4 preview, API client, and tests.
- Create `apps/desktop/src-tauri`: Tauri 2 scaffold, sidecar binary allow-list, and desktop command boundary documentation.
- Create `services/sidecar`: FastAPI app, SQLite repository, PDF rendering pipeline, and pytest suite.
- Create `packages/contracts`: JSON Schemas for `ResumeVersion`, `PDFExport`, and generated TypeScript/Python type entrypoints.
- Create `packages/resume-renderer`: shared HTML/CSS resume rendering helpers used by preview and PDF export.
- Modify `docs/README.md`: link the implementation plan and state Slice 1 scope.

## Scope Lock

This plan implements Slice 0 and Slice 1 from `docs/engineering-plan.md`.

It intentionally does not implement AI rewrite, Evidence Vault, Job Target parsing, Review Gate, provider configuration, PDF import, or full Tauri installer packaging. The data boundaries leave room for those slices without building UI or service complexity before it is needed.

### Task 1: Root Workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.gitignore`
- Modify: `docs/README.md`

- [ ] **Step 1: Add the root workspace manifest**

Create `package.json`:

```json
{
  "name": "typedance",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@10.11.0",
  "scripts": {
    "dev": "pnpm --parallel --filter @typedance/web --filter @typedance/sidecar dev",
    "build": "pnpm --filter @typedance/contracts build && pnpm --filter @typedance/resume-renderer build && pnpm --filter @typedance/web build",
    "test": "pnpm --filter @typedance/contracts test && pnpm --filter @typedance/resume-renderer test && pnpm --filter @typedance/web test && pnpm --filter @typedance/sidecar test",
    "lint": "pnpm --filter @typedance/web lint"
  },
  "devDependencies": {
    "@playwright/test": "^1.52.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 2: Add workspace discovery**

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
  - "packages/*"
  - "services/*"
```

- [ ] **Step 3: Add ignores**

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
.vite/
.pytest_cache/
__pycache__/
*.pyc
.venv/
services/sidecar/.typedance-dev/
apps/desktop/src-tauri/target/
apps/desktop/src-tauri/gen/
```

- [ ] **Step 4: Update docs index**

Append this section to `docs/README.md`:

```markdown

## 当前实施计划

- `superpowers/plans/2026-05-08-typedance-foundation-slice-1.md`
  - Slice 0 + Slice 1 工程落地计划。
  - 目标是先完成可运行的本地优先简历编辑、A4 预览、sidecar 持久化和 PDF 导出闭环。
```

- [ ] **Step 5: Verify the workspace manifest**

Run: `pnpm install --lockfile-only`

Expected: `pnpm-lock.yaml` is created and no workspace package resolution errors are reported.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml .gitignore docs/README.md pnpm-lock.yaml
git commit -m "chore: initialize typedance workspace"
```

### Task 2: Shared Contracts

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/schemas/resume-version.schema.json`
- Create: `packages/contracts/schemas/pdf-export.schema.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/contracts/tests/contracts.test.ts`

- [ ] **Step 1: Create package manifest**

Create `packages/contracts/package.json`:

```json
{
  "name": "@typedance/contracts",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "vitest": "^3.1.3"
  }
}
```

- [ ] **Step 2: Add TypeScript config**

Create `packages/contracts/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "declaration": true,
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Add ResumeVersion schema**

Create `packages/contracts/schemas/resume-version.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://typedance.local/schemas/resume-version.schema.json",
  "title": "ResumeVersion",
  "type": "object",
  "required": ["id", "title", "target_language", "template_id", "doc_json", "plain_text_snapshot", "created_at", "updated_at"],
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "title": { "type": "string", "minLength": 1 },
    "job_target_id": { "type": ["string", "null"] },
    "target_language": { "type": "string", "enum": ["zh-CN", "en-US"] },
    "template_id": { "type": "string", "minLength": 1 },
    "doc_json": { "type": "object" },
    "plain_text_snapshot": { "type": "string" },
    "source_refs": { "type": "array", "items": { "type": "string" } },
    "accepted_edit_ids": { "type": "array", "items": { "type": "string" } },
    "created_at": { "type": "string", "format": "date-time" },
    "updated_at": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

- [ ] **Step 4: Add PDFExport schema**

Create `packages/contracts/schemas/pdf-export.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://typedance.local/schemas/pdf-export.schema.json",
  "title": "PDFExport",
  "type": "object",
  "required": ["id", "resume_version_id", "file_path", "language", "layout_status", "created_at"],
  "properties": {
    "id": { "type": "string", "minLength": 1 },
    "resume_version_id": { "type": "string", "minLength": 1 },
    "review_gate_result_id": { "type": ["string", "null"] },
    "file_path": { "type": "string", "minLength": 1 },
    "language": { "type": "string", "enum": ["zh-CN", "en-US"] },
    "layout_profile": { "type": "string", "enum": ["single-page-a4", "multi-page-a4"] },
    "layout_status": { "type": "string", "enum": ["ready", "overflow", "render_failed"] },
    "created_at": { "type": "string", "format": "date-time" }
  },
  "additionalProperties": false
}
```

- [ ] **Step 5: Add runtime TypeScript contracts**

Create `packages/contracts/src/index.ts`:

```ts
import { z } from "zod";

export const languageSchema = z.enum(["zh-CN", "en-US"]);

export const resumeVersionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  job_target_id: z.string().nullable().optional(),
  target_language: languageSchema,
  template_id: z.string().min(1),
  doc_json: z.record(z.unknown()),
  plain_text_snapshot: z.string(),
  source_refs: z.array(z.string()).default([]),
  accepted_edit_ids: z.array(z.string()).default([]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime()
});

export const pdfExportSchema = z.object({
  id: z.string().min(1),
  resume_version_id: z.string().min(1),
  review_gate_result_id: z.string().nullable().optional(),
  file_path: z.string().min(1),
  language: languageSchema,
  layout_profile: z.enum(["single-page-a4", "multi-page-a4"]).default("single-page-a4"),
  layout_status: z.enum(["ready", "overflow", "render_failed"]),
  created_at: z.string().datetime()
});

export type ResumeVersion = z.infer<typeof resumeVersionSchema>;
export type PDFExport = z.infer<typeof pdfExportSchema>;
```

- [ ] **Step 6: Write contract tests**

Create `packages/contracts/tests/contracts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resumeVersionSchema } from "../src/index";

describe("resumeVersionSchema", () => {
  it("accepts a minimal valid resume version", () => {
    const parsed = resumeVersionSchema.parse({
      id: "resume_1",
      title: "Backend Engineer Resume",
      target_language: "en-US",
      template_id: "classic-a4",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "",
      created_at: "2026-05-08T08:00:00.000Z",
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(parsed.source_refs).toEqual([]);
    expect(parsed.accepted_edit_ids).toEqual([]);
  });
});
```

- [ ] **Step 7: Verify contracts**

Run: `pnpm --filter @typedance/contracts test`

Expected: one passing Vitest suite.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts
git commit -m "feat: add shared resume contracts"
```

### Task 3: Sidecar API and Persistence

**Files:**
- Create: `services/sidecar/package.json`
- Create: `services/sidecar/pyproject.toml`
- Create: `services/sidecar/src/typedance_sidecar/main.py`
- Create: `services/sidecar/src/typedance_sidecar/db.py`
- Create: `services/sidecar/src/typedance_sidecar/models.py`
- Create: `services/sidecar/tests/test_resume_versions.py`

- [ ] **Step 1: Add sidecar package manifest for workspace scripts**

Create `services/sidecar/package.json`:

```json
{
  "name": "@typedance/sidecar",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "uvicorn typedance_sidecar.main:app --reload --app-dir src --port 4317",
    "test": "pytest"
  }
}
```

- [ ] **Step 2: Add Python project config**

Create `services/sidecar/pyproject.toml`:

```toml
[project]
name = "typedance-sidecar"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115.0",
  "pydantic>=2.7.0",
  "uvicorn>=0.30.0",
  "weasyprint>=62.0"
]

[project.optional-dependencies]
dev = ["pytest>=8.2.0", "httpx>=0.27.0"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["src"]
```

- [ ] **Step 3: Add Pydantic models**

Create `services/sidecar/src/typedance_sidecar/models.py`:

```py
from datetime import datetime, timezone
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field


Language = Literal["zh-CN", "en-US"]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class ResumeVersionCreate(BaseModel):
    title: str = Field(min_length=1)
    target_language: Language = "zh-CN"
    template_id: str = "classic-a4"
    doc_json: dict[str, Any] = Field(default_factory=lambda: {"type": "doc", "content": []})
    plain_text_snapshot: str = ""


class ResumeVersion(BaseModel):
    id: str
    title: str
    job_target_id: str | None = None
    target_language: Language
    template_id: str
    doc_json: dict[str, Any]
    plain_text_snapshot: str
    source_refs: list[str] = Field(default_factory=list)
    accepted_edit_ids: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str

    @classmethod
    def new(cls, payload: ResumeVersionCreate) -> "ResumeVersion":
        now = utc_now()
        return cls(id=f"resume_{uuid4().hex}", created_at=now, updated_at=now, **payload.model_dump())
```

- [ ] **Step 4: Add SQLite repository**

Create `services/sidecar/src/typedance_sidecar/db.py`:

```py
import json
import sqlite3
from pathlib import Path

from .models import ResumeVersion


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS resume_versions (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    return connection


class ResumeRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    def list(self) -> list[ResumeVersion]:
        rows = self.connection.execute(
            "SELECT payload FROM resume_versions ORDER BY updated_at DESC"
        ).fetchall()
        return [ResumeVersion.model_validate(json.loads(row["payload"])) for row in rows]

    def save(self, resume: ResumeVersion) -> ResumeVersion:
        payload = resume.model_dump_json()
        self.connection.execute(
            """
            INSERT INTO resume_versions (id, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
            """,
            (resume.id, payload, resume.updated_at),
        )
        self.connection.commit()
        return resume
```

- [ ] **Step 5: Add FastAPI app**

Create `services/sidecar/src/typedance_sidecar/main.py`:

```py
import os
from pathlib import Path

from fastapi import Depends, FastAPI

from .db import ResumeRepository, connect
from .models import ResumeVersion, ResumeVersionCreate


app = FastAPI(title="TypeDance Sidecar", version="0.1.0")


def app_data_dir() -> Path:
    override = os.environ.get("TYPEDANCE_DATA_DIR")
    if override:
        return Path(override)
    return Path.home() / ".typedance"


def resume_repository() -> ResumeRepository:
    return ResumeRepository(connect(app_data_dir() / "typedance.sqlite"))


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": "0.1.0"}


@app.get("/resume-versions", response_model=list[ResumeVersion])
def list_resume_versions(repo: ResumeRepository = Depends(resume_repository)) -> list[ResumeVersion]:
    return repo.list()


@app.post("/resume-versions", response_model=ResumeVersion, status_code=201)
def create_resume_version(
    payload: ResumeVersionCreate,
    repo: ResumeRepository = Depends(resume_repository),
) -> ResumeVersion:
    resume = ResumeVersion.new(payload)
    return repo.save(resume)
```

- [ ] **Step 6: Write sidecar tests**

Create `services/sidecar/tests/test_resume_versions.py`:

```py
from fastapi.testclient import TestClient

from typedance_sidecar.main import app


def test_create_and_list_resume_versions(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.post(
        "/resume-versions",
        json={"title": "Frontend Engineer", "target_language": "en-US"},
    )

    assert response.status_code == 201
    created = response.json()
    assert created["title"] == "Frontend Engineer"
    assert created["target_language"] == "en-US"

    list_response = client.get("/resume-versions")

    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [created["id"]]
```

- [ ] **Step 7: Verify sidecar**

Run: `cd services/sidecar && python -m pip install -e ".[dev]" && pytest`

Expected: `test_create_and_list_resume_versions` passes.

- [ ] **Step 8: Commit**

```bash
git add services/sidecar
git commit -m "feat: add sidecar resume persistence"
```

### Task 4: Resume Renderer

**Files:**
- Create: `packages/resume-renderer/package.json`
- Create: `packages/resume-renderer/tsconfig.json`
- Create: `packages/resume-renderer/src/index.ts`
- Create: `packages/resume-renderer/tests/render.test.ts`

- [ ] **Step 1: Create renderer package**

Create `packages/resume-renderer/package.json`:

```json
{
  "name": "@typedance/resume-renderer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@typedance/contracts": "workspace:*"
  },
  "devDependencies": {
    "vitest": "^3.1.3"
  }
}
```

- [ ] **Step 2: Add TypeScript config**

Create `packages/resume-renderer/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "declaration": true,
    "outDir": "dist",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Add controlled HTML renderer**

Create `packages/resume-renderer/src/index.ts`:

```ts
import type { ResumeVersion } from "@typedance/contracts";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderResumeHtml(resume: ResumeVersion): string {
  const lines = resume.plain_text_snapshot
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const body = lines.length
    ? lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")
    : "<p class=\"muted\">Start writing your resume.</p>";

  return `<!doctype html>
<html lang="${resume.target_language}">
  <head>
    <meta charset="utf-8" />
    <style>
      @page { size: A4; margin: 18mm; }
      body { font-family: Arial, "Noto Sans SC", sans-serif; color: #1f2933; line-height: 1.45; }
      h1 { font-size: 22px; margin: 0 0 12px; }
      p { margin: 0 0 8px; font-size: 11px; }
      .muted { color: #697586; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(resume.title)}</h1>
    ${body}
  </body>
</html>`;
}
```

- [ ] **Step 4: Write renderer test**

Create `packages/resume-renderer/tests/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderResumeHtml } from "../src/index";

describe("renderResumeHtml", () => {
  it("escapes resume text before rendering", () => {
    const html = renderResumeHtml({
      id: "resume_1",
      title: "A < B",
      target_language: "en-US",
      template_id: "classic-a4",
      doc_json: {},
      plain_text_snapshot: "Built <secure> export",
      source_refs: [],
      accepted_edit_ids: [],
      created_at: "2026-05-08T08:00:00.000Z",
      updated_at: "2026-05-08T08:00:00.000Z"
    });

    expect(html).toContain("A &lt; B");
    expect(html).toContain("Built &lt;secure&gt; export");
  });
});
```

- [ ] **Step 5: Verify renderer**

Run: `pnpm --filter @typedance/resume-renderer test`

Expected: one passing Vitest suite.

- [ ] **Step 6: Commit**

```bash
git add packages/resume-renderer
git commit -m "feat: add controlled resume renderer"
```

### Task 5: Web Workspace UI

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/api.ts`
- Create: `apps/web/src/App.test.tsx`
- Create: `apps/web/src/styles.css`

- [ ] **Step 1: Create Vite package**

Create `apps/web/package.json`:

```json
{
  "name": "@typedance/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1 --port 5173",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "lint": "eslint src --ext ts,tsx"
  },
  "dependencies": {
    "@typedance/contracts": "workspace:*",
    "@typedance/resume-renderer": "workspace:*",
    "@vitejs/plugin-react": "^4.4.1",
    "vite": "^6.3.5",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "lucide-react": "^0.511.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.3.0",
    "@testing-library/jest-dom": "^6.6.3",
    "@types/react": "^19.1.3",
    "@types/react-dom": "^19.1.3",
    "eslint": "^9.26.0",
    "typescript": "^5.8.3",
    "vitest": "^3.1.3"
  }
}
```

- [ ] **Step 2: Add HTML entry**

Create `apps/web/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TypeDance</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Add API client**

Create `apps/web/src/api.ts`:

```ts
import { resumeVersionSchema, type ResumeVersion } from "@typedance/contracts";

const baseUrl = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:4317";

export async function createResumeVersion(title: string): Promise<ResumeVersion> {
  const response = await fetch(`${baseUrl}/resume-versions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, target_language: "zh-CN" })
  });

  if (!response.ok) {
    throw new Error(`Failed to create resume: ${response.status}`);
  }

  return resumeVersionSchema.parse(await response.json());
}
```

- [ ] **Step 4: Add app shell**

Create `apps/web/src/App.tsx`:

```tsx
import { FileDown, HardDrive, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { ResumeVersion } from "@typedance/contracts";
import { renderResumeHtml } from "@typedance/resume-renderer";
import { createResumeVersion } from "./api";
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
  const [status, setStatus] = useState("Local draft");
  const resume = useMemo(() => makeDraftResume(text), [text]);
  const preview = useMemo(() => renderResumeHtml(resume), [resume]);

  async function handleCreateVersion() {
    const created = await createResumeVersion(resume.title);
    setStatus(`Saved ${created.id}`);
  }

  return (
    <main className="workspace">
      <header className="topbar">
        <strong>TypeDance</strong>
        <span className="local"><HardDrive size={16} /> {status}</span>
        <button type="button" onClick={handleCreateVersion}>
          <Plus size={16} /> Save version
        </button>
        <button type="button">
          <FileDown size={16} /> Export PDF
        </button>
      </header>
      <aside className="rail">
        <h2>目标岗位</h2>
        <p>先粘贴 JD，Slice 2 会接入岗位解析。</p>
      </aside>
      <section className="editor">
        <textarea aria-label="Resume text" value={text} onChange={(event) => setText(event.target.value)} />
      </section>
      <aside className="insights">
        <h2>质量概览</h2>
        <p>当前 Slice 仅检查可编辑、可预览、可保存。</p>
      </aside>
      <section className="preview" aria-label="A4 resume preview">
        <iframe title="A4 resume preview" srcDoc={preview} />
      </section>
    </main>
  );
}
```

- [ ] **Step 5: Add React entry**

Create `apps/web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 6: Add focused workspace styling**

Create `apps/web/src/styles.css`:

```css
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, "Noto Sans SC", system-ui, sans-serif; color: #17202a; background: #eef1f4; }
button { display: inline-flex; align-items: center; gap: 6px; border: 1px solid #c5ccd5; background: #fff; color: #17202a; min-height: 34px; padding: 0 10px; border-radius: 6px; }
.workspace { min-height: 100vh; display: grid; grid-template-columns: 300px minmax(360px, 1fr) 340px; grid-template-rows: 56px 1fr 280px; }
.topbar { grid-column: 1 / -1; display: flex; align-items: center; gap: 14px; padding: 0 16px; border-bottom: 1px solid #d9dee5; background: #fff; }
.topbar strong { font-size: 17px; }
.topbar button:last-child { margin-left: auto; background: #17202a; color: #fff; border-color: #17202a; }
.local { display: inline-flex; align-items: center; gap: 6px; color: #566371; font-size: 13px; }
.rail, .insights { padding: 16px; background: #f8fafc; border-right: 1px solid #d9dee5; }
.insights { border-right: 0; border-left: 1px solid #d9dee5; }
.rail h2, .insights h2 { font-size: 14px; margin: 0 0 10px; }
.rail p, .insights p { font-size: 13px; line-height: 1.5; color: #566371; }
.editor { padding: 18px; }
textarea { width: 100%; height: 100%; resize: none; border: 1px solid #c5ccd5; border-radius: 6px; padding: 14px; font: 14px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
.preview { grid-column: 2 / 3; padding: 0 18px 18px; }
iframe { width: 100%; height: 100%; border: 1px solid #c5ccd5; background: white; border-radius: 4px; }
@media (max-width: 900px) {
  .workspace { grid-template-columns: 1fr; grid-template-rows: 56px auto 360px auto 320px; }
  .rail, .insights, .preview { grid-column: 1; }
}
```

- [ ] **Step 7: Add smoke test**

Create `apps/web/src/App.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("renders the resume workspace instead of a landing page", () => {
    render(<App />);

    expect(screen.getByText("TypeDance")).toBeInTheDocument();
    expect(screen.getByLabelText("Resume text")).toBeInTheDocument();
    expect(screen.getByLabelText("A4 resume preview")).toBeInTheDocument();
  });
});
```

- [ ] **Step 8: Verify web app**

Run: `pnpm --filter @typedance/web test && pnpm --filter @typedance/web build`

Expected: tests pass and Vite emits a production build in `apps/web/dist`.

- [ ] **Step 9: Commit**

```bash
git add apps/web
git commit -m "feat: add resume workspace shell"
```

### Task 6: PDF Export Endpoint

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/main.py`
- Create: `services/sidecar/src/typedance_sidecar/pdf.py`
- Create: `services/sidecar/tests/test_pdf_export.py`

- [ ] **Step 1: Add PDF renderer**

Create `services/sidecar/src/typedance_sidecar/pdf.py`:

```py
from pathlib import Path

from weasyprint import HTML

from .models import ResumeVersion


def escape_html(value: str) -> str:
    return (
        value.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def render_resume_html(resume: ResumeVersion) -> str:
    lines = [line.strip() for line in resume.plain_text_snapshot.splitlines() if line.strip()]
    body = "".join(f"<p>{escape_html(line)}</p>" for line in lines) or '<p class="muted">Start writing your resume.</p>'
    return f"""<!doctype html>
<html lang="{resume.target_language}">
  <head>
    <meta charset="utf-8">
    <style>
      @page {{ size: A4; margin: 18mm; }}
      body {{ font-family: Arial, "Noto Sans SC", sans-serif; color: #1f2933; line-height: 1.45; }}
      h1 {{ font-size: 22px; margin: 0 0 12px; }}
      p {{ margin: 0 0 8px; font-size: 11px; }}
      .muted {{ color: #697586; }}
    </style>
  </head>
  <body>
    <h1>{escape_html(resume.title)}</h1>
    {body}
  </body>
</html>"""


def export_resume_pdf(resume: ResumeVersion, exports_dir: Path) -> Path:
    exports_dir.mkdir(parents=True, exist_ok=True)
    pdf_path = exports_dir / f"{resume.id}.pdf"
    HTML(string=render_resume_html(resume)).write_pdf(pdf_path)
    return pdf_path
```

- [ ] **Step 2: Add export route**

Modify `services/sidecar/src/typedance_sidecar/main.py`:

```py
from fastapi import Depends, FastAPI, HTTPException

from .pdf import export_resume_pdf


@app.post("/exports/pdf/{resume_id}", status_code=201)
def export_pdf(resume_id: str, repo: ResumeRepository = Depends(resume_repository)) -> dict[str, str]:
    resume = next((item for item in repo.list() if item.id == resume_id), None)
    if resume is None:
        raise HTTPException(status_code=404, detail="Resume version not found")

    pdf_path = export_resume_pdf(resume, app_data_dir() / "files" / "exports")
    return {
        "id": f"pdf_{resume.id}",
        "resume_version_id": resume.id,
        "file_path": str(pdf_path),
        "language": resume.target_language,
        "layout_status": "ready",
        "created_at": resume.updated_at
    }
```

- [ ] **Step 3: Add PDF export test**

Create `services/sidecar/tests/test_pdf_export.py`:

```py
from pathlib import Path

from fastapi.testclient import TestClient

from typedance_sidecar.main import app


def test_export_pdf_creates_file(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)
    created = client.post(
        "/resume-versions",
        json={
            "title": "Backend Engineer",
            "target_language": "en-US",
            "plain_text_snapshot": "Built reliable PDF export."
        },
    ).json()

    response = client.post(f"/exports/pdf/{created['id']}")

    assert response.status_code == 201
    pdf_path = Path(response.json()["file_path"])
    assert pdf_path.exists()
    assert pdf_path.suffix == ".pdf"
    assert pdf_path.stat().st_size > 0
```

- [ ] **Step 4: Verify PDF export**

Run: `cd services/sidecar && pytest`

Expected: resume persistence and PDF export tests pass.

- [ ] **Step 5: Commit**

```bash
git add services/sidecar
git commit -m "feat: export resume versions as pdf"
```

### Task 7: Tauri 2 Shell Scaffold

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/capabilities/default.json`
- Create: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/README.md`

- [ ] **Step 1: Create desktop package wrapper**

Create `apps/desktop/package.json`:

```json
{
  "name": "@typedance/desktop",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "tauri dev",
    "build": "tauri build"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.5.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.5.0"
  }
}
```

- [ ] **Step 2: Add Tauri configuration**

Create `apps/desktop/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "TypeDance",
  "version": "0.1.0",
  "identifier": "app.typedance.desktop",
  "build": {
    "beforeDevCommand": "pnpm --filter @typedance/web dev",
    "devUrl": "http://127.0.0.1:5173",
    "frontendDist": "../../web/dist"
  },
  "app": {
    "windows": [
      {
        "title": "TypeDance",
        "width": 1366,
        "height": 900
      }
    ]
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "externalBin": ["binaries/typedance-sidecar"]
  }
}
```

- [ ] **Step 3: Add sidecar capability allow-list**

Create `apps/desktop/src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Main TypeDance desktop window permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    {
      "identifier": "shell:allow-execute",
      "allow": [
        {
          "name": "binaries/typedance-sidecar",
          "sidecar": true,
          "args": true
        }
      ]
    }
  ]
}
```

- [ ] **Step 4: Add Rust command boundary**

Create `apps/desktop/src-tauri/src/lib.rs`:

```rust
use tauri_plugin_shell::ShellExt;

#[tauri::command]
async fn check_sidecar_health(app: tauri::AppHandle) -> Result<String, String> {
    let output = app
        .shell()
        .sidecar("typedance-sidecar")
        .map_err(|error| error.to_string())?
        .arg("--health")
        .output()
        .await
        .map_err(|error| error.to_string())?;

    String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![check_sidecar_health])
        .run(tauri::generate_context!())
        .expect("error while running TypeDance");
}
```

- [ ] **Step 5: Document desktop status**

Create `apps/desktop/README.md`:

```markdown
# TypeDance Desktop

This is the Tauri 2 shell boundary for TypeDance.

Slice 1 keeps desktop packaging thin:

- Web UI runs from `apps/web`.
- FastAPI sidecar runs during development with `pnpm --filter @typedance/sidecar dev`.
- Bundled sidecar binary packaging is configured but not produced until the sidecar is ready for release packaging.

Tauri commands must stay limited to OS integration, app paths, dialogs, sidecar lifecycle, and file reveal/open operations. Resume business logic belongs in `services/sidecar`.
```

- [ ] **Step 6: Verify desktop config shape**

Run: `pnpm --filter @typedance/desktop install`

Expected: package resolution succeeds. If Rust or Tauri prerequisites are missing, record the missing prerequisite in `apps/desktop/README.md` before continuing.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop
git commit -m "chore: scaffold tauri desktop shell"
```

### Task 8: End-to-End Slice Verification

**Files:**
- Create: `apps/web/e2e/workspace.spec.ts`
- Modify: `apps/web/package.json`
- Modify: `docs/README.md`

- [ ] **Step 1: Add Playwright test script**

Modify `apps/web/package.json` scripts:

```json
{
  "test:e2e": "playwright test"
}
```

- [ ] **Step 2: Add workspace E2E test**

Create `apps/web/e2e/workspace.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

test("workspace opens directly to resume editing", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByText("TypeDance")).toBeVisible();
  await expect(page.getByLabel("Resume text")).toBeVisible();
  await expect(page.getByLabel("A4 resume preview")).toBeVisible();
});
```

- [ ] **Step 3: Add Playwright config**

Create `apps/web/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  webServer: {
    command: "pnpm --filter @typedance/web dev",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    viewport: { width: 1366, height: 900 }
  }
});
```

- [ ] **Step 4: Update docs with Slice 1 runbook**

Append to `docs/README.md`:

```markdown

## Slice 1 本地运行

1. `pnpm install`
2. `cd services/sidecar && python -m pip install -e ".[dev]"`
3. `pnpm --filter @typedance/sidecar dev`
4. `pnpm --filter @typedance/web dev`
5. 打开 `http://127.0.0.1:5173`

验收命令：

- `pnpm test`
- `pnpm --filter @typedance/web test:e2e`
```

- [ ] **Step 5: Run full verification**

Run: `pnpm test`

Expected: contracts, renderer, web, and sidecar tests all pass.

Run: `pnpm --filter @typedance/web test:e2e`

Expected: Playwright confirms the workspace opens directly to the editing experience.

- [ ] **Step 6: Commit**

```bash
git add apps/web docs/README.md
git commit -m "test: verify slice one workspace flow"
```

## Self-Review

**Spec coverage:** This plan covers the V1 foundation, local-first data boundary, Resume Version target language, controlled rendering, A4 preview, sidecar persistence, and PDF export. Job Target, Evidence Vault, AI rewrite, Review Gate, bilingual message bundles, and provider configuration are intentionally deferred to later slice plans.

**Placeholder scan:** The plan contains no deferred-work markers or vague error-handling instructions. Every code-producing step includes concrete file content or a concrete patch target.

**Type consistency:** `ResumeVersion`, `PDFExport`, `target_language`, `template_id`, `doc_json`, and `plain_text_snapshot` are named consistently across contracts, renderer, sidecar, and web.
