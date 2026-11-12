import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"
import { expect, test, type Locator, type Page } from "@playwright/test"
import type { CanvasPrintSnapshot, EditorRequest, EditorSnapshot } from "@typedance/contracts"

const root = resolve(import.meta.dirname, "../../..")
const richTimeline = JSON.parse(readFileSync(resolve(root, "services/sidecar/tests/fixtures/timeline_rich.json"), "utf8"))
const python = `import json,sys
from typedance_sidecar.editor_operations import capability_catalog,prepare_operations
p=json.load(sys.stdin)
print(json.dumps(prepare_operations(**p) if p else capability_catalog(),ensure_ascii=False))`

function backend(payload?: unknown) {
  return execFileSync("python", ["-X", "utf8", "-c", python], {
    cwd: root, input: JSON.stringify(payload ?? null), encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resolve(root, "services/sidecar/src") },
  })
}

const p = (text = "") => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })
const initial = { type: "doc", content: [p("工作经历"), p("保留的普通正文")] }

function longRichDoc() {
  const doc = structuredClone(richTimeline)
  doc.content[1].content[1].content[1].content.push(...Array.from({ length: 26 }, (_, index) => ({ type: "listItem", content: [p(`跨页成果 ${index + 1}：复杂表格、查询面板与数据分析需要保持嵌套列表和三栏表头完整，正文宽高随内容调整。`)] })))
  return doc
}

const pageBreakDoc = { type: "doc", content: [
  ...Array.from({ length: 25 }, (_, index) => p(`前一页内容 ${index + 1}`)),
  { type: "timeline", content: [richTimeline.content[1].content[0]] },
] }

async function openPageBreakPreview(page: Page, preview: "template" | "transaction", transaction?: EditorRequest["transaction"], toolbarVisible = true) {
  const request: EditorRequest = {
    id: "request", document_id: "doc", editor_session_id: "session", kind: "transaction", mode: "review",
    transaction: transaction ?? { id: "transaction", document_id: "doc", editor_session_id: "session", content_revision: 1,
      before_doc_json: initial, doc_json: pageBreakDoc, catalog_revision: "current", summary: "调整项目标题",
      effects: [], node_origins: [], text_origins: [] },
  }
  await page.route("**/__timeline-preview-test", (route) => route.fulfill({ contentType: "text/html", body: `
    <!doctype html><html><head><meta charset="utf-8"></head><body><div id="test-root"></div>
    <script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
    window.__vite_plugin_react_preamble_installed__=true;
    </script><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import '/src/styles.css';
    import {TooltipProvider} from '/src/components/ui/tooltip.tsx';
    import {builtInSamples,defaultClassicA4Style} from '/src/features/templates/data.ts';
    const h=React.createElement;
    let content;
    if (${JSON.stringify(preview)} === 'template') {
      const {TemplateDetail}=await import('/src/features/templates/components/TemplateDetail.tsx');
      const theme={id:'classic-a4',title:'经典 A4',source:'default',styleConfig:defaultClassicA4Style};
      const noop=()=>{};
      content=h(TemplateDetail,{theme,themes:[theme],sample:builtInSamples['sample-tech-zh'],uiLanguage:'zh-CN',
        previewId:'fixture',previewDocJson:${JSON.stringify(pageBreakDoc)},previewLoading:false,
        sampleStatus:'',styleStatus:'主题已同步',hasUnsavedStyleChanges:false,isSavingStyle:false,
        onThemeChange:noop,onStyleChange:noop,onSaveStyle:async()=>true,onSaveAsTemplate:noop,onRetryPreview:noop});
    } else {
      const {EditorRequestCard}=await import('/src/features/revision/EditorRequestCard.tsx');
      const {DraftCanvas}=await import('/src/features/revision/DraftCanvas.tsx');
      const {EditorReferencesProvider,useEditorReferences}=await import('/src/features/revision/references/EditorReferences.tsx');
      const {useSourceCanvasAutosave}=await import('/src/features/revision/useSourceCanvasAutosave.ts');
      const {setAccountSession}=await import('/src/accountSession.ts');
      setAccountSession({id:'preview-test',sidecar_url:'http://127.0.0.1:4317',agent_host_url:'http://127.0.0.1:4318',token:'synthetic-preview-test'});
      const request=${JSON.stringify(request)};
      const canvas={id:'source',document_id:request.document_id,old_resume_source_id:'source',version:1,
        doc_json:request.transaction.before_doc_json,node_map:[],module_anchors:[],source_snapshot_hash:'fixture',
        created_at:'2026-11-12T00:00:00Z',updated_at:'2026-11-12T00:00:00Z'};
      function Workspace() {
        const references=useEditorReferences();
        const autosave=useSourceCanvasAutosave(canvas.document_id,()=>{});
        window.readSourceCanvas=()=>references.getPayload().then(result=>result.snapshot);
        return h('div',{style:{height:'100vh',display:'grid',gridTemplateColumns:'minmax(850px,1fr) 380px'}},
          h(DraftCanvas,{canvas,onChange:autosave.handleChange,saveStatus:autosave.saveStatus,toolbarVisible:${toolbarVisible}}),
          h('aside',null,h(EditorRequestCard,{runId:'run',request,events:[],active:true})));
      }
      content=h(EditorReferencesProvider,{documentId:canvas.document_id},h(Workspace));
    }
    ReactDOM.createRoot(document.getElementById('test-root')).render(h(TooltipProvider,null,content));
    </script></body></html>` }))
  await page.goto("/__timeline-preview-test")
  if (preview === "transaction" && !transaction) await page.getByRole("button", { name: "查看修改预览" }).click()
  return page.getByLabel(preview === "template" ? "主题演示简历预览" : "修改后的简历预览")
}

