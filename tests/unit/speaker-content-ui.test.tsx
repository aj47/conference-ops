// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpeakerContentSnapshot } from "../../src/shared/speaker-content";

vi.mock("../../src/client/workspace", () => ({
  useWorkspace: () => ({
    workspace: {
      event: { id: "event-a", timezone: "America/Los_Angeles" },
      actor: { id: "organizer-a", role: "organizer", name: "Jordan Alvarez" },
    },
    source: "api",
    privateWorkspaceEventId: "event-a",
  }),
}));

import { SpeakerContentOperations } from "../../src/client/speaker-content/SpeakerContentOperations";

const snapshot: SpeakerContentSnapshot = {
  speakers: [
    {
      id: "speaker-priya", name: "Priya Raman", email: "priya@example.test", title: "Staff Engineer",
      company: "Latticework", bio: "Build systems leader", workflowStatus: "confirmed", socialLinks: {},
      travelDetails: "Vegetarian", profileComplete: true, published: true,
      sessions: [{ id: "session-ci", title: "Taming 40-Minute CI" }],
    },
    {
      id: "speaker-marcus", name: "Marcus Okafor", email: "marcus@example.test", title: "Founder",
      company: "Agent Relay", bio: "Production agents", workflowStatus: "onboarding", socialLinks: {},
      travelDetails: "", profileComplete: false, published: false,
      sessions: [{ id: "session-agents", title: "Agents in Production Q&A" }],
    },
  ],
  tasks: [
    {
      id: "task-slides", speakerId: "speaker-priya", speakerName: "Priya Raman", sessionId: "session-ci",
      sessionTitle: "Taming 40-Minute CI", title: "Upload Session Presentation", description: "Final PDF",
      kind: "file_request", dueAt: "2027-05-01T12:00:00.000Z", status: "complete",
      comments: [{ id: "comment-a", authorName: "Priya Raman", body: "Final version coming Friday.", createdAt: "2027-04-01T12:00:00.000Z" }],
      versions: [
        { uploadId: "v2", fileName: "slides.pdf", contentType: "application/pdf", byteSize: 20, uploadedAt: "2027-04-02T12:00:00.000Z", current: true, downloadUrl: "/v2" },
        { uploadId: "v1", fileName: "slides.pdf", contentType: "application/pdf", byteSize: 10, uploadedAt: "2027-04-01T12:00:00.000Z", current: false, downloadUrl: "/v1" },
      ],
    },
    {
      id: "task-bio", speakerId: "speaker-marcus", speakerName: "Marcus Okafor", title: "Complete bio",
      description: "Finish profile", kind: "general", dueAt: "2027-04-14T12:00:00.000Z", status: "not_started",
      comments: [], versions: [],
    },
  ],
  files: [{
    id: "task-slides", taskId: "task-slides", speakerId: "speaker-priya", speakerName: "Priya Raman",
    sessionId: "session-ci", sessionTitle: "Taming 40-Minute CI", fileName: "slides.pdf",
    uploadedAt: "2027-04-02T12:00:00.000Z", versionCount: 2,
    versions: [
      { uploadId: "v2", fileName: "slides.pdf", contentType: "application/pdf", byteSize: 20, uploadedAt: "2027-04-02T12:00:00.000Z", current: true, downloadUrl: "/v2" },
      { uploadId: "v1", fileName: "slides.pdf", contentType: "application/pdf", byteSize: 10, uploadedAt: "2027-04-01T12:00:00.000Z", current: false, downloadUrl: "/v1" },
    ],
  }],
  sessions: [
    { id: "session-ci", title: "Taming 40-Minute CI", description: "CI systems", format: "talk", scheduleStatus: "scheduled", contentStatus: "approved", speakerIds: ["speaker-priya"], speakerNames: ["Priya Raman"], history: [] },
    { id: "session-agents", title: "Agents in Production Q&A", description: "Agent systems", format: "lightning", scheduleStatus: "scheduled", contentStatus: "in_review", speakerIds: ["speaker-marcus"], speakerNames: ["Marcus Okafor"], history: [] },
  ],
  communications: [],
  generatedAt: "2027-04-03T12:00:00.000Z",
};

let container: HTMLDivElement;
let root: Root;

function button(name: string) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(name));
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: snapshot }), { status: 200, headers: { "content-type": "application/json" } })));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("speaker content operations UI", () => {
  it("exposes roster filters, task matrix, versioned library, approval editing, and personalized communications", async () => {
    await act(async () => {
      root.render(<SpeakerContentOperations />);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container.textContent).toContain("Priya Raman");
    expect(container.textContent).toContain("Marcus Okafor");
    const search = container.querySelector<HTMLInputElement>('input[placeholder="Search roster"]')!;
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "Priya");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.textContent).toContain("Priya Raman");
    expect(container.textContent).not.toContain("Marcus Okafor");

    await act(async () => button("Progress")!.click());
    expect(container.textContent).toContain("Per-speaker assignment matrix");
    expect(container.textContent).toContain("Upload Session Presentation");
    expect(container.textContent).toContain("Send reminders (1)");

    await act(async () => button("Files")!.click());
    expect(container.textContent).toContain("slides.pdf");
    expect(container.textContent).toContain("2 versions");
    expect(container.textContent).toContain("Final version coming Friday.");

    await act(async () => button("Session content")!.click());
    expect(container.textContent).toContain("Content approval queue");
    expect(container.querySelector('select option[value="approved"]')).not.toBeNull();
    expect(container.textContent).toContain("Assigned speakers");

    await act(async () => button("Communications")!.click());
    expect(container.textContent).toContain("Production outbox");
    expect(container.textContent).toContain("{{speaker.first_name}}");
    expect(container.textContent).toContain("Hi Priya");
  });
});
