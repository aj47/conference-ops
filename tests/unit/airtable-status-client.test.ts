import { afterEach, describe, expect, it, vi } from "vitest";
import { conferenceApi } from "../../src/client/api";

afterEach(() => vi.unstubAllGlobals());

describe("Airtable operator status client", () => {
  it("loads the event-scoped organizer endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        enabled: false,
        configured: false,
        health: "disabled",
        authority: "d1",
        connection: { scope: "none", state: "not_configured", schemaVersion: null },
        sync: { lastPushAt: null, lastPullAt: null, lastReconciledAt: null, webhook: "not_configured", webhookExpiresAt: null },
        workload: { scope: "unavailable", pending: null, dead: null, openConflicts: null },
        guidance: { mode: "commission", title: "Commission", detail: "Server-side only", steps: [] },
        generatedAt: "2026-08-08T18:00:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(conferenceApi.airtableStatus("organizer-a", "event/a")).resolves.toMatchObject({ health: "disabled", authority: "d1" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/events/event%2Fa/integrations/airtable/status",
      { headers: { "content-type": "application/json", "x-demo-actor": "organizer-a" } },
    );
  });
});