async function firstPageLayout(editor: Locator) {
  await expect(editor.locator(".rm-page-break")).toHaveCount(2)
  return editor.evaluate((element) => {
    const paper = element.getBoundingClientRect()
    const firstParagraph = element.querySelector(":scope > p")!.getBoundingClientRect()
    const pageBreak = element.querySelector(".rm-page-break > .breaker")!.getBoundingClientRect()
    const pageGap = element.querySelector(".rm-pagination-gap")!.getBoundingClientRect()
    return {
      bodyTop: Math.round(firstParagraph.top - paper.top),
      bodyLeft: Math.round(firstParagraph.left - paper.left),
      bodyRight: Math.round(paper.right - firstParagraph.right),
      bodyEnd: Math.round(pageBreak.top - paper.top),
      pageEnd: Math.round(pageGap.top - paper.top),
    }
  })
}

for (const mode of ["template", "transaction"] as const) {
  test(`${mode} preview matches canvas pagination and keeps the timeline header together`, async ({ page }) => {
    await openEditor(page, pageBreakDoc)
    const canvasLayout = await firstPageLayout(page.getByLabel("时间轴验收画布"))
    const preview = await openPageBreakPreview(page, mode)
    const row = preview.locator(".td-timeline-body .td-columns-content")
    await expect(row).toContainText("示例科技有限公司")
    await expect(row).toContainText("2023.02 - 2026.02")
    expect(await firstPageLayout(preview)).toEqual(canvasLayout)

    const layout = await row.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const body = element.closest(".td-timeline-body")!.getBoundingClientRect()
      const gap = element.closest(".ProseMirror")!.querySelector(".rm-page-break > .breaker")!.getBoundingClientRect()
      return { rowLeft: rect.left, rowWidth: rect.width, rowTop: rect.top, bodyLeft: body.left, bodyWidth: body.width, gapBottom: gap.bottom }
    })
    expect(layout.rowTop).toBeGreaterThanOrEqual(layout.gapBottom - 1)
    expect(layout.rowLeft).toBeCloseTo(layout.bodyLeft, 0)
    expect(layout.rowWidth).toBeCloseTo(layout.bodyWidth, 0)
  })
}

test("画布预览按真实分页标记改动范围，取消和反复预览不保存原稿", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  const longText = "项目资料。" + "跨页工作说明覆盖需求评审、联调和交付后的反馈整理。".repeat(102)
  const before = { type: "doc", content: [
    p("项目一"), p("项目一说明"), p("项目二"), p("项目二说明"), p("保留的普通正文"),
    p("工作经历一"), p("工作经历二"),
    { type: "columns", attrs: { count: 3 }, content: ["版本管理", "工具调用", "混合检索"].map(text => ({ type: "column", content: [p(text)] })) },
    p(longText),
  ] }
  const operations = [
    { capability: "blocks.move", parameters: { paths: [[2], [3]], before: [0] } },
    { capability: "blocks.insert", parameters: { parent: [], index: 2, kind: "horizontalRule" } },
    { capability: "timeline.wrap", parameters: { paths: [[6], [7]] } },
    { capability: "timeline.split", parameters: { path: [6, 0, 1] } },
    { capability: "text.replace", parameters: { path: [7, 1, 0], text: "工具调用", replacement: "工具编排" } },
    { capability: "text.replace", parameters: { path: [8], text: "项目资料", replacement: "验收清单" } },
  ]
  const catalog = JSON.parse(backend())
  const result = JSON.parse(backend({ doc_json: before, operations, catalog_revision: catalog.revision }))
  const transaction: NonNullable<EditorRequest["transaction"]> = {
    ...result, id: "scope-test", document_id: "doc", editor_session_id: "session",
    content_revision: 0, summary: "调整项目顺序、分栏和工作经历", before_doc_json: before,
  }
  let writes = 0
  await page.route("http://127.0.0.1:4317/**", route => {
    if (route.request().method() === "PUT") writes++
    return route.fulfill({ status: 409, json: { detail: "此用例中画布不应保存" } })
  })
  const preview = await openPageBreakPreview(page, "transaction", transaction)
  const readSource = () => page.evaluate(async () => {
    const snapshot = await (window as Window & { readSourceCanvas: () => Promise<EditorSnapshot | undefined> }).readSourceCanvas()
    if (!snapshot) return undefined
    return { doc: snapshot.doc_json, revision: snapshot.content_revision, version: snapshot.canvas_version, session: snapshot.editor_session_id }
  })
  await expect(page.getByLabel("原始简历编辑区")).toBeVisible()
  await expect.poll(readSource).toBeDefined()
  const source = await readSource()
  await page.getByRole("button", { name: "查看修改预览" }).click()
  await expect(preview).toBeVisible()
  await expect(preview).toHaveAttribute("contenteditable", "false")
  await expect(page.locator("[data-td-editor-document]")).toHaveAttribute("inert", "")
  await expect(preview.locator(".td-timeline-entry")).toHaveCount(2)
  await expect(preview).toContainText("工具编排")
  await expect(preview).toContainText("验收清单")
  await expect(preview.locator("hr")).toHaveCount(1)
  const overlay = page.locator("[data-td-preview-overlay]")
  await expect(overlay.locator(".td-preview-ink")).toHaveCount(2)
  const geometry = await preview.evaluate(editor => {
    const rect = (element: Element) => element.getBoundingClientRect()
    const cards = Array.from(editor.closest("[data-td-canvas-preview]")!.querySelectorAll("[data-td-preview-region]"), rect)
    const paragraphs = Array.from(editor.querySelectorAll("p"))
    const unchanged = rect(paragraphs.find(p => p.textContent === "保留的普通正文")!)
    const long = rect(paragraphs.find(p => p.textContent?.startsWith("验收清单"))!)
    const columns = rect(editor.querySelector(".td-columns-editor")!)
    const divider = rect(editor.querySelector("hr")!)
    const timeline = rect(editor.querySelector(".td-timeline")!)
    const covers = (target: DOMRect) => cards.some(card => card.top <= target.top + 1 && card.bottom >= target.bottom - 1
      && card.left <= target.left + 1 && card.right >= target.right - 1)
    const gaps = Array.from(editor.querySelectorAll(".rm-page-break > .breaker"), rect).filter(gap => gap.height > 0)
    return {
      unchanged: cards.some(card => card.top <= unchanged.top + unchanged.height / 2 && card.bottom >= unchanged.top + unchanged.height / 2),
      crossing: cards.filter(card => card.bottom > long.top + 4 && card.top < long.bottom - 4).length,
      inGaps: cards.some(card => gaps.some(gap => card.top < gap.bottom - 1 && card.bottom > gap.top + 1)),
      row: covers(columns), divider: covers(divider), timeline: covers(timeline),
      order: (paragraphs.findIndex(p => p.textContent === "项目二") < paragraphs.findIndex(p => p.textContent === "项目一")),
    }
  })
  expect(geometry).toMatchObject({ unchanged: false, inGaps: false, row: true, divider: true, timeline: true, order: true })
  expect(geometry.crossing).toBeGreaterThan(1)
  await page.screenshot({ path: test.info().outputPath("canvas-preview.png") })
  expect(await readSource()).toEqual(source)
  await page.keyboard.type("禁止写入")
  await page.getByTestId("editor-transaction").getByRole("button", { name: "取消预览" }).click()
  await expect(preview).toHaveCount(0)
  await page.getByRole("button", { name: "查看修改预览" }).click()
  await expect(preview).toBeVisible()
  await page.getByTestId("editor-transaction").getByRole("button", { name: "取消预览" }).click()
  await expect(preview).toHaveCount(0)
  await expect(page.getByLabel("原始简历编辑区")).toHaveAttribute("contenteditable", "true")
  await page.waitForTimeout(700)
  expect(await readSource()).toEqual(source)
  expect(writes).toBe(0)
  expect(errors).toEqual([])
})

