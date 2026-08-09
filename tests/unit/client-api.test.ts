import { afterEach, describe, expect, it, vi } from "vitest";
import { conferenceApi, safeDownloadFileName } from "../../src/client/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("conference client communication and export requests", () => {
  it("normalizes untrusted upload filenames before they reach task state or a download", () => {
    expect(safeDownloadFileName("../final\u202edeck.pdf", "submitted-file")).toBe("finaldeck.pdf");
    expect(safeDownloadFileName("..", "submitted-file")).toBe("submitted-file");
  });

  it("sends criterion scores instead of a client-authored aggregate for reviews", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        proposalId: "proposal-1",
        status: "submitted",
        scores: { fit: 5, evidence: 4 },
        score: 4.4,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(conferenceApi.review("reviewer-1", "event-1", "proposal-1", {
      scores: { fit: 5, evidence: 4 },
      recommendation: "yes",
      notes: "The proposal includes specific evidence and a useful outcome.",
      submit: true,
    })).resolves.toMatchObject({ score: 4.4 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-1/proposals/proposal-1/review",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          scores: { fit: 5, evidence: 4 },
          recommendation: "yes",
          notes: "The proposal includes specific evidence and a useful outcome.",
          submit: true,
        }),
      }),
    );
  });

  it("claims an invited speaker profile with the verified browser session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        eventId: "event-aie-2026",
        role: "speaker",
        speakerProfileId: "speaker-a",
        claimed: true,
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(conferenceApi.claimSpeaker("event-aie-2026")).resolves.toMatchObject({
      role: "speaker",
      speakerProfileId: "speaker-a",
      claimed: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/claim-speaker",
      {
        method: "POST",
        body: JSON.stringify({ eventId: "event-aie-2026" }),
        headers: {
          "content-type": "application/json",
          "x-demo-actor": "",
        },
      },
    );
  });

  it("accepts a staff invitation with the signed-in session", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { accepted: true, eventId: "event-aie-2026", role: "reviewer" },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(conferenceApi.acceptInvitation("invite-token".repeat(4))).resolves.toEqual({
      accepted: true,
      eventId: "event-aie-2026",
      role: "reviewer",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/invitations/accept",
      {
        method: "POST",
        body: JSON.stringify({ token: "invite-token".repeat(4) }),
        headers: {
          "content-type": "application/json",
          "x-demo-actor": "",
        },
      },
    );
  });

  it("queues a reviewer invitation from the organizer workspace", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: "invite-1", email: "reviewer@example.com", role: "reviewer", status: "queued", expiresAt: "2026-08-15T12:00:00.000Z" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(conferenceApi.inviteStaff("user-organizer", "event-aie-2026", {
      email: "reviewer@example.com",
      role: "reviewer",
    })).resolves.toMatchObject({ status: "queued", role: "reviewer" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-aie-2026/invitations",
      {
        method: "POST",
        body: JSON.stringify({ email: "reviewer@example.com", role: "reviewer" }),
        headers: {
          "content-type": "application/json",
          "x-demo-actor": "user-organizer",
        },
      },
    );
  });

  it("opens a controlled proposal revision with an organizer note", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        proposalId: "proposal-1",
        status: "changes_requested",
        note: "Clarify the benchmark and attach the promised evidence.",
        revisionRequestedAt: "2026-08-08T12:00:00.000Z",
        revokedAssignments: 2,
        submittedReviewsPreserved: 1,
        messagesQueued: 1,
        messagesDispatched: 1,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(conferenceApi.requestProposalChanges(
      "user-organizer",
      "event-aie-2026",
      "proposal-1",
      "Clarify the benchmark and attach the promised evidence.",
    )).resolves.toMatchObject({ status: "changes_requested", submittedReviewsPreserved: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-aie-2026/proposals/proposal-1/request-changes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ note: "Clarify the benchmark and attach the promised evidence." }),
      }),
    );
  });

  it("opens an applicant-owned submitted proposal for editing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        id: "proposal-1",
        status: "revision_open",
        version: 4,
        revisionRequestedAt: "2026-08-08T12:00:00.000Z",
        revokedAssignments: 1,
        submittedReviewsPreserved: 2,
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(conferenceApi.reopenSubmission("user-applicant", "event-aie-2026", "proposal-1"))
      .resolves.toMatchObject({ status: "revision_open", version: 4 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-aie-2026/submissions/proposal-1/reopen",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("queues a communication with the selected profiles and idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { queued: 2, idempotencyKey: "send-1" },
    }), {
      status: 202,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await conferenceApi.sendCommunication("user-organizer", "event-aie-2026", {
      kind: "reminder",
      recipientIds: ["speaker-marco", "speaker-priya"],
      idempotencyKey: "send-1",
    });

    expect(result).toEqual({ queued: 2, idempotencyKey: "send-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-aie-2026/communications/send",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          kind: "reminder",
          recipientIds: ["speaker-marco", "speaker-priya"],
        }),
        headers: {
          "content-type": "application/json",
          "idempotency-key": "send-1",
          "x-demo-actor": "user-organizer",
        },
      }),
    );
  });

  it("loads the organizer's event-scoped communication delivery history", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        deliveries: [{
          id: "delivery-1",
          kind: "reminder",
          transport: "email",
          recipient: "speaker@example.test",
          subject: "Tasks due",
          status: "sent",
          attempts: 1,
          createdAt: "2026-08-08T12:00:00.000Z",
          updatedAt: "2026-08-08T12:00:08.000Z",
          sentAt: "2026-08-08T12:00:08.000Z",
        }],
        generatedAt: "2026-08-08T12:01:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(conferenceApi.communicationHistory("user-organizer", "event-aie-2026")).resolves.toMatchObject({
      deliveries: [{ id: "delivery-1", status: "sent" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-aie-2026/communications/history",
      {
        headers: {
          "content-type": "application/json",
          "x-demo-actor": "user-organizer",
        },
      },
    );
  });

  it("downloads a named export from the event export endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("id,name\r\nspeaker-1,Ada", {
      status: 200,
      headers: {
        "content-disposition": "attachment; filename=\"summit-speakers.csv\"",
        "content-type": "text/csv",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await conferenceApi.downloadExport(
      "user-organizer",
      "event-aie-2026",
      "speakers.csv",
    );

    expect(result.fileName).toBe("summit-speakers.csv");
    expect(result.blob.type).toBe("text/csv");
    expect(result.blob.size).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-aie-2026/exports/speakers.csv",
      { headers: { "x-demo-actor": "user-organizer" } },
    );
  });

  it("downloads a private upload and decodes its safe RFC 5987 filename", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("deck bytes", {
      status: 200,
      headers: {
        "content-disposition": "attachment; filename*=UTF-8''Final%20deck.pdf",
        "content-type": "application/pdf",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await conferenceApi.downloadUpload(
      "user-organizer",
      "event-aie-2026",
      "upload-deck",
      "submitted-file",
    );

    expect(result.fileName).toBe("Final deck.pdf");
    expect(result.blob.type).toBe("application/pdf");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-aie-2026/uploads/upload-deck",
      { headers: { "x-demo-actor": "user-organizer" } },
    );
  });
});

