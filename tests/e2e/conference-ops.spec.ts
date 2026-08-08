import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const marker = "conference-ops-e2e-storage-initialized";
    if (window.sessionStorage.getItem(marker)) return;
    window.localStorage.clear();
    window.sessionStorage.setItem(marker, "true");
  });
});

test("event roles cannot open organizer-only workspaces", async ({ page, isMobile }) => {
  await page.goto("/workspace");
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("combobox", { name: "Viewing as" }).selectOption("user-applicant");

  await expect(page).toHaveURL(/\/submit\/ai-engineer-summit-2026$/);
  await expect(page.getByRole("combobox", { name: "Switch demo persona" })).toHaveValue("user-applicant");
  await page.evaluate(() => {
    window.history.pushState({}, "", "/publish");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/submit\/ai-engineer-summit-2026$/);
  await expect(page.getByRole("button", { name: "Publish agenda" })).toHaveCount(0);
});

test("organizer can initialize a fresh event workspace", async ({ page }) => {
  await page.goto("/events/new");
  await page.getByRole("textbox", { name: "Organization" }).fill("Program Guild");
  await page.getByRole("textbox", { name: "Event name" }).fill("Practical AI Summit 2027");
  await page.getByRole("textbox", { name: "Short name" }).fill("PAI 2027");
  await expect(page.getByRole("textbox", { name: "Public slug" })).toHaveValue("practical-ai-summit-2027");
  await page.getByRole("button", { name: "Create event workspace" }).click();

  await expect(page).toHaveURL(/\/workspace\?eventId=event-/);
  await expect(page.getByRole("heading", { name: "The conference is a living system." })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("a selected secondary event survives organizer navigation and mutations", async ({ page, isMobile }) => {
  test.skip(isMobile, "The desktop lifecycle run covers multi-event navigation scope.");
  const selectedEventId = "event-secondary";
  await page.route("**/api/v1/bootstrap**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("eventId") !== selectedEventId) {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const payload = await response.json() as { data: { demoMode: boolean; event: Record<string, unknown> } };
    payload.data = {
      ...payload.data,
      demoMode: false,
      event: {
        ...payload.data.event,
        id: selectedEventId,
        name: "Secondary Conference 2026",
        shortName: "SC 2026",
        slug: "secondary-conference-2026",
      },
    };
    await route.fulfill({ response, json: payload });
  });

  await page.goto(`/workspace?eventId=${selectedEventId}`);
  await expect(page.getByText("Secondary Conference 2026", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Schedule board", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/schedule\\?eventId=${selectedEventId}$`));
  await page.getByRole("link", { name: "Control room" }).click();
  await expect(page).toHaveURL(new RegExp(`/workspace\\?eventId=${selectedEventId}$`));

  await page.getByRole("button", { name: "Event details" }).click();
  const eventName = page.getByRole("dialog", { name: "Working details" }).getByRole("textbox", { name: "Event name" });
  await expect(eventName).toHaveValue("Secondary Conference 2026");
  await eventName.fill("Secondary Conference 2026 · Updated");
  const updateRequest = page.waitForRequest((request) =>
    request.method() === "PUT" && new URL(request.url()).pathname === `/api/v1/events/${selectedEventId}`,
  );
  await page.getByRole("button", { name: "Save event details" }).click();
  await updateRequest;
  await expect(page.getByText("Event details saved across the workspace.")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/workspace\\?eventId=${selectedEventId}$`));

  await page.getByRole("link", { name: "CFP builder", exact: true }).click();
  await page.getByRole("button", { name: "Preview draft" }).click();
  await expect(page).toHaveURL(`/submit/secondary-conference-2026?preview=draft&eventId=${selectedEventId}`);
  await expect(page.getByText("Private draft preview.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Private draft preview.")).toBeVisible();
  await expect(page).toHaveURL(`/submit/secondary-conference-2026?preview=draft&eventId=${selectedEventId}`);
});

test("control-room exceptions open the event-scoped speaker task after navigation and reload", async ({ page }) => {
  await page.route("**/api/v1/bootstrap**", async (route) => {
    const response = await route.fetch();
    const payload = await response.json() as {
      data: { proposals: Array<Record<string, unknown>> };
    };
    payload.data.proposals = payload.data.proposals.map((proposal) =>
      proposal.id === "proposal-2" ? { ...proposal, status: "accepted" } : proposal);
    await route.fulfill({ response, json: payload });
  });

  await page.goto("/workspace?eventId=event-aie-2026");
  const taskException = page.locator(".risk-list").getByRole("link", { name: /Complete public profile/ });
  await expect(taskException).toBeVisible();
  const destination = new URL(await taskException.getAttribute("href") ?? "", "http://127.0.0.1:5173");
  expect(destination.pathname).toBe("/speaker-ops");
  expect(Object.fromEntries(destination.searchParams)).toEqual({
    eventId: "event-aie-2026",
    speakerId: "speaker-leah",
    taskId: "task-4",
  });

  await taskException.click();
  await expect(page.getByRole("heading", { name: "Leah Okafor" })).toBeVisible();
  let targetedTask = page.locator('article.task-row[aria-current="true"]');
  await expect(targetedTask).toContainText("Complete public profile");
  await expect(targetedTask).toBeFocused();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Leah Okafor" })).toBeVisible();
  targetedTask = page.locator('article.task-row[aria-current="true"]');
  await expect(targetedTask).toContainText("Complete public profile");
  await expect(targetedTask).toBeFocused();

  await page.goto("/speaker-ops?eventId=event-aie-2026&speakerId=missing&taskId=task-4");
  await expect(page.getByRole("heading", { name: "Marco Ruiz" })).toBeVisible();
  await expect(page.locator('article.task-row[aria-current="true"]')).toHaveCount(0);

  await page.goto("/speaker-ops?eventId=event-aie-2026&speakerId=speaker-leah&taskId=missing");
  await expect(page.getByRole("heading", { name: "Leah Okafor" })).toBeVisible();
  await expect(page.locator('article.task-row[aria-current="true"]')).toHaveCount(0);
});

test("dialogs contain focus, close with Escape, and restore their opener", async ({ page, isMobile }) => {
  test.skip(isMobile, "Mobile focus behavior is covered by the navigation drawer test.");
  await page.goto("/workspace");

  const eventDetails = page.getByRole("button", { name: "Event details" });
  await eventDetails.click();
  const eventDialog = page.getByRole("dialog", { name: "Working details" });
  await expect(eventDialog.getByRole("textbox", { name: "Event name" })).toBeFocused();
  const closeEventDialog = eventDialog.getByRole("button", { name: "Close event settings" });
  await closeEventDialog.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(eventDialog.getByRole("button", { name: "Save event details" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(eventDialog).toBeHidden();
  await expect(eventDetails).toBeFocused();

  const inviteStaff = page.getByRole("button", { name: "Invite staff" });
  await inviteStaff.click();
  const inviteDialog = page.getByRole("dialog", { name: "Invite a collaborator" });
  await expect(inviteDialog.getByRole("textbox", { name: "Email address" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(inviteDialog).toBeHidden();
  await expect(inviteStaff).toBeFocused();

  const commandTrigger = page.getByRole("button", { name: "Jump to a workflow" });
  await commandTrigger.click();
  await expect(page.getByRole("textbox", { name: "Search commands" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Quick navigation" })).toBeHidden();
  await expect(commandTrigger).toBeFocused();
});

test("mobile navigation is inert while closed and behaves as a modal when open", async ({ page, isMobile }) => {
  test.skip(!isMobile, "This behavior applies below the mobile navigation breakpoint.");
  await page.goto("/workspace");

  const sidebar = page.locator("aside.sidebar");
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(sidebar).toHaveAttribute("aria-hidden", "true");

  const opener = page.getByRole("button", { name: "Open navigation" });
  await opener.click();
  const navigationDialog = page.getByRole("dialog", { name: "Primary navigation" });
  await expect(navigationDialog.getByRole("button", { name: "Close navigation" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(navigationDialog.getByRole("combobox", { name: "Viewing as" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sidebar).toHaveAttribute("inert", "");
  await expect(opener).toBeFocused();
});

test("scheduled sessions expose a keyboard reschedule flow", async ({ page }) => {
  await page.goto("/schedule");
  const scheduledCard = page.locator(".schedule-card").filter({ hasText: "Opening call" });
  const reschedule = scheduledCard.getByRole("button", { name: "Reschedule Opening call" });
  await expect(reschedule).toBeVisible();
  await reschedule.focus();
  await page.keyboard.press("Enter");
  const placementDialog = page.getByRole("dialog", { name: "Place session" });
  await expect(placementDialog.getByRole("combobox", { name: "Room" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(placementDialog).toBeHidden();
  await expect(reschedule).toBeFocused();
});

test("agenda publishing explains the live reschedule contract", async ({ page }) => {
  await page.goto("/publish");
  await expect(page.getByText("Publishing adds scheduled sessions. Rescheduling a published session updates the live program immediately.")).toBeVisible();
  await expect(page.getByText("LIVE EDITS")).toBeVisible();
  await expect(page.getByText("Immediate", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Agenda is live" })).toBeDisabled();
});

test("unsupported file fields cannot be authored and clipboard notices reflect the result", async ({ page, isMobile }) => {
  test.skip(isMobile, "The desktop run covers the builder and clipboard integrations.");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => window.localStorage.setItem("conference-ops-test-copy", value),
      },
    });
  });

  await page.goto("/forms");
  await page.getByRole("button", { name: /3\. Proposal information/ }).click();
  const addField = page.getByRole("button", { name: "Add field" });
  await addField.click();
  await expect(page.getByRole("option", { name: /File upload/ })).toHaveCount(0);
  await expect(page.getByText("Secure file uploads are not available yet.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(addField).toBeFocused();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("conference-ops-test-copy"))).toContain("/submit/ai-engineer-summit-2026");
  await expect(page.getByText("Public submission link copied.")).toBeVisible();

  await page.goto("/publish");
  await page.getByRole("button", { name: "Copy preview link" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("conference-ops-test-copy"))).toBe("http://127.0.0.1:5173/events/ai-engineer-summit-2026/agenda");
  await expect(page.getByText("Agenda preview link copied.")).toBeVisible();

  await page.goto("/events/ai-engineer-summit-2026/agenda");
  await page.getByRole("button", { name: "Embed agenda" }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("conference-ops-test-copy"))).toBe("http://127.0.0.1:5173/events/ai-engineer-summit-2026/embed/agenda");
  await expect(page.getByText("Embed URL copied.")).toBeVisible();

  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => Promise.reject(new Error("Clipboard denied")) },
    });
  });
  await page.getByRole("button", { name: "Embed agenda" }).click();
  await expect(page.getByText("Could not copy the embed URL. Open the embed page and copy the address from your browser.")).toBeVisible();
});

test("organizer authors a one-level conditional CFP question", async ({ page, isMobile }) => {
  test.skip(isMobile, "The desktop builder run covers conditional question authoring.");
  await page.goto("/forms");
  await page.getByRole("button", { name: /3\. Proposal information/ }).click();
  await page.getByRole("button", { name: "Add field" }).click();

  const dialog = page.getByRole("dialog", { name: "Add a form field" });
  await dialog.getByRole("textbox", { name: "Question label" }).fill("Live workshop prerequisites");
  await dialog.getByRole("combobox", { name: "Answer type" }).selectOption("long_text");
  await dialog.getByText("Show this field conditionally", { exact: true }).click();
  await expect(dialog.getByRole("checkbox", { name: "Show this field conditionally" })).toBeChecked();
  await dialog.getByRole("combobox", { name: "Source question" }).selectOption("field-format");
  await dialog.getByRole("combobox", { name: "Value" }).selectOption({ label: "Workshop" });
  await dialog.getByRole("button", { name: "Add field" }).click();

  const newField = page.locator("article.field-row").filter({ hasText: "Live workshop prerequisites" });
  await expect(newField.getByText("Live workshop prerequisites", { exact: true })).toBeVisible();
  await expect(newField.getByText("When Preferred format is Workshop", { exact: true })).toBeVisible();
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
  await page.getByRole("combobox", { name: "Start" }).selectOption({ label: "10:00 AM PDT" });
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

test("submitter completes the public CFP and sees a confirmation", async ({ page, isMobile }) => {
  if (isMobile) await page.emulateMedia({ reducedMotion: "reduce" });
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

  await expect(page.getByText("1 of 4 speakers", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Remove co-speaker/ })).toHaveCount(0);
  await page.getByRole("textbox", { name: "First name" }).fill("Leah");
  await page.getByRole("textbox", { name: "Last name" }).fill("Okafor");
  await page.getByRole("textbox", { name: "Role or title" }).fill("Founder");
  await page.getByRole("textbox", { name: "Company / affiliation" }).fill("Tracewell");
  await page.getByRole("textbox", { name: /Biography/ }).fill("Builds observability systems for long-running AI workflows and studies how operators recover them safely.");
  await page.getByRole("textbox", { name: "Mobile phone" }).fill("+1 415 555 0135");

  const addCoSpeaker = page.getByRole("button", { name: "Add co-speaker" });
  await addCoSpeaker.click();
  await addCoSpeaker.click();
  await addCoSpeaker.click();
  await expect(page.getByText("4 of 4 speakers", { exact: true })).toBeVisible();
  await expect(addCoSpeaker).toBeDisabled();
  await page.getByRole("button", { name: "Remove co-speaker 4" }).click();
  await page.getByRole("button", { name: "Remove co-speaker 3" }).click();

  const coSpeaker = page.getByRole("group", { name: "Co-speaker 2" });
  await coSpeaker.getByRole("textbox", { name: "First name" }).fill("Mina");
  await coSpeaker.getByRole("textbox", { name: "Last name" }).fill("Patel");
  await coSpeaker.getByRole("textbox", { name: "Email address" }).fill("leah@example.com");
  await coSpeaker.getByRole("textbox", { name: "Role or title" }).fill("Principal Engineer");
  await coSpeaker.getByRole("textbox", { name: "Company / affiliation" }).fill("Tracewell");
  await coSpeaker.getByRole("textbox", { name: "Biography" }).fill("Builds durable workflow systems with a focus on human handoffs and incident recovery.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(coSpeaker.getByText("Each speaker needs a distinct email address.")).toBeVisible();
  await coSpeaker.getByRole("textbox", { name: "Email address" }).fill("mina@example.com");
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByText("+1 415 555 0135")).toBeVisible();
  await expect(page.getByText(/Mina Patel/)).toBeVisible();
  await expect(page.getByText(/mina@example\.com · Principal Engineer · Tracewell/)).toBeVisible();
  const stepper = page.getByRole("navigation", { name: "Submission progress" });
  const reviewStep = stepper.getByRole("button", { name: "Review" });
  await expect(reviewStep).toHaveAttribute("aria-current", "step");
  await expect.poll(() => reviewStep.evaluate((button) => {
    const stepButton = button as HTMLElement;
    const container = stepButton.parentElement;
    if (!container) return false;
    const containerBox = container.getBoundingClientRect();
    const buttonBox = stepButton.getBoundingClientRect();
    const visibleLeft = containerBox.left + container.clientLeft;
    const visibleRight = visibleLeft + container.clientWidth;
    return buttonBox.left >= visibleLeft - 1 && buttonBox.right <= visibleRight + 1;
  })).toBe(true);
  expect(await stepper.evaluate((container) => getComputedStyle(container).scrollBehavior)).toBe(isMobile ? "auto" : "smooth");
  await expect(page.getByRole("heading", { name: "One final read before it leaves your desk." })).toBeFocused();
  await expect(reviewStep).not.toBeFocused();
  const editTarget = await page.getByRole("button", { name: "Edit" }).first().evaluate((button) => {
    const box = button.getBoundingClientRect();
    return { width: box.width, height: box.height };
  });
  expect(editTarget.width).toBeGreaterThanOrEqual(44);
  expect(editTarget.height).toBeGreaterThanOrEqual(44);
  await page.getByRole("checkbox", { name: /I have permission to submit this material/ }).check();
  const submissionRequest = page.waitForRequest((request) =>
    request.method() === "POST" && request.url().endsWith("/api/v1/events/event-aie-2026/submissions"),
  );
  await page.getByRole("button", { name: "Submit proposal" }).click();
  const submittedBody = (await submissionRequest).postDataJSON() as {
    responses: Record<string, unknown>;
    speakers: Array<{ name: string; email: string }>;
  };
  expect(submittedBody.responses).toMatchObject({
    "field-title": "Tracing the handoffs that make long-running agents reliable",
    "field-category": "Agents in production",
    "field-format": "Talk",
    "speaker-phone": "+1 415 555 0135",
  });
  expect(submittedBody.speakers).toEqual([
    expect.objectContaining({ name: "Leah Okafor", email: "leah@example.com" }),
    expect.objectContaining({ name: "Mina Patel", email: "mina@example.com" }),
  ]);
  await expect(page.getByRole("heading", { name: "You’re in the review queue." })).toBeVisible();
  await expect(page.getByText("Confirmation queued", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Continue to speaker portal" })).toHaveAttribute(
    "href",
    "/portal/home?eventId=event-aie-2026&role=applicant",
  );
});

test("public program, embed, and speaker portal are responsive", async ({ page }) => {
  await page.goto("/events/ai-engineer-summit-2026/agenda");
  await expect(page.getByRole("heading", { name: "A program for people who operate the systems." })).toBeVisible();
  await expect(page.getByText("August 28–29, 2026 · Fort Mason Center, San Francisco")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opening call" })).toBeVisible();

  await page.goto("/events/ai-engineer-summit-2026/speakers");
  await expect(page.getByRole("heading", { name: "Meet the people behind the field notes." })).toBeVisible();
  await expect(page.getByText("Marco Ruiz", { exact: true }).first()).toBeVisible();

  await page.goto("/events/ai-engineer-summit-2026/embed/agenda");
  await expect(page.getByText("Full agenda")).toBeVisible();
  await expect(page.getByText("Program reflects the current live schedule when this page loads.")).toBeVisible();

  await page.goto("/portal/home");
  await page.getByRole("combobox", { name: "Switch demo persona" }).selectOption("user-speaker");
  await expect(page.getByRole("heading", { name: "Welcome back, Marco." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Speaker portal" })).toBeVisible();
  await page.getByRole("link", { name: /Tasks/ }).click();
  const proposalTarget = page.locator(".portal-task-target", { hasText: "The eval flywheel that caught our agent regressions" });
  await expect(proposalTarget).toBeVisible();
  expect(await proposalTarget.evaluate((target) => {
    const title = target.previousElementSibling;
    if (!title) return false;
    const titleBox = title.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    return getComputedStyle(target).display === "block" && targetBox.top >= titleBox.bottom - 1;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("proposal and speaker filters expose distinct accessible names", async ({ page }) => {
  await page.goto("/proposals?eventId=event-aie-2026");
  await expect(page.getByRole("textbox", { name: "Search proposals" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter proposals by status" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Filter proposals by category" })).toBeVisible();

  await page.goto("/events/ai-engineer-summit-2026/speakers");
  await expect(page.getByRole("textbox", { name: "Search speakers" })).toBeVisible();
});

test("public agenda favorites survive a reload and stay scoped to the event", async ({ page }) => {
  await page.goto("/events/ai-engineer-summit-2026/agenda");
  const addFavorite = page.getByRole("button", { name: "Add Opening call to favorites" });
  await expect(addFavorite).toHaveAttribute("aria-pressed", "false");
  await addFavorite.click();
  await expect(page.getByRole("button", { name: "Remove Opening call from favorites" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() =>
    window.localStorage.getItem("conference-ops:agenda-favorites:ai-engineer-summit-2026"),
  )).toContain("session-opening");

  await page.reload();
  await expect(page.getByRole("button", { name: "Remove Opening call from favorites" })).toHaveAttribute("aria-pressed", "true");
});

test("public speaker gallery renders an accessible headshot and falls back when it fails", async ({ page }) => {
  await page.route("**/api/v1/public/events/ai-engineer-summit-2026", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ data: {
      event: {
        id: "event-a", slug: "ai-engineer-summit-2026", name: "AI Engineer Summit 2026", shortName: "AIE 2026",
        description: "A working conference for people operating AI systems.", timezone: "America/Los_Angeles",
        startsAt: "2026-08-28T16:00:00.000Z", endsAt: "2026-08-29T01:00:00.000Z",
        cfpClosesAt: "2026-08-13T05:00:00.000Z", venue: "Fort Mason Center, San Francisco",
        websiteUrl: "", status: "agenda_published", accent: "#e05b3f",
      },
      form: null,
      sessions: [{
        id: "session-a", eventId: "event-a", title: "Operational evals", description: "A field report.",
        speakerIds: ["speaker-a"], speakerNames: ["Ada Rivera"], status: "published",
        startsAt: "2026-08-28T16:00:00.000Z", endsAt: "2026-08-28T17:00:00.000Z",
        trackId: "track-a", trackName: "Build", trackColor: "#2d6a6c", roomId: "room-a", roomName: "Theater",
      }],
      speakers: [{
        id: "speaker-a", name: "Ada Rivera", title: "Staff Engineer", company: "Northstar",
        bio: "Builds reliable production systems.", profileComplete: true, headshotUrl: "/test-assets/ada.png",
      }],
      resources: [],
    } }),
  }));
  await page.route("**/test-assets/ada.png", (route) => route.fulfill({
    contentType: "image/png",
    body: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XoR2AAAAAElFTkSuQmCC", "base64"),
  }));
  await page.goto("/events/ai-engineer-summit-2026/speakers");

  const portrait = page.getByRole("img", { name: "Portrait of Ada Rivera" });
  await expect(portrait).toBeVisible();
  await page.route("**/missing-headshot.png", (route) => route.abort());
  await portrait.evaluate((image) => { image.setAttribute("src", "/missing-headshot.png"); });
  await expect(page.getByRole("img", { name: "Portrait of Ada Rivera" })).toHaveCount(0);
  await expect(page.locator(".speaker-card__portrait .avatar", { hasText: "AR" })).toBeVisible();
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