for (const { toolbarVisible, fits, name } of [
  { toolbarVisible: false, fits: true, name: "单页恰好装入画布" },
  { toolbarVisible: false, fits: false, name: "单页已滚动" },
  { toolbarVisible: true, fits: false, name: "多页且格式栏展开" },
]) {
  test(`预览切换时滚动条与纸张坐标保持稳定，${name}`, async ({ page }) => {
    const doc = { type: "doc", content: Array.from({ length: toolbarVisible ? 45 : 3 }, (_, index) => p(`第 ${index + 1} 段：用于检查滚动条的项目文档。`)) }
    const result = JSON.parse(backend({
      doc_json: doc,
      operations: (fits ? [0] : toolbarVisible ? [0, 12] : [1]).map(index => ({
        capability: "text.replace", parameters: { path: [index], text: "项目文档", replacement: "验收清单" },
      })),
      catalog_revision: JSON.parse(backend()).revision,
    }))
    const preview = await openPageBreakPreview(page, "transaction", {
      ...result, id: "stable-scroll", document_id: "doc", editor_session_id: "session", content_revision: 0,
      before_doc_json: doc, summary: "修改项目文档",
    }, toolbarVisible)
    const scroller = page.locator(".td-editor-print-wrapper")
    const source = page.getByLabel("原始简历编辑区")
    await expect(source).toBeVisible()
    await expect(source.locator(".rm-page-break")).toHaveCount(toolbarVisible ? 2 : 1)
    if (fits) {
      const requiredHeight = await scroller.evaluate(el => el.scrollHeight + 8)
      await page.setViewportSize({ width: 1366, height: requiredHeight })
    } else {
      await scroller.evaluate((el, offset) => { el.scrollTop = offset }, toolbarVisible ? 320 : 100)
    }
    const samples = scroller.evaluate(async (el) => {
      const read = () => {
        const view = el.querySelector('[data-preview-ready="true"] .ProseMirror') ?? el.querySelector(".ProseMirror")!
        const { x, y, width } = view.getBoundingClientRect()
        return {
          x, y, width, scrollTop: el.scrollTop, clientWidth: el.clientWidth, clientHeight: el.clientHeight,
          scrollHeight: el.scrollHeight, gutter: el.offsetWidth - el.clientWidth,
          hasScrollbar: el.scrollHeight > el.clientHeight,
          sameScroller: el === document.querySelector(".td-editor-print-wrapper") && document.querySelectorAll(".td-editor-print-wrapper").length === 1,
        }
      }
      const start = read()
      const frames = []
      let previewStartedAt: number | undefined
      const deadline = performance.now() + 7000
      while (performance.now() < deadline) {
        await new Promise(requestAnimationFrame)
        frames.push(read())
        if (el.querySelector('[data-preview-ready="true"]')) previewStartedAt ??= performance.now()
        if (previewStartedAt !== undefined && performance.now() - previewStartedAt >= 1650) break
      }
      return { start, frames, previewStarted: previewStartedAt !== undefined }
    })
    await page.getByRole("button", { name: "查看修改预览" }).click()
    const measured = await samples
    await expect(preview).toBeVisible()
    expect(measured.previewStarted).toBe(true)
    expect(measured.start.scrollTop).toBe(fits ? 0 : toolbarVisible ? 320 : 100)
    expect(measured.start.hasScrollbar).toBe(!fits)
    expect(measured.start.sameScroller).toBe(true)
    for (const frame of measured.frames) expect(frame).toEqual(measured.start)
    await scroller.evaluate(el => { el.scrollTop -= 80 })
    await page.getByRole("button", { name: "取消预览" }).click()
    await expect(preview).toHaveCount(0)
    expect(await scroller.evaluate(el => el.scrollTop)).toBe(measured.start.scrollTop)
    await expect(source).toHaveAttribute("contenteditable", "true")
  })
}

