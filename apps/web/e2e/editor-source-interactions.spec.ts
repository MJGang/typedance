import { expect, test, type Page } from "@playwright/test"
import { execFileSync } from "node:child_process"
import { delimiter } from "node:path"
import { fileURLToPath } from "node:url"

const sidecarSource = fileURLToPath(new URL("../../../services/sidecar/src/", import.meta.url))
function runEditorBusiness(payload: Record<string, unknown> = {}) {
  return JSON.parse(execFileSync("python", ["-X", "utf8", "-c", [
    "import json, sys",
    "from typedance_sidecar.editor_operations import capability_catalog, prepare_operations",
    "payload = json.load(sys.stdin)",
    "result = prepare_operations(payload['doc_json'], payload['operations'], payload['catalog_revision'], payload.get('template_style')) if 'operations' in payload else capability_catalog()",
    "print(json.dumps(result))",
  ].join("\n")], { encoding: "utf8", input: JSON.stringify(payload),
    env: { ...process.env, PYTHONPATH: [sidecarSource, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
  }))
}

async function openCanvas(page: Page) {
  // 仅为浏览器夹具模拟桌面 IPC；所有业务请求仍走实际账号会话传输。
  await page.addInitScript(() => {
    let callbackId = 0
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
        transformCallback() { return ++callbackId },
        unregisterCallback() {},
        async invoke(command: string, args?: Record<string, unknown>) {
          if (command === "plugin:event|listen") return args?.handler
          if (command === "get_account_state") return {
            revision: 1, status: "ready", configured: true, providers: ["github"],
            user: { id: "source-test", name: "交互测试" },
            session: { id: "source-test", sidecar_url: "http://127.0.0.1:4317", agent_host_url: "http://127.0.0.1:4327", token: "test-source-session-token-with-32-characters" },
            error: null, legacy: null,
          }
          if (command === "get_client_update_state") return {
            revision: 0, phase: "idle", currentVersion: "0.1.23", releasesUrl: "https://example.com/releases", update: null,
            downloadedBytes: 0, totalBytes: null, lastCheckedAt: null, error: null,
          }
          return false
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    })
  })
  const text = (value: string, bold = false) => ({ type: "text", text: value, ...(bold ? { marks: [{ type: "bold" }] } : {}) })
  const paragraph = (value: string) => ({ type: "paragraph", content: [text(value)] })
  const canvas = {
    id: "canvas_source", document_id: "doc_source", old_resume_source_id: "source", version: 1,
    source_snapshot_hash: "sha256:seed", node_map: [], module_anchors: [],
    created_at: "2026-11-02T00:00:00Z", updated_at: "2026-11-02T00:00:00Z",
    doc_json: { type: "doc", content: [
      { type: "heading", attrs: { level: 2 }, content: [text("项目背景")] },
      paragraph("面向 ETC 业务人员，解决在处理错误码、页面报错及办理问题时依赖微信群人工求助。"),
      { type: "paragraph", content: [text("需求背景", true)] },
      paragraph("这里是需求背景下方的正文，切换源码时应保持原来的段落间距。"),
      ...["bulletList", "orderedList"].map((type) => ({ type, content: [
        { type: "listItem", content: [{ type: "paragraph", content: [text("性能治理", true), text("：Web Vitals、性能监控 SDK 与资源预加载。"), text("其他加粗", true)] }] },
        { type: "listItem", content: [paragraph("普通列表项正文")] },
      ] })),
      paragraph("工具栏选区测试文字"),
    ] },
  }
  const workspace = {
    document: { id: "doc_source", pack_id: "resume", title: "源码交互验收", status: "active", template_id: "classic-a4", current_draft_id: "draft", target_language: "zh-CN", created_at: canvas.created_at, updated_at: canvas.updated_at },
    current_draft: { id: "draft", document_id: "doc_source", status: "in_review", pack_id: "resume", variant_type: "base", run_id: "run", summary: "", applied_proposal_ids: [], unresolved_issue_ids: [], created_at: canvas.created_at, updated_at: canvas.updated_at },
    modules: [], claims: [], issues: [], proposals: [], evidence: [], source_summaries: [],
    source_resume_canvas: canvas, quality_gate: { status: "ready", blocking_issue_ids: [], warning_issue_ids: [] },
    run_status: { run_id: "run", status: "completed" }, coach_summary: { summary: "", next_action_ids: [] }, available_actions: [],
  }
  await page.route("http://127.0.0.1:4317/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/editor/capabilities" || path === "/editor/prepare") {
      await route.fulfill({ json: runEditorBusiness(path.endsWith("/prepare") ? route.request().postDataJSON() : {}) })
      return
    }
    if (path.endsWith("/source-resume-canvas") && route.request().method() === "PUT") {
      canvas.doc_json = route.request().postDataJSON().doc_json
      canvas.version++
    }
    const body = path === "/documents" ? [workspace.document] : path.endsWith("/workspace-view") ? workspace
      : path.endsWith("/source-resume-canvas") ? canvas : []
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })
  })
  await page.route("http://127.0.0.1:4327/**", (route) => route.fulfill({ json: route.request().url().endsWith("/settings/model")
    ? { provider: "deepseek", model: "test-model", base_url: "https://example.com", api_key: { configured: false, preview: null } } : [] }))
  await page.goto("/")
  await page.getByRole("link", { name: "打开简历 源码交互验收", exact: true }).click()
  await expect(page.locator(".td-rich-editor-prosemirror h2")).toHaveText("项目背景")
}