describe("conference client applicant submission requests", () => {
  const draft = {
    title: "Durable agent queues",
    summary: "A practical account of queue recovery, tracing, and production failure handling.",
    category: "Agents in production",
    format: "talk" as const,
    durationMinutes: 30,
    level: "intermediate" as const,
    responses: { "field-proof": "Production traces" },
    speakers: [{ name: "Ada Rivera", email: "ada@example.com", title: "Staff Engineer", company: "Northstar", bio: "Builds reliable systems." }],
    submit: false,
  };

  it("updates an owned draft with its optimistic version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: "proposal-draft", status: "draft", version: 4 },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await conferenceApi.updateSubmission("user-applicant", "event-a", "proposal-draft", {
      ...draft,
      expectedVersion: 3,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-a/submissions/proposal-draft",
      {
        method: "PUT",
        body: JSON.stringify({ ...draft, expectedVersion: 3 }),
        headers: {
          "content-type": "application/json",
          "x-demo-actor": "user-applicant",
        },
      },
    );
  });

  it("withdraws an owned submission through the explicit action endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: "proposal-submitted", status: "withdrawn", withdrawnAt: "2026-08-08T12:00:00.000Z" },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await conferenceApi.withdrawSubmission("user-applicant", "event-a", "proposal-submitted");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-a/submissions/proposal-submitted/withdraw",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-demo-actor": "user-applicant",
        },
      },
    );
  });
});