test("当前窗口看不到任何改动时定位到首处，取消后恢复原位置", async ({ page }) => {
  const doc = { type: "doc", content: Array.from({ length: 80 }, (_, index) => p(`第 ${index + 1} 段：项目文档。`)) }
  const result = JSON.parse(backend({
    doc_json: doc,
    operations: [50, 65].map(index => ({
      capability: "text.replace", parameters: { path: [index], text: "项目文档", replacement: "验收清单" },
    })),
    catalog_revision: JSON.parse(backend()).revision,
  }))
  const preview = await openPageBreakPreview(page, "transaction", {
    ...result, id: "offscreen-change", document_id: "doc", editor_session_id: "session", content_revision: 0,
    before_doc_json: doc, summary: "修改页外项目文档",
  }, false)
  const scroller = page.locator(".td-editor-print-wrapper")
  await expect(page.getByLabel("原始简历编辑区")).toBeVisible()
  await expect(page.getByLabel("原始简历编辑区").locator(".rm-page-break").nth(1)).toBeAttached()
  await scroller.evaluate(el => { el.scrollTop = 150 })
  const before = await scroller.evaluate(el => ({ top: el.scrollTop, height: el.clientHeight, gutter: el.offsetWidth - el.clientWidth }))
  expect(before.top).toBe(150)
  const playback = scroller.evaluate(async el => {
    let scrollingWithoutAnimation = false
    let lastPosition = el.scrollTop
    let lastMovement = performance.now()
    const deadline = lastMovement + 7000
    while (performance.now() < deadline) {
      const now = await new Promise<number>(requestAnimationFrame)
      const playing = el.querySelector('[data-preview-playing="true"]') !== null
      if (el.scrollTop !== lastPosition) {
        lastPosition = el.scrollTop
        lastMovement = now
        if (!playing) scrollingWithoutAnimation = true
      }
      if (playing) return { scrollingWithoutAnimation, settleTime: now - lastMovement }
    }
    return null
  })
  await page.getByRole("button", { name: "查看修改预览" }).click()
  await expect(preview).toBeVisible()
  const timing = await playback
  expect(timing?.scrollingWithoutAnimation).toBe(true)
  expect(timing?.settleTime).toBeGreaterThanOrEqual(150)
  const after = await scroller.evaluate(el => {
    const bounds = el.getBoundingClientRect()
    const first = el.querySelector("[data-td-preview-region]")!.getBoundingClientRect()
    return { top: el.scrollTop, height: el.clientHeight, gutter: el.offsetWidth - el.clientWidth, first: first.top - bounds.top }
  })
  expect(after.top).toBeGreaterThan(before.top)
  expect(after.first).toBeCloseTo(before.height * 0.2, 0)
  expect(after.height).toBe(before.height)
  expect(after.gutter).toBe(before.gutter)
  await page.getByRole("button", { name: "取消预览" }).click()
  await expect(preview).toHaveCount(0)
  expect(await scroller.evaluate(el => el.scrollTop)).toBe(before.top)

  await page.getByRole("button", { name: "查看修改预览" }).click()
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(before.top)
  await expect(page.locator("[data-td-preview-overlay]")).toHaveAttribute("data-preview-playing", "false")
  await page.getByRole("button", { name: "取消预览" }).click()
  await expect(preview).toHaveCount(0)
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(before.top)
})

