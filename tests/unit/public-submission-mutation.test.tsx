// @vitest-environment jsdom

import { act, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, conferenceApi, type PublicEventData } from "../../src/client/api";
import { PublicSubmissionWizard } from "../../src/client/pages/PublicSubmission";
import { WorkspaceProvider, useWorkspace, type ApplicantSubmission } from "../../src/client/workspace";
import { createDemoWorkspace } from "../../src/shared/demo-data";
import type { FormDefinition, Proposal } from "../../src/shared/domain";

vi.mock("../../src/client/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { id: "user-verified", name: "Ada María Rivera", email: "ada.verified@example.com", emailVerified: true } },
      isPending: false,
      isRefetching: false,
      error: null,
      refetch: vi.fn(),
    }),
  },
}));

let container: HTMLDivElement;
let root: Root;

const event = {
  id: "event-field-notes",
  slug: "field-notes-2027",
  name: "Field Notes 2027",
  shortName: "FN 2027",
  description: "Production lessons from working teams.",
  timezone: "America/Los_Angeles",
  startsAt: "2027-06-10T16:00:00.000Z",
  endsAt: "2027-06-11T01:00:00.000Z",
  venue: "Oakland, CA",
  websiteUrl: "https://example.com",
  status: "cfp_open" as const,
  cfpClosesAt: "2027-05-01T20:00:00.000Z",
  accent: "#315b61",
};

const publicForm: FormDefinition = {
  id: "form-real-production-cfp",
  eventId: event.id,
  name: "Field Notes call for speakers",
  publicTitle: "Share a production field note",
  pageHeading: "Apply",
  version: 7,
  publishedVersion: 7,
  status: "published",
  kind: "cfp",
  submissionType: "abstract",
  collectsParticipants: true,
  welcomeTitle: "Share a production field note",
  welcomeCopy: "Bring evidence another team can use.",
  confirmationCopy: "Your proposal is in review.",
  maxSpeakers: 3,
  maxSubmissionsPerUser: 2,
  closesAt: "2027-05-01T20:00:00.000Z",
  redirectToPortal: true,
  confirmationEmailEnabled: true,
  allowMultipleDrafts: true,
  fields: [
    { id: "production-title", label: "Session title", type: "short_text", required: true, section: "proposal" },
    { id: "production-abstract", label: "Abstract", type: "long_text", required: true, section: "proposal" },
    { id: "production-lane", label: "Program lane", type: "select", required: true, section: "proposal", options: ["Operating AI"] },
    { id: "production-format", label: "Preferred format", type: "select", required: true, section: "proposal", options: ["Talk"] },
    { id: "production-evidence", label: "Evidence available", type: "long_text", required: false, section: "proposal" },
  ],
  submissions: 0,
  updatedAt: "2027-01-10T12:00:00.000Z",
};

const applicantSubmission: ApplicantSubmission = {
  title: "Operating a durable agent queue",
  summary: "A concrete account of production failure modes, evidence, and the recovery controls another team can reuse.",
  category: "Operating AI",
  format: "talk",
  level: "advanced",
  repoUrl: "",
  workshopNeeds: "",
  responses: { "production-evidence": "Thirty days of traces and incident reports." },
  speakers: [{
    firstName: "Ada",
    lastName: "Rivera",
    email: "ada@example.com",
    title: "Staff Engineer",
    company: "Northstar",
    bio: "Builds durable agent systems.",
  }],
};

