import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("organizer can author, publish, unpublish, and delete a participant resource", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/program-settings?eventId=event-aie-2026&role=organizer");
  await page.getByRole("button", { name: /Participant resources/ }).click();
  await expect(page.getByRole("heading", { name: "Publish the answers speakers need without another email." })).toBeVisible();

  const newResource = page.getByRole("button", { name: "New resource" });
  await newResource.click();
  const pageTitle = page.getByRole("textbox", { name: "Page title" });
  await expect(pageTitle).toBeFocused();
  await pageTitle.fill("Venue arrival guide");
  await expect(page.getByRole("textbox", { name: "URL slug" })).toHaveValue("venue-arrival-guide");
  await page.getByRole("textbox", { name: "Short summary" }).fill("Check-in, doors, and day-of contacts.");
  await page.getByRole("textbox", { name: "Page content" }).fill("Enter through the north lobby.\n\nSpeaker check-in opens at 8:00 AM.");
  await page.getByRole("combobox", { name: "Visibility" }).selectOption("published");
  await page.getByRole("button", { name: "Save & publish" }).click();
  await expect(newResource).toBeFocused();

  const saved = page.getByRole("article").filter({ hasText: "Venue arrival guide" });
  await expect(saved).toContainText("published");
  await saved.getByRole("button", { name: "Unpublish" }).click();
  await expect(saved).toContainText("draft");
  page.once("dialog", (dialog) => dialog.accept());
  await saved.getByRole("button", { name: "Delete Venue arrival guide" }).click();
  await expect(saved).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
});

test("published resources are available in public and participant views", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/events/ai-engineer-summit-2026/resources");
  await expect(page.getByRole("heading", { name: "Event guides & policies" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Speaker field guide" })).toBeVisible();
  await expect(page.getByText("Workshop production checklist")).toHaveCount(0);

  await page.evaluate(() => window.localStorage.setItem("conference-ops-actor", "user-speaker"));
  await page.goto("/portal/resources?eventId=event-aie-2026&role=speaker");
  await expect(page.getByRole("heading", { name: "Participant resources" })).toBeVisible();
  await expect(page.getByText("Arrive at Fort Mason Center 45 minutes before your session.")).toBeVisible();
  await expect(page.getByText("Workshop production checklist")).toHaveCount(0);
  await page.setViewportSize({ width: 900, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.getByText("Arrive at Fort Mason Center 45 minutes before your session.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(browserErrors).toEqual([]);
});