async function openEditor(page: Page, doc: unknown = initial, showStylePanel = false) {
  page.on("pageerror", (error) => console.error(error.message))
  page.on("console", (message) => { if (message.type() === "error") console.error(message.text()) })
  await page.route("http://127.0.0.1:4317/editor/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: backend(route.request().method() === "POST" ? route.request().postDataJSON() : undefined) })
  })
  await page.route("**/__timeline-test", (route) => route.fulfill({ contentType: "text/html", body: `
    <!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#f4f4f5"><div id="test-root"></div><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
    window.__vite_plugin_react_preamble_installed__=true;
    </script><script type="module">
    import React from '/node_modules/.vite/deps/react.js';
    import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
    import '/src/styles.css';
    import {ResumeRichTextEditor} from '/src/features/workspace/components/ResumeRichTextEditor.tsx';
    import {TooltipProvider} from '/src/components/ui/tooltip.tsx';
    import {setAccountSession} from '/src/accountSession.ts';
    import {defaultClassicA4Style} from '/src/features/templates/data.ts';
    import {StylePanel} from '/src/features/templates/components/style-panel/StylePanel.tsx';
    import {generateWorkspaceTemplateCSS} from '/@fs/${root.replaceAll("\\", "/")}/packages/resume-renderer/src/index.ts';
    setAccountSession({id:'timeline-test',sidecar_url:'http://127.0.0.1:4317',agent_host_url:'http://127.0.0.1:4318',token:'synthetic-timeline-test'});
    function App() {
      const [doc,setDoc]=React.useState(()=>JSON.parse(sessionStorage.getItem('timeline-doc')||'null')||${JSON.stringify(doc)});
      const [style,setStyle]=React.useState(()=>JSON.parse(sessionStorage.getItem('timeline-style')||'null')||defaultClassicA4Style);
      const [activeBlock,setActiveBlock]=React.useState('timeline');
      return React.createElement(TooltipProvider,null,React.createElement('div',{style:{display:'flex'}},React.createElement('div',{className:'td-source-resume-canvas',style:{height:'100vh',flex:1,minWidth:0}},React.createElement(ResumeRichTextEditor,{
        docJson:doc,templateStyle:style,ariaLabel:'时间轴验收画布',
        marginConfig:{top:76,bottom:76,left:50,right:50},
        cssText:generateWorkspaceTemplateCSS(style,'.rm-with-pagination'),
        onChange:(change)=>{sessionStorage.setItem('timeline-doc',JSON.stringify(change.docJson));setDoc(change.docJson)}
      })),${showStylePanel} ? React.createElement('aside',{style:{width:320}},React.createElement(StylePanel,{
        styleConfig:style,selectedThemeId:'classic-a4',themeOptions:[{id:'classic-a4',title:'经典 A4',source:'default'}],
        onChange:(next)=>{sessionStorage.setItem('timeline-style',JSON.stringify(next));setStyle(next)},onThemeChange:()=>{},
        activeBlock,onActiveBlockChange:setActiveBlock,uiLanguage:'zh-CN'
      })) : null));
    }
    ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(App));
    </script></body></html>` }))
  await page.goto("/__timeline-test")
  await expect(page.locator(".ProseMirror[aria-label='时间轴验收画布']")).toBeVisible()
}

async function itemMenu(page: Page, index: number) {
  const item = page.locator(".td-timeline-item").nth(index)
  await item.hover()
  await item.getByRole("button", { name: "时间轴条目操作" }).click()
}

test("divider hit area supports click, Delete, Backspace and undo without changing neighboring text", async ({ page }, info) => {
  await openEditor(page, { type: "doc", content: [p("分割线上方"), { type: "horizontalRule" }, p("分割线下方")] })
  const divider = page.locator(".ProseMirror hr")
  const editor = page.locator(".ProseMirror")
  for (const key of ["Delete", "Backspace"]) {
    // 在线条下方 4px 点击，覆盖扩大后的命中范围。
    await divider.click({ position: { x: 100, y: 4 } })
    await expect(divider).toHaveClass(/ProseMirror-selectednode/)
    if (key === "Delete") await page.screenshot({ path: info.outputPath("divider-selected.png") })
    await page.keyboard.press(key)
    await expect(divider).toHaveCount(0)
    await expect(editor).toContainText("分割线上方")
    await expect(editor).toContainText("分割线下方")
    await page.keyboard.press("Control+z")
    await expect(divider).toHaveCount(1)
  }
})

test("template timeline padding supports zero, restores after reopening and survives print snapshot", async ({ page, context }, info) => {
  await openEditor(page, richTimeline, true)
  const first = page.locator(".td-timeline-item").first()
  await expect(first).toHaveCSS("padding-left", "24px")
  await expect(first).toHaveCSS("padding-bottom", "20px")
  for (const [label, value] of [["节点左侧内边距", "32"], ["节点底部内边距", "0"]]) {
    await page.getByRole("textbox", { name: label }).fill(value)
    await page.getByRole("textbox", { name: label }).press("Enter")
  }
  await expect(first).toHaveCSS("padding-left", "32px")
  await expect(first).toHaveCSS("padding-bottom", "0px")
  await page.reload()
  await expect(first).toHaveCSS("padding-left", "32px")
  await expect(first).toHaveCSS("padding-bottom", "0px")
  await page.screenshot({ path: info.outputPath("timeline-zero-padding.png") })
  const snapshot = await page.evaluate(async () => {
    const { prepareCanvasPrintSnapshot } = await import("/src/features/revision/canvasPrintSnapshot.ts")
    return prepareCanvasPrintSnapshot(document.querySelector<HTMLElement>(".ProseMirror")!)
  })
  const exported = await context.newPage()
  await exported.setContent(snapshot.html)
  await expect(exported.locator(".td-timeline-item").first()).toHaveCSS("padding-left", "32px")
  await expect(exported.locator(".td-timeline-item").first()).toHaveCSS("padding-bottom", "0px")
  await exported.close()
  await page.getByRole("textbox", { name: "节点左侧内边距" }).fill("0")
  await page.getByRole("textbox", { name: "节点左侧内边距" }).press("Enter")
  await expect(first).toHaveCSS("padding-left", "0px")
})

