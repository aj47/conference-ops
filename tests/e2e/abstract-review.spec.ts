import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("organizer can assign, remind, compare, and explicitly override bounded AI triage", async ({ page }) => {
  await page.goto("/proposals?eventId=event-aie-2026&role=organizer");

  await expect(page.getByRole("heading", { name: "Assign, monitor, and compare the committee." })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Review round" })).toContainText("Round 2 · Final Review");
  await expect(page.getByRole("button", { name: "Save 2 assignments" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Export review results CSV" })).toBeVisible();

  await page.getByRole("checkbox", { name: /Dev Patel 0 of 2 complete/ }).check();
  await page.getByRole("button", { name: "Send reminder to 1" }).click();
  await expect(page.getByText("1 reviewer reminder safely queued for delivery.")).toBeVisible();

  await page.getByRole("button", { name: "Run AI triage" }).click();
  await expect(page.getByText("Conference Ops bounded evaluator v1", { exact: true })).toBeVisible();
  await expect(page.getByText(/A program chair must review the full submission/)).toBeVisible();
  await page.getByRole("button", { name: "Override AI signal" }).click();
  await page.getByRole("spinbutton", { name: "Human score" }).fill("4.6");
  await page.getByRole("textbox", { name: "Override reason" }).fill("Strong program fit after chair review");
  await page.getByRole("button", { name: "Save override" }).click();
  await expect(page.getByText(/Organizer override: 4\.6\/5/)).toBeVisible();

  const overflow = await page.locator("body *").evaluateAll((elements) => elements
    .map((element) => ({ tag: element.tagName, className: element.getAttribute("class"), text: element.textContent?.trim().slice(0, 80), right: element.getBoundingClientRect().right }))
    .filter((element) => element.right > window.innerWidth + 1));
  expect(overflow).toEqual([]);
});

test("organizer can inspect separate dated rounds and author all rubric field types", async ({ page }) => {
  await page.goto("/program-settings?eventId=event-aie-2026&role=organizer");

  await expect(page.getByRole("heading", { name: "Give every stage its own contract." })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Round 1 Initial Review/ })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Opens" })).toHaveValue("2026-07-31T17:00");
  await expect(page.getByRole("textbox", { name: "Closes" })).toHaveValue("2026-10-15T16:59");
  await page.getByRole("tab", { name: /Round 2 Final Review/ }).click();
  await expect(page.getByRole("textbox", { name: "Opens" })).toHaveValue("2026-10-15T17:00");
  await expect(page.getByRole("textbox", { name: "Closes" })).toHaveValue("2026-11-30T15:59");
  await expect(page.getByRole("combobox", { name: "Answer type" }).nth(1)).toHaveValue("text");

  await page.getByRole("button", { name: "Add criterion" }).click();
  const answerTypes = page.getByRole("combobox", { name: "Answer type" });
  await answerTypes.last().selectOption("dropdown");
  await expect(page.getByRole("textbox", { name: "Options" })).toHaveValue("Accept, Maybe, Reject");
  await expect(page.getByRole("checkbox", { name: /Blind reviewer view/ })).not.toBeChecked();
  await expect(page.getByRole("spinbutton", { name: "Assignment cap" })).toBeDisabled();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("reviewer sees a blind typed scorecard and can recuse from one submission", async ({ page, isMobile }) => {
  await page.goto("/workspace?eventId=event-aie-2026&role=organizer");
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("combobox", { name: "Viewing as" }).selectOption("user-reviewer");

  await expect(page).toHaveURL(/\/reviews\?eventId=event-aie-2026&role=reviewer$/);
  await expect(page.getByText("Blind review enabled.", { exact: true })).toBeVisible();
  await expect(page.getByText("Presenter context", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Decision confidence response" })).toHaveValue("High");
  await page.getByRole("combobox", { name: "Decision confidence response" }).selectOption("Medium");
  await page.getByRole("textbox", { name: "Evidence to revisit response" }).fill("Validate the retry example with the committee.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("Review draft saved.")).toBeVisible();
  await expect(page.getByText("Blind review enabled.", { exact: true })).toBeVisible();
  await expect(page.getByText("Presenter context", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: /02 Serving small models at the edge/ }).click();
  await page.getByRole("button", { name: "Declare conflict / recuse" }).click();
  await page.getByRole("textbox", { name: "Conflict reason" }).fill("I advised the submitting team on this proposal.");
  await page.getByRole("button", { name: "Confirm recusal for this submission" }).click();
  await expect(page.getByText("Conflict declared.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit review" })).toBeDisabled();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});
