# Template Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a left-sidebar Template Library where users can browse resume templates, inspect Tailwind CSS 4 style configuration, edit sample TipTap content, and persist sample/style configuration locally through the sidecar.

**Architecture:** Keep template browsing inside the existing React workspace shell by adding a new `templates` workspace section. Store reusable template metadata and PDF class policy in TypeScript contracts, mirror persistence models in the Python sidecar, and keep sample content separate from template style configuration. Template style configuration uses controlled Tailwind utility class strings with allowlist/blocklist validation before saving and before rendering.

**Tech Stack:** React 19, Vite 6, Tailwind CSS 4, TipTap 3, shadcn/ui, Zod, FastAPI, Pydantic, SQLite, Vitest, pytest, Playwright.

---

## Scope Check

The approved spec spans front-end navigation, local sidecar persistence, template metadata, sample TipTap content, Tailwind class policy, and tests. These are one feature because each part is needed for a usable Template Library loop:

```text
Sidebar entry -> template list/detail -> editable sample doc_json -> sidecar persistence -> preview/style policy validation
```

The plan intentionally does not implement drag-and-drop layout editing, remote template marketplace, arbitrary CSS editing, or applying templates to the current resume version.

## File Structure

Create or modify these files:

- Create `apps/web/src/features/templates/types.ts`: front-end template, sample, style, and policy types imported from contracts where practical.
- Create `apps/web/src/features/templates/data.ts`: built-in template registry, built-in sample content, default style config, and default PDF class policy.
- Create `apps/web/src/features/templates/classPolicy.ts`: pure class parsing and validation helpers.
- Create `apps/web/src/features/templates/components/TemplatePreview.tsx`: A4-like static preview rendered from sample TipTap JSON and style slot class names.
- Create `apps/web/src/features/templates/components/TemplateCard.tsx`: template grid card.
- Create `apps/web/src/features/templates/components/TemplateDetail.tsx`: template detail, config summary, style editor, and policy errors.
- Create `apps/web/src/features/templates/components/TemplateSampleEditor.tsx`: TipTap sample content editor with save status.
- Create `apps/web/src/features/templates/components/TemplateLibrary.tsx`: tabs, list/detail state, sample/style loading and saving.
- Modify `apps/web/src/features/workspace/types.ts`: add `templates` to `WorkspaceSection`.
- Modify `apps/web/src/features/workspace/data.ts`: add copy keys for template library.
- Modify `apps/web/src/features/workspace/components/WorkspaceSidebar.tsx`: add Template Library nav item.
- Modify `apps/web/src/App.tsx`: render `TemplateLibrary` when `activeSection === "templates"`.
- Modify `apps/web/src/api.ts`: add sidecar API client functions for template samples, template styles, and PDF class policy.
- Modify `apps/web/src/App.test.tsx`: add coverage for sidebar navigation into Template Library.
- Create `apps/web/src/features/templates/templates.test.tsx`: unit tests for list/detail/sample editor.
- Create `apps/web/src/features/templates/classPolicy.test.ts`: unit tests for allowlist/blocklist behavior.
- Modify `apps/web/e2e/workspace.spec.ts`: add Template Library navigation smoke flow.
- Modify `packages/contracts/src/index.ts`: add Zod schemas and exported types for template sample, style config, and PDF class policy.
- Modify `packages/contracts/tests/contracts.test.ts`: add contract tests for new schemas.
- Modify `services/sidecar/src/typedance_sidecar/models.py`: add Pydantic models for sample content, style config, policy, and validation errors.
- Modify `services/sidecar/src/typedance_sidecar/db.py`: add repositories and SQLite tables for template samples, template styles, and policy.
- Modify `services/sidecar/src/typedance_sidecar/main.py`: add REST endpoints.
- Create `services/sidecar/src/typedance_sidecar/template_policy.py`: Python class parsing and validation that mirrors the front-end policy behavior.
- Create `services/sidecar/tests/test_template_library.py`: sidecar API and policy tests.

---

### Task 1: Shared Contracts For Templates

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/tests/contracts.test.ts`

- [ ] **Step 1: Add failing contract tests**

Append these tests to `packages/contracts/tests/contracts.test.ts`:

```ts
import {
  pdfClassPolicySchema,
  templateSampleContentSchema,
  templateStyleConfigSchema,
} from "../src/index"

it("validates template sample content", () => {
  const parsed = templateSampleContentSchema.parse({
    id: "sample-tech-zh",
    name: { "zh-CN": "通用技术岗样张", "en-US": "General technical sample" },
    target_language: "zh-CN",
    doc_json: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "张三" }] }],
    },
    plain_text_snapshot: "张三",
    updated_at: "2026-05-11T00:00:00.000Z",
  })

  expect(parsed.id).toBe("sample-tech-zh")
})

it("validates template style config", () => {
  const parsed = templateStyleConfigSchema.parse({
    template_id: "classic-a4",
    slots: {
      page: {
        label: { "zh-CN": "页面", "en-US": "Page" },
        class_name: "bg-white text-slate-900 font-sans",
        allowed_class_groups: ["page-background", "text-color", "font-family"],
      },
    },
    updated_at: "2026-05-11T00:00:00.000Z",
  })

  expect(parsed.slots.page.class_name).toContain("bg-white")
})

it("validates pdf class policy", () => {
  const parsed = pdfClassPolicySchema.parse({
    allowlist: ["bg-white", "text-slate-900", "font-sans"],
    blocklist: ["fixed", "animate-spin"],
    groups: {
      "text-color": {
        label: { "zh-CN": "文字颜色", "en-US": "Text color" },
        allowlist: ["text-slate-900"],
        blocklist: ["text-transparent"],
      },
    },
    updated_at: "2026-05-11T00:00:00.000Z",
  })

  expect(parsed.groups["text-color"].allowlist).toEqual(["text-slate-900"])
})
```

- [ ] **Step 2: Run the contracts tests and verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/contracts test
```

Expected: FAIL because `templateSampleContentSchema`, `templateStyleConfigSchema`, and `pdfClassPolicySchema` are not exported.

- [ ] **Step 3: Add schemas and types**

Add this to `packages/contracts/src/index.ts` after `pdfExportSchema`:

