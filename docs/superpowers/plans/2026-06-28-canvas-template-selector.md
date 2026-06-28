# 画布模板选择器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在修订画布顶部工具栏中提供文档级模板选择，并确保画布预览与 PDF、HTML 导出始终使用同一模板样式。

**Architecture:** `Document.template_id` 是唯一持久化选择；Sidecar 负责默认值、迁移、更新和删除模板时的引用修正。Web 端通过一个纯函数合并官方模板定义与已保存样式，解析出唯一的 `selectedTemplateStyle`，同时传给 `DraftCanvas` 和导出请求。

**Tech Stack:** TypeScript、React、Vitest、shadcn/ui Select、Zod、Python、FastAPI、Pydantic、SQLite、pytest

---

## 文件结构

- `packages/contracts/src/revision/document.ts`：为跨进程文档契约增加必填 `template_id`。
- `services/sidecar/src/typedance_sidecar/revision_models.py`：为 Sidecar 文档模型增加模板 ID 与默认模板常量。
- `services/sidecar/src/typedance_sidecar/revision_repository.py`：迁移旧文档 payload，并批量重置模板引用。
- `services/sidecar/src/typedance_sidecar/revision_api.py`：创建文档默认模板，并支持部分更新 `title` / `template_id`。
- `services/sidecar/src/typedance_sidecar/main.py`：删除模板前修正文档引用。
- `services/sidecar/tests/test_revision_repository.py`：覆盖迁移与批量引用修正。
- `services/sidecar/tests/test_revision_api.py`：覆盖创建默认值和模板更新接口。
- `services/sidecar/tests/test_template_library.py`：覆盖删除模板时文档引用重置。
- `apps/web/src/api.ts`：允许更新文档模板 ID。
- `apps/web/src/features/templates/theme-options.ts`：集中构建官方/自定义模板选项。
- `apps/web/src/features/templates/theme-options.test.ts`：覆盖模板合并与解析。
- `apps/web/src/features/templates/components/TemplateLibrary.tsx`：复用统一模板选项构建逻辑。
- `apps/web/src/features/templates/components/style-panel/ThemeSelector.tsx`：支持加载/保存禁用状态。
- `apps/web/src/features/revision/RevisionWorkspacePage.tsx`：加载模板、持久化选择，并统一预览/导出样式。
- `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`：覆盖选择、失败回滚和导出一致性。

### Task 1: 文档契约、默认值与旧数据迁移

**Files:**
- Modify: `packages/contracts/src/revision/document.ts`
- Modify: `services/sidecar/src/typedance_sidecar/revision_models.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_repository.py`
- Modify: `services/sidecar/tests/test_revision_repository.py`

- [ ] **Step 1: 写失败的迁移与模型测试**

在 `test_revision_repository.py` 中构造不含 `template_id` 的旧 `documents.payload`，调用 `migrate_revision_payloads(connection)` 后断言：

```python
payload = json.loads(connection.execute(
    "SELECT payload FROM documents WHERE id = ?",
    ("doc_legacy",),
).fetchone()["payload"])
assert payload["template_id"] == "classic-a4"
assert Document.model_validate(payload).template_id == "classic-a4"
```

并在最小 Document 校验测试中显式加入：

```python
template_id="classic-a4",
```

- [ ] **Step 2: 运行测试并确认因字段/迁移缺失而失败**

Run:

```powershell
rtk pytest services/sidecar/tests/test_revision_repository.py -q
```

Expected: FAIL，旧 payload 没有 `template_id`，或 `Document` 尚无该字段。

- [ ] **Step 3: 实现唯一默认值和迁移**

在 Python 模型中定义并使用：

```python
DEFAULT_TEMPLATE_ID = "classic-a4"

class Document(BaseModel):
    id: str
    pack_id: str
    title: str
    template_id: str
    status: DocumentStatus
    target_language: Language
    current_draft_id: str | None = None
    accepted_draft_id: str | None = None
    created_at: str
    updated_at: str
```

在迁移入口调用 `_normalize_document_payloads`，仅做一次性数据修正：

