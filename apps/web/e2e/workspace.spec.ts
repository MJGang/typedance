import { expect, test } from "@playwright/test"

test("home guides users toward importing an old resume", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("button", { name: "TypeDance" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "我的简历" })).toBeVisible()
  await expect(page.getByText("还没有简历")).toBeVisible()

  await page.getByRole("button", { name: "导入旧简历" }).first().click()
  await expect(page.getByRole("dialog", { name: "导入旧简历" })).toBeVisible()
  await expect(page.getByLabel("项目名称")).toBeVisible()
  await expect(page.getByLabel("旧简历内容")).toBeVisible()

  await page.getByRole("button", { name: "生成改稿工作台" }).click()
  await expect(page.getByText("请先粘贴旧简历内容。")).toBeVisible()
})

test("opens theme library and classic A4 theme detail", async ({ page }) => {
  await page.goto("/")

  await page.getByRole("link", { name: "主题库" }).click()
  await expect(page.getByRole("heading", { name: "主题库" })).toBeVisible()

  await page.getByRole("button", { name: /经典 A4/ }).first().click()
  await expect(page.getByText("返回主题库")).toBeVisible()
  await expect(page.getByLabel("主题演示简历预览")).toBeVisible()
  await expect(page.getByRole("combobox", { name: "选择主题" })).toHaveText(/经典 A4/)
})