```ts
export const localizedTextSchema = z.object({
  "zh-CN": z.string().min(1),
  "en-US": z.string().min(1),
})

export const templateSampleContentSchema = z.object({
  id: z.string().min(1),
  name: localizedTextSchema,
  target_language: languageSchema,
  doc_json: z.record(z.unknown()),
  plain_text_snapshot: z.string(),
  updated_at: z.string().datetime(),
})

export const templateStyleSlotSchema = z.object({
  label: localizedTextSchema,
  class_name: z.string(),
  allowed_class_groups: z.array(z.string().min(1)).default([]),
})

export const templateStyleConfigSchema = z.object({
  template_id: z.string().min(1),
  slots: z.record(templateStyleSlotSchema),
  updated_at: z.string().datetime(),
})

export const pdfClassPolicyGroupSchema = z.object({
  label: localizedTextSchema,
  allowlist: z.array(z.string().min(1)),
  blocklist: z.array(z.string().min(1)).optional(),
})

export const pdfClassPolicySchema = z.object({
  allowlist: z.array(z.string().min(1)),
  blocklist: z.array(z.string().min(1)),
  groups: z.record(pdfClassPolicyGroupSchema),
  updated_at: z.string().datetime(),
})

export type TemplateSampleContent = z.infer<typeof templateSampleContentSchema>
export type TemplateStyleConfig = z.infer<typeof templateStyleConfigSchema>
export type PdfClassPolicy = z.infer<typeof pdfClassPolicySchema>
```

- [ ] **Step 4: Run contracts tests and verify pass**

Run:

```powershell
corepack pnpm --filter @typedance/contracts test
```

Expected: PASS.

- [ ] **Step 5: Commit contracts**

Run:

```powershell
git add packages/contracts/src/index.ts packages/contracts/tests/contracts.test.ts
git commit -m "feat(templates): 新增模板配置共享契约"
```

Expected: commit succeeds.

---

### Task 2: Sidecar Persistence And Policy Validation

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/models.py`
- Modify: `services/sidecar/src/typedance_sidecar/db.py`
- Modify: `services/sidecar/src/typedance_sidecar/main.py`
- Create: `services/sidecar/src/typedance_sidecar/template_policy.py`
- Create: `services/sidecar/tests/test_template_library.py`

- [ ] **Step 1: Write failing sidecar tests**

Create `services/sidecar/tests/test_template_library.py`:

```py
from fastapi.testclient import TestClient

from typedance_sidecar.main import app


def test_template_sample_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    payload = {
        "id": "sample-tech-zh",
        "name": {"zh-CN": "通用技术岗样张", "en-US": "General technical sample"},
        "target_language": "zh-CN",
        "doc_json": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "张三"}]}]},
        "plain_text_snapshot": "张三",
    }

    put_response = client.put("/template-samples/sample-tech-zh", json=payload)
    assert put_response.status_code == 200
    assert put_response.json()["plain_text_snapshot"] == "张三"

    get_response = client.get("/template-samples/sample-tech-zh")
    assert get_response.status_code == 200
    assert get_response.json()["id"] == "sample-tech-zh"


