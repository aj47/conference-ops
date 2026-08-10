import { expect, test } from "@playwright/test";

async function expectContained(page: import("@playwright/test").Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test("organizer can inspect every guided launch source without creating data", async ({ page, isMobile }) => {
  if (isMobile) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/events/new");

  await expect(page.getByRole("heading", { name: "Start with a run of show, not a blank database." })).toBeVisible();
  await expect(page.getByRole("button", { name: /Conference CFP/ })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /Rooms \+ tracks CSV/ }).click();
  await page.locator(".launch-csv-import input[type=file]").setInputFiles({
    name: "event-structure.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("type,name,capacity,color\ntrack,Operate,,#2d6a6c\nroom,Main Hall,400,\n"),
  });
  await expect(page.getByLabel("Workspace launch summary")).toContainText("Operate · Main Hall");

  await page.getByRole("button", { name: /Airtable source/ }).click();
  await expect(page.getByText("Safe Airtable handoff:", { exact: true })).toBeVisible();
  await expect(page.getByText(/Tokens and raw connector details never enter this form/)).toBeVisible();

  await page.getByRole("button", { name: /Starter template/ }).click();
  await page.getByRole("button", { name: /Multi-track technical/ }).click();
  await expect(page.getByRole("button", { name: /Multi-track technical/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Workspace launch summary")).toContainText("Build · Evaluate · Operate");
  await expect(page.getByRole("button", { name: "Create event workspace" })).toBeDisabled();
  await expectContained(page);
});

test("organizer can preview personas and reset the guide without changing event data", async ({ page, isMobile }) => {
  if (isMobile) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/workspace?eventId=event-aie-2026&role=organizer");

  const previewOpener = page.getByRole("button", { name: "Preview as…" });
  await previewOpener.click();
  const preview = page.getByRole("dialog", { name: "See the event before they do." });
  await expect(preview.getByText("Preview mode · no data changes")).toBeVisible();
  await preview.getByRole("button", { name: "Reviewer" }).click();
  await expect(preview.getByLabel("Reviewer preview")).toContainText("identity rules applied");
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(previewOpener).toBeFocused();

  const tourOpener = page.getByRole("button", { name: "Guided tour" });
  await tourOpener.click();
  const tour = page.getByRole("dialog", { name: "One complete event loop, in order." });
  await tour.getByRole("button", { name: "Mark complete: Shape the intake" }).click();
  await expect(tour.getByText("1 of 6 guide steps checked")).toBeVisible();
  await tour.getByRole("button", { name: "Reset guide only" }).click();
  await expect(tour.getByText("0 of 6 guide steps checked")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tour).toBeHidden();
  await expect(tourOpener).toBeFocused();
  await expectContained(page);
});

test("organizer proof surfaces and speaker next action stay client-readable", async ({ page, isMobile }) => {
  if (isMobile) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/program-settings?eventId=event-aie-2026&role=organizer&section=brand");

  await expect(page.getByRole("heading", { name: "Make every event surface feel intentional." })).toBeVisible();
  await page.getByRole("button", { name: "Use #2d6a6c as event accent" }).click();
  await page.getByRole("button", { name: "Save brand kit" }).click();
  await expect(page.getByText("Brand kit saved. Private previews and public event surfaces now share this identity.")).toBeVisible();

  await page.getByRole("button", { name: /Communications/ }).click();
  await expect(page.getByRole("heading", { name: "Preview one personalized message before it can send." })).toBeVisible();
  await page.getByRole("button", { name: "Send test to me" }).click();
  await expect(page.getByText(/Test queued to .* The subject starts with \[TEST\]\./)).toBeVisible();

  await page.getByRole("button", { name: /Airtable source/ }).click();
  await expect(page.getByRole("heading", { name: "See that the event and the base agree." })).toBeVisible();
  await page.getByText("Platform diagnostics", { exact: true }).click();
  await expect(page.getByText(/Tokens, webhook secrets, raw records/)).toBeVisible();
  await expectContained(page);

  await page.evaluate(() => window.localStorage.setItem("conference-ops-actor", "user-speaker"));
  await page.goto("/portal/home?eventId=event-aie-2026&role=speaker");
  const nextAction = page.locator(".portal-next-action");
  await expect(nextAction).toContainText(/next action/i);
  await expect(nextAction.getByRole("link", { name: /Open task|Open submission|Finish profile/ })).toBeVisible();
  await expectContained(page);
});
