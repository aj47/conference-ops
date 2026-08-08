import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgramSession, Proposal, ProposalStatus, SpeakerProfile, WorkspaceSnapshot } from "../../src/shared/domain";
import { projectConferenceExport } from "../../src/shared/conference-export";
import { createDemoWorkspace } from "../../src/shared/demo-data";
import type { Bindings } from "../../src/server/env";

const workspaceState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: {
      getSession: async () => ({ user: { id: "organizer-a", name: "Organizer A", email: "organizer@example.com" } }),
    },
    handler: async () => new Response(null, { status: 404 }),
  }),
}));

vi.mock("../../src/server/workspace", () => ({
  loadWorkspace: async () => workspaceState.current,
}));

import app from "../../src/server/index";

function speaker(id: string, marker: string): SpeakerProfile {
  return {
    id,
    name: marker,
    email: `${marker}@example.test`,
    title: `${marker} title`,
    company: `${marker} company`,
    bio: `${marker} bio`,
    profileComplete: true,
  };
}

function proposal(id: string, status: ProposalStatus, speakers: SpeakerProfile[], eventId = "event-a"): Proposal {
  return {
    id,
    eventId,
    title: `${id} title`,
    summary: `${id} summary with enough detail for the export fixture.`,
    category: "Build",
    format: "talk",
    durationMinutes: 30,
    level: "intermediate",
    status,
    speakers,
    submittedAt: "2026-08-01T12:00:00.000Z",
    reviewCount: 1,
    reviewerGroup: "Program",
    tags: [],
  };
}

function session(input: Partial<ProgramSession> & Pick<ProgramSession, "id" | "status">): ProgramSession {
  return {
    id: input.id,
    eventId: input.eventId ?? "event-a",
    proposalId: input.proposalId,
    origin: input.origin,
    title: input.title ?? `${input.id} title`,
    description: input.description ?? `${input.id} description`,
    format: input.format ?? "talk",
    speakerIds: input.speakerIds ?? [],
    speakerNames: input.speakerNames ?? [],
    trackId: input.trackId ?? "track-a",
    roomId: input.roomId ?? "room-a",
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    status: input.status,
  };
}

const safeA = speaker("speaker-safe-a", "Safe A");
const safeB = speaker("speaker-safe-b", "Safe B");
const draftSecret = speaker("speaker-draft", "SECRET_DRAFT_PII");
const rejectedSecret = speaker("speaker-rejected", "SECRET_REJECTED_PII");
const withdrawnSecret = speaker("speaker-withdrawn", "SECRET_WITHDRAWN_PII");
const waitlistedSecret = speaker("speaker-waitlisted", "SECRET_WAITLISTED_PII");
const directSpeaker = speaker("speaker-direct", "Direct Program Guest");
const directCompanionSecret = speaker("speaker-direct-companion", "SECRET_UNREFERENCED_DIRECT_COMPANION_PII");
const crossEventSecret = speaker("speaker-cross-event", "SECRET_CROSS_EVENT_PII");

function mixedWorkspace(): WorkspaceSnapshot {
  return {
    actor: { id: "organizer-a", name: "Organizer A", email: "organizer@example.com", role: "organizer" },
    actors: [],
    event: {
      id: "event-a",
      slug: "safe-conference",
      name: "Safe Conference",
      shortName: "SAFE",
      description: "Safe export fixture",
      timezone: "America/Los_Angeles",
      startsAt: "2026-08-28T16:00:00.000Z",
      endsAt: "2026-08-30T01:00:00.000Z",
      venue: "Test venue",
      websiteUrl: "https://example.test",
      status: "review",
      cfpClosesAt: "2026-08-01T00:00:00.000Z",
      accent: "#123456",
    },
    forms: [],
    proposals: [
      proposal("proposal-accepted", "accepted", [safeA]),
      proposal("proposal-session", "session", [safeB, safeA]),
      proposal("proposal-draft", "draft", [draftSecret]),
      proposal("proposal-rejected", "rejected", [rejectedSecret]),
      proposal("proposal-withdrawn", "withdrawn", [withdrawnSecret]),
      proposal("proposal-waitlisted", "waitlisted", [directSpeaker, directCompanionSecret, waitlistedSecret]),
      proposal("proposal-cross-event", "accepted", [crossEventSecret], "event-b"),
    ],
    reviews: [],
    tasks: [],
    tracks: [{ id: "track-a", name: "Build", color: "#123456" }],
    rooms: [{ id: "room-a", name: "Main room", capacity: 100 }],
    sessions: [
      session({ id: "session-scheduled", proposalId: "proposal-accepted", origin: "proposal", status: "scheduled", speakerIds: [safeA.id], speakerNames: ["SECRET_STALE_SESSION_NAME"], startsAt: "2026-08-28T17:00:00.000Z", endsAt: "2026-08-28T17:30:00.000Z" }),
      session({ id: "session-published", proposalId: "proposal-session", origin: "proposal", status: "published", speakerIds: [safeB.id], speakerNames: [safeB.name], startsAt: "2026-08-28T18:00:00.000Z", endsAt: "2026-08-28T18:30:00.000Z" }),
      session({ id: "session-direct", origin: "direct_program", status: "published", speakerIds: [directSpeaker.id], speakerNames: ["SECRET_STALE_DIRECT_NAME"], startsAt: "2026-08-28T18:30:00.000Z", endsAt: "2026-08-28T19:00:00.000Z" }),
      session({ id: "session-break", origin: "direct_program", status: "published", title: "Program break", format: "break", speakerIds: [], speakerNames: [], startsAt: "2026-08-28T19:00:00.000Z", endsAt: "2026-08-28T19:30:00.000Z" }),
      session({ id: "session-unscheduled", origin: "direct_sponsor", status: "unscheduled", title: "SECRET_UNSCHEDULED_SESSION", speakerIds: [waitlistedSecret.id], speakerNames: [waitlistedSecret.name] }),
      session({ id: "session-rejected-speaker", proposalId: "proposal-rejected", origin: "proposal", status: "scheduled", title: "SECRET_REJECTED_SESSION", speakerIds: [rejectedSecret.id], speakerNames: [rejectedSecret.name], startsAt: "2026-08-28T19:30:00.000Z", endsAt: "2026-08-28T20:00:00.000Z" }),
      session({ id: "session-mixed-speakers", proposalId: "proposal-accepted", origin: "proposal", status: "published", title: "SECRET_MIXED_SESSION", speakerIds: [safeA.id, rejectedSecret.id], speakerNames: [safeA.name, rejectedSecret.name], startsAt: "2026-08-28T20:00:00.000Z", endsAt: "2026-08-28T20:30:00.000Z" }),
      session({ id: "session-direct-cross-event-speaker", origin: "direct_sponsor", status: "scheduled", title: "SECRET_DIRECT_CROSS_EVENT_SESSION", speakerIds: [crossEventSecret.id], speakerNames: [crossEventSecret.name], startsAt: "2026-08-28T20:30:00.000Z", endsAt: "2026-08-28T21:00:00.000Z" }),
      session({ id: "session-cross-event", eventId: "event-b", status: "published", title: "SECRET_CROSS_EVENT_SESSION", speakerIds: [safeA.id], speakerNames: [safeA.name], startsAt: "2026-08-28T21:00:00.000Z", endsAt: "2026-08-28T21:30:00.000Z" }),
      session({ id: "session-invalid-time", status: "scheduled", title: "SECRET_INVALID_TIME_SESSION", speakerIds: [safeA.id], speakerNames: [safeA.name] }),
    ],
    resources: [],
    activity: [],
  };
}