def test_style_config_rejects_blocklisted_class(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    response = client.put(
        "/template-styles/classic-a4",
        json={
            "template_id": "classic-a4",
            "slots": {
                "page": {
                    "label": {"zh-CN": "页面", "en-US": "Page"},
                    "class_name": "bg-white fixed",
                    "allowed_class_groups": ["page-background"],
                }
            },
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["class_name"] == "fixed"


def test_pdf_class_policy_round_trip(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPEDANCE_DATA_DIR", str(tmp_path))
    client = TestClient(app)

    payload = {
        "allowlist": ["bg-white", "text-slate-900"],
        "blocklist": ["fixed"],
        "groups": {
            "text-color": {
                "label": {"zh-CN": "文字颜色", "en-US": "Text color"},
                "allowlist": ["text-slate-900"],
            }
        },
    }

    put_response = client.put("/pdf-class-policy", json=payload)
    assert put_response.status_code == 200
    assert put_response.json()["allowlist"] == ["bg-white", "text-slate-900"]

    get_response = client.get("/pdf-class-policy")
    assert get_response.status_code == 200
    assert get_response.json()["blocklist"] == ["fixed"]
```

- [ ] **Step 2: Run the sidecar tests and verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/sidecar test
```

Expected: FAIL because the new endpoints do not exist.

- [ ] **Step 3: Add Pydantic models**

Add this to `services/sidecar/src/typedance_sidecar/models.py`:

```py
class LocalizedText(BaseModel):
    zh_CN: str = Field(alias="zh-CN", min_length=1)
    en_US: str = Field(alias="en-US", min_length=1)


class TemplateSampleContent(BaseModel):
    id: str = Field(min_length=1)
    name: LocalizedText
    target_language: Language
    doc_json: dict[str, Any] = Field(default_factory=lambda: {"type": "doc", "content": []})
    plain_text_snapshot: str = ""
    updated_at: str = Field(default_factory=utc_now)


class TemplateStyleSlot(BaseModel):
    label: LocalizedText
    class_name: str = ""
    allowed_class_groups: list[str] = Field(default_factory=list)


class TemplateStyleConfig(BaseModel):
    template_id: str = Field(min_length=1)
    slots: dict[str, TemplateStyleSlot] = Field(default_factory=dict)
    updated_at: str = Field(default_factory=utc_now)


class PdfClassPolicyGroup(BaseModel):
    label: LocalizedText
    allowlist: list[str] = Field(default_factory=list)
    blocklist: list[str] = Field(default_factory=list)


class PdfClassPolicy(BaseModel):
    allowlist: list[str] = Field(default_factory=list)
    blocklist: list[str] = Field(default_factory=list)
    groups: dict[str, PdfClassPolicyGroup] = Field(default_factory=dict)
    updated_at: str = Field(default_factory=utc_now)


class PdfClassValidationError(BaseModel):
    slot: str
    class_name: str
    reason: Literal["blocked", "not_allowed"]
```

- [ ] **Step 4: Add policy validation helper**

Create `services/sidecar/src/typedance_sidecar/template_policy.py`:

```py
from __future__ import annotations

from .models import PdfClassPolicy, PdfClassValidationError, TemplateStyleConfig


DEFAULT_PDF_CLASS_POLICY = PdfClassPolicy(
    allowlist=[
        "bg-white",
        "text-slate-900",
        "text-slate-700",
        "text-blue-800",
        "font-sans",
        "font-bold",
        "font-semibold",
        "text-sm",
        "text-base",
        "text-xl",
        "leading-normal",
        "leading-relaxed",
        "border-b",
        "border-b-2",
        "border-blue-800",
        "pb-3",
        "mb-4",
        "mt-4",
        "space-y-2",
        "grid",
        "gap-2",
    ],
    blocklist=[
        "fixed",
        "sticky",
        "absolute",
        "animate-spin",
        "transition",
        "blur",
        "drop-shadow",
        "hover:bg-white",
        "focus:ring",
    ],
    groups={},
)


def split_classes(class_name: str) -> list[str]:
    return [item.strip() for item in class_name.split() if item.strip()]


def validate_style_config(config: TemplateStyleConfig, policy: PdfClassPolicy) -> list[PdfClassValidationError]:
    allowed = set(policy.allowlist)
    blocked = set(policy.blocklist)
    errors: list[PdfClassValidationError] = []

    for group in policy.groups.values():
        allowed.update(group.allowlist)
        blocked.update(group.blocklist)

    for slot_name, slot in config.slots.items():
        for class_name in split_classes(slot.class_name):
            if class_name in blocked:
                errors.append(PdfClassValidationError(slot=slot_name, class_name=class_name, reason="blocked"))
            elif class_name not in allowed:
                errors.append(PdfClassValidationError(slot=slot_name, class_name=class_name, reason="not_allowed"))

    return errors
```

- [ ] **Step 5: Add repositories**

Add these tables inside `connect()` in `services/sidecar/src/typedance_sidecar/db.py` after the existing `resume_versions` table creation:

```py
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS template_samples (
          id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS template_styles (
          template_id TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        """
    )
```

Add repository classes to `services/sidecar/src/typedance_sidecar/db.py`:

```py
from .models import PdfClassPolicy, TemplateSampleContent, TemplateStyleConfig


class TemplateSampleRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    def get(self, sample_id: str) -> TemplateSampleContent | None:
        row = self.connection.execute("SELECT payload FROM template_samples WHERE id = ?", (sample_id,)).fetchone()
        if row is None:
            return None
        return TemplateSampleContent.model_validate(json.loads(row["payload"]))

    def save(self, sample: TemplateSampleContent) -> TemplateSampleContent:
        payload = sample.model_dump_json(by_alias=True)
        self.connection.execute(
            """
            INSERT INTO template_samples (id, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
            """,
            (sample.id, payload, sample.updated_at),
        )
        self.connection.commit()
        return sample


class TemplateStyleRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    def get(self, template_id: str) -> TemplateStyleConfig | None:
        row = self.connection.execute("SELECT payload FROM template_styles WHERE template_id = ?", (template_id,)).fetchone()
        if row is None:
            return None
        return TemplateStyleConfig.model_validate(json.loads(row["payload"]))

    def save(self, config: TemplateStyleConfig) -> TemplateStyleConfig:
        payload = config.model_dump_json(by_alias=True)
        self.connection.execute(
            """
            INSERT INTO template_styles (template_id, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(template_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
            """,
            (config.template_id, payload, config.updated_at),
        )
        self.connection.commit()
        return config


class AppSettingsRepository:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self.connection = connection

    def get_pdf_class_policy(self) -> PdfClassPolicy | None:
        row = self.connection.execute("SELECT payload FROM app_settings WHERE key = ?", ("pdf_class_policy",)).fetchone()
        if row is None:
            return None
        return PdfClassPolicy.model_validate(json.loads(row["payload"]))

    def save_pdf_class_policy(self, policy: PdfClassPolicy) -> PdfClassPolicy:
        payload = policy.model_dump_json(by_alias=True)
        self.connection.execute(
            """
            INSERT INTO app_settings (key, payload, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
            """,
            ("pdf_class_policy", payload, policy.updated_at),
        )
        self.connection.commit()
        return policy
```

- [ ] **Step 6: Add endpoints**

Modify imports in `services/sidecar/src/typedance_sidecar/main.py`:

```py
from .db import AppSettingsRepository, ResumeRepository, TemplateSampleRepository, TemplateStyleRepository, connect
from .models import PdfClassPolicy, TemplateSampleContent, TemplateStyleConfig, utc_now
from .template_policy import DEFAULT_PDF_CLASS_POLICY, validate_style_config
```

Add dependency helpers:

```py
def template_sample_repository() -> TemplateSampleRepository:
    return TemplateSampleRepository(connect(app_data_dir() / "typedance.sqlite"))


def template_style_repository() -> TemplateStyleRepository:
    return TemplateStyleRepository(connect(app_data_dir() / "typedance.sqlite"))


def app_settings_repository() -> AppSettingsRepository:
    return AppSettingsRepository(connect(app_data_dir() / "typedance.sqlite"))
```

Add endpoints before the preview routes:

```py
@app.get("/template-samples/{sample_id}", response_model=TemplateSampleContent)
def get_template_sample(
    sample_id: str,
    repo: TemplateSampleRepository = Depends(template_sample_repository),
) -> TemplateSampleContent:
    sample = repo.get(sample_id)
    if sample is None:
        raise HTTPException(status_code=404, detail="Template sample not found")
    return sample


@app.put("/template-samples/{sample_id}", response_model=TemplateSampleContent)
def save_template_sample(
    sample_id: str,
    payload: TemplateSampleContent,
    repo: TemplateSampleRepository = Depends(template_sample_repository),
) -> TemplateSampleContent:
    sample = payload.model_copy(update={"id": sample_id, "updated_at": utc_now()})
    return repo.save(sample)


@app.get("/pdf-class-policy", response_model=PdfClassPolicy)
def get_pdf_class_policy(repo: AppSettingsRepository = Depends(app_settings_repository)) -> PdfClassPolicy:
    return repo.get_pdf_class_policy() or DEFAULT_PDF_CLASS_POLICY


@app.put("/pdf-class-policy", response_model=PdfClassPolicy)
def save_pdf_class_policy(
    payload: PdfClassPolicy,
    repo: AppSettingsRepository = Depends(app_settings_repository),
) -> PdfClassPolicy:
    return repo.save_pdf_class_policy(payload.model_copy(update={"updated_at": utc_now()}))


@app.get("/template-styles/{template_id}", response_model=TemplateStyleConfig)
def get_template_style(
    template_id: str,
    repo: TemplateStyleRepository = Depends(template_style_repository),
) -> TemplateStyleConfig:
    config = repo.get(template_id)
    if config is None:
        raise HTTPException(status_code=404, detail="Template style not found")
    return config


@app.put("/template-styles/{template_id}", response_model=TemplateStyleConfig)
def save_template_style(
    template_id: str,
    payload: TemplateStyleConfig,
    style_repo: TemplateStyleRepository = Depends(template_style_repository),
    settings_repo: AppSettingsRepository = Depends(app_settings_repository),
) -> TemplateStyleConfig:
    config = payload.model_copy(update={"template_id": template_id, "updated_at": utc_now()})
    policy = settings_repo.get_pdf_class_policy() or DEFAULT_PDF_CLASS_POLICY
    validation_errors = validate_style_config(config, policy)
    if validation_errors:
        raise HTTPException(status_code=422, detail=[error.model_dump() for error in validation_errors])
    return style_repo.save(config)
```

- [ ] **Step 7: Run sidecar tests**

Run:

```powershell
corepack pnpm --filter @typedance/sidecar test
```

Expected: PASS.

- [ ] **Step 8: Commit sidecar persistence**

Run:

```powershell
git add services/sidecar/src/typedance_sidecar services/sidecar/tests/test_template_library.py
git commit -m "feat(sidecar): 保存模板样张与样式配置"
```

Expected: commit succeeds.

---

### Task 3: Front-End Template Data And Policy Helpers

**Files:**
- Create: `apps/web/src/features/templates/types.ts`
- Create: `apps/web/src/features/templates/data.ts`
- Create: `apps/web/src/features/templates/classPolicy.ts`
- Create: `apps/web/src/features/templates/classPolicy.test.ts`

- [ ] **Step 1: Write failing policy tests**

Create `apps/web/src/features/templates/classPolicy.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { PdfClassPolicy } from "@typedance/contracts"
import { validateTemplateClasses } from "./classPolicy"

const policy: PdfClassPolicy = {
  allowlist: ["bg-white", "text-slate-900", "font-sans", "border-b-2"],
  blocklist: ["fixed", "animate-spin"],
  groups: {
    spacing: {
      label: { "zh-CN": "间距", "en-US": "Spacing" },
      allowlist: ["pb-3", "mb-4"],
    },
  },
  updated_at: "2026-05-11T00:00:00.000Z",
}

describe("validateTemplateClasses", () => {
  it("accepts allowlisted classes from root and groups", () => {
    expect(validateTemplateClasses("bg-white pb-3", policy)).toEqual([])
  })

  it("blocks blacklisted classes before allowlist checks", () => {
    expect(validateTemplateClasses("bg-white fixed", policy)).toEqual([
      { className: "fixed", reason: "blocked" },
    ])
  })

  it("marks unknown classes as not allowed", () => {
    expect(validateTemplateClasses("shadow-xl", policy)).toEqual([
      { className: "shadow-xl", reason: "not_allowed" },
    ])
  })
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/templates/classPolicy.test.ts
```

Expected: FAIL because `classPolicy.ts` does not exist.

- [ ] **Step 3: Add front-end types**

Create `apps/web/src/features/templates/types.ts`:

```ts
import type { PdfClassPolicy, TemplateSampleContent, TemplateStyleConfig } from "@typedance/contracts"
import type { TargetLanguage, UiLanguage } from "../workspace/types"

export type TemplateStatus = "built-in" | "planned"

export type ResumeTemplateDefinition = {
  id: string
  name: string
  localizedName: Record<UiLanguage, string>
  description: Record<UiLanguage, string>
  languages: TargetLanguage[]
  status: TemplateStatus
  tags: Record<UiLanguage, string[]>
  sampleContentIds: Partial<Record<TargetLanguage, string>>
  configSummary: {
    pageSize: string
    margin: string
    fontStack: string
    accentColor: string
    layout: string
  }
  implementation: {
    packageName: string
    rendererEntry: string
    templateId: string
  }
  futureConfig: Record<UiLanguage, string[]>
}

export type TemplateLibraryTab = "templates" | "samples"
export type ClassValidationReason = "blocked" | "not_allowed"
export type ClassValidationIssue = { className: string; reason: ClassValidationReason }

export type {
  PdfClassPolicy,
  TemplateSampleContent,
  TemplateStyleConfig,
}
```

- [ ] **Step 4: Add class policy helper**

Create `apps/web/src/features/templates/classPolicy.ts`:

```ts
import type { ClassValidationIssue, PdfClassPolicy } from "./types"

export function splitClasses(className: string): string[] {
  return className
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function validateTemplateClasses(className: string, policy: PdfClassPolicy): ClassValidationIssue[] {
  const allowlist = new Set(policy.allowlist)
  const blocklist = new Set(policy.blocklist)

  for (const group of Object.values(policy.groups)) {
    for (const item of group.allowlist) {
      allowlist.add(item)
    }
    for (const item of group.blocklist ?? []) {
      blocklist.add(item)
    }
  }

  return splitClasses(className).flatMap((item) => {
    if (blocklist.has(item)) {
      return [{ className: item, reason: "blocked" as const }]
    }

    if (!allowlist.has(item)) {
      return [{ className: item, reason: "not_allowed" as const }]
    }

    return []
  })
}
```

- [ ] **Step 5: Add built-in template data**

Create `apps/web/src/features/templates/data.ts`:

```ts
import type { PdfClassPolicy, ResumeTemplateDefinition, TemplateSampleContent, TemplateStyleConfig } from "./types"

export const templateRegistry: ResumeTemplateDefinition[] = [
  {
    id: "classic-a4",
    name: "Classic A4",
    localizedName: { "zh-CN": "经典 A4", "en-US": "Classic A4" },
    description: {
      "zh-CN": "适合通用投递的单栏 A4 简历模板。",
      "en-US": "A single-column A4 resume template for general applications.",
    },
    languages: ["zh-CN", "en-US"],
    status: "built-in",
    tags: { "zh-CN": ["内置", "中英双语", "ATS 友好"], "en-US": ["Built-in", "Bilingual", "ATS friendly"] },
    sampleContentIds: { "zh-CN": "sample-tech-zh", "en-US": "sample-tech-en" },
    configSummary: {
      pageSize: "A4",
      margin: "18mm 20mm",
      fontStack: "Noto Sans SC / Microsoft YaHei / Arial",
      accentColor: "#174ea6",
      layout: "single-column",
    },
    implementation: {
      packageName: "@typedance/resume-renderer",
      rendererEntry: "packages/resume-renderer/src/index.ts",
      templateId: "classic-a4",
    },
    futureConfig: {
      "zh-CN": ["字体", "主色", "页边距", "标题样式", "段落间距"],
      "en-US": ["Font", "Accent color", "Margins", "Heading style", "Paragraph spacing"],
    },
  },
]

export const builtInSamples: Record<string, TemplateSampleContent> = {
  "sample-tech-zh": {
    id: "sample-tech-zh",
    name: { "zh-CN": "通用技术岗样张", "en-US": "General technical sample" },
    target_language: "zh-CN",
    doc_json: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "张三" }] },
        { type: "paragraph", content: [{ type: "text", text: "全栈工程师 | React / TypeScript / 本地优先应用" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "项目经历" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "负责简历工作台从编辑到 PDF 导出的闭环体验。" }] }] }] },
      ],
    },
    plain_text_snapshot: "张三\n全栈工程师 | React / TypeScript / 本地优先应用\n项目经历\n负责简历工作台从编辑到 PDF 导出的闭环体验。",
    updated_at: "2026-05-11T00:00:00.000Z",
  },
  "sample-tech-en": {
    id: "sample-tech-en",
    name: { "zh-CN": "通用技术岗英文样张", "en-US": "General technical sample" },
    target_language: "en-US",
    doc_json: {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Alex Chen" }] },
        { type: "paragraph", content: [{ type: "text", text: "Full-stack Engineer | React / TypeScript / Local-first Apps" }] },
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Experience" }] },
        { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Built an end-to-end resume workspace from editing to PDF export." }] }] }] },
      ],
    },
    plain_text_snapshot: "Alex Chen\nFull-stack Engineer | React / TypeScript / Local-first Apps\nExperience\nBuilt an end-to-end resume workspace from editing to PDF export.",
    updated_at: "2026-05-11T00:00:00.000Z",
  },
}

export const defaultClassicA4Style: TemplateStyleConfig = {
  template_id: "classic-a4",
  slots: {
    page: {
      label: { "zh-CN": "页面", "en-US": "Page" },
      class_name: "bg-white text-slate-900 font-sans",
      allowed_class_groups: ["page-background", "text-color", "font-family"],
    },
    header: {
      label: { "zh-CN": "页眉", "en-US": "Header" },
      class_name: "border-b-2 border-blue-800 pb-3 mb-4",
      allowed_class_groups: ["border", "spacing", "color"],
    },
  },
  updated_at: "2026-05-11T00:00:00.000Z",
}

export const defaultPdfClassPolicy: PdfClassPolicy = {
  allowlist: ["bg-white", "text-slate-900", "text-slate-700", "text-blue-800", "font-sans", "font-bold", "font-semibold", "border-b-2", "border-blue-800", "pb-3", "mb-4"],
  blocklist: ["fixed", "sticky", "absolute", "animate-spin", "transition", "blur", "drop-shadow", "hover:bg-white", "focus:ring"],
  groups: {},
  updated_at: "2026-05-11T00:00:00.000Z",
}
```

- [ ] **Step 6: Run policy tests**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/templates/classPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit template data helpers**

Run:

```powershell
git add apps/web/src/features/templates packages/contracts
git commit -m "feat(templates): 新增模板元数据与样式校验"
```

Expected: commit succeeds.

---

### Task 4: API Client For Template Library

**Files:**
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/api.test.ts`

- [ ] **Step 1: Write failing API client tests**

Create `apps/web/src/api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest"
import { getTemplateSample, saveTemplateStyle } from "./api"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("template api", () => {
  it("loads a template sample", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "sample-tech-zh",
      name: { "zh-CN": "通用技术岗样张", "en-US": "General technical sample" },
      target_language: "zh-CN",
      doc_json: { type: "doc", content: [] },
      plain_text_snapshot: "",
      updated_at: "2026-05-11T00:00:00.000Z",
    }))))

    await expect(getTemplateSample("sample-tech-zh")).resolves.toMatchObject({ id: "sample-tech-zh" })
  })

  it("surfaces style validation failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      detail: [{ slot: "page", class_name: "fixed", reason: "blocked" }],
    }), { status: 422 })))

    await expect(saveTemplateStyle({
      template_id: "classic-a4",
      slots: {},
      updated_at: "2026-05-11T00:00:00.000Z",
    })).rejects.toThrow("fixed")
  })
})
```

- [ ] **Step 2: Run API test and verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/api.test.ts
```