```python
def _normalize_document_payloads(connection: sqlite3.Connection) -> None:
    rows = connection.execute("SELECT id, payload FROM documents").fetchall()
    for row in rows:
        payload = json.loads(row["payload"])
        if "template_id" in payload:
            continue
        payload["template_id"] = DEFAULT_TEMPLATE_ID
        connection.execute(
            "UPDATE documents SET payload = ? WHERE id = ?",
            (json.dumps(payload, ensure_ascii=False), row["id"]),
        )
```

TypeScript 契约增加：

```typescript
template_id: z.string().min(1),
```

- [ ] **Step 4: 运行聚焦测试**

Run:

```powershell
rtk pytest services/sidecar/tests/test_revision_repository.py -q
rtk corepack.cmd pnpm --filter @typedance/contracts build
```

Expected: PASS。

- [ ] **Step 5: 提交数据模型切片**

```powershell
rtk git add packages/contracts/src/revision/document.ts services/sidecar/src/typedance_sidecar/revision_models.py services/sidecar/src/typedance_sidecar/revision_repository.py services/sidecar/tests/test_revision_repository.py
rtk git commit -m "feat(canvas): 持久化文档模板选择"
```

### Task 2: Sidecar 模板更新与删除引用完整性

**Files:**
- Modify: `services/sidecar/src/typedance_sidecar/revision_api.py`
- Modify: `services/sidecar/src/typedance_sidecar/revision_repository.py`
- Modify: `services/sidecar/src/typedance_sidecar/main.py`
- Modify: `services/sidecar/tests/test_revision_api.py`
- Modify: `services/sidecar/tests/test_revision_repository.py`
- Modify: `services/sidecar/tests/test_template_library.py`

- [ ] **Step 1: 写失败的 API 与删除行为测试**

增加三条行为断言：

```python
assert client.post("/documents", json={
    "title": "模板测试",
    "initial_mode": "base_resume",
}).json()["template_id"] == "classic-a4"

updated = client.patch(
    f"/documents/{document_id}",
    json={"template_id": "custom-theme-1"},
)
assert updated.status_code == 200
assert updated.json()["template_id"] == "custom-theme-1"
assert updated.json()["title"] == original_title

client.delete("/template-styles/custom-theme-1")
assert client.get(f"/documents/{document_id}").json()["template_id"] == "classic-a4"
```

- [ ] **Step 2: 运行测试并确认因 API 不支持而失败**

Run:

```powershell
rtk pytest services/sidecar/tests/test_revision_api.py services/sidecar/tests/test_revision_repository.py services/sidecar/tests/test_template_library.py -q
```

Expected: FAIL，创建响应缺字段、PATCH 要求 title 或删除模板未重置引用。

- [ ] **Step 3: 实现部分更新和引用重置**

请求模型改成：

```python
class UpdateDocumentRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    template_id: str | None = Field(default=None, min_length=1)
```

更新接口只写入提交字段：

```python
updates = {"updated_at": utc_now()}
if payload.title is not None:
    updates["title"] = payload.title
if payload.template_id is not None:
    updates["template_id"] = payload.template_id
return repo.save_document(document.model_copy(update=updates))
```

Repository 增加单事务批量修正：

```python
def reassign_document_template(self, template_id: str, replacement_id: str) -> int:
    changed = 0
    for document in self.list_documents():
        if document.template_id != template_id:
            continue
        self._save_without_commit(
            "documents",
            document.model_copy(update={
                "template_id": replacement_id,
                "updated_at": utc_now(),
            }),
            {},
        )
        changed += 1
    self.connection.commit()
    return changed
```

删除模板路由在确认模板存在后执行：

```python
revision_repo.reassign_document_template(template_id, DEFAULT_TEMPLATE_ID)
deleted = style_repo.delete(template_id)
```

- [ ] **Step 4: 运行 Sidecar 聚焦测试**

Run:

```powershell
rtk pytest services/sidecar/tests/test_revision_api.py services/sidecar/tests/test_revision_repository.py services/sidecar/tests/test_template_library.py -q
```

Expected: PASS。

- [ ] **Step 5: 提交 Sidecar 行为切片**

```powershell
rtk git add services/sidecar/src/typedance_sidecar/revision_api.py services/sidecar/src/typedance_sidecar/revision_repository.py services/sidecar/src/typedance_sidecar/main.py services/sidecar/tests/test_revision_api.py services/sidecar/tests/test_revision_repository.py services/sidecar/tests/test_template_library.py
rtk git commit -m "feat(canvas): 支持更新和清理模板引用"
```

