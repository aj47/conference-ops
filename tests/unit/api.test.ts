import { describe, expect, it } from "vitest";
import app from "../../src/server/index";
import type { Bindings } from "../../src/server/env";

function demoBindings(): Bindings {
  return {
    DB: {} as D1Database,
    UPLOADS: {} as R2Bucket,
    ENVIRONMENT: "local",
    DEMO_MODE: "true",
    PUBLIC_APP_URL: "http://localhost:5173",
    BETTER_AUTH_URL: "http://localhost:5173",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-demo-only",
    MAIL_FROM: "Conference Ops <program@example.test>",
    MAIL_REPLY_TO: "program@example.test",
  };
}

function request(path: string, init?: RequestInit) {
  return app.request(`http://localhost${path}`, init, demoBindings());
}

function jsonRequest(path: string, body: unknown, actor = "user-organizer") {
  return request(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-actor": actor },
    body: JSON.stringify(body),
  });
}

const schedulePath = "/api/v1/events/event-aie-2026/sessions/session-unscheduled/schedule";

type SuccessPayload = { data: Record<string, unknown> };
type ErrorPayload = {
  error: {
    code: string;
    requestId: string;
    fieldErrors?: Record<string, string>;
    conflicts?: Array<{ type: string }>;
  };
};

function responseJson<T>(response: Response) {
  return response.json() as Promise<T>;
}

