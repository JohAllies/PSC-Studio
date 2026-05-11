import { expect, test } from "@playwright/test";

test("loads the PSC Studio shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("PSC Studio")).toBeVisible();
  await expect(page.getByText("Script Tree")).toBeVisible();
  await expect(page.getByText("Warnings")).toBeVisible();
});