Expected: FAIL because the API functions do not exist.

- [ ] **Step 3: Implement API functions**

Append this to `apps/web/src/api.ts`:

```ts
import {
  pdfClassPolicySchema,
  templateSampleContentSchema,
  templateStyleConfigSchema,
  type PdfClassPolicy,
  type TemplateSampleContent,
  type TemplateStyleConfig,
} from "@typedance/contracts"

async function parseTemplateResponse<T>(response: Response, parser: (value: unknown) => T, fallbackMessage: string): Promise<T> {
  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    const details = Array.isArray(payload?.detail)
      ? payload.detail.map((item: { class_name?: string; reason?: string }) => `${item.class_name ?? "class"}:${item.reason ?? "invalid"}`).join(", ")
      : `${response.status}`
    throw new Error(`${fallbackMessage}: ${details}`)
  }

  return parser(payload)
}

export async function getTemplateSample(sampleId: string): Promise<TemplateSampleContent> {
  const response = await fetch(`${baseUrl}/template-samples/${sampleId}`)
  return parseTemplateResponse(response, templateSampleContentSchema.parse, "Failed to load template sample")
}

export async function saveTemplateSample(sample: TemplateSampleContent): Promise<TemplateSampleContent> {
  const response = await fetch(`${baseUrl}/template-samples/${sample.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sample),
  })
  return parseTemplateResponse(response, templateSampleContentSchema.parse, "Failed to save template sample")
}