test("insert, edit, add before and after, remove, undo, redo and unwrap preserve ordinary content", async ({ page }, info) => {
  await openEditor(page)
  await page.getByText("工作经历", { exact: true }).click()
  await page.getByRole("button", { name: "时间轴", exact: true }).click()
  await page.screenshot({ path: info.outputPath("timeline-insert-menu.png") })
  await page.getByRole("menuitem", { name: "插入空白时间轴" }).click()
  await expect(page.locator(".td-timeline-item")).toHaveCount(2)
  await page.keyboard.type("公司 A")
  await page.keyboard.press("Enter")
  await page.keyboard.type("工作成果 A")
  await expect(page.locator(".td-timeline-item").first()).toContainText("工作成果 A")
  await itemMenu(page, 0)
  await page.screenshot({ path: info.outputPath("timeline-item-menu.png") })
  await page.getByRole("menuitem", { name: "在后面新增条目" }).click()
  await expect(page.locator(".td-timeline-item")).toHaveCount(3)
  await page.keyboard.type("公司 B")
  await expect(page.locator(".td-timeline-item").nth(1)).toContainText("公司 B")
  await itemMenu(page, 1)
  await page.getByRole("menuitem", { name: "在前面新增条目" }).click()
  await expect(page.locator(".td-timeline-item")).toHaveCount(4)
  await page.keyboard.type("临时条目")
  await itemMenu(page, 1)
  await page.getByRole("menuitem", { name: "删除此条目及正文" }).click()
  await expect(page.locator(".td-timeline-item")).toHaveCount(3)
  await page.keyboard.press("Control+z")
  await expect(page.locator(".td-timeline-item")).toHaveCount(4)
  await page.keyboard.press("Control+Shift+z")
  await expect(page.locator(".td-timeline-item")).toHaveCount(3)
  await expect(page.getByText("保留的普通正文", { exact: true })).toBeVisible()
  await itemMenu(page, 0)
  await page.getByRole("menuitem", { name: "取消时间轴，保留正文" }).click()
  await expect(page.locator(".td-timeline")).toHaveCount(0)
  await expect(page.locator(".ProseMirror")).toContainText("公司 A")
  await expect(page.locator(".ProseMirror")).toContainText("工作成果 A")
  await expect(page.getByText("公司 B", { exact: true })).toBeVisible()
})

test("wrap, delete whole timeline, undo and remove last item preserve surrounding content", async ({ page }) => {
  await openEditor(page)
  await page.getByText("工作经历", { exact: true }).click()
  await page.getByRole("button", { name: "时间轴", exact: true }).click()
  await page.getByRole("menuitem", { name: "所选内容转为时间轴条目" }).click()
  await expect(page.locator(".td-timeline-item")).toHaveCount(1)
  await expect(page.locator(".td-timeline-item")).toContainText("工作经历")
  await itemMenu(page, 0)
  await page.getByRole("menuitem", { name: "删除整个时间轴及正文" }).click()
  await expect(page.locator(".td-timeline")).toHaveCount(0)
  await expect(page.getByText("保留的普通正文", { exact: true })).toBeVisible()
  await page.keyboard.press("Control+z")
  await expect(page.locator(".td-timeline-item")).toHaveCount(1)
  await itemMenu(page, 0)
  await page.getByRole("menuitem", { name: "在时间轴后继续输入" }).click()
  await expect(page.locator(".ProseMirror > p")).toHaveCount(2)
  await page.keyboard.type("新的普通段落")
  await expect(page.locator(".td-timeline")).not.toContainText("新的普通段落")
  await page.getByText("保留的普通正文", { exact: true }).click()
  await expect(page.getByText("新的普通段落", { exact: true })).toBeVisible()
  await itemMenu(page, 0)
  await page.getByRole("menuitem", { name: "删除此条目及正文" }).click()
  await expect(page.locator(".td-timeline")).toHaveCount(0)
  await expect(page.getByText("新的普通段落", { exact: true })).toBeVisible()
})

test("split existing paragraphs into entries without losing text", async ({ page }) => {
  await openEditor(page, { type: "doc", content: [{ type: "timeline", content: [{ type: "timelineItem", content: [p("公司 A"), p("成果 A"), p("公司 B"), p("成果 B")] }] }] })
  await page.getByText("公司 B", { exact: true }).click()
  await itemMenu(page, 0)
  await page.getByRole("menuitem", { name: "从当前段落拆出新条目" }).click()
  await expect(page.locator(".td-timeline-item")).toHaveCount(2)
  await expect(page.locator(".td-timeline-item").first()).toContainText("成果 A")
  await expect(page.locator(".td-timeline-item").first()).not.toContainText("公司 B")
  await expect(page.locator(".td-timeline-item").last()).toContainText("成果 B")
  await page.keyboard.press("Control+z")
  await expect(page.locator(".td-timeline-item")).toHaveCount(1)
})