describe("demo API smoke flow", () => {
  it("serves health and security/request correlation headers", async () => {
    const response = await request("/api/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", service: "conference-ops", environment: "local" });
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("serves the public event with only publishable sessions and accepted speakers", async () => {
    const response = await request("/api/v1/public/events/ai-engineer-summit-2026");
    const payload = await response.json() as {
      data: {
        form: { status: string };
        sessions: Array<{ status: string; trackName?: string; trackColor?: string; roomName?: string }>;
        speakers: Array<{ id: string }>;
        resources: Array<{ status: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.data.form.status).toBe("published");
    expect(payload.data.sessions.length).toBeGreaterThan(0);
    expect(payload.data.sessions.every((session) => ["published", "scheduled"].includes(session.status))).toBe(true);
    expect(payload.data.sessions.every((session) => session.trackName && session.trackColor && session.roomName)).toBe(true);
    expect(payload.data.sessions.map((session) => session.trackName)).toEqual(expect.arrayContaining(["Build", "Evaluate"]));
    expect(payload.data.sessions.map((session) => session.roomName)).toEqual(expect.arrayContaining(["Cowell Theater", "Gallery 308"]));
    expect(payload.data.speakers.map((speaker) => speaker.id)).toEqual(expect.arrayContaining(["speaker-marco", "speaker-priya"]));
    expect(payload.data.resources.every((resource) => resource.status === "published")).toBe(true);
  });

  it("bootstraps the requested demo actor and workspace", async () => {
    const response = await request("/api/v1/bootstrap", { headers: { "x-demo-actor": "user-reviewer" } });
    const payload = await response.json() as { data: { actor: { id: string; role: string }; proposals: unknown[] } };

    expect(response.status).toBe(200);
    expect(payload.data.actor).toMatchObject({ id: "user-reviewer", role: "reviewer" });
    expect(payload.data.proposals.length).toBeGreaterThan(0);
  });

  it("allows an organizer decision and a reviewer score, but rejects reviewer decisions", async () => {
    const decisionPath = "/api/v1/events/event-aie-2026/proposals/proposal-2/decision";
    const accepted = await jsonRequest(decisionPath, { status: "accepted", note: "Strong evidence and fit." });
    const denied = await jsonRequest(decisionPath, { status: "rejected" }, "user-reviewer");
    const reviewed = await jsonRequest(
      "/api/v1/events/event-aie-2026/proposals/proposal-2/review",
      { score: 4.5, recommendation: "yes", notes: "Strong operational detail and a concrete failure story.", submit: true },
      "user-reviewer",
    );

    expect(accepted.status).toBe(200);
    expect((await responseJson<SuccessPayload>(accepted)).data).toMatchObject({ proposalId: "proposal-2", status: "accepted" });
    expect(denied.status).toBe(403);
    expect((await responseJson<ErrorPayload>(denied)).error.code).toBe("ROLE_REQUIRED");
    expect(reviewed.status).toBe(200);
    expect((await responseJson<SuccessPayload>(reviewed)).data).toMatchObject({ proposalId: "proposal-2", status: "submitted", score: 4.5 });
  });

  it("keeps staged decision queues distinct from final acceptance", async () => {
    const decisionPath = "/api/v1/events/event-aie-2026/proposals/proposal-2/decision";
    const queued = await jsonRequest(decisionPath, { status: "accept_queue", note: "Hold for the final program pass." });

    expect(queued.status).toBe(200);
    expect((await responseJson<SuccessPayload>(queued)).data).toMatchObject({
      proposalId: "proposal-2",
      status: "accept_queue",
    });
  });

  it("converts an accepted proposal, supports a direct sponsor session, and publishes scheduled agenda entries", async () => {
    const converted = await jsonRequest(
      "/api/v1/events/event-aie-2026/proposals/proposal-1/convert",
      {},
    );
    const direct = await jsonRequest("/api/v1/events/event-aie-2026/sessions", {
      title: "Partner field note",
      description: "A guaranteed sponsor session with an explicit program origin.",
      speakerIds: ["speaker-marco"],
      kind: "sponsor",
      format: "talk",
      capacity: 120,
      clientId: "sponsor-2026-01",
    });
    const published = await jsonRequest("/api/v1/events/event-aie-2026/agenda/publish", {
      sessionIds: ["session-eval-flywheel", "session-red-team"],
    });

    expect(converted.status).toBe(201);
    expect((await responseJson<SuccessPayload>(converted)).data).toMatchObject({
      proposalId: "proposal-1",
      title: "The eval flywheel that caught our agent regressions",
      status: "unscheduled",
    });
    expect(direct.status).toBe(201);
    expect((await responseJson<SuccessPayload>(direct)).data).toMatchObject({
      title: "Partner field note",
      kind: "sponsor",
      status: "unscheduled",
    });
    expect(published.status).toBe(200);
    expect((await responseJson<SuccessPayload>(published)).data).toMatchObject({
      status: "agenda_published",
      publishedSessions: 2,
    });
  });

  it("rejects zero-length and reversed schedule intervals with a field error", async () => {
    for (const [startsAt, endsAt] of [
      ["2026-08-28T18:00:00.000Z", "2026-08-28T18:00:00.000Z"],
      ["2026-08-28T18:30:00.000Z", "2026-08-28T18:00:00.000Z"],
    ]) {
      const response = await jsonRequest(schedulePath, {
        roomId: "room-cowell",
        trackId: "track-build",
        startsAt,
        endsAt,
      });
      const payload = await responseJson<ErrorPayload>(response);

      expect(response.status).toBe(422);
      expect(payload.error).toMatchObject({
        code: "INVALID_INTERVAL",
        fieldErrors: { endsAt: "Choose a later end time." },
      });
      expect(payload.error.requestId).toBeTruthy();
    }
  });

  it("returns structured room, track, and speaker conflicts", async () => {
    const response = await jsonRequest(schedulePath, {
      roomId: "room-cowell",
      trackId: "track-build",
      startsAt: "2026-08-28T16:05:00.000Z",
      endsAt: "2026-08-28T16:15:00.000Z",
    });
    const payload = await responseJson<ErrorPayload>(response);

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe("SCHEDULE_CONFLICT");
    expect(payload.error.conflicts?.map((conflict) => conflict.type)).toEqual(["room", "track", "speaker"]);
    expect(payload.error.requestId).toBeTruthy();
  });

  it("schedules a non-overlapping session and records an explicit conflict override", async () => {
    const openSlot = await jsonRequest(schedulePath, {
      roomId: "room-cowell",
      trackId: "track-build",
      startsAt: "2026-08-28T18:20:00.000Z",
      endsAt: "2026-08-28T18:50:00.000Z",
    });
    const overridden = await jsonRequest(schedulePath, {
      roomId: "room-cowell",
      trackId: "track-build",
      startsAt: "2026-08-28T16:05:00.000Z",
      endsAt: "2026-08-28T16:15:00.000Z",
      overrideReason: "Stage manager approved this intentional overlap.",
    });

    expect(openSlot.status).toBe(200);
    expect((await responseJson<SuccessPayload>(openSlot)).data).toMatchObject({ status: "scheduled", conflictsOverridden: 0 });
    expect(overridden.status).toBe(200);
    expect((await responseJson<SuccessPayload>(overridden)).data).toMatchObject({ status: "scheduled", conflictsOverridden: 3 });
  });

  it("publishes a form and completes a speaker task in demo mode", async () => {
    const published = await jsonRequest("/api/v1/events/event-aie-2026/forms/form-main-cfp/publish", { version: 4 });
    const completed = await jsonRequest(
      "/api/v1/events/event-aie-2026/tasks/task-2/complete",
      { complete: true },
      "user-speaker",
    );

    expect(published.status).toBe(200);
    expect((await responseJson<SuccessPayload>(published)).data).toMatchObject({ formId: "form-main-cfp", version: 4, status: "published" });
    expect(completed.status).toBe(200);
    expect((await responseJson<SuccessPayload>(completed)).data).toMatchObject({ taskId: "task-2", status: "complete" });
  });
});