test("keeps the clicked Chinese caret and paragraph spacing when revealing source", async ({ page }) => {
  await openCanvas(page)
  const editor = page.locator(".td-rich-editor-prosemirror")
  const heading = editor.locator("h2")
  const body = editor.locator("p").filter({ hasText: "面向 ETC" })
  const before = (await body.boundingBox())!
  const point = await heading.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let text = walker.nextNode()
    while (text && !text.textContent?.includes("项目背景")) text = walker.nextNode()
    if (!text) throw new Error("Missing heading text")
    const range = document.createRange()
    range.setStart(text, 3)
    range.collapse(true)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y + rect.height / 2 }
  })
  await page.mouse.click(point.x, point.y)
  const source = editor.locator("textarea")
  await expect(source).toHaveValue("## 项目背景")
  await expect(source).toBeFocused()
  expect(await source.evaluate((input) => (input as HTMLTextAreaElement).selectionStart)).toBe(6)
  expect(Math.abs((await body.boundingBox())!.y - before.y)).toBeLessThan(2)
  await page.keyboard.type("验")
  await page.keyboard.press("Escape")
  await expect(heading).toHaveText("项目背验景")

  const bold = editor.locator("strong").filter({ hasText: "需求背景" })
  const following = editor.locator("p").filter({ hasText: "这里是需求" })
  const previousY = (await following.boundingBox())!.y
  const boldPoint = await bold.evaluate((element) => {
    const range = document.createRange()
    range.setStart(document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!, 3)
    range.collapse(true)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y + rect.height / 2 }
  })
  await page.mouse.click(boldPoint.x, boldPoint.y)
  await expect(source).toHaveValue("**需求背景**")
  expect(await source.evaluate((input) => (input as HTMLTextAreaElement).selectionStart)).toBe(5)
  expect(Math.abs((await following.boundingBox())!.y - previousY)).toBeLessThan(2)
  await page.screenshot({ path: test.info().outputPath("source-spacing.png") })
})

