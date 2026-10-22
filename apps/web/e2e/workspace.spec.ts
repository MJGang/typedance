import { expect, test } from "@playwright/test"

const sidecarUrl = process.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:4317"

test.beforeEach(async ({ page }) => {
  await page.route(`${sidecarUrl}/documents`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  })
  await page.route(`${sidecarUrl}/template-styles`, async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  })
  await page.route(`${sidecarUrl}/template-samples/*`, async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
  })
})

test("empty workspace exposes blank and import through one creation dialog", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("radio", { name: "简历", exact: true })).toBeChecked()
  await expect(page.getByRole("heading", { name: "开始编辑简历" })).toBeVisible()
  await expect(page.getByText("还没有简历。")).toBeVisible()

  await expect(page.getByRole("button", { name: "导入", exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "新建简历" }).click()
  await expect(page.getByRole("dialog", { name: "新建简历" })).toBeVisible()
  await expect(page.getByLabel("简历名称")).toHaveValue("未命名简历")
  await expect(page.getByRole("button", { name: "创建并打开" })).toBeEnabled()
  await page.getByRole("radio", { name: "导入已有简历" }).click()
  await expect(page.getByTestId("resume-file-dropzone")).toBeVisible()
  await expect(page.getByRole("button", { name: "导入并打开" })).toBeDisabled()
  await page.getByRole("tab", { name: "粘贴文本" }).click()
  await expect(page.getByLabel("简历内容")).toBeVisible()
  await expect(page.getByTestId("resume-file-dropzone")).toHaveCount(0)
  await page.getByLabel("简历内容").fill("项目经历\n负责知识库问答")
  await page.getByRole("tab", { name: "上传文件" }).click()
  await expect(page.getByRole("button", { name: "导入并打开" })).toBeDisabled()
  await page.getByRole("tab", { name: "粘贴文本" }).click()
  await expect(page.getByLabel("简历内容")).toHaveValue("项目经历\n负责知识库问答")
  await expect(page.getByRole("button", { name: "导入并打开" })).toBeEnabled()
})

test("switches directly from resumes to the default template editor", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("radio", { name: "模板", exact: true }).click()
  await expect(page).toHaveURL(/\/packs\/resume\/templates\/classic-a4$/)
  await expect(page.getByRole("link", { name: "编辑模板 经典 A4" })).toHaveAttribute("aria-current", "page")
  await expect(page.getByText("返回主题库")).toHaveCount(0)
  await expect(page.getByLabel("主题演示简历预览")).toBeVisible()
  await expect(page.getByRole("combobox", { name: "选择主题" })).toHaveText(/经典 A4/)
})
