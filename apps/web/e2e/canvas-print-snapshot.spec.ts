import { expect, test, type Page } from "@playwright/test"
import type { CanvasPrintSnapshot, SourceResumeCanvas, WorkspaceView } from "@typedance/contracts"

const DOCUMENT_ID = "doc_print_layout"
const NOW = "2026-09-26T08:00:00.000Z"

function paragraph(text = "") {
  return { type: "paragraph", content: text ? [{ type: "text", text }] : [] }
}

function buildWorkspace(blankCount: number): WorkspaceView {
  const content = [
    { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [{ type: "text", text: "Synthetic resume" }] },
    ...Array.from({ length: 36 }, (_, index) => paragraph(`Experience ${index + 1}: document layout and export verification.`)),
    ...Array.from({ length: blankCount }, () => paragraph()),
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Project experience" }] },
    {
      type: "columns",
      attrs: { count: 3, gap: "default", widths: [45, 30, 25] },
      content: ["Example project", "Developer", "2024 - 2026"].map((text) => ({ type: "column", content: [paragraph(text)] })),
    },
    {
      type: "bulletList",
      content: [{
        type: "listItem",
        content: [paragraph("Project highlights:"), {
          type: "orderedList",
          content: Array.from({ length: 12 }, (_, index) => ({
            type: "listItem",
            content: [paragraph(`Result ${index + 1}: preserve every word, line and page position after export.`)],
          })),
        }],
      }],
    },
    ...Array.from({ length: 50 }, (_, index) => paragraph(`Additional experience ${index + 1}: independent pagination regression fixture.`)),
  ]
  const canvas: SourceResumeCanvas = {
    id: `canvas_${DOCUMENT_ID}`,
    document_id: DOCUMENT_ID,
    old_resume_source_id: `source_${DOCUMENT_ID}`,
    version: 1,
    source_snapshot_hash: "sha256:synthetic-print-fixture",
    doc_json: { type: "doc", content },
    node_map: [],
    module_anchors: [],
    created_at: NOW,
    updated_at: NOW,
  }
  return {
    document: {
      id: DOCUMENT_ID, pack_id: "resume", title: "Synthetic print fixture", status: "active",
      target_language: "en-US", template_id: "classic-a4", current_draft_id: `draft_${DOCUMENT_ID}`,
      created_at: NOW, updated_at: NOW,
    },
    current_draft: {
      id: `draft_${DOCUMENT_ID}`, document_id: DOCUMENT_ID, run_id: `run_${DOCUMENT_ID}`, pack_id: "resume",
      status: "in_review", summary: "Synthetic fixture", applied_proposal_ids: [], unresolved_issue_ids: [],
      variant_type: "base", created_at: NOW, updated_at: NOW,
    },
    modules: [], claims: [], issues: [], proposals: [], evidence: [], source_summaries: [],
    source_resume_canvas: canvas,
    quality_gate: { status: "ready", blocking_issue_ids: [], warning_issue_ids: [] },
    run_status: { run_id: `run_${DOCUMENT_ID}`, status: "completed" },
    coach_summary: { summary: "Synthetic fixture", next_action_ids: [] },
    available_actions: [],
  }
}

async function openWorkspace(page: Page, blankCount: number) {
  const workspace = buildWorkspace(blankCount)
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true })
  })
  await page.route("http://127.0.0.1:4317/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const response = path.endsWith("/workspace-view") ? workspace
      : path.endsWith("/source-resume-canvas") ? workspace.source_resume_canvas : []
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) })
  })
  await page.goto(`/packs/resume/workspaces/${DOCUMENT_ID}`)
  await expect(page.locator(".td-source-resume-canvas .ProseMirror h1")).toHaveText("Synthetic resume")
  await expect.poll(() => page.locator(".td-source-resume-canvas .rm-pagination-gap").count()).toBeGreaterThan(1)
}

