import { expect, test } from "@playwright/test"

test.beforeEach(async ({ page }) => {
  await page.route("http://127.0.0.1:4317/documents", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  })
  await page.route("http://127.0.0.1:4317/template-styles", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  })
  await page.route("http://127.0.0.1:4317/template-samples/*", async (route) => {
    await route.fulfill({ status: 404, contentType: "application/json", body: "{}" })
  })
})

test("empty workspace exposes import from the sidebar", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("radio", { name: "简历", exact: true })).toBeChecked()
  await expect(page.getByRole("heading", { name: "开始编辑简历" })).toBeVisible()
  await expect(page.getByText("还没有简历。")).toBeVisible()

  await page.getByRole("button", { name: "导入", exact: true }).click()
  await expect(page.getByRole("dialog", { name: "导入旧简历" })).toBeVisible()
  await expect(page.getByLabel("项目名称")).toBeVisible()
  await expect(page.getByLabel("旧简历内容")).toBeVisible()

  await page.getByRole("button", { name: "生成改稿工作台" }).click()
  await expect(page.getByText("请粘贴简历内容或选择一个文件。")).toBeVisible()
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