test("timeline width follows its column and long text grows vertically", async ({ page }) => {
  await openEditor(page, { type: "doc", content: [{ type: "columns", attrs: { count: 2, widths: [60, 40] }, content: [
    { type: "column", content: [{ type: "timeline", content: [{ type: "timelineItem", content: [p("公司 A"), p("长正文需要在所在分栏内自动换行，同时保持左侧圆点和连线的位置。".repeat(8))] }] }] },
    { type: "column", content: [p("另一栏内容")] },
  ] }] })
  const layout = await page.evaluate(() => {
    const body = document.querySelector<HTMLElement>(".td-timeline-body")!
    const column = body.closest(".td-column")!.getBoundingClientRect()
    const rect = body.getBoundingClientRect()
    const paragraphs = body.querySelectorAll("p")
    return { right: rect.right, columnRight: column.right, width: rect.width, columnWidth: column.width,
      titleHeight: paragraphs[0].getBoundingClientRect().height, bodyHeight: paragraphs[1].getBoundingClientRect().height }
  })
  expect(layout.right).toBeLessThanOrEqual(layout.columnRight + 0.1)
  expect(layout.width).toBeLessThan(layout.columnWidth)
  expect(layout.bodyHeight).toBeGreaterThan(layout.titleHeight * 3)
  await expect(page.getByText("另一栏内容", { exact: true })).toBeVisible()
})

