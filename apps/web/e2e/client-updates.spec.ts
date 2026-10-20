import { expect, test, type Page } from "@playwright/test"
import { resolve } from "node:path"

test.setTimeout(60_000)

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:4317/documents", (route) => route.fulfill({ json: [] }))
  await page.route("http://127.0.0.1:4317/template-styles", (route) => route.fulfill({ json: [] }))
  await page.route("http://127.0.0.1:4327/settings/model", (route) => route.fulfill({ json: {
    provider: "deepseek", model: "test-model", base_url: "https://example.com", api_key: { configured: false, preview: null },
  } }))
})

// 仅在测试浏览器模拟 IPC；生产代码始终调用真实 Rust updater。
async function mockDesktop(page: Page) {
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>()
    let nextId = 0
    let updateListener: number | undefined
    let finishDownload: ((state: unknown) => void) | undefined
    let state = {
      revision: 0, phase: "idle", currentVersion: "0.1.0", releasesUrl: "https://example.com/releases", update: null as unknown,
      downloadedBytes: 0, totalBytes: null as number | null, lastCheckedAt: null as number | null, error: null as string | null,
    }
    const control = {
      installCalls: 0,
      logCalls: 0,
      nextCheck: "available",
      publish(phase: string) {
        state = { ...state, phase, revision: state.revision + 1 }
        if (phase === "downloading") Object.assign(state, { downloadedBytes: 53_320_000, totalBytes: 86_000_000 })
        if (updateListener !== undefined) callbacks.get(updateListener)?.({ event: "client-update-state", id: updateListener, payload: state })
        if (phase === "ready" || phase === "available") { finishDownload?.(state); finishDownload = undefined }
        return state
      },
    }
    Object.assign(window, {
      __updateTest: control,
      __TAURI_INTERNALS__: {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
        transformCallback(callback: (event: unknown) => void) { callbacks.set(++nextId, callback); return nextId },
        unregisterCallback(id: number) { callbacks.delete(id) },
        async invoke(command: string, args?: Record<string, unknown>) {
          if (command === "plugin:event|listen") {
            if (args?.event === "client-update-state") updateListener = args.handler as number
            return args?.handler
          }
          if (command === "get_client_update_state") return state
          if (command === "check_client_update") {
            state = { ...state, lastCheckedAt: Date.now(), error: control.nextCheck === "error" ? "check" : null,
              update: control.nextCheck === "available" ? { version: "0.1.1", notes: "- 优化简历编辑体验\n- 改进 PDF 导出稳定性\n- 修复已知问题", publishedAt: "2026-10-20T00:00:00Z" } : null }
            return control.publish(control.nextCheck)
          }
          if (command === "download_client_update") {
            control.publish("downloading")
            return new Promise((done) => { finishDownload = done })
          }
          if (command === "cancel_client_update") { control.publish("available"); return }
          if (command === "install_client_update") { control.installCalls++; return control.publish("installing") }
          if (command === "open_client_update_logs") { control.logCalls++; return }
          return false
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
    })
  })
}

test("browser preview explains desktop updates without offering a fake download", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "设置", exact: true }).click()
  await page.getByRole("tab", { name: "客户端更新" }).click()
  await expect(page.getByText("请在桌面客户端中检查更新")).toBeVisible()
  await expect(page.getByRole("button", { name: "检查更新", exact: true })).toBeDisabled()
  await expect(page.getByRole("button", { name: "下载更新", exact: true })).toHaveCount(0)
})

test("desktop update survives dialog dismissal and requires a confirmed restart", async ({ page }) => {
  await mockDesktop(page)
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await expect(page.getByLabel("有客户端更新")).toBeVisible()
  await page.getByRole("button", { name: "设置", exact: true }).click()
  await expect(page.getByText("发现新版本")).toBeVisible()
  await expect(page.getByRole("tablist", { name: "设置分类" })).toHaveAttribute("aria-orientation", "vertical")
  expect(await page.getByRole("tablist").evaluate((element) => getComputedStyle(element).flexDirection)).toBe("column")
  expect(await page.getByRole("switch").evaluate((element) => getComputedStyle(element).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)")
  await page.getByRole("tab", { name: "AI 设置" }).focus()
  await page.keyboard.press("ArrowDown")
  await expect(page.getByRole("tab", { name: "客户端更新" })).toHaveAttribute("aria-selected", "true")
  await expect(page.getByText("2026/10/20", { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "更新日志" }).click()
  expect(await page.evaluate(() => (window as unknown as { __updateTest: { logCalls: number } }).__updateTest.logCalls)).toBe(1)
  await page.screenshot({ path: resolve("../../artifacts/client-update-checks/available.png") })
  await page.getByRole("button", { name: "下载更新", exact: true }).click()
  await expect(page.getByText("62%", { exact: true })).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("button", { name: "设置", exact: true }).click()
  await expect(page.getByText("62%", { exact: true })).toBeVisible()
  await page.screenshot({ path: resolve("../../artifacts/client-update-checks/downloading.png") })
  await page.getByRole("button", { name: "取消下载", exact: true }).click()
  await expect(page.getByRole("button", { name: "下载更新", exact: true })).toBeVisible()
  await page.getByRole("button", { name: "下载更新", exact: true }).click()
  await page.evaluate(() => (window as unknown as { __updateTest: { publish: (phase: string) => void } }).__updateTest.publish("ready"))
  await expect(page.getByText("更新已准备就绪")).toBeVisible()
  await page.screenshot({ path: resolve("../../artifacts/client-update-checks/ready.png") })
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "切换深色模式" }).click()
  await page.getByRole("button", { name: "设置", exact: true }).click()
  await page.screenshot({ path: resolve("../../artifacts/client-update-checks/dark.png") })
  await page.getByRole("button", { name: "重启并更新", exact: true }).click()
  await expect(page.getByRole("alertdialog")).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __updateTest: { installCalls: number } }).__updateTest.installCalls)).toBe(0)
  await page.getByRole("button", { name: "确认重启", exact: true }).click()
  await expect(page.getByText("正在准备安装…")).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __updateTest: { installCalls: number } }).__updateTest.installCalls)).toBe(1)
})

test("settings remain usable in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 820 })
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "设置", exact: true }).click()
  await page.getByRole("tab", { name: "客户端更新" }).click()
  const bounds = await page.getByRole("dialog").boundingBox()
  expect(bounds).not.toBeNull()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(420)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(820)
  await page.screenshot({ path: resolve("../../artifacts/client-update-checks/narrow.png") })
})

test("manual checks distinguish latest and failure states and persist the startup preference", async ({ page }) => {
  await mockDesktop(page)
  await page.goto("/", { waitUntil: "domcontentloaded" })
  await page.getByRole("button", { name: "设置", exact: true }).click()
  await page.getByRole("tab", { name: "客户端更新" }).click()
  await page.getByRole("switch", { name: "启动时自动检查更新" }).click()
  expect(await page.evaluate(() => localStorage.getItem("typedance.client-updates.auto-check"))).toBe("false")
  await page.evaluate(() => { (window as unknown as { __updateTest: { nextCheck: string } }).__updateTest.nextCheck = "latest" })
  await page.getByRole("button", { name: "检查更新", exact: true }).click()
  await expect(page.getByText("已是最新版本", { exact: true })).toBeVisible()
  await page.evaluate(() => { (window as unknown as { __updateTest: { nextCheck: string } }).__updateTest.nextCheck = "error" })
  await page.getByRole("button", { name: "重新检查", exact: true }).click()
  await expect(page.getByText("暂时无法检查更新", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible()
})
