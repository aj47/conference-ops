// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: null, isPending: false, isRefetching: false, error: null, refetch: vi.fn() }),
  },
}));

import { conferenceApi, type PublicEventData } from "../../src/client/api";
import { PublicSubmissionWizard } from "../../src/client/pages/PublicSubmission";
import { WorkspaceProvider } from "../../src/client/workspace";
import type { FormDefinition } from "../../src/shared/domain";

let container: HTMLDivElement;
let root: Root;

const event = {
  id: "event-practical",
  slug: "practical-ai-2027",
  name: "Practical AI 2027",
  shortName: "PAI 2027",
  description: "A working program for production teams.",
  timezone: "America/Los_Angeles",
  startsAt: "2027-04-10T16:00:00.000Z",
  endsAt: "2027-04-11T01:00:00.000Z",
  venue: "Oakland, CA",
  websiteUrl: "https://example.com",
  status: "cfp_open" as const,
  cfpClosesAt: "2027-03-01T20:00:00.000Z",
  accent: "#2d6a6c",
};

const form: FormDefinition = {
  id: "form-practical",
  eventId: event.id,
  name: "Practical AI call for speakers",
  publicTitle: "Share a practical field note",
  version: 1,
  status: "published",
  kind: "cfp",
  submissionType: "abstract",
  collectsParticipants: true,
  welcomeTitle: "Share a practical field note",
  welcomeCopy: "Bring a concrete system, decision, or failure that another team can use.",
  confirmationCopy: "Your field note is in the review queue.",
  maxSpeakers: 3,
  maxSubmissionsPerUser: 2,
  closesAt: "2027-02-01T20:00:00.000Z",
  redirectToPortal: true,
  confirmationEmailEnabled: true,
  allowMultipleDrafts: true,
  fields: [
    { id: "field-title", label: "Session title", type: "short_text", required: true, section: "proposal" },
    { id: "field-summary", label: "Abstract", type: "long_text", required: true, section: "proposal" },
    { id: "field-category", label: "Program category", type: "select", required: true, section: "proposal", options: ["General"] },
    { id: "field-format", label: "Preferred format", type: "select", required: true, section: "proposal", options: ["Talk"] },
    { id: "speaker-first", label: "First name", type: "short_text", required: true, section: "participant" },
    { id: "speaker-last", label: "Last name", type: "short_text", required: true, section: "participant" },
    { id: "speaker-email", label: "Email", type: "email", required: true, section: "participant" },
  ],
  submissions: 0,
  updatedAt: "2027-01-01T12:00:00.000Z",
};

function payload(publishedForm: FormDefinition | null): PublicEventData {
  return { event, form: publishedForm, sessions: [], speakers: [], resources: [] };
}

async function renderWizard() {
  await act(async () => {
    root.render(
      <BrowserRouter>
        <WorkspaceProvider>
          <Routes><Route path="/submit/:slug" element={<PublicSubmissionWizard />} /></Routes>
        </WorkspaceProvider>
      </BrowserRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  window.history.replaceState({}, "", "/submit/practical-ai-2027");
  const values = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      get length() { return values.size; },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } satisfies Storage,
  });
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("public submission contract states", () => {
  it("renders an explicit unavailable state and never exposes seeded demo fields", async () => {
    const fetchPublic = vi.spyOn(conferenceApi, "publicEvent").mockResolvedValue(payload(null));
    await renderWizard();

    expect(fetchPublic).toHaveBeenCalledWith("practical-ai-2027");
    expect(container.textContent).toMatch(/submissions aren’t open yet/i);
    expect(container.querySelector('input[placeholder*="eval flywheel"]')).toBeNull();
    expect(container.textContent).not.toContain("Agents in production");
  });

  it("renders a recoverable error instead of falling back when the public fetch fails", async () => {
    vi.spyOn(conferenceApi, "publicEvent").mockRejectedValue(new Error("The event endpoint is temporarily unavailable."));
    await renderWizard();

    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/couldn’t open this call/i);
    expect(container.textContent).toContain("The event endpoint is temporarily unavailable.");
    expect(container.querySelector("select")).toBeNull();
  });

  it("hydrates the canonical category and deadline from the published form", async () => {
    vi.spyOn(conferenceApi, "publicEvent").mockResolvedValue(payload(form));
    await renderWizard();

    expect(container.textContent).toContain("Share a practical field note");
    expect(container.textContent).toContain("Open until February 1 at 12:00 PM PST");
    expect(container.textContent).toContain("01General");
    expect(container.textContent).not.toContain("Agents in production");
    expect(container.textContent).not.toContain("March 1");
  });
});
