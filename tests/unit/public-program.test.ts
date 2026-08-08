import { describe, expect, it, vi } from "vitest";
import app from "../../src/server/index";
import type { Bindings } from "../../src/server/env";
import {
  databaseTimestampToIso,
  isPublicEventStatus,
  publicEventFromRow,
  publicSessionsFromRows,
} from "../../src/server/public-program";

const startsAt = Date.UTC(2026, 7, 28, 16);
const endsAt = Date.UTC(2026, 7, 28, 17);

interface PublicDatabaseRows {
  event?: Record<string, unknown> | null;
  form?: Record<string, unknown> | null;
  sessions?: Array<Record<string, unknown>>;
  sessionSpeakers?: Array<{ sessionId: string; speakerId: string; speakerName: string }>;
  speakers?: Array<Record<string, unknown>>;
  resources?: Array<Record<string, unknown>>;
  headshot?: { objectKey: string; contentType: string } | null;
}

function productionBindings(rows: PublicDatabaseRows, object?: R2ObjectBody) {
  const prepare = vi.fn((sql: string) => {
    const statement = {
      bind: vi.fn(() => statement),
      first: vi.fn(async () => {
        if (sql.includes("SELECT up.object_key AS objectKey")) return rows.headshot ?? null;
        if (sql.includes("FROM events WHERE")) return rows.event ?? null;
        if (sql.includes("FROM submission_forms")) return rows.form ?? null;
        return null;
      }),
      all: vi.fn(async () => {
        if (sql.includes("FROM program_sessions ps LEFT JOIN")) return { results: rows.sessions ?? [] };
        if (sql.includes("FROM session_speakers ss")) return { results: rows.sessionSpeakers ?? [] };
        if (sql.includes("FROM speaker_profiles sp")) return { results: rows.speakers ?? [] };
        if (sql.includes("FROM resource_pages")) return { results: rows.resources ?? [] };
        return { results: [] };
      }),
    };
    return statement;
  });
  const get = vi.fn(async () => object ?? null);
  const bindings: Bindings = {
    DB: { prepare } as unknown as D1Database,
    UPLOADS: { get } as unknown as R2Bucket,
    ENVIRONMENT: "production",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.com",
    BETTER_AUTH_URL: "https://conference.example.com",
    BETTER_AUTH_SECRET: "auth-secret-that-is-at-least-32-characters",
    MAIL_FROM: "program@example.com",
    MAIL_REPLY_TO: "replies@example.com",
  };
  return { bindings, get, prepare };
}

function publicRows(): PublicDatabaseRows {
  return {
    event: {
      id: "event-a",
      slug: "summit-2026",
      name: "Summit 2026",
      shortName: "SUMMIT",
      description: "Field notes from production.",
      timezone: "America/Los_Angeles",
      startsAt,
      endsAt,
      cfpClosesAt: String(startsAt - 86_400_000),
      venue: "Fort Mason",
      websiteUrl: null,
      accent: "#e05b3f",
      status: "agenda_published",
    },
    form: {
      id: "form-a", name: "CFP", status: "published", version: 3, submissionType: "abstract",
      collectsParticipants: 1, maxSubmissionsPerUser: 3, redirectToPortal: 1,
      confirmationEmailEnabled: 1, closesAt: startsAt - 86_400_000, updatedAt: startsAt - 1000,
      publicTitle: "Call for speakers", pageHeading: "Apply", welcomeTitle: "Bring the work",
      welcomeCopy: "Welcome", confirmationCopy: "Received", maxSpeakers: 4,
      allowMultipleDrafts: 1, fields: "[]", settings: JSON.stringify({
        proposalSectionTitle: "Share the operating lesson",
        proposalPageHeading: "Your session",
        proposalInstructions: "Explain the decision and evidence.",
        participantSectionTitle: "Introduce the presenters",
        participantPageHeading: "Presenters",
        participantInstructions: "Add the people who will present.",
        participantMin: 2,
        combinedCharacterLimit: 7400,
      }),
    },
    sessions: [{
      id: "session-a", eventId: "event-a", proposalId: "proposal-a", title: "Operational evals",
      description: "A field report.", startsAt, endsAt, trackId: "track-a", trackName: "Build",
      trackColor: "#123456", roomId: "room-a", roomName: "Theater",
    }],
    sessionSpeakers: [
      { sessionId: "session-a", speakerId: "speaker-a", speakerName: "Ada Rivera" },
      { sessionId: "session-a", speakerId: "speaker-b", speakerName: "Lin Park" },
    ],
    speakers: [{
      id: "speaker-a", name: "Ada Rivera", title: "Staff Engineer", company: "Northstar",
      bio: "Builds production systems.", profileComplete: 1, hasHeadshot: 1,
      objectKey: "private/event-a/speaker-a/headshot",
    }],
    resources: [{ id: "resource-a", title: "Arrival guide", slug: "arrival", summary: "Day-of details.", updatedAt: startsAt }],
  };
}

