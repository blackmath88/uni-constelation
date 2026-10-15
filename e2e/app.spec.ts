import { expect, test, type Page } from "@playwright/test";

test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => !!isMobile, "desktop flows");

async function open(page: Page, hash = "") {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`./${hash}`);
  await expect(page.getByTestId("framing")).toContainText("Public-data pilot · Law × Business and Economics");
  return errors;
}

async function firstSuggestionNames(page: Page) {
  const conv = page.locator(".conversations .conv").first();
  await expect(conv).toBeVisible();
  return conv;
}

test("loads the static build with the snapshot framing and a rendered map", async ({ page }) => {
  const errors = await open(page);
  await expect(page.getByTestId("framing")).toHaveText(/\d[\d,]* publications · snapshot \d{4}-\d{2}-\d{2}/);
  const canvas = page.locator("[data-testid=map] canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box!.width).toBeGreaterThan(500);
  await expect(page.locator(".topic-label").first()).toBeVisible();
  await expect(page.locator(".legend")).toContainText("Coauthored — shared publication record (observed)");
  await expect(page.locator(".legend")).toContainText("Thematic similarity — derived from shared terms (suggestion)");
  await page.screenshot({ path: "docs/screenshots/law-economics-overview.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("find a researcher, inspect their work and open a publication", async ({ page }) => {
  await open(page);
  // take the first suggestion's researcher name as a known-good search target
  const name = (await (await firstSuggestionNames(page)).locator(".conv-names").innerText()).split(" and ")[0].trim();
  await page.keyboard.press("/");
  await expect(page.getByTestId("search")).toBeFocused();
  await page.keyboard.type(name);
  const option = page.getByRole("option").first();
  await expect(option).toContainText(name);
  await page.keyboard.press("Enter");
  const detail = page.getByTestId("detail");
  await expect(detail.locator(".detail-title")).toHaveText(name);
  await expect(detail).toContainText("faculty-listed publication");
  await expect(page).toHaveURL(/#r=r-/);
  // open their first publication
  await detail.locator(".pub-list .pub-link").first().click();
  await expect(page).toHaveURL(/#p=p-/);
  await expect(detail).toContainText(/UNIverse (Law|Economics) listing/);
  await detail.getByRole("button", { name: /show source record/i }).click();
  await expect(detail.locator(".raw-cite")).not.toBeEmpty();
});

test("follow a suggested connection and see why it appears", async ({ page }) => {
  await open(page);
  await (await firstSuggestionNames(page)).click();
  const detail = page.getByTestId("detail");
  await expect(detail.getByRole("heading", { name: "Why explore this connection?" })).toBeVisible();
  await expect(detail).toContainText("No joint publication in this snapshot.");
  const pairs = detail.locator(".evidence-pair");
  expect(await pairs.count()).toBeGreaterThan(0);
  await expect(pairs.first().locator(".ev-pub")).toHaveCount(2);
  await expect(pairs.first().locator(".ev-shared")).toContainText("Shared:");
  await expect(detail.locator(".question")).toContainText("A question to investigate");
  await expect(pairs.first().getByRole("link", { name: "Open source record" })).toHaveCount(2);
  await page.screenshot({ path: "docs/screenshots/law-economics-comparison.png", fullPage: true });
  // evidence publications are clickable
  await pairs.first().locator(".pub-link").first().click();
  await expect(page).toHaveURL(/#p=p-/);
});

test("switch relationship mode and keep the label clear", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "Coauthorship" }).click();
  await expect(page.locator(".mode-banner")).toContainText("Showing observed coauthorship");
  await expect(page).toHaveURL(/mode=coauthors/);
  await page.getByRole("radio", { name: "Research topics" }).click();
  await expect(page.locator(".mode-banner")).toContainText("Showing subject neighbourhoods");
});

test("filters preserve selection and show an empty state", async ({ page }) => {
  await open(page);
  await (await firstSuggestionNames(page)).click();
  const selected = new URL(page.url()).hash.match(/s=([^&]+)/)![1];
  await page.locator("fieldset.types").getByRole("button", { name: "None" }).click();
  await expect(page.locator(".map-empty")).toContainText("No publications match these filters");
  expect(new URL(page.url()).hash).toContain(`s=${selected}`); // selection kept alongside shareable filters
  await page.locator(".filters .section-head").getByRole("button", { name: "Reset" }).click();
  await expect(page.locator(".map-empty")).toHaveCount(0);
});

test("list view works without the graph and topics are selectable", async ({ page }) => {
  await open(page);
  await page.getByRole("radio", { name: "List" }).click();
  const list = page.getByTestId("list-view");
  await expect(list.locator(".list-rows li").first()).toBeVisible();
  await list.getByRole("tab", { name: /Researchers/ }).click();
  await expect(list.locator(".list-rows li").first()).toBeVisible();
  await page.locator(".topic-btn").first().click();
  await expect(page.getByTestId("detail")).toContainText("Subject area");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("detail")).toContainText("Where does your work connect?");
});

test("faculty and year filters survive the URL and gate suggestions and coauthor evidence", async ({ page }) => {
  await open(page);
  await page.locator(".walkthrough").getByRole("button", { name: "Skip tour" }).click();
  await page.locator("fieldset.faculties").getByText("Business and Economics").click();
  await expect(page).toHaveURL(/faculty=law/);
  await expect(page.locator(".conversations .conv")).toHaveCount(0);
  await page.locator("fieldset.faculties").getByText("Business and Economics").click();
  await page.getByRole("radio", { name: "Coauthorship" }).click();
  const map = page.getByTestId("map");
  const before = Number(await map.getAttribute("data-visible-coauthor-edges"));
  await page.locator(".year-selects label").first().getByRole("combobox").selectOption("2026");
  const after = Number(await map.getAttribute("data-visible-coauthor-edges"));
  expect(after).toBeLessThan(before);
  await page.reload();
  await expect(page.locator(".year-selects label").first().getByRole("combobox")).toHaveValue("2026");
});

test("invalid deep link and unavailable abstract fail in ordinary language", async ({ page }) => {
  await open(page, "#p=p-not-real");
  await expect(page.getByTestId("detail")).toContainText("not in the snapshot");
  const missingId = await page.evaluate(async () => {
    const pubs = await fetch(`${location.pathname.replace(/\/$/, "")}/data/publications.json`).then((r) => r.json());
    return pubs.find((p: { hasAbstract: boolean }) => !p.hasAbstract).id;
  });
  await page.goto(`./#p=${missingId}`);
  await page.reload();
  await expect(page.getByTestId("detail")).toContainText(/No abstract/);
});

test("map responds to clicks and keyboard zoom", async ({ page }) => {
  await open(page);
  const map = page.getByTestId("map");
  await map.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("0");
  // click the densest point: try a grid of points until a publication opens
  const box = (await map.boundingBox())!;
  let opened = false;
  for (let gx = 0.3; gx <= 0.7 && !opened; gx += 0.05) {
    for (let gy = 0.3; gy <= 0.7 && !opened; gy += 0.05) {
      await page.mouse.click(box.x + box.width * gx, box.y + box.height * gy);
      opened = /#p=p-/.test(page.url());
    }
  }
  expect(opened).toBe(true);
  await expect(page.getByTestId("detail").locator(".detail-title")).not.toBeEmpty();
});
