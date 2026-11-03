import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { readFileSync } from "node:fs"
import { expect, test, type Page } from "@playwright/test"
import type { CanvasPrintSnapshot } from "@typedance/contracts"

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