describe("conference client active event role continuity", () => {
  function workspaceSnapshot(actorId: string, eventId: string, role: "organizer" | "reviewer" | "speaker") {
    return {
      actor: { id: actorId, name: "Multi Role", email: "multi@example.com", role },
      event: { id: eventId },
      demoMode: false,
    };
  }

  it("keeps organizer and speaker memberships distinct across portal profile writes", async () => {
    const actorId = "organizer-speaker";
    const eventId = "event-organizer-speaker";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: workspaceSnapshot(actorId, eventId, "speaker") }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "speaker-multi", profileComplete: true } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: workspaceSnapshot(actorId, eventId, "organizer") }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { proposalId: "proposal-a", status: "accepted" } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await conferenceApi.bootstrap(actorId, eventId, "speaker");
    await conferenceApi.updateProfile(actorId, eventId, "speaker-multi", {
      name: "Multi Role",
      title: "Chair and speaker",
      company: "Example",
      bio: "A complete speaker biography.",
      publish: true,
    });
    await conferenceApi.bootstrap(actorId, eventId, "organizer");
    await conferenceApi.decide(actorId, eventId, "proposal-a", "accepted");

    expect(fetchMock).toHaveBeenNthCalledWith(1, `/api/v1/bootstrap?eventId=${eventId}&role=speaker`, expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/v1/events/${eventId}/speakers/speaker-multi/profile`, expect.objectContaining({
      headers: expect.objectContaining({ "x-event-role": "speaker" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/v1/bootstrap?eventId=${eventId}&role=organizer`, expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(4, `/api/v1/events/${eventId}/proposals/proposal-a/decision`, expect.objectContaining({
      headers: expect.objectContaining({ "x-event-role": "organizer" }),
    }));
  });

  it("keeps reviewer and speaker memberships distinct across task and review writes", async () => {
    const actorId = "reviewer-speaker";
    const eventId = "event-reviewer-speaker";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: workspaceSnapshot(actorId, eventId, "speaker") }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { taskId: "task-a", status: "complete" } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: workspaceSnapshot(actorId, eventId, "reviewer") }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { proposalId: "proposal-b", status: "submitted", scores: { fit: 4 }, score: 4 } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await conferenceApi.bootstrap(actorId, eventId, "speaker");
    await conferenceApi.completeTask(actorId, eventId, "task-a", true);
    await conferenceApi.bootstrap(actorId, eventId, "reviewer");
    await conferenceApi.review(actorId, eventId, "proposal-b", {
      scores: { fit: 4 },
      recommendation: "yes",
      notes: "A complete reviewer evidence note.",
      submit: true,
    });

    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/v1/events/${eventId}/tasks/task-a/complete`, expect.objectContaining({
      headers: expect.objectContaining({ "x-event-role": "speaker" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, `/api/v1/events/${eventId}/proposals/proposal-b/review`, expect.objectContaining({
      headers: expect.objectContaining({ "x-event-role": "reviewer" }),
    }));
  });

  it("does not let a stale bootstrap overwrite the role selected by a newer navigation", async () => {
    const actorId = "out-of-order-multi-role";
    const eventId = "event-out-of-order";
    let resolveSpeaker!: (response: Response) => void;
    let resolveOrganizer!: (response: Response) => void;
    const speakerResponse = new Promise<Response>((resolve) => { resolveSpeaker = resolve; });
    const organizerResponse = new Promise<Response>((resolve) => { resolveOrganizer = resolve; });
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => speakerResponse)
      .mockImplementationOnce(() => organizerResponse)
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { proposalId: "proposal-a", status: "accepted" } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const staleSpeakerBootstrap = conferenceApi.bootstrap(actorId, eventId, "speaker");
    const currentOrganizerBootstrap = conferenceApi.bootstrap(actorId, eventId, "organizer");
    resolveOrganizer(new Response(JSON.stringify({ data: workspaceSnapshot(actorId, eventId, "organizer") }), { status: 200, headers: { "content-type": "application/json" } }));
    await currentOrganizerBootstrap;
    resolveSpeaker(new Response(JSON.stringify({ data: workspaceSnapshot(actorId, eventId, "speaker") }), { status: 200, headers: { "content-type": "application/json" } }));
    await staleSpeakerBootstrap;
    await conferenceApi.decide(actorId, eventId, "proposal-a", "accepted");

    expect(fetchMock).toHaveBeenNthCalledWith(3, `/api/v1/events/${eventId}/proposals/proposal-a/decision`, expect.objectContaining({
      headers: expect.objectContaining({ "x-event-role": "organizer" }),
    }));
  });

  it("keeps valid roles isolated across events and through a failed same-event switch", async () => {
    const actorId = "same-actor-separate-events";
    const speakerEventId = "event-speaker-role";
    const organizerEventId = "event-organizer-role";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: workspaceSnapshot(actorId, speakerEventId, "speaker") }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: workspaceSnapshot(actorId, organizerEventId, "organizer") }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: "NO_EVENT", message: "No matching membership." } }), { status: 404, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { taskId: "task-a", status: "complete" } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { proposalId: "proposal-a", status: "accepted" } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await conferenceApi.bootstrap(actorId, speakerEventId, "speaker");
    await conferenceApi.bootstrap(actorId, organizerEventId, "organizer");
    await expect(conferenceApi.bootstrap(actorId, speakerEventId, "organizer")).rejects.toMatchObject({ code: "NO_EVENT" });
    await conferenceApi.completeTask(actorId, speakerEventId, "task-a", true);
    await conferenceApi.decide(actorId, organizerEventId, "proposal-a", "accepted");

    expect(fetchMock).toHaveBeenNthCalledWith(4, `/api/v1/events/${speakerEventId}/tasks/task-a/complete`, expect.objectContaining({
      headers: expect.objectContaining({ "x-event-role": "speaker" }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(5, `/api/v1/events/${organizerEventId}/proposals/proposal-a/decision`, expect.objectContaining({
      headers: expect.objectContaining({ "x-event-role": "organizer" }),
    }));
  });
});

describe("conference client venue resource requests", () => {
  it("creates, updates, and deletes event-scoped schedule resources", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "room-a", name: "Main hall", capacity: 450 } }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "track-a", name: "Production", color: "#123456" } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "room-a", deleted: true } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await conferenceApi.createRoom("user-organizer", "event/a", { name: "Main hall", capacity: 450 });
    await conferenceApi.updateTrack("user-organizer", "event/a", "track/a", { name: "Production", color: "#123456" });
    await conferenceApi.deleteRoom("user-organizer", "event/a", "room/a");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/events/event%2Fa/rooms", {
      method: "POST",
      body: JSON.stringify({ name: "Main hall", capacity: 450 }),
      headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/events/event%2Fa/tracks/track%2Fa", {
      method: "PUT",
      body: JSON.stringify({ name: "Production", color: "#123456" }),
      headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/events/event%2Fa/rooms/room%2Fa", {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
    });
  });
});

describe("conference client participant resource requests", () => {
  it("creates, publishes, and deletes event-scoped wiki pages", async () => {
    const draft = { title: "Arrival guide", slug: "arrival-guide", summary: "Day-of logistics.", body: "Use the north entrance.", linkUrl: "https://events.example.com/arrival", status: "draft" as const };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "resource-a", ...draft, updatedAt: "2026-08-08T12:00:00.000Z" } }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "resource-a", ...draft, status: "published", updatedAt: "2026-08-08T12:01:00.000Z" } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: "resource-a", deleted: true } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await conferenceApi.createResourcePage("user-organizer", "event/a", draft);
    await conferenceApi.updateResourcePage("user-organizer", "event/a", "resource/a", { ...draft, status: "published" });
    await conferenceApi.deleteResourcePage("user-organizer", "event/a", "resource/a");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/events/event%2Fa/resources", {
      method: "POST",
      body: JSON.stringify(draft),
      headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/events/event%2Fa/resources/resource%2Fa", {
      method: "PUT",
      body: JSON.stringify({ ...draft, status: "published" }),
      headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/events/event%2Fa/resources/resource%2Fa", {
      method: "DELETE",
      headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
    });
  });
});

describe("conference client headshot requests", () => {
  it("uploads an allowed image as a headshot", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: "upload-headshot", fileName: "portrait.webp", status: "stored" },
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const file = new File(["image bytes"], "portrait.webp", { type: "image/webp" });

    await conferenceApi.upload("user-speaker", "event-aie-2026", file, "headshot");

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-aie-2026/uploads?purpose=headshot&filename=portrait.webp",
      {
        method: "POST",
        headers: {
          "content-type": "image/webp",
          "x-demo-actor": "user-speaker",
        },
        body: file,
      },
    );
  });

  it("saves the upload ID with the complete current profile payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: "speaker-leah", headshotUploadId: "upload-headshot", profileComplete: true },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await conferenceApi.updateProfile("user-speaker", "event-aie-2026", "speaker-leah", {
      name: "Leah Okafor",
      title: "Founder",
      company: "Tracewell",
      bio: "Works on observability for long-running AI workflows.",
      city: "London, UK",
      headshotUploadId: "upload-headshot",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event-aie-2026/speakers/speaker-leah/profile",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          name: "Leah Okafor",
          title: "Founder",
          company: "Tracewell",
          bio: "Works on observability for long-running AI workflows.",
          city: "London, UK",
          headshotUploadId: "upload-headshot",
        }),
      }),
    );
  });
});