describe("public program projections", () => {
  it("only recognizes non-draft public event lifecycle states", () => {
    expect(["cfp_open", "review", "agenda_published", "archived"].every(isPublicEventStatus)).toBe(true);
    expect(isPublicEventStatus("draft")).toBe(false);
  });

  it("maps database milliseconds and numeric strings to ISO instants", () => {
    expect(databaseTimestampToIso(startsAt)).toBe("2026-08-28T16:00:00.000Z");
    expect(databaseTimestampToIso(String(startsAt))).toBe("2026-08-28T16:00:00.000Z");
    expect(publicEventFromRow(publicRows().event!)).toMatchObject({
      startsAt: "2026-08-28T16:00:00.000Z",
      endsAt: "2026-08-28T17:00:00.000Z",
      websiteUrl: "",
    });
  });

  it("attaches ordered session speaker IDs and names without duplicates", () => {
    const rows = publicRows();
    const sessions = publicSessionsFromRows(rows.sessions!, [...rows.sessionSpeakers!, rows.sessionSpeakers![0]]);
    expect(sessions[0]).toMatchObject({
      speakerIds: ["speaker-a", "speaker-b"],
      speakerNames: ["Ada Rivera", "Lin Park"],
      startsAt: "2026-08-28T16:00:00.000Z",
      endsAt: "2026-08-28T17:00:00.000Z",
    });
  });
});

describe("production public program API", () => {
  it("hides unavailable events at the SQL boundary", async () => {
    const { bindings, prepare } = productionBindings({ event: null });
    const response = await app.request("https://conference.example.com/api/v1/public/events/draft-event", undefined, bindings);

    expect(response.status).toBe(404);
    expect(prepare.mock.calls[0][0]).toContain("deleted_at IS NULL");
    expect(prepare.mock.calls[0][0]).toContain("status IN ('cfp_open', 'review', 'agenda_published', 'archived')");
  });

  it("returns normalized published sessions, profiles, resources, and opaque headshot URLs", async () => {
    const { bindings, prepare } = productionBindings(publicRows());
    const response = await app.request("https://conference.example.com/api/v1/public/events/summit-2026", undefined, bindings);
    const payload = await response.json() as { data: Record<string, unknown> };
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      event: { startsAt: "2026-08-28T16:00:00.000Z", endsAt: "2026-08-28T17:00:00.000Z" },
      form: {
        closesAt: "2026-08-27T16:00:00.000Z",
        updatedAt: "2026-08-28T15:59:59.000Z",
        settings: {
          proposalSectionTitle: "Share the operating lesson",
          proposalPageHeading: "Your session",
          participantMin: 2,
          combinedCharacterLimit: 7400,
        },
      },
      sessions: [{ speakerIds: ["speaker-a", "speaker-b"], speakerNames: ["Ada Rivera", "Lin Park"] }],
      speakers: [{ id: "speaker-a", headshotUrl: "/api/v1/public/events/summit-2026/speakers/speaker-a/headshot" }],
      resources: [{ id: "resource-a", updatedAt: "2026-08-28T16:00:00.000Z" }],
    });
    expect(serialized).not.toContain("objectKey");
    expect(serialized).not.toContain("private/event-a");
    expect(prepare.mock.calls.find(([sql]) => String(sql).includes("FROM submission_forms"))?.[0]).toContain("fv.settings");
  });

  it("projects published version controls ahead of denormalized legacy form columns", async () => {
    const rows = publicRows();
    rows.form!.settings = JSON.stringify({
      ...JSON.parse(String(rows.form!.settings)),
      submissionControls: {
        submissionType: "session",
        collectsParticipants: false,
        maxSubmissionsPerUser: 9,
        redirectToPortal: false,
        confirmationEmailEnabled: true,
        closesAt: "2026-08-30T18:00:00.000Z",
      },
    });
    const { bindings } = productionBindings(rows);
    const response = await app.request("https://conference.example.com/api/v1/public/events/summit-2026", undefined, bindings);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: {
        form: {
          submissionType: "session",
          collectsParticipants: false,
          maxSubmissionsPerUser: 9,
          redirectToPortal: false,
          confirmationEmailEnabled: true,
          closesAt: "2026-08-30T18:00:00.000Z",
        },
      },
    });
  });

  it("serves only eligible image objects with public caching and conditional requests", async () => {
    const body = new Uint8Array([0xff, 0xd8, 0xff]);
    const object = {
      body: new Blob([body], { type: "image/jpeg" }).stream(),
      size: body.byteLength,
      httpEtag: '"headshot-etag"',
    } as unknown as R2ObjectBody;
    const rows = { headshot: { objectKey: "private/headshot", contentType: "image/jpeg" } };
    const first = productionBindings(rows, object);
    const response = await app.request("https://conference.example.com/api/v1/public/events/summit-2026/speakers/speaker-a/headshot", undefined, first.bindings);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, stale-while-revalidate=86400");
    expect(response.headers.get("etag")).toBe('"headshot-etag"');
    expect(first.get).toHaveBeenCalledWith("private/headshot");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);

    const second = productionBindings(rows, object);
    const notModified = await app.request("https://conference.example.com/api/v1/public/events/summit-2026/speakers/speaker-a/headshot", {
      headers: { "if-none-match": '"headshot-etag"' },
    }, second.bindings);
    expect(notModified.status).toBe(304);
  });

  it("does not read R2 when the profile/session/upload eligibility query fails", async () => {
    const { bindings, get } = productionBindings({ headshot: null });
    const response = await app.request("https://conference.example.com/api/v1/public/events/summit-2026/speakers/private/headshot", undefined, bindings);

    expect(response.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });
});
