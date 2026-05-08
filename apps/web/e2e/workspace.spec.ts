import { expect, test } from "@playwright/test";

test("workspace opens directly to resume editing", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("header").getByText("TypeDance", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Resume text")).toBeVisible();
  await expect(page.getByLabel("A4 resume preview")).toBeVisible();
});
