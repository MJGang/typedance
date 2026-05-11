import { expect, test } from "@playwright/test";

test("workspace opens directly to resume editing", async ({ page }) => {
  await page.goto("/");

  await expect(page.locator("header").getByText("TypeDance", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Resume text")).toBeVisible();

  await page.getByRole("button", { name: /A4/ }).click();
  await expect(page.getByLabel("A4 resume preview")).toBeVisible();
});

test("opens template library and classic template detail", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: /模板库|Template Library/i }).click();
  await expect(page.getByRole("heading", { name: "模板库" })).toBeVisible();

  await page.getByRole("button", { name: /经典 A4|Classic A4/ }).click();
  await expect(page.getByText("classic-a4")).toBeVisible();
  await expect(page.getByLabel("A4 template sample preview")).toBeVisible();
});