async function captureSnapshot(page: Page): Promise<CanvasPrintSnapshot> {
  return page.evaluate(async () => {
    // Vite loads the production helper in the browser, with its actual dependency graph.
    const modulePath = "/src/features/revision/canvasPrintSnapshot.ts"
    const { prepareCanvasPrintSnapshot } = await import(/* @vite-ignore */ modulePath)
    const editor = document.querySelector<HTMLElement>(".td-source-resume-canvas .ProseMirror")
    if (!editor) throw new Error("Missing editor")
    return prepareCanvasPrintSnapshot(editor)
  })
}

function measureLayout(pageTops: number[]) {
  const root = document.querySelector<HTMLElement>(".ProseMirror")
  if (!root) throw new Error("Missing rendered document")
  const rootRect = root.getBoundingClientRect()
  const scale = rootRect.width / Number.parseFloat(getComputedStyle(root).width)
  const toPosition = (rect: DOMRect) => {
    const y = (rect.top - rootRect.top) / scale
    const page = pageTops.reduce((result, top, index) => y >= top - 0.01 ? index : result, 0)
    return { x: (rect.left - rootRect.left) / scale, y: y - pageTops[page], page }
  }
  const chars: Array<{ text: string; x: number; y: number; page: number }> = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest(".rm-pages-wrapper,.rm-pagination-gap,button,svg,.td-module-interaction-only,.td-column-width-label")) continue
    for (let offset = 0; offset < (node.textContent?.length ?? 0); offset += 1) {
      const text = node.textContent![offset]
      if (/\s/.test(text)) continue
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 1)
      const rect = range.getBoundingClientRect()
      if (rect.width && rect.height) chars.push({ text, ...toPosition(rect) })
    }
  }
  const blanks = Array.from(root.querySelectorAll("p"))
    .filter((element) => !element.textContent?.trim())
    .map((element) => ({ ...toPosition(element.getBoundingClientRect()), height: element.getBoundingClientRect().height / scale }))
  const headings = Array.from(root.querySelectorAll("h1,h2,h3"), (element) => ({
    text: element.textContent,
    ...toPosition(element.getBoundingClientRect()),
    width: element.getBoundingClientRect().width / scale,
    height: element.getBoundingClientRect().height / scale,
  }))
  return { chars, blanks, headings, headingAlignment: getComputedStyle(root.querySelector("h1")!).textAlign }
}

for (const blankCount of [0, 1, 4]) {
  test(`preserves text positions, pages and ${blankCount} empty paragraphs in a standalone snapshot`, async ({ page, context }, testInfo) => {
    await openWorkspace(page, blankCount)
    const snapshot = await captureSnapshot(page)
    const source = await page.evaluate(measureLayout, snapshot.page_tops)
    expect(snapshot.page_tops.length).toBeGreaterThan(2)
    expect(source.chars.length).toBeGreaterThan(4000)
    expect(source.blanks).toHaveLength(blankCount)
    expect(source.headingAlignment).toBe("center")

    // No editor/application stylesheet is loaded: export must be self-contained.
    const standalone = await context.newPage()
    await standalone.setContent(`<!doctype html><html><body style="margin:0"><main style="position:relative;width:${snapshot.page_width}px">${snapshot.html}</main></body></html>`)
    await standalone.evaluate(() => document.fonts.ready)
    const exported = await standalone.evaluate(measureLayout, snapshot.page_tops)
    expect(exported.headingAlignment).toBe("center")
    expect(exported.chars.map((char) => char.text).join("")).toBe(source.chars.map((char) => char.text).join(""))
    expect(exported.chars.map((char) => char.page)).toEqual(source.chars.map((char) => char.page))
    const maximumTextDrift = Math.max(...source.chars.map((char, index) => Math.max(
      Math.abs(char.x - exported.chars[index].x), Math.abs(char.y - exported.chars[index].y),
    )))
    expect(maximumTextDrift).toBeLessThan(0.1)
    expect(exported.blanks).toEqual(source.blanks)
    expect(exported.headings).toEqual(source.headings)
    await testInfo.attach("layout-comparison", {
      contentType: "application/json",
      body: JSON.stringify({
        blankCount,
        pageCount: snapshot.page_tops.length,
        characterCount: source.chars.length,
        maximumTextDrift,
        blanks: exported.blanks,
        headings: exported.headings,
      }, null, 2),
    })
    await expect(standalone.locator("button,[contenteditable],.td-column-resize-handle")).toHaveCount(0)
    await standalone.close()
  })
}