class MembershipStatement {
  bind() {
    return this;
  }

  async first<T>() {
    return { role: "organizer" } as T;
  }
}

class MembershipDatabase {
  prepare() {
    return new MembershipStatement();
  }
}

function bindings(): Bindings {
  return {
    DB: new MembershipDatabase() as unknown as D1Database,
    UPLOADS: {} as R2Bucket,
    ENVIRONMENT: "local",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.test",
    BETTER_AUTH_URL: "https://conference.example.test",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-api-tests",
    MAIL_FROM: "program@example.test",
    MAIL_REPLY_TO: "program@example.test",
    ACCELEVENTS_ENABLED: "false",
  };
}

function request(path: string, init?: RequestInit) {
  return app.request(`http://localhost${path}`, init, bindings());
}

describe("safe conference export projection", () => {
  beforeEach(() => {
    workspaceState.current = mixedWorkspace();
  });

  it("projects only accepted speakers and valid scheduled or published sessions", () => {
    const projection = projectConferenceExport(mixedWorkspace());

    expect(projection.speakers.map((item) => item.id)).toEqual([safeA.id, safeB.id, directSpeaker.id]);
    expect(projection.sessions.map((item) => item.id)).toEqual(["session-scheduled", "session-published", "session-direct", "session-break"]);
    expect(projection.sessions[0]).toMatchObject({ speakerIds: [safeA.id], speakerNames: [safeA.name] });
    expect(projection.sessions[2]).toMatchObject({ speakerIds: [directSpeaker.id], speakerNames: [directSpeaker.name] });
    expect(JSON.stringify(projection)).not.toContain("SECRET_");
  });

  it("retains the deliberate direct-program opening session and its waitlisted guest", () => {
    const projection = projectConferenceExport(createDemoWorkspace("organizer-a"));

    expect(projection.sessions.map((item) => item.id)).toContain("session-opening");
    expect(projection.speakers.map((item) => item.id)).toContain("speaker-jon");
  });

  it("keeps every export format on the same safe audience without leaking excluded PII", async () => {
    const speakersResponse = await request("/api/v1/events/event-a/exports/speakers.csv");
    const sessionsResponse = await request("/api/v1/events/event-a/exports/sessions.csv");
    const programResponse = await request("/api/v1/events/event-a/exports/program.json");
    const speakersCsv = await speakersResponse.text();
    const sessionsCsv = await sessionsResponse.text();
    const program = await programResponse.json() as { speakers: SpeakerProfile[]; sessions: ProgramSession[] };

    expect(speakersResponse.status).toBe(200);
    expect(sessionsResponse.status).toBe(200);
    expect(programResponse.status).toBe(200);
    expect(speakersCsv.split("\r\n").slice(1).map((row) => row.split(",", 1)[0])).toEqual(['"speaker-safe-a"', '"speaker-safe-b"', '"speaker-direct"']);
    expect(sessionsCsv.split("\r\n").slice(1).map((row) => row.split(",", 1)[0])).toEqual(['"session-scheduled"', '"session-published"', '"session-direct"', '"session-break"']);
    expect(program.speakers.map((item) => item.id)).toEqual([safeA.id, safeB.id, directSpeaker.id]);
    expect(program.sessions.map((item) => item.id)).toEqual(["session-scheduled", "session-published", "session-direct", "session-break"]);
    expect(`${speakersCsv}\n${sessionsCsv}\n${JSON.stringify(program)}`).not.toContain("SECRET_");
  });

  it("returns manual Accelevents fallback URLs for the protected CSV endpoints", async () => {
    const response = await request("/api/v1/events/event-a/integrations/accelevents/publish", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        status: "manual_action",
        exportUrls: {
          speakers: "/api/v1/events/event-a/exports/speakers.csv",
          sessions: "/api/v1/events/event-a/exports/sessions.csv",
        },
      },
    });
  });
});
