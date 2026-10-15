import { expect, test } from "@playwright/test";

test("mobile layout: map on top, tabbed panels, no horizontal overflow", async ({ page }) => {
  await page.goto("./");
  await expect(page.getByTestId("framing")).toBeVisible();
  await expect(page.locator("[data-testid=map] canvas")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.getByRole("button", { name: "Conversations", exact: true }).click();
  const conv = page.locator(".conversations .conv").first();
  await expect(conv).toBeVisible();
  await conv.click();
  await expect(page.getByTestId("detail").getByRole("heading", { name: "Why this connection?" })).toBeVisible();
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await expect(page.locator(".filters")).toBeVisible();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow2).toBeLessThanOrEqual(0);
});
