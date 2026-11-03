import { resolve } from "node:path"
import { expect, test, type Page } from "@playwright/test"
import type { CanvasPrintSnapshot } from "@typedance/contracts"

const root = resolve(import.meta.dirname, "../../..").replaceAll("\\", "/")
const paragraph = (text = "") => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] })

async function openEditor(page: Page, kind = "bulletList", savedPlaceholder = false) {
  const doc = { type: "doc", content: [
    paragraph("分页边界验收"),
    { type: kind, content: Array.from({ length: 30 }, (_, index) => ({
      type: "listItem", content: [paragraph(`结果 ${index + 1}：完整保留这一项。`)],
    })) },
    ...(savedPlaceholder ? [paragraph()] : []),
  ] }
  await page.route("**/__trailing-paragraph-test", (route) => route.fulfill({ contentType: "text/html", body: `
    <!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0"><div id="test-root"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
    </script><script type="module">
      import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import '/src/styles.css';
      import {ResumeRichTextEditor} from '/src/features/workspace/components/ResumeRichTextEditor.tsx';
      import {TooltipProvider} from '/src/components/ui/tooltip.tsx';
      import {defaultClassicA4Style} from '/src/features/templates/data.ts';
      import {generateWorkspaceTemplateCSS} from '/@fs/${root}/packages/resume-renderer/src/index.ts';
      const style=structuredClone(defaultClassicA4Style);
      style.blocks.paragraph={...style.blocks.paragraph,fontSize:'14px',lineHeight:1.5,marginBottom:'10px'};
      for(const kind of ['bulletList','orderedList']) style.blocks[kind]={...style.blocks[kind],fontSize:'14px',lineHeight:1.62,marginTop:'0px',marginBottom:'6px'};
      function App(){
        const [doc,setDoc]=React.useState(()=>JSON.parse(sessionStorage.getItem('trailing-doc')||'null')||${JSON.stringify(doc)});
        return React.createElement(TooltipProvider,null,React.createElement('div',{className:'td-source-resume-canvas',style:{height:'100vh'}},React.createElement(ResumeRichTextEditor,{
          docJson:doc,templateStyle:style,ariaLabel:'末尾段落验收画布',toolbarVisible:false,
          marginConfig:{top:50,bottom:50,left:50,right:50},
          cssText:generateWorkspaceTemplateCSS(style,'.rm-with-pagination'),
          onChange:change=>{sessionStorage.setItem('trailing-doc',JSON.stringify(change.docJson));setDoc(change.docJson)}
        })));
      }
      ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(App));
    </script></body></html>` }))
  await page.goto("/__trailing-paragraph-test")
  await expect(page.locator(".ProseMirror > [data-rm-pagination-ignore]")).toHaveCount(1)
  await expect(page.locator(".rm-page-break")).toHaveCount(1)
}

async function snapshot(page: Page): Promise<CanvasPrintSnapshot> {
  return page.evaluate(async () => {
    const path = "/src/features/revision/canvasPrintSnapshot.ts"
    const { prepareCanvasPrintSnapshot } = await import(/* @vite-ignore */ path)
    return prepareCanvasPrintSnapshot(document.querySelector(".ProseMirror")!)
  })
}

for (const kind of ["bulletList", "orderedList"]) {
  test(`${kind} 末尾占位不撑出空白页，仍可点击输入、撤销、删除和重新打开`, async ({ page, context }, info) => {
    await openEditor(page, kind, true)
    const editor = page.locator(".ProseMirror")
    const placeholder = editor.locator(":scope > [data-rm-pagination-ignore]")
    await expect(editor.locator("li")).toHaveCount(30)
    await expect(editor.locator("li").last()).toHaveText("结果 30：完整保留这一项。")

    const print = await snapshot(page)
    expect(print.page_tops).toHaveLength(1)
    expect(print.html).not.toContain("data-rm-pagination-ignore")
    const exported = await context.newPage()
    await exported.setContent(print.html)
    await expect(exported.locator("li")).toHaveCount(30)
    await expect(exported.locator("li").last()).toHaveText("结果 30：完整保留这一项。")
    await exported.close()

    await placeholder.click({ position: { x: 8, y: 8 } })
    await page.keyboard.type("Continue writing")
    await expect(editor.locator(":scope > p").last()).toHaveText("Continue writing")
    await expect(placeholder).toHaveCount(0)
    await expect(page.locator(".rm-page-break")).toHaveCount(2)
    // 点击段落会进入源码输入框，先结束源码编辑，再验证文档级撤销。
    await page.keyboard.press("Escape")
    await page.keyboard.press("Control+z")
    await expect(placeholder).toHaveCount(1)
    await expect(page.locator(".rm-page-break")).toHaveCount(1)

    await placeholder.click({ position: { x: 8, y: 8 } })
    await page.keyboard.press("Escape")
    await page.keyboard.press("Backspace")
    await expect(editor.locator("li")).toHaveCount(30)
    await expect(page.locator(".rm-page-break")).toHaveCount(1)
    await page.reload()
    await expect(placeholder).toHaveCount(1)
    await expect(page.locator(".rm-page-break")).toHaveCount(1)
    await test.info().attach("print-pages", { contentType: "application/json", body: JSON.stringify({ pageCount: print.page_tops.length, listItems: 30 }) })
    await page.screenshot({ path: info.outputPath("no-trailing-blank-page.png") })
  })
}

test("主动留出的连续空段落仍参与分页，撤销后只保留输入占位", async ({ page }) => {
  await openEditor(page)
  const editor = page.locator(".ProseMirror")
  await editor.locator("[data-rm-pagination-ignore]").click({ position: { x: 8, y: 8 } })
  await page.keyboard.press("Escape")
  await page.keyboard.press("Enter")
  await expect(editor.locator(":scope > p")).toHaveCount(3)
  await expect(editor.locator("[data-rm-pagination-ignore]")).toHaveCount(0)
  await expect(page.locator(".rm-page-break")).toHaveCount(2)
  const print = await snapshot(page)
  expect(print.page_tops).toHaveLength(2)
  await page.keyboard.press("Control+z")
  await expect(editor.locator("[data-rm-pagination-ignore]")).toHaveCount(1)
  await expect(page.locator(".rm-page-break")).toHaveCount(1)
})