### Task 3: 统一前端模板选项解析

**Files:**
- Create: `apps/web/src/features/templates/theme-options.ts`
- Create: `apps/web/src/features/templates/theme-options.test.ts`
- Modify: `apps/web/src/features/templates/components/TemplateLibrary.tsx`
- Modify: `apps/web/src/features/templates/components/TemplateDetail.tsx`
- Modify: `apps/web/src/features/templates/components/style-panel/ThemeSelector.tsx`

- [ ] **Step 1: 写失败的纯函数测试**

测试输入包含一个已保存官方样式和一个自定义样式，断言：

```typescript
const themes = buildTemplateThemes([savedClassic, custom], "zh-CN")

expect(themes.map(({ id, source }) => ({ id, source }))).toEqual([
  { id: "custom-theme-1", source: "custom" },
  { id: "classic-a4", source: "default" },
])
expect(themes.find((theme) => theme.id === "classic-a4")?.styleConfig).toBe(savedClassic)
```

另测没有保存官方样式时使用 `defaultClassicA4Style`，但不为缺失的自定义模板生成 fallback。

- [ ] **Step 2: 运行测试并确认模块不存在**

Run:

```powershell
rtk corepack.cmd pnpm --filter @typedance/web exec vitest run src/features/templates/theme-options.test.ts
```

Expected: FAIL，`theme-options.ts` 不存在。

- [ ] **Step 3: 实现共享主题构建器**

```typescript
export type TemplateTheme = {
  id: string
  title: string
  description: string
  source: "default" | "custom"
  styleConfig: TemplateStyleConfig
}

export function buildTemplateThemes(
  savedStyles: TemplateStyleConfig[],
  uiLanguage: UiLanguage,
): TemplateTheme[] {
  const styleMap = new Map(savedStyles.map((style) => [style.template_id, style]))
  const defaultThemes = templateRegistry.map((template) => ({
    id: template.id,
    title: (styleMap.get(template.id)?.name ?? template.localizedName[uiLanguage]),
    description: template.description[uiLanguage],
    source: "default" as const,
    styleConfig: styleMap.get(template.id) ?? defaultClassicA4Style,
  }))
  const customThemes = savedStyles
    .filter((style) => !templateRegistry.some((template) => template.id === style.template_id))
    .map((style, index) => ({
      id: style.template_id,
      title: style.name?.trim() || `自定义主题 ${index + 1}`,
      description: "本地自定义主题",
      source: "custom" as const,
      styleConfig: style,
    }))
  return [...customThemes, ...defaultThemes]
}
```

`TemplateLibrary` 删除本地重复合并逻辑并复用该函数。`ThemeSelector` 增加 `disabled?: boolean`，把它传给 `Select`。

- [ ] **Step 4: 运行模板测试和 TemplateLibrary 相关测试**

Run:

```powershell
rtk corepack.cmd pnpm --filter @typedance/web exec vitest run src/features/templates/theme-options.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交共享模板解析切片**

```powershell
rtk git add apps/web/src/features/templates/theme-options.ts apps/web/src/features/templates/theme-options.test.ts apps/web/src/features/templates/components/TemplateLibrary.tsx apps/web/src/features/templates/components/TemplateDetail.tsx apps/web/src/features/templates/components/style-panel/ThemeSelector.tsx
rtk git commit -m "refactor(templates): 统一模板选项解析"
```

### Task 4: 工具栏选择、预览与导出一致性

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.tsx`
- Modify: `apps/web/src/features/revision/RevisionWorkspacePage.test.tsx`

- [ ] **Step 1: 写失败的工作台回归测试**

扩展 API mocks，提供 `listTemplateStyles`。加载页面后断言工具栏显示当前模板，且 `DraftCanvas` 收到该样式：

```typescript
expect(await screen.findByRole("combobox", { name: "选择模板" })).toHaveTextContent("经典 A4")
expect(draftCanvasMocks.render).toHaveBeenLastCalledWith(
  expect.objectContaining({ templateStyle: customStyle }),
)
```

选择自定义模板后断言：

