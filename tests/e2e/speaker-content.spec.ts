import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.localStorage.setItem("conference-ops-actor", "user-organizer");
  });
});

test("organizer can scan speaker progress, versioned files, approvals, and communications", async ({ page }) => {
  await page.goto("/speaker-ops?eventId=event-aie-2026&role=organizer");
  await expect(page.getByRole("region", { name: "Speaker and content operations" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Roster to show-ready, in one traceable flow." })).toBeVisible();
  await expect(page.getByPlaceholder("Search roster")).toBeVisible();

  await page.getByRole("button", { name: /Progress/ }).click();
  await expect(page.getByRole("table", { name: "Speaker task progress" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Create task/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Record reminders/ })).toBeVisible();

  await page.getByRole("button", { name: /^Files/ }).click();
  await expect(page.getByRole("heading", { name: "Latest deliverables, with every prior version intact" })).toBeVisible();

  await page.getByRole("button", { name: /Session content/ }).click();
  await expect(page.getByText("Content approval queue")).toBeVisible();
  await expect(page.getByLabel("Content status")).toBeVisible();

  await page.getByRole("button", { name: /Communications/ }).click();
  await expect(page.getByText(/Demo · no live delivery|Production outbox/)).toBeVisible();
  await expect(page.getByLabel("Template body")).toHaveValue(/\{\{speaker\.first_name\}\}/);

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("speaker portal names its session assignment and file limits", async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem("conference-ops-actor", "user-speaker"));
  await page.goto("/portal/home?eventId=event-aie-2026&role=speaker");
  await expect(page.getByLabel("Switch demo persona")).toHaveValue("user-speaker");
  await expect(page.getByLabel("Switch demo persona").locator("option:checked")).toHaveText("Marco Ruiz · speaker");
  await expect(page.getByRole("heading", { name: "My sessions" })).toBeVisible();
  await page.getByRole("link", { name: /Tasks/ }).click();
  const fileLimit = page.getByText("PDF, PowerPoint, Word, or text · 50 MB maximum per file");
  await expect(fileLimit.first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
