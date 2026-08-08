import { afterEach, describe, expect, it, vi } from "vitest";
import { conferenceApi } from "../../src/client/api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("conference client communication and export requests", () => {
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
      publish: true,
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
          publish: true,
        }),
      }),
    );
  });
});