export async function getTemplateStyle(templateId: string): Promise<TemplateStyleConfig> {
  const response = await fetch(`${baseUrl}/template-styles/${templateId}`)
  return parseTemplateResponse(response, templateStyleConfigSchema.parse, "Failed to load template style")
}

export async function saveTemplateStyle(style: TemplateStyleConfig): Promise<TemplateStyleConfig> {
  const response = await fetch(`${baseUrl}/template-styles/${style.template_id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(style),
  })
  return parseTemplateResponse(response, templateStyleConfigSchema.parse, "Failed to save template style")
}

export async function getPdfClassPolicy(): Promise<PdfClassPolicy> {
  const response = await fetch(`${baseUrl}/pdf-class-policy`)
  return parseTemplateResponse(response, pdfClassPolicySchema.parse, "Failed to load PDF class policy")
}

export async function savePdfClassPolicy(policy: PdfClassPolicy): Promise<PdfClassPolicy> {
  const response = await fetch(`${baseUrl}/pdf-class-policy`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(policy),
  })
  return parseTemplateResponse(response, pdfClassPolicySchema.parse, "Failed to save PDF class policy")
}
```

If TypeScript reports duplicate import declarations from `@typedance/contracts`, merge the new named imports into the existing import at the top of `apps/web/src/api.ts`.

- [ ] **Step 4: Run API test**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/api.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit API client**

Run:

```powershell
git add apps/web/src/api.ts apps/web/src/api.test.ts
git commit -m "feat(templates): 接入模板库本地API"
```

Expected: commit succeeds.

---

### Task 5: Template Library UI

**Files:**
- Create: `apps/web/src/features/templates/components/TemplatePreview.tsx`
- Create: `apps/web/src/features/templates/components/TemplateCard.tsx`
- Create: `apps/web/src/features/templates/components/TemplateDetail.tsx`
- Create: `apps/web/src/features/templates/components/TemplateSampleEditor.tsx`
- Create: `apps/web/src/features/templates/components/TemplateLibrary.tsx`
- Create: `apps/web/src/features/templates/templates.test.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: Write failing component tests**

Create `apps/web/src/features/templates/templates.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { TemplateLibrary } from "./components/TemplateLibrary"
import { copy } from "../workspace/data"

vi.mock("../../api", () => ({
  getTemplateSample: vi.fn(async () => {
    throw new Error("not saved locally")
  }),
  saveTemplateSample: vi.fn(async (sample) => sample),
  getTemplateStyle: vi.fn(async () => {
    throw new Error("not saved locally")
  }),
  saveTemplateStyle: vi.fn(async (style) => style),
  getPdfClassPolicy: vi.fn(async () => {
    throw new Error("not saved locally")
  }),
}))

describe("TemplateLibrary", () => {
  it("renders classic a4 and opens detail", async () => {
    render(<TemplateLibrary copy={copy["zh-CN"]} uiLanguage="zh-CN" targetLanguage="zh-CN" />)

    expect(await screen.findByRole("heading", { name: "模板库" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /Classic A4/ }))

    expect(screen.getByRole("heading", { name: /Classic A4/ })).toBeInTheDocument()
    expect(screen.getByText("classic-a4")).toBeInTheDocument()
  })

  it("edits sample content", async () => {
    render(<TemplateLibrary copy={copy["zh-CN"]} uiLanguage="zh-CN" targetLanguage="zh-CN" />)

    fireEvent.click(await screen.findByRole("tab", { name: "样张内容" }))
    expect(screen.getByRole("heading", { name: "样张内容" })).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "保存样张" }))

    await waitFor(() => expect(screen.getByText("样张已保存")).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/templates/templates.test.tsx
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Implement TemplatePreview**

Create `apps/web/src/features/templates/components/TemplatePreview.tsx`:

```tsx
import type { TemplateSampleContent, TemplateStyleConfig } from "../types"

type TemplatePreviewProps = {
  sample: TemplateSampleContent
  styleConfig: TemplateStyleConfig
  scale?: "card" | "detail"
}

function nodeText(node: unknown): string {
  if (!node || typeof node !== "object") {
    return ""
  }

  const typedNode = node as { text?: unknown; content?: unknown[] }
  if (typeof typedNode.text === "string") {
    return typedNode.text
  }

  return Array.isArray(typedNode.content) ? typedNode.content.map(nodeText).join("") : ""
}

function blockLabel(node: unknown): string {
  if (!node || typeof node !== "object") {
    return ""
  }

  return nodeText(node).trim()
}

export function TemplatePreview({ sample, styleConfig, scale = "detail" }: TemplatePreviewProps) {
  const content = Array.isArray(sample.doc_json.content) ? sample.doc_json.content : []
  const [title, subtitle, ...rest] = content.map(blockLabel).filter(Boolean)
  const pageClass = styleConfig.slots.page?.class_name ?? ""
  const headerClass = styleConfig.slots.header?.class_name ?? ""

  return (
    <div className={`td-template-preview td-template-preview-${scale}`} aria-label="A4 template sample preview">
      <article className={`td-template-paper ${pageClass}`}>
        <header className={headerClass}>
          <h3>{title || sample.name["zh-CN"]}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </header>
        <div className="td-template-preview-body">
          {rest.slice(0, scale === "card" ? 4 : 12).map((line, index) => (
            <p key={`${line}-${index}`}>{line}</p>
          ))}
        </div>
      </article>
    </div>
  )
}
```

- [ ] **Step 4: Implement TemplateCard**

Create `apps/web/src/features/templates/components/TemplateCard.tsx`:

```tsx
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { TargetLanguage, UiLanguage } from "../../workspace/types"
import type { ResumeTemplateDefinition, TemplateSampleContent, TemplateStyleConfig } from "../types"
import { TemplatePreview } from "./TemplatePreview"

type TemplateCardProps = {
  template: ResumeTemplateDefinition
  sample: TemplateSampleContent
  styleConfig: TemplateStyleConfig
  uiLanguage: UiLanguage
  targetLanguage: TargetLanguage
  onOpen: () => void
}

export function TemplateCard({ template, sample, styleConfig, uiLanguage, targetLanguage, onOpen }: TemplateCardProps) {
  const isAvailable = template.status === "built-in"

  return (
    <Button
      type="button"
      variant="outline"
      className="td-template-card"
      aria-label={`${template.name} ${template.localizedName[uiLanguage]}`}
      onClick={onOpen}
      disabled={!isAvailable}
    >
      <TemplatePreview sample={sample} styleConfig={styleConfig} scale="card" />
      <span className="td-template-card-title">{template.name}</span>
      <span className="td-template-card-description">{template.description[uiLanguage]}</span>
      <span className="td-template-card-tags">
        {template.tags[uiLanguage].map((tag) => (
          <Badge key={tag} variant="secondary">{tag}</Badge>
        ))}
        <Badge variant={template.languages.includes(targetLanguage) ? "default" : "secondary"}>
          {template.status === "built-in" ? "内置" : "规划中"}
        </Badge>
      </span>
    </Button>
  )
}
```

- [ ] **Step 5: Implement TemplateDetail**

Create `apps/web/src/features/templates/components/TemplateDetail.tsx`:

```tsx
import { ArrowLeft, Save } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { UiLanguage } from "../../workspace/types"
import { validateTemplateClasses } from "../classPolicy"
import type { PdfClassPolicy, ResumeTemplateDefinition, TemplateSampleContent, TemplateStyleConfig } from "../types"
import { TemplatePreview } from "./TemplatePreview"

type TemplateDetailProps = {
  template: ResumeTemplateDefinition
  sample: TemplateSampleContent
  styleConfig: TemplateStyleConfig
  policy: PdfClassPolicy
  uiLanguage: UiLanguage
  onBack: () => void
  onStyleChange: (style: TemplateStyleConfig) => void
  onSaveStyle: () => void
  styleStatus: string
}

export function TemplateDetail({
  template,
  sample,
  styleConfig,
  policy,
  uiLanguage,
  onBack,
  onStyleChange,
  onSaveStyle,
  styleStatus,
}: TemplateDetailProps) {
  return (
    <section className="td-template-detail">
      <div className="td-template-detail-header">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          返回模板库
        </Button>
        <Badge>{template.status === "built-in" ? "当前可用" : "规划中"}</Badge>
      </div>

      <div className="td-template-detail-grid">
        <TemplatePreview sample={sample} styleConfig={styleConfig} />
        <aside className="td-template-detail-panel">
          <h2>{template.name}</h2>
          <p>{template.description[uiLanguage]}</p>
          <dl className="td-template-meta">
            <dt>template_id</dt>
            <dd>{template.implementation.templateId}</dd>
            <dt>页面尺寸</dt>
            <dd>{template.configSummary.pageSize}</dd>
            <dt>页边距</dt>
            <dd>{template.configSummary.margin}</dd>
            <dt>字体</dt>
            <dd>{template.configSummary.fontStack}</dd>
            <dt>渲染入口</dt>
            <dd>{template.implementation.rendererEntry}</dd>
          </dl>

          <h3>Tailwind class 配置</h3>
          {Object.entries(styleConfig.slots).map(([slotName, slot]) => {
            const issues = validateTemplateClasses(slot.class_name, policy)
            return (
              <label key={slotName} className="td-template-style-field">
                <span>{slot.label[uiLanguage]}</span>
                <Input
                  value={slot.class_name}
                  onChange={(event) =>
                    onStyleChange({
                      ...styleConfig,
                      slots: {
                        ...styleConfig.slots,
                        [slotName]: { ...slot, class_name: event.target.value },
                      },
                    })
                  }
                />
                {issues.length ? (
                  <small role="alert">{issues.map((issue) => `${issue.className}:${issue.reason}`).join(", ")}</small>
                ) : (
                  <small>PDF 支持</small>
                )}
              </label>
            )
          })}
          <Button type="button" onClick={onSaveStyle}>
            <Save data-icon="inline-start" />
            保存样式
          </Button>
          <p aria-live="polite">{styleStatus}</p>
        </aside>
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Implement TemplateSampleEditor**

Create `apps/web/src/features/templates/components/TemplateSampleEditor.tsx`:

```tsx
import { useState } from "react"
import { Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ResumeEditorChange } from "../../workspace/editor"
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

export function TemplateSampleEditor({ sample, uiLanguage, status, onChange, onSave }: TemplateSampleEditorProps) {
  const [localName] = useState(sample.name[uiLanguage])

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
      <p>{localName} 会用于模板库缩略图和详情样张，不会修改当前简历。</p>
      <ResumeRichTextEditor ariaLabel="Template sample content" docJson={sample.doc_json} onChange={handleChange} />
      <p aria-live="polite">{status}</p>
    </section>
  )
}
```

- [ ] **Step 7: Implement TemplateLibrary**

Create `apps/web/src/features/templates/components/TemplateLibrary.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react"
import { getPdfClassPolicy, getTemplateSample, getTemplateStyle, saveTemplateSample, saveTemplateStyle } from "@/api"
import type { TargetLanguage, UiLanguage, WorkspaceCopy } from "../../workspace/types"
import { builtInSamples, defaultClassicA4Style, defaultPdfClassPolicy, templateRegistry } from "../data"
import type { PdfClassPolicy, ResumeTemplateDefinition, TemplateLibraryTab, TemplateSampleContent, TemplateStyleConfig } from "../types"
import { TemplateCard } from "./TemplateCard"
import { TemplateDetail } from "./TemplateDetail"
import { TemplateSampleEditor } from "./TemplateSampleEditor"

type TemplateLibraryProps = {
  copy: WorkspaceCopy
  uiLanguage: UiLanguage
  targetLanguage: TargetLanguage
}

export function TemplateLibrary({ uiLanguage, targetLanguage }: TemplateLibraryProps) {
  const [activeTab, setActiveTab] = useState<TemplateLibraryTab>("templates")
  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplateDefinition | null>(null)
  const [sample, setSample] = useState<TemplateSampleContent>(builtInSamples["sample-tech-zh"])
  const [styleConfig, setStyleConfig] = useState<TemplateStyleConfig>(defaultClassicA4Style)
  const [policy, setPolicy] = useState<PdfClassPolicy>(defaultPdfClassPolicy)
  const [sampleStatus, setSampleStatus] = useState("本地默认样张")
  const [styleStatus, setStyleStatus] = useState("本地默认样式")

  const currentTemplate = selectedTemplate ?? templateRegistry[0]
  const sampleId = currentTemplate.sampleContentIds[targetLanguage] ?? "sample-tech-zh"
  const visibleSample = sample.id === sampleId ? sample : builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"]

  useEffect(() => {
    void getTemplateSample(sampleId)
      .then((nextSample) => {
        setSample(nextSample)
        setSampleStatus("已读取本地样张")
      })
      .catch(() => {
        setSample(builtInSamples[sampleId] ?? builtInSamples["sample-tech-zh"])
        setSampleStatus("使用内置样张")
      })
  }, [sampleId])

  useEffect(() => {
    void getTemplateStyle(currentTemplate.id)
      .then((nextStyle) => {
        setStyleConfig(nextStyle)
        setStyleStatus("已读取本地样式")
      })
      .catch(() => {
        setStyleConfig(defaultClassicA4Style)
        setStyleStatus("使用内置样式")
      })

    void getPdfClassPolicy().then(setPolicy).catch(() => setPolicy(defaultPdfClassPolicy))
  }, [currentTemplate.id])

  const templates = useMemo(() => templateRegistry, [])

  const handleSaveSample = async () => {
    const saved = await saveTemplateSample(visibleSample)
    setSample(saved)
    setSampleStatus("样张已保存")
  }

  const handleSaveStyle = async () => {
    const saved = await saveTemplateStyle(styleConfig)
    setStyleConfig(saved)
    setStyleStatus("样式已保存")
  }

  return (
    <main className="td-template-library">
      <header className="td-template-library-heading">
        <div>
          <p className="td-eyebrow">Template Library</p>
          <h1>模板库</h1>
          <p>{templates.length} 个模板 · 样张内容与 Tailwind class 配置本地保存</p>
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
            />
          ))}
        </section>
      ) : null}

      {activeTab === "templates" && selectedTemplate ? (
        <TemplateDetail
          template={selectedTemplate}
          sample={visibleSample}
          styleConfig={styleConfig}
          policy={policy}
          uiLanguage={uiLanguage}
          onBack={() => setSelectedTemplate(null)}
          onStyleChange={setStyleConfig}
          onSaveStyle={handleSaveStyle}
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
```

- [ ] **Step 8: Add CSS**

Append focused styles to `apps/web/src/styles.css`:

```css
.td-template-library {
  min-height: calc(100svh - 3.75rem);
  overflow: auto;
  padding: 1.25rem;
  background: var(--background);
}

.td-template-library-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1rem;
}

.td-template-library-heading h1,
.td-template-library-heading h2 {
  margin: 0;
  font-size: 1.25rem;
}

.td-template-tabs {
  display: inline-flex;
  gap: 0.25rem;
  margin-bottom: 1rem;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 0.25rem;
  background: var(--card);
}

.td-template-tabs button {
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--foreground);
  padding: 0.45rem 0.75rem;
}