for (const format of ["pdf", "html"] as const) {
  test(`the ${format.toUpperCase()} export button submits the current measured canvas snapshot`, async ({ page }) => {
    await openWorkspace(page, 4)
    const expected = await captureSnapshot(page)
    let submitted: { print_snapshot: CanvasPrintSnapshot } | undefined
    await page.route(`http://127.0.0.1:4317/documents/${DOCUMENT_ID}/canvas-export/${format}`, async (route) => {
      submitted = route.request().postDataJSON()
      await route.fulfill({
        status: 200,
        contentType: format === "pdf" ? "application/pdf" : "text/html",
        body: format === "pdf" ? "%PDF-1.7\n%%EOF" : "<!doctype html><title>Fixture export</title>",
      })
    })
    await page.getByRole("button", { name: "导出", exact: true }).click()
    await page.getByRole("menuitem", { name: `导出 ${format.toUpperCase()}` }).click()
    await expect.poll(() => submitted).toBeDefined()
    expect(Object.keys(submitted!)).toEqual(["print_snapshot"])
    expect(submitted!.print_snapshot.page_tops).toEqual(expected.page_tops)
    expect(submitted!.print_snapshot.page_width).toBe(expected.page_width)
    expect(submitted!.print_snapshot.page_height).toBe(expected.page_height)
    expect(submitted!.print_snapshot.html).toContain("Synthetic resume")
    expect(submitted!.print_snapshot.html).toContain("Project highlights:")
  })
}

for (const targetSelector of [".td-columns-editor", ".ProseMirror"]) {
  test(`export waits for the AI feedback highlight on ${targetSelector} and preserves its background`, async ({ page, context }) => {
    await openWorkspace(page, 1)
    await captureSnapshot(page)
    const { snapshot, resolvedWithFlash, flashingAnimation } = await page.evaluate(async (targetSelector) => {
      const modulePath = "/src/features/revision/canvasPrintSnapshot.ts"
      const { prepareCanvasPrintSnapshot } = await import(/* @vite-ignore */ modulePath)
      const editor = document.querySelector<HTMLElement>(".td-source-resume-canvas .ProseMirror")!
      const target = editor.matches(targetSelector) ? editor : editor.querySelector<HTMLElement>(targetSelector)!
      target.style.setProperty("background-color", "rgb(240, 225, 200)", "important")
      target.classList.add("td-ai-canvas-flash")
      const flashingAnimation = getComputedStyle(target).animationName
      let resolved = false
      const pending = prepareCanvasPrintSnapshot(editor).then((snapshot: CanvasPrintSnapshot) => {
        resolved = true
        return snapshot
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 200))
      if (!target.classList.contains("td-ai-canvas-flash")) throw new Error("Fixture highlight was removed before capture")
      const resolvedWithFlash = resolved
      target.classList.remove("td-ai-canvas-flash")
      return { snapshot: await pending, resolvedWithFlash, flashingAnimation }
    }, targetSelector)
    expect(flashingAnimation).toBe("td-ai-canvas-flash")
    expect(resolvedWithFlash).toBe(false)
    expect(snapshot.html).not.toContain("td-ai-canvas-flash")

    const standalone = await context.newPage()
    await standalone.setContent(snapshot.html)
    const exportedBackground = await standalone.locator(targetSelector).evaluate((element) => ({
      color: getComputedStyle(element).backgroundColor,
      image: getComputedStyle(element).backgroundImage,
    }))
    expect(exportedBackground).toEqual({ color: "rgb(240, 225, 200)", image: "none" })
    await standalone.close()
  })
}