test("existing heading, list, column and inline formatting controls work inside timeline items and restore after reopening", async ({ page }) => {
  test.setTimeout(60_000)
  await openEditor(page, richTimeline)
  const item = page.locator(".td-timeline-item").last()
  for (const level of [1, 2, 3]) {
    await item.locator("h1,h2,h3").first().click()
    await page.getByRole("button", { name: "正文与标题" }).click()
    await page.getByRole("menuitem", { name: `标题${level}`, exact: true }).click()
    await expect(item.locator(`h${level}`)).toContainText("示例软件有限公司")
  }
  await item.getByText("保留一个可以继续编辑的段落。", { exact: true }).click()
  await page.getByRole("button", { name: "无序列表", exact: true }).click()
  await page.getByRole("button", { name: "实心圆", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(item.locator("ul")).toContainText("保留一个可以继续编辑的段落。")
  await item.locator("ul p").first().click()
  await page.getByRole("button", { name: "有序列表", exact: true }).click()
  await page.getByRole("button", { name: "数字编号", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(item.locator("ol").first()).toContainText("保留一个可以继续编辑的段落。")
  await item.locator("h3").click()
  await page.getByRole("button", { name: "分栏", exact: true }).click()
  await page.getByRole("button", { name: "3 栏", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(item.locator(".td-column")).toHaveCount(3)
  await expect(item.locator(".td-column").first()).toContainText("示例软件有限公司")
  const date = page.locator(".td-timeline-item").first().locator(".td-column").nth(2).locator("p")
  await date.click()
  await page.getByRole("button", { name: "对齐方式" }).click()
  await page.getByRole("button", { name: "左对齐", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(date).toHaveCSS("text-align", "left")
  await date.click()
  await page.getByRole("button", { name: "对齐方式" }).click()
  await page.getByRole("button", { name: "右对齐", exact: true }).click()
  await page.keyboard.press("Escape")
  await expect(date).toHaveCSS("text-align", "right")
  await date.click()
  await page.getByRole("textbox", { name: "当前段落 Markdown 源码" }).press("Control+a")
  await page.getByRole("button", { name: "字号", exact: true }).click()
  await page.getByRole("textbox", { name: "字号数值" }).fill("14")
  await page.getByRole("button", { name: "应用字号", exact: true }).click()
  await expect(date.locator("[data-td-inline-style]").first()).toHaveCSS("font-size", "14px")
  await page.getByRole("button", { name: "文字颜色", exact: true }).click()
  await page.getByRole("textbox", { name: "HEX 颜色" }).fill("#123abc")
  await page.getByRole("textbox", { name: "HEX 颜色" }).press("Enter")
  await expect(date.locator("[data-td-inline-style]").first()).toHaveCSS("color", "rgb(18, 58, 188)")
  await page.getByRole("button", { name: "加粗", exact: true }).click()
  await expect(date.locator("strong")).toContainText("2023.02 - 2026.02")
  await page.reload()
  await expect(page.locator(".td-timeline-item")).toHaveCount(3)
  await expect(page.locator(".td-timeline-item").last().locator(".td-column")).toHaveCount(3)
  await expect(page.locator(".td-timeline-item").last().locator("ol").first()).toContainText("保留一个可以继续编辑的段落。")
  await expect(date.locator("[data-td-inline-style]").first()).toHaveCSS("font-size", "14px")
  await expect(date.locator("strong")).toContainText("2023.02 - 2026.02")
})

test("long rich timeline preserves text, decoration geometry and page positions in print snapshot", async ({ page, context }, info) => {
  test.setTimeout(60_000)
  const doc = longRichDoc()
  await openEditor(page, doc)
  await expect.poll(() => page.locator(".rm-pagination-gap").count()).toBeGreaterThan(1)
  await expect(page.locator(".td-timeline-line:visible")).toHaveCount(2)
  await expect.poll(() => page.locator(".td-timeline-line-segment").count()).toBeGreaterThan(2)
  await expect(page.locator(".td-timeline-dot").nth(1)).toHaveCSS("background-color", "rgb(255, 255, 255)")
  const snapshot: CanvasPrintSnapshot = await page.evaluate(async () => {
    const { prepareCanvasPrintSnapshot } = await import("/src/features/revision/canvasPrintSnapshot.ts")
    return prepareCanvasPrintSnapshot(document.querySelector<HTMLElement>(".ProseMirror")!)
  })
  await page.screenshot({ path: info.outputPath("timeline-pages.png"), fullPage: true })
  await info.attach("timeline-snapshot", { body: JSON.stringify(snapshot), contentType: "application/json" })
  function geometry() {
    const editor = document.querySelector<HTMLElement>(".ProseMirror")!
    const base = editor.getBoundingClientRect()
    const scale = base.width / parseFloat(getComputedStyle(editor).width)
    return Array.from(editor.querySelectorAll<HTMLElement>(".td-timeline-dot,.td-timeline-line,.td-timeline-body p,.td-timeline-body h1,.td-timeline-body h2,.td-timeline-body h3,.td-timeline-body .td-columns,.td-timeline-body ul,.td-timeline-body ol"), (el) => {
      const box = el.getBoundingClientRect()
      return { kind: el.className, text: el.textContent, x: box.height ? (box.left - base.left) / scale : 0,
        y: box.height ? (box.top - base.top) / scale : 0, width: box.width / scale, height: box.height / scale }
    })
  }
  const source = await page.evaluate(geometry)
  expect(Math.max(...source.map((element) => element.y + element.height))).toBeLessThanOrEqual(snapshot.page_tops.at(-1)! + snapshot.page_height)
  const standalone = await context.newPage()
  await standalone.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0">${snapshot.html}</body></html>`)
  const exported = await standalone.evaluate(geometry)
  expect(exported.map((el) => el.text)).toEqual(source.map((el) => el.text))
  expect(Math.max(...source.flatMap((el, i) => ["x", "y", "width", "height"].map((key) => Math.abs(el[key as "x"] - exported[i][key as "x"]))))).toBeLessThan(0.1)
  await expect(standalone.locator("button,.td-module-interaction-only")).toHaveCount(0)
  // 使用实际 Sidecar 的静态快照打印路径生成 PDF，供逐页视觉验收。
  const pdfPath = info.outputPath("timeline.pdf")
  execFileSync("python", ["-X", "utf8", "-c", `import json,sys
from pathlib import Path
from typedance_sidecar.revision_models import CanvasPrintSnapshot
from typedance_sidecar.canvas_export import render_canvas_snapshot_html,render_canvas_snapshot_pdf
p=json.load(sys.stdin)
render_canvas_snapshot_pdf(render_canvas_snapshot_html(CanvasPrintSnapshot.model_validate(p['snapshot']),title='时间轴验收'),Path(p['output']))`], {
    cwd: root, input: JSON.stringify({ snapshot, output: pdfPath }), encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resolve(root, "services/sidecar/src") },
  })
  await info.attach("timeline-pdf", { path: pdfPath, contentType: "application/pdf" })
  await standalone.close()
})

test("background document export renders timeline rich blocks and a real PDF", async ({ page, context }, info) => {
  test.setTimeout(60_000)
  const doc = longRichDoc()
  await openEditor(page, doc)
  const style = await page.evaluate(async () => {
    const style = structuredClone((await import("/src/features/templates/data.ts")).defaultClassicA4Style)
    style.blocks.timeline = { paddingLeft: "32px", paddingBottom: "0px" }
    return style
  })
  const pdfPath = info.outputPath("timeline-server.pdf")
  const result = JSON.parse(execFileSync("python", ["-X", "utf8", "-c", `import json,sys
from pathlib import Path
from typedance_sidecar.models import ResumeVersion,TemplateStyleConfig,utc_now
from typedance_sidecar.pdf import render_resume_html,render_html_to_pdf,cleanup_browser
p=json.load(sys.stdin)
now=utc_now()
resume=ResumeVersion(id='timeline',title='时间轴',target_language='zh-CN',template_id='classic-a4',doc_json=p['doc'],plain_text_snapshot='',created_at=now,updated_at=now)
html=render_resume_html(resume,TemplateStyleConfig.model_validate(p['style']),html_page_margin={'top':'76px','bottom':'76px','left':'50px','right':'50px'})
try:
    render_html_to_pdf(html,Path(p['output']))
finally:
    cleanup_browser()
print(json.dumps({'html':html},ensure_ascii=False))`], {
    cwd: root, input: JSON.stringify({ doc, style, output: pdfPath }), encoding: "utf8",
    env: { ...process.env, PYTHONPATH: resolve(root, "services/sidecar/src") },
  }))
  const exported = await context.newPage()
  await exported.setContent(result.html)
  await expect(exported.locator(".td-timeline-item")).toHaveCount(3)
  await expect(exported.locator(".td-timeline-item").first()).toHaveCSS("padding-left", "32px")
  await expect(exported.locator(".td-timeline-item").first()).toHaveCSS("padding-bottom", "0px")
  await expect(exported.locator(".td-timeline-dot")).toHaveCount(3)
  await expect(exported.locator(".td-columns")).toHaveCount(2)
  await expect(exported.locator(".td-timeline-item").first().locator("h3")).toHaveText("示例科技有限公司")
  await expect(exported.locator(".td-timeline-item").first().locator("strong")).toHaveCount(3)
  await expect(exported.locator(".td-timeline-item").nth(1).locator("ol > li")).toHaveCount(28)
  await expect(exported.locator(".td-timeline-item").nth(1).locator("ul > li")).toHaveCount(2)
  await expect(exported.locator(".td-timeline-item").first().locator(".td-column").nth(2).locator("span")).toHaveCSS("font-size", "12px")
  await expect(exported.locator(".td-timeline-dot").nth(1)).toHaveCSS("background-color", "rgb(255, 255, 255)")
  await exported.screenshot({ path: info.outputPath("timeline-server-html.png"), fullPage: true })
  await info.attach("timeline-server-pdf", { path: pdfPath, contentType: "application/pdf" })
  await exported.close()
})