.td-template-tabs button[aria-selected="true"] {
  background: var(--primary);
  color: var(--primary-foreground);
}

.td-template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 1rem;
}

.td-template-card {
  display: grid;
  height: auto;
  min-height: 23rem;
  justify-items: stretch;
  gap: 0.75rem;
  padding: 0.75rem;
  text-align: left;
  white-space: normal;
}

.td-template-card-title {
  font-weight: 700;
}

.td-template-card-description {
  color: var(--muted-foreground);
  font-size: 0.85rem;
}

.td-template-card-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.td-template-preview {
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  background: var(--td-surface-2);
  padding: 0.75rem;
}

.td-template-preview-card {
  aspect-ratio: 210 / 297;
  width: 100%;
}

.td-template-preview-detail {
  min-height: 34rem;
}

.td-template-paper {
  aspect-ratio: 210 / 297;
  width: min(100%, 28rem);
  overflow: hidden;
  background: #fff;
  color: #111827;
  padding: 2rem;
  font-family: Inter, "Noto Sans SC", "Microsoft YaHei", Arial, sans-serif;
}

.td-template-paper h3 {
  margin: 0 0 0.5rem;
  font-size: 1.5rem;
}

.td-template-paper p {
  color: #374151;
  font-size: 0.78rem;
  line-height: 1.5;
}

