import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.clear());
});

test("organizer creates, places, and resolves a direct-session conflict", async ({ page }) => {
  await page.goto("/schedule");
  await expect(page.getByRole("heading", { name: "Every room, track, and speaker gets one place." })).toBeVisible();

  await page.getByRole("button", { name: "Add direct session" }).click();
  await page.getByRole("textbox", { name: "Session title" }).fill("Competition sponsor field note");
  await page.getByRole("textbox", { name: "Description" }).fill("A guaranteed sponsor session tested end to end.");
  await page.getByRole("combobox", { name: "Commitment" }).selectOption("sponsor");
  await page.getByRole("combobox", { name: /Speaker/ }).selectOption("speaker-marco");
  await page.getByRole("button", { name: "Add to ready-to-place" }).click();

  const directCard = page.locator("article").filter({ hasText: "Competition sponsor field note" });
  await expect(directCard).toBeVisible();
  await directCard.getByRole("button", { name: "Place with controls" }).click();
  await page.getByRole("combobox", { name: "Start" }).selectOption("10:00");
  await page.getByRole("button", { name: "Check and place" }).click();
  await expect(page.getByText("Session scheduled.")).toBeVisible();

  const existingCard = page.locator("article").filter({ hasText: "Designing the first ten minutes of an AI SDK" });
  await existingCard.getByRole("button", { name: "Place with controls" }).click();
  await page.getByRole("button", { name: "Check and place" }).click();
  await expect(page.getByRole("dialog", { name: "Conflict queue" })).toBeVisible();
  await page.getByRole("textbox", { name: /Override reason/ }).fill("Stage manager approved the intentional overlap.");
  await page.getByRole("button", { name: "Override & place" }).click();
  await expect(page.getByText("Session scheduled with an audited override.")).toBeVisible();
});

test("submitter completes the public CFP and sees a confirmation", async ({ page }) => {
  await page.goto("/submit/ai-engineer-summit-2026");
  await page.getByRole("combobox", { name: "Switch demo persona" }).selectOption("user-applicant");
  await expect(page.getByRole("heading", { name: "Call for Speakers · AI Engineer Summit 2026", exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "Email address" }).fill("leah@example.com");
  await page.getByRole("checkbox", { name: /I can access this inbox/ }).check();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("textbox", { name: /Session title/ }).fill("Tracing the handoffs that make long-running agents reliable");
  await page.getByRole("textbox", { name: /Abstract/ }).fill("A practical field report on tracing retries, human handoffs, and durable checkpoints in agents that run for hours, including the failure evidence and reusable evaluation harness our team now ships.");
  await page.getByRole("textbox", { name: /Project or repository/ }).fill("https://github.com/example/agent-handoffs");
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByRole("textbox", { name: "First name" }).fill("Leah");
  await page.getByRole("textbox", { name: "Last name" }).fill("Okafor");
  await page.getByRole("textbox", { name: "Role or title" }).fill("Founder");
  await page.getByRole("textbox", { name: "Company / affiliation" }).fill("Tracewell");
  await page.getByRole("textbox", { name: /Biography/ }).fill("Builds observability systems for long-running AI workflows and studies how operators recover them safely.");
  await page.getByRole("textbox", { name: "Mobile phone" }).fill("+1 415 555 0135");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("+1 415 555 0135")).toBeVisible();
  await page.getByRole("checkbox", { name: /I have permission to submit this material/ }).check();
  const submissionRequest = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().endsWith("/api/v1/events/event-aie-2026/submissions"),
  );
  await page.getByRole("button", { name: "Submit proposal" }).click();
  const submittedBody = (await submissionRequest).postDataJSON() as { responses: Record<string, unknown> };
  expect(submittedBody.responses).toMatchObject({
    "field-title": "Tracing the handoffs that make long-running agents reliable",
    "field-category": "Agents in production",
    "field-format": "Talk",
    "speaker-phone": "+1 415 555 0135",
  });
  await expect(page.getByRole("heading", { name: "You’re in the review queue." })).toBeVisible();
  await expect(page.getByText("Confirmation queued", { exact: true })).toBeVisible();
});

test("public program, embed, and speaker portal are responsive", async ({ page }) => {
  await page.goto("/agenda");
  await expect(page.getByRole("heading", { name: "A program for people who operate the systems." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opening call" })).toBeVisible();

  await page.goto("/speakers");
  await expect(page.getByRole("heading", { name: "Meet the people behind the field notes." })).toBeVisible();
  await expect(page.getByText("Marco Ruiz", { exact: true }).first()).toBeVisible();

  await page.goto("/embed/agenda");
  await expect(page.getByText("Full agenda")).toBeVisible();
  await expect(page.getByText("Program updates automatically from the published revision.")).toBeVisible();

  await page.goto("/portal/home");
  await page.getByRole("combobox", { name: "Switch demo persona" }).selectOption("user-speaker");
  await expect(page.getByRole("heading", { name: "Welcome back, Marco." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toBeVisible();
});

test("organizer queues operational communication and exports the program", async ({ page, isMobile }) => {
  test.skip(isMobile, "The mobile project is covered by the public and lifecycle flows.");
  await page.goto("/publish");
  await expect(page.getByRole("heading", { name: "Make the public promise match operations." })).toBeVisible();

  await page.getByRole("button", { name: /Queue 2 messages/ }).click();
  await expect(page.getByText("2 acceptance messages queued for delivery.")).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button").filter({ hasText: "Program.json" }).click();
  await expect((await download).suggestedFilename()).toContain("program.json");

  await page.getByRole("button", { name: /Queue calendar invitations/ }).click();
  await expect(page.getByText(/calendar invitations queued for scheduled sessions/)).toBeVisible();
});