test("reveals list markers and inline bold independently", async ({ page }) => {
  await openCanvas(page)
  const editor = page.locator(".td-rich-editor-prosemirror")
  for (const tag of ["ul", "ol"]) {
    const list = editor.locator(`:scope > ${tag}`)
    const plain = list.locator("li").nth(1).locator("p")
    await plain.click()
    await expect(editor.locator("textarea")).toHaveCount(0)
    const bold = list.locator("strong").first()
    await bold.click()
    const source = editor.locator("textarea")
    await expect(source).toHaveValue("**性能治理**")
    await expect(list.locator("strong").last()).toHaveText("其他加粗")
    await expect(list.locator("li").first()).not.toHaveAttribute("data-markdown-source-list")
    await page.keyboard.press("Escape")
    const box = (await plain.boundingBox())!
    await page.mouse.click(box.x - 4, box.y + box.height / 2)
    await expect(source).toHaveValue(tag === "ul" ? "- " : "2. ")
    await expect(list.locator("strong").first()).toBeVisible()
    await page.keyboard.press("Escape")
  }
})

test("keeps selected text visible and formats it after opening the toolbar", async ({ page }) => {
  await openCanvas(page)
  const editor = page.locator(".td-rich-editor-prosemirror")
  const paragraph = editor.locator("p").filter({ hasText: "工具栏选区测试文字" })
  const box = (await paragraph.boundingBox())!
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + 70, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  const selected = await page.evaluate(() => window.getSelection()?.toString())
  expect(selected?.length).toBeGreaterThan(1)
  await page.getByRole("button", { name: "显示格式工具栏", exact: true }).click()
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected)
  expect(await editor.evaluate((element) => element.contains(document.activeElement))).toBe(true)
  await page.screenshot({ path: test.info().outputPath("toolbar-selection.png") })
  await page.getByRole("button", { name: "加粗", exact: true }).click()
  await expect(paragraph.locator("strong")).toHaveText(selected!)
})

test("preserves a source selection while revealing the toolbar", async ({ page }) => {
  await openCanvas(page)
  const source = page.locator(".td-rich-editor-prosemirror textarea")
  await page.locator(".td-rich-editor-prosemirror strong").filter({ hasText: "需求背景" }).click()
  await source.press("Home")
  await source.press("ArrowRight")
  await source.press("ArrowRight")
  await source.press("Shift+ArrowRight")
  await source.press("Shift+ArrowRight")
  await page.getByRole("button", { name: "显示格式工具栏", exact: true }).click()
  await expect(source).toBeFocused()
  expect(await source.evaluate((input) => {
    const textarea = input as HTMLTextAreaElement
    return textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
  })).toBe("需求")
  await page.getByRole("button", { name: "斜体", exact: true }).click()
  await expect(page.locator(".td-rich-editor-prosemirror em")).toHaveText("需求")
})

test("keeps typing focused through a divider intermediate state in inline source", async ({ page }) => {
  await openCanvas(page)
  const editor = page.locator(".td-rich-editor-prosemirror")
  const source = editor.locator("textarea")
  await editor.locator("strong").filter({ hasText: "需求背景" }).click()
  await source.press("Control+A")
  let typed = ""
  for (const character of "***新文字***") {
    typed += character
    await page.keyboard.type(character)
    await expect(source).toHaveValue(typed)
    await expect(source).toBeFocused()
  }
  await page.keyboard.press("Escape")
  await expect(editor.locator("strong em")).toHaveText("新文字")
  await expect(editor.locator("p").filter({ hasText: "这里是需求" })).toBeVisible()
})

test("continues typing after arrow navigation enters rendered list text", async ({ page }) => {
  await openCanvas(page)
  const editor = page.locator(".td-rich-editor-prosemirror")
  const list = editor.locator(":scope > ul")
  await list.locator("strong").first().click()
  const source = editor.locator("textarea")
  await source.press("End")
  await page.keyboard.press("ArrowDown")
  await expect(source).toHaveCount(0)
  await expect(editor).toBeFocused()
  await page.keyboard.type("新")
  await page.keyboard.press("Escape")
  await expect(list.locator("li").nth(1).locator("p")).toHaveText("新普通列表项正文")
})