```typescript
expect(apiMocks.updateRevisionDocument).toHaveBeenCalledWith(
  "doc_1",
  { template_id: "custom-theme-1" },
)
expect(draftCanvasMocks.render).toHaveBeenLastCalledWith(
  expect.objectContaining({ templateStyle: customStyle }),
)
```

触发 PDF 导出并断言同一对象进入 payload：

```typescript
expect(apiMocks.exportRevisionDocumentPdf).toHaveBeenCalledWith(
  "doc_1",
  expect.any(String),
  expect.objectContaining({ templateStyle: customStyle }),
)
```

更新失败时断言选择值和 `DraftCanvas.templateStyle` 保持原样，并调用 `toast.error`。

- [ ] **Step 2: 运行测试并确认工具栏/加载逻辑缺失**

Run:

```powershell
rtk corepack.cmd pnpm --filter @typedance/web exec vitest run src/features/revision/RevisionWorkspacePage.test.tsx
```

Expected: FAIL，找不到“选择模板”或仍使用 `defaultClassicA4Style`。

- [ ] **Step 3: 实现并行加载和单一选中样式**

`LoadState.loaded` 同时保存 `workspace` 与 `themes`，加载使用：

```typescript
const [workspace, savedStyles] = await Promise.all([
  getRevisionWorkspaceView(capturedDocumentId),
  listTemplateStyles(),
])
const themes = buildTemplateThemes(savedStyles, "zh-CN")
```

解析当前样式：

```typescript
const selectedTheme = themes.find(
  (theme) => theme.id === workspace.document.template_id,
)
const selectedTemplateStyle = selectedTheme?.styleConfig
```

切换成功后只替换 `workspace.document`：

```typescript
const updatedDocument = await updateRevisionDocument(workspace.document.id, {
  template_id: templateId,
})
setState((current) => current.status === "loaded"
  ? {
      ...current,
      workspace: { ...current.workspace, document: updatedDocument },
    }
  : current)
```

渲染：

```tsx
<ThemeSelector
  value={workspace.document.template_id}
  options={themes}
  onChange={(templateId) => void handleTemplateChange(templateId)}
  disabled={isSavingTemplate}
/>
```

并确保两个出口使用同一变量：

```tsx
<DraftCanvas templateStyle={selectedTemplateStyle} />
```

```typescript
templateStyle: selectedTemplateStyle,
```

若 `selectedTemplateStyle` 不存在，显示模板数据错误并禁用导出，不读取默认模板。

- [ ] **Step 4: 运行前端聚焦测试**

Run:

```powershell
rtk corepack.cmd pnpm --filter @typedance/web exec vitest run src/features/templates/theme-options.test.ts src/features/revision/RevisionWorkspacePage.test.tsx src/features/revision/DraftCanvas.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 提交工作台功能切片**

```powershell
rtk git add apps/web/src/api.ts apps/web/src/features/revision/RevisionWorkspacePage.tsx apps/web/src/features/revision/RevisionWorkspacePage.test.tsx
rtk git commit -m "feat(canvas): 新增模板选择并统一导出样式"
```

### Task 5: 完整验证与推送

**Files:**
- Verify: all modified files

- [ ] **Step 1: 运行 Sidecar 相关测试**

```powershell
rtk pytest services/sidecar/tests/test_revision_repository.py services/sidecar/tests/test_revision_api.py services/sidecar/tests/test_template_library.py -q
```

Expected: PASS。

- [ ] **Step 2: 运行 Web 测试与构建**

```powershell
rtk corepack.cmd pnpm --filter @typedance/web test
rtk corepack.cmd pnpm --filter @typedance/web build
```

Expected: PASS。

- [ ] **Step 3: 检查 shadcn Maia 配置**

```powershell
rtk corepack.cmd pnpm dlx shadcn@latest info --json
```

Expected: `style` 为 `radix-maia`，`select` 在组件列表中。

- [ ] **Step 4: 检查 diff 与分支**

```powershell
rtk git diff --check
rtk git status --short
rtk git log -5 --oneline
rtk git branch --show-current
```

Expected: 当前分支为 `main`，工作区无未提交文件。

- [ ] **Step 5: 推送**

```powershell
rtk git push origin main
```

Expected: `main` 成功推送到远端。