.td-template-detail-grid {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(280px, 360px);
  gap: 1rem;
}

.td-template-detail-header {
  display: flex;
  justify-content: space-between;
  margin-bottom: 1rem;
}

.td-template-detail-panel,
.td-template-sample-editor {
  display: grid;
  gap: 1rem;
}

.td-template-meta {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 0.4rem 0.75rem;
  font-size: 0.85rem;
}

.td-template-meta dt {
  color: var(--muted-foreground);
}

.td-template-style-field {
  display: grid;
  gap: 0.35rem;
}

.td-template-style-field small[role="alert"] {
  color: var(--destructive);
}

@media (max-width: 768px) {
  .td-template-detail-grid,
  .td-template-grid {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 9: Run component tests**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/features/templates/templates.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit template UI**

Run:

```powershell
git add apps/web/src/features/templates apps/web/src/styles.css
git commit -m "feat(templates): 新增模板库界面"
```

Expected: commit succeeds.

---

### Task 6: Workspace Navigation Integration

**Files:**
- Modify: `apps/web/src/features/workspace/types.ts`
- Modify: `apps/web/src/features/workspace/data.ts`
- Modify: `apps/web/src/features/workspace/components/WorkspaceSidebar.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Add failing app test**

Append this test to `apps/web/src/App.test.tsx`:

```tsx
it("opens the template library from the sidebar", async () => {
  render(<App />)

  fireEvent.click(screen.getByRole("button", { name: /模板库|Template Library/i }))

  expect(await screen.findByRole("heading", { name: "模板库" })).toBeInTheDocument()
  expect(screen.getByRole("button", { name: /Classic A4/ })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run app test and verify failure**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/App.test.tsx
```

Expected: FAIL because the sidebar has no Template Library entry.

- [ ] **Step 3: Add workspace section and copy**

Modify `apps/web/src/features/workspace/types.ts`:

```ts
export type WorkspaceSection = "workspace" | "templates" | "jobs" | "evidence" | "review" | "exports"
```

Add copy keys in both language objects in `apps/web/src/features/workspace/data.ts`:

```ts
templates: "模板库",
```

```ts
templates: "Template Library",
```

- [ ] **Step 4: Add sidebar item**

Modify imports in `apps/web/src/features/workspace/components/WorkspaceSidebar.tsx`:

```ts
import { LayoutTemplate } from "lucide-react"
```

Add nav item after `workspace`:

```ts
{ id: "templates", icon: LayoutTemplate },
```

- [ ] **Step 5: Render TemplateLibrary in App**

Add import in `apps/web/src/App.tsx`:

```ts
import { TemplateLibrary } from "./features/templates/components/TemplateLibrary"
```

Replace the direct workspace shell render with a conditional:

```tsx
{activeSection === "templates" ? (
  <TemplateLibrary copy={t} uiLanguage={uiLanguage} targetLanguage={targetLanguage} />
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
```

- [ ] **Step 6: Run app tests**

Run:

```powershell
corepack pnpm --filter @typedance/web test -- src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit navigation**

Run:

```powershell
git add apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/features/workspace
git commit -m "feat(workspace): 接入模板库导航"
```

Expected: commit succeeds.

---

### Task 7: End-To-End And Full Verification

**Files:**
- Modify: `apps/web/e2e/workspace.spec.ts`

- [ ] **Step 1: Add E2E smoke test**

Append this test to `apps/web/e2e/workspace.spec.ts`:

```ts
test("opens template library and classic template detail", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("button", { name: /模板库|Template Library/i }).click()
  await expect(page.getByRole("heading", { name: "模板库" })).toBeVisible()

  await page.getByRole("button", { name: /Classic A4/ }).click()
  await expect(page.getByText("classic-a4")).toBeVisible()
  await expect(page.getByLabel("A4 template sample preview")).toBeVisible()
})
```

- [ ] **Step 2: Run focused tests**

Run:

```powershell
corepack pnpm --filter @typedance/contracts test
corepack pnpm --filter @typedance/sidecar test
corepack pnpm --filter @typedance/web test -- src/features/templates/classPolicy.test.ts src/features/templates/templates.test.tsx src/App.test.tsx src/api.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Run full workspace test**

Run:

```powershell
corepack pnpm test
```

Expected: all package tests PASS.

- [ ] **Step 4: Run web build**

Run:

```powershell
corepack pnpm --filter @typedance/web build
```

Expected: TypeScript build and Vite build PASS.

- [ ] **Step 5: Run E2E test if local sidecar setup is available**

Run:

```powershell
corepack pnpm --filter @typedance/web test:e2e
```

Expected: PASS. If the command fails because the sidecar is not running or the browser dependencies are missing, capture the exact error and keep the unit/API verification as the blocking signal.

- [ ] **Step 6: Commit verification test**

Run:

```powershell
git add apps/web/e2e/workspace.spec.ts
git commit -m "test(templates): 覆盖模板库浏览流程"
```

Expected: commit succeeds.

---

## Self-Review

**Spec coverage:** This plan covers the sidebar Template Library entry, template list, template detail, sample TipTap content editing, local sidecar persistence, Tailwind CSS 4 class-based style configuration, PDF class allowlist/blocklist policy, front-end and sidecar validation, and tests. It explicitly leaves out drag-and-drop layout editing, arbitrary CSS, remote marketplace, and applying templates to the current resume.

**Placeholder scan:** The plan contains no `TBD`, no unscoped "add tests", and every implementation task names concrete files, commands, and expected results.

**Type consistency:** Shared names are consistent across the plan: `TemplateSampleContent`, `TemplateStyleConfig`, `PdfClassPolicy`, `template_id`, `class_name`, `allowlist`, `blocklist`, and `updated_at`.
