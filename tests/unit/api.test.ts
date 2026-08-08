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

  it("lets an organizer queue a staff invitation but rejects a reviewer", async () => {
    const path = "/api/v1/events/event-aie-2026/invitations";
    const invited = await jsonRequest(path, { email: "committee@example.com", role: "reviewer" });
    const denied = await jsonRequest(path, { email: "organizer.two@example.com", role: "organizer" }, "user-reviewer");

    expect(invited.status).toBe(201);
    expect((await responseJson<SuccessPayload>(invited)).data).toMatchObject({ role: "reviewer", status: "queued" });
    expect(denied.status).toBe(403);
    expect((await responseJson<ErrorPayload>(denied)).error.code).toBe("ROLE_REQUIRED");
  });

  it("serves the public event with only publishable sessions and accepted speakers", async () => {
    const response = await request("/api/v1/public/events/ai-engineer-summit-2026");
    const payload = await response.json() as {
      data: {
        demoMode?: boolean;
        form: { status: string };
        sessions: Array<{ status: string; trackName?: string; trackColor?: string; roomName?: string }>;
        speakers: Array<{ id: string; email?: string }>;
        resources: Array<{ status: string }>;
      };
    };

    expect(response.status).toBe(200);
    expect(payload.data.form.status).toBe("published");
    expect(payload.data.sessions.length).toBeGreaterThan(0);
    expect(payload.data.sessions.every((session) => session.status === "published")).toBe(true);
    expect(payload.data.sessions.every((session) => session.trackName && session.trackColor && session.roomName)).toBe(true);
    expect(payload.data.sessions.map((session) => session.trackName)).toEqual(expect.arrayContaining(["Build", "Evaluate"]));
    expect(payload.data.sessions.map((session) => session.roomName)).toEqual(expect.arrayContaining(["Cowell Theater", "Gallery 308"]));
    expect(payload.data.demoMode).toBe(true);
    expect(payload.data.speakers.map((speaker) => speaker.id)).toEqual(expect.arrayContaining(["speaker-jon", "speaker-marco", "speaker-priya"]));
    expect(payload.data.speakers.every((speaker) => !("email" in speaker))).toBe(true);
    expect(payload.data.resources.every((resource) => resource.status === "published")).toBe(true);
  });

  it("bootstraps the requested demo actor and workspace", async () => {
    const response = await request("/api/v1/bootstrap", { headers: { "x-demo-actor": "user-reviewer" } });
    const payload = await response.json() as { data: { actor: { id: string; role: string }; proposals: Array<{ id: string }>; reviews: Array<{ reviewerId: string; rubric: unknown[]; scores: Record<string, number> }> } };

    expect(response.status).toBe(200);
    expect(payload.data.actor).toMatchObject({ id: "user-reviewer", role: "reviewer" });
    expect(payload.data.proposals.map((proposal) => proposal.id)).toEqual(["proposal-2", "proposal-5"]);
    expect(payload.data.reviews.every((review) => review.reviewerId === "user-reviewer")).toBe(true);
    expect(payload.data.reviews[0]).toMatchObject({
      rubric: expect.arrayContaining([expect.objectContaining({ id: "relevance", maxScore: 5 })]),
      scores: { relevance: 5, evidence: 4, delivery: 4 },
    });
  });

  it("allows an organizer decision and a reviewer score, but rejects reviewer decisions", async () => {
    const decisionPath = "/api/v1/events/event-aie-2026/proposals/proposal-2/decision";
    const accepted = await jsonRequest(decisionPath, { status: "accepted", note: "Strong evidence and fit." });
    const denied = await jsonRequest(decisionPath, { status: "rejected" }, "user-reviewer");
    const reviewed = await jsonRequest(
      "/api/v1/events/event-aie-2026/proposals/proposal-2/review",
      { scores: { relevance: 5, evidence: 4, delivery: 4 }, recommendation: "yes", notes: "Strong operational detail and a concrete failure story.", submit: true },
      "user-reviewer",
    );

    expect(accepted.status).toBe(200);
    expect((await responseJson<SuccessPayload>(accepted)).data).toMatchObject({ proposalId: "proposal-2", status: "accepted" });
    expect(denied.status).toBe(403);
    expect((await responseJson<ErrorPayload>(denied)).error.code).toBe("ROLE_REQUIRED");
    expect(reviewed.status).toBe(200);
    expect((await responseJson<SuccessPayload>(reviewed)).data).toMatchObject({
      proposalId: "proposal-2",
      status: "submitted",
      scores: { relevance: 5, evidence: 4, delivery: 4 },
      score: 4.33,
    });
  });

  it("validates review criterion IDs, configured ranges, and submitted completeness", async () => {
    const path = "/api/v1/events/event-aie-2026/proposals/proposal-2/review";
    const unknown = await jsonRequest(path, {
      scores: { relevance: 5, evidence: 4, made_up: 3 },
      recommendation: "yes",
      notes: "This note has enough evidence to be useful.",
      submit: true,
    }, "user-reviewer");
    const incomplete = await jsonRequest(path, {
      scores: { relevance: 5 },
      recommendation: "yes",
      notes: "This note has enough evidence to be useful.",
      submit: true,
    }, "user-reviewer");

    expect(unknown.status).toBe(422);
    expect(await responseJson<ErrorPayload>(unknown)).toMatchObject({
      error: {
        code: "REVIEW_SCORES_INVALID",
        fieldErrors: { "scores.made_up": "This criterion is not part of the active review rubric." },
      },
    });
    expect(incomplete.status).toBe(422);
    expect(await responseJson<ErrorPayload>(incomplete)).toMatchObject({
      error: {
        code: "REVIEW_SCORES_INVALID",
        fieldErrors: {
          "scores.evidence": "Choose a score before submitting.",
          "scores.delivery": "Choose a score before submitting.",
        },
      },
    });
  });

  it("rejects review submissions without an assignment for the signed-in reviewer", async () => {
    const response = await jsonRequest(
      "/api/v1/events/event-aie-2026/proposals/proposal-1/review",
      { scores: { relevance: 5, evidence: 5, delivery: 5 }, recommendation: "strong_yes", notes: "This is a specific and well-supported recommendation.", submit: true },
      "user-reviewer",
    );

    expect(response.status).toBe(404);
    expect((await responseJson<ErrorPayload>(response)).error.code).toBe("REVIEW_ASSIGNMENT_NOT_FOUND");
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
      sessionIds: ["session-evals", "session-redteam"],
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

  it("lets organizers create and rename event-scoped rooms and tracks", async () => {
    const roomCreated = await jsonRequest("/api/v1/events/event-aie-2026/rooms", {
      name: "Workshop Loft",
      capacity: 72,
    });
    const trackCreated = await jsonRequest("/api/v1/events/event-aie-2026/tracks", {
      name: "Applied research",
      color: "#ABCDEF",
    });
    const roomUpdated = await request("/api/v1/events/event-aie-2026/rooms/room-firehouse", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
      body: JSON.stringify({ name: "Firehouse Lab", capacity: 96 }),
    });
    const trackUpdated = await request("/api/v1/events/event-aie-2026/tracks/track-operate", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
      body: JSON.stringify({ name: "Operations", color: "#102030" }),
    });

    expect(roomCreated.status).toBe(201);
    expect((await responseJson<SuccessPayload>(roomCreated)).data).toMatchObject({ name: "Workshop Loft", capacity: 72 });
    expect(trackCreated.status).toBe(201);
    expect((await responseJson<SuccessPayload>(trackCreated)).data).toMatchObject({ name: "Applied research", color: "#abcdef" });
    expect(roomUpdated.status).toBe(200);
    expect((await responseJson<SuccessPayload>(roomUpdated)).data).toMatchObject({ id: "room-firehouse", name: "Firehouse Lab", capacity: 96 });
    expect(trackUpdated.status).toBe(200);
    expect((await responseJson<SuccessPayload>(trackUpdated)).data).toMatchObject({ id: "track-operate", name: "Operations", color: "#102030" });
  });

  it("rejects duplicate venue names case-insensitively and validates resource values", async () => {
    const duplicateRoom = await jsonRequest("/api/v1/events/event-aie-2026/rooms", {
      name: "  cowell THEATER  ",
      capacity: 500,
    });
    const duplicateTrack = await request("/api/v1/events/event-aie-2026/tracks/track-operate", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
      body: JSON.stringify({ name: "build", color: "#445566" }),
    });
    const invalidRoom = await jsonRequest("/api/v1/events/event-aie-2026/rooms", {
      name: "No seats",
      capacity: 0,
    });
    const invalidTrack = await jsonRequest("/api/v1/events/event-aie-2026/tracks", {
      name: "Broken color",
      color: "orange",
    });

    expect(duplicateRoom.status).toBe(409);
    expect(await responseJson<ErrorPayload>(duplicateRoom)).toMatchObject({ error: { code: "ROOM_NAME_TAKEN", fieldErrors: { name: "Use a different room name." } } });
    expect(duplicateTrack.status).toBe(409);
    expect(await responseJson<ErrorPayload>(duplicateTrack)).toMatchObject({ error: { code: "TRACK_NAME_TAKEN", fieldErrors: { name: "Use a different track name." } } });
    expect(invalidRoom.status).toBe(400);
    expect(invalidTrack.status).toBe(400);
  });

  it("prevents deleting venue resources in use and removes unused resources", async () => {
    const usedRoom = await request("/api/v1/events/event-aie-2026/rooms/room-cowell", {
      method: "DELETE",
      headers: { "x-demo-actor": "user-organizer" },
    });
    const unusedRoom = await request("/api/v1/events/event-aie-2026/rooms/room-firehouse", {
      method: "DELETE",
      headers: { "x-demo-actor": "user-organizer" },
    });
    const usedTrack = await request("/api/v1/events/event-aie-2026/tracks/track-build", {
      method: "DELETE",
      headers: { "x-demo-actor": "user-organizer" },
    });
    const unusedTrack = await request("/api/v1/events/event-aie-2026/tracks/track-operate", {
      method: "DELETE",
      headers: { "x-demo-actor": "user-organizer" },
    });

    expect(usedRoom.status).toBe(409);
    expect((await responseJson<ErrorPayload>(usedRoom)).error.code).toBe("ROOM_IN_USE");
    expect(unusedRoom.status).toBe(200);
    expect((await responseJson<SuccessPayload>(unusedRoom)).data).toEqual({ id: "room-firehouse", deleted: true });
    expect(usedTrack.status).toBe(409);
    expect((await responseJson<ErrorPayload>(usedTrack)).error.code).toBe("TRACK_IN_USE");
    expect(unusedTrack.status).toBe(200);
    expect((await responseJson<SuccessPayload>(unusedTrack)).data).toEqual({ id: "track-operate", deleted: true });
  });

  it("scopes venue resources to the requested event and organizer role", async () => {
    const wrongEvent = await jsonRequest("/api/v1/events/event-other/rooms", { name: "Other room", capacity: 20 });
    const wrongRole = await jsonRequest("/api/v1/events/event-aie-2026/tracks", { name: "Reviewer track", color: "#112233" }, "user-reviewer");

    expect(wrongEvent.status).toBe(404);
    expect((await responseJson<ErrorPayload>(wrongEvent)).error.code).toBe("EVENT_NOT_FOUND");
    expect(wrongRole.status).toBe(403);
    expect((await responseJson<ErrorPayload>(wrongRole)).error.code).toBe("ROLE_REQUIRED");
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

  it("rejects a session that extends outside the event window", async () => {
    const response = await jsonRequest(schedulePath, {
      roomId: "room-cowell",
      trackId: "track-build",
      startsAt: "2026-08-30T00:45:00.000Z",
      endsAt: "2026-08-30T01:15:00.000Z",
    });
    const payload = await responseJson<ErrorPayload>(response);

    expect(response.status).toBe(422);
    expect(payload.error).toMatchObject({
      code: "OUTSIDE_EVENT_WINDOW",
      fieldErrors: {
        startsAt: "Choose a start time during the event.",
        endsAt: "Finish the session before the event ends.",
      },
    });
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

  it("keeps a live session published when its placement changes", async () => {
    const response = await jsonRequest(
      "/api/v1/events/event-aie-2026/sessions/session-opening/schedule",
      {
        roomId: "room-cowell",
        trackId: "track-build",
        startsAt: "2026-08-28T16:00:00.000Z",
        endsAt: "2026-08-28T16:20:00.000Z",
      },
    );

    expect(response.status).toBe(200);
    expect((await responseJson<SuccessPayload>(response)).data).toMatchObject({
      status: "published",
      conflictsOverridden: 0,
    });
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

  it("accepts and returns the complete versioned CFP settings payload", async () => {
    const settings = {
      proposalSectionTitle: "Share the operating lesson",
      proposalPageHeading: "Your session",
      proposalInstructions: "Explain the decision, evidence, and reusable result.",
      participantSectionTitle: "Introduce the presenters",
      participantPageHeading: "Presenters",
      participantInstructions: "Add the people who will actually present this work.",
      participantMin: 2,
      combinedCharacterLimit: 7400,
    };
    const response = await request("/api/v1/events/event-aie-2026/forms/form-main-cfp", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
      body: JSON.stringify({
        expectedVersion: 3,
        name: "AI Engineer Summit 2026 CFP",
        publicTitle: "Call for speakers",
        pageHeading: "Apply",
        submissionType: "abstract",
        collectsParticipants: true,
        welcomeTitle: "Bring the work",
        welcomeCopy: "Share a concrete field report.",
        confirmationCopy: "Your proposal was received.",
        maxSpeakers: 4,
        maxSubmissionsPerUser: 3,
        closesAt: "2026-08-13T05:00:00.000Z",
        allowMultipleDrafts: true,
        redirectToPortal: true,
        confirmationEmailEnabled: true,
        settings,
        fields: [
          { id: "field-title", label: "Session title", type: "short_text", required: true, section: "proposal" },
          { id: "speaker-email", label: "Speaker email", type: "email", required: true, section: "participant" },
        ],
      }),
    });
    const payload = await responseJson<SuccessPayload>(response);

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({ version: 4, status: "draft", settings });
  });
});