function SubmitFetchedPublicForm() {
  const { loading, publicBuilder, submitProposal } = useWorkspace();
  const started = useRef(false);

  useEffect(() => {
    if (loading || !publicBuilder || started.current) return;
    started.current = true;
    void submitProposal(applicantSubmission, publicBuilder);
  }, [loading, publicBuilder, submitProposal]);

  return null;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/submit/field-notes-2027");
  Object.defineProperty(window, "scrollTo", { configurable: true, value: vi.fn() });
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

describe("production public submission mutation contract", () => {
  it("uses the fetched public form ID and fields instead of the provider's seeded private builder", async () => {
    const payload: PublicEventData = { event, form: publicForm, sessions: [], speakers: [], resources: [] };
    vi.spyOn(conferenceApi, "publicEvent").mockResolvedValue(payload);
    vi.spyOn(conferenceApi, "enroll").mockResolvedValue({ eventId: event.id, role: "applicant", enrolled: true });
    const submit = vi.spyOn(conferenceApi, "submitProposal").mockResolvedValue({
      id: "proposal-production",
      status: "submitted",
      version: 1,
      submittedAt: "2027-02-01T12:00:00.000Z",
    });

    await act(async () => {
      root.render(
        <BrowserRouter>
          <WorkspaceProvider><SubmitFetchedPublicForm /></WorkspaceProvider>
        </BrowserRouter>,
      );
    });

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledWith(
      expect.any(String),
      event.id,
      expect.objectContaining({
        formId: publicForm.id,
        responses: {
          "production-title": applicantSubmission.title,
          "production-abstract": applicantSubmission.summary,
          "production-lane": applicantSubmission.category,
          "production-format": "Talk",
          "production-evidence": applicantSubmission.responses["production-evidence"],
        },
      }),
    );
    expect(submit.mock.calls[0][2]).not.toMatchObject({ formId: "form-main-cfp" });
    expect(submit.mock.calls[0][2].responses).not.toHaveProperty("field-title");
  });

  it("submits a participant-disabled form with the verified account owner as its sole speaker", async () => {
    const participantDisabledForm: FormDefinition = {
      ...publicForm,
      id: "form-no-participant-step",
      collectsParticipants: false,
    };
    vi.spyOn(conferenceApi, "publicEvent").mockResolvedValue({
      event,
      form: participantDisabledForm,
      sessions: [],
      speakers: [],
      resources: [],
    });
    vi.spyOn(conferenceApi, "bootstrap").mockRejectedValue(new ApiClientError(404, "NO_EVENT", "No applicant workspace yet."));
    vi.spyOn(conferenceApi, "enroll").mockResolvedValue({ eventId: event.id, role: "applicant", enrolled: true });
    const submit = vi.spyOn(conferenceApi, "submitProposal").mockResolvedValue({
      id: "proposal-no-participants",
      status: "submitted",
      version: 1,
      submittedAt: "2027-02-01T12:00:00.000Z",
    });

    await act(async () => {
      root.render(
        <BrowserRouter>
          <WorkspaceProvider>
            <Routes><Route path="/submit/:slug" element={<PublicSubmissionWizard />} /></Routes>
          </WorkspaceProvider>
        </BrowserRouter>,
      );
    });

    const button = (label: RegExp) => [...container.querySelectorAll("button")]
      .find((candidate) => label.test(candidate.textContent ?? ""));
    const click = async (label: RegExp) => {
      await vi.waitFor(() => expect(button(label)).toBeTruthy());
      await act(async () => button(label)!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    };
    const change = async (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
      await act(async () => element.dispatchEvent(new Event("input", { bubbles: true })));
    };

    await vi.waitFor(() => expect(container.textContent).toContain(participantDisabledForm.publicTitle));
    await click(/^Continue/);
    await vi.waitFor(() => expect(container.textContent).toContain("Verified as"));
    await click(/^Continue/);

    const title = container.querySelector<HTMLInputElement>('input[placeholder*="eval flywheel"]')!;
    const summary = container.querySelector<HTMLTextAreaElement>('textarea[placeholder*="What did you build"]')!;
    expect(title).toBeTruthy();
    expect(summary).toBeTruthy();
    await change(title, applicantSubmission.title);
    await change(summary, applicantSubmission.summary);
    await click(/^Continue/);

    expect(container.textContent).not.toContain("Primary speaker questions");
    const permission = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    expect(permission).toBeTruthy();
    await act(async () => permission.click());
    await click(/Submit proposal/);

    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    expect(submit.mock.calls[0][2]).toMatchObject({
      formId: participantDisabledForm.id,
      speakers: [{
        name: "Ada María Rivera",
        email: "ada.verified@example.com",
      }],
    });
    expect(submit.mock.calls[0][2].speakers).toHaveLength(1);
  });

  it("resumes an older account draft against its pinned form and drops non-contract responses", async () => {
    const latestForm: FormDefinition = {
      ...publicForm,
      version: 8,
      publishedVersion: 8,
      publicTitle: "Latest public call",
      fields: [
        { id: "v2-title", label: "Session title", type: "short_text", required: true, section: "proposal" },
        { id: "v2-abstract", label: "Abstract", type: "long_text", required: true, section: "proposal" },
        { id: "v2-lane", label: "Program lane", type: "select", required: true, section: "proposal", options: ["New lane"] },
        { id: "v2-format", label: "Preferred format", type: "select", required: true, section: "proposal", options: ["Talk"] },
        { id: "v2-required", label: "New required evidence", type: "long_text", required: true, section: "proposal" },
      ],
    };
    const pinnedForm: FormDefinition = {
      ...publicForm,
      version: 7,
      publishedVersion: 7,
      publicTitle: "Pinned version seven call",
      fields: [
        { id: "v1-title", label: "Session title", type: "short_text", required: true, section: "proposal" },
        { id: "v1-abstract", label: "Abstract", type: "long_text", required: true, section: "proposal" },
        { id: "v1-lane", label: "Program lane", type: "select", required: true, section: "proposal", options: ["Legacy lane"] },
        { id: "v1-format", label: "Preferred format", type: "select", required: true, section: "proposal", options: ["Talk"] },
        { id: "v1-evidence", label: "Version seven evidence", type: "long_text", required: false, section: "proposal" },
      ],
    };
    const draft: Proposal = {
      id: "proposal-version-seven",
      eventId: event.id,
      version: 3,
      title: applicantSubmission.title,
      summary: applicantSubmission.summary,
      category: "Legacy lane",
      format: "talk",
      durationMinutes: 30,
      level: "advanced",
      status: "draft",
      speakers: [{
        id: "speaker-ada",
        name: "Ada María Rivera",
        email: "ada.verified@example.com",
        title: "Staff Engineer",
        company: "Northstar",
        bio: "Builds durable agent systems.",
        profileComplete: true,
      }],
      submittedAt: "2027-01-10T12:00:00.000Z",
      reviewCount: 0,
      reviewerGroup: "Legacy committee",
      tags: [],
      responses: {
        "v1-title": "Stale canonical title",
        "v1-abstract": "Stale canonical abstract",
        "v1-lane": "Stale lane",
        "v1-format": "Workshop",
        "v1-evidence": "Evidence retained from version seven.",
        "removed-response": "This hidden answer must not be re-sent.",
      },
      form: pinnedForm,
    };
    const snapshot = createDemoWorkspace("user-applicant");
    vi.spyOn(conferenceApi, "publicEvent").mockResolvedValue({ event, form: latestForm, sessions: [], speakers: [], resources: [] });
    vi.spyOn(conferenceApi, "bootstrap").mockResolvedValue({
      ...snapshot,
      demoMode: false,
      event,
      actor: { id: "user-verified", name: "Ada María Rivera", email: "ada.verified@example.com", role: "applicant" },
      actors: [{ id: "user-verified", name: "Ada María Rivera", email: "ada.verified@example.com", role: "applicant" }],
      forms: [latestForm],
      proposals: [draft],
      reviews: [],
      tasks: [],
      tracks: [],
      rooms: [],
      sessions: [],
      resources: [],
      embeds: [],
      activity: [],
    });
    vi.spyOn(conferenceApi, "enroll").mockResolvedValue({ eventId: event.id, role: "applicant", enrolled: false });
    const update = vi.spyOn(conferenceApi, "updateSubmission").mockResolvedValue({
      id: draft.id,
      status: "submitted",
      version: 4,
      submittedAt: "2027-02-01T12:00:00.000Z",
    });
    window.history.replaceState({}, "", `/submit/${event.slug}?edit=${draft.id}`);

    await act(async () => {
      root.render(
        <BrowserRouter>
          <WorkspaceProvider>
            <Routes><Route path="/submit/:slug" element={<PublicSubmissionWizard />} /></Routes>
          </WorkspaceProvider>
        </BrowserRouter>,
      );
    });

    const button = (label: RegExp) => [...container.querySelectorAll("button")]
      .find((candidate) => label.test(candidate.textContent ?? ""));
    const click = async (label: RegExp) => {
      await vi.waitFor(() => expect(button(label)).toBeTruthy());
      await act(async () => button(label)!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    };

    await vi.waitFor(() => expect(container.textContent).toContain("Pinned version seven call"));
    expect(container.textContent).toContain("immutable form version 7; new proposals use version 8");
    expect(container.textContent).toContain("Version seven evidence");
    expect(container.textContent).not.toContain("New required evidence");
    await click(/^Continue/);
    await vi.waitFor(() => expect(container.textContent).toContain("Who will be on stage?"));
    await click(/^Continue/);
    await vi.waitFor(() => expect(container.textContent).toContain("One final read"));
    const permission = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => permission.click());
    await click(/Submit saved draft/);

    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    expect(update).toHaveBeenCalledWith(
      expect.any(String),
      event.id,
      draft.id,
      expect.objectContaining({
        expectedVersion: 3,
        responses: {
          "v1-title": draft.title,
          "v1-abstract": draft.summary,
          "v1-lane": draft.category,
          "v1-format": "Talk",
          "v1-evidence": "Evidence retained from version seven.",
        },
      }),
    );
    expect(update.mock.calls[0][3].responses).not.toHaveProperty("removed-response");
    expect(update.mock.calls[0][3].responses).not.toHaveProperty("v2-required");
  });
});
