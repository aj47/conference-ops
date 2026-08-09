import { describe, expect, it } from "vitest";
import { projectAirtableOperatorStatus } from "../../src/server/airtable-status";

const now = Date.parse("2026-08-08T18:00:00.000Z");

describe("Airtable operator status projection", () => {
  it("defaults to a disabled D1 authority without exposing configuration details", () => {
    const status = projectAirtableOperatorStatus({ envEnabled: false, now });

    expect(status).toMatchObject({
      enabled: false,
      configured: false,
      health: "disabled",
      authority: "d1",
      connection: { scope: "none", state: "not_configured", schemaVersion: null },
      workload: { scope: "unavailable", pending: null, dead: null, openConflicts: null },
      guidance: { mode: "commission" },
    });
    expect(status).not.toHaveProperty("baseId");
    expect(status).not.toHaveProperty("recordsTableId");
    expect(status).not.toHaveProperty("commandsTableId");
    expect(status).not.toHaveProperty("webhookId");
    expect(status).not.toHaveProperty("token");
    expect(status).not.toHaveProperty("payload");
  });

  it("fails closed instead of presenting an event-scoped connector as usable", () => {
    const status = projectAirtableOperatorStatus({
      envEnabled: true,
      now,
      connection: {
        id: "connection-event-a",
        event_id: "event-a",
        authority: "d1",
        enabled: 1,
        status: "healthy",
        schema_version: 1,
        webhook_configured: 1,
        webhook_expires_at: now + 3 * 24 * 60 * 60 * 1_000,
        last_push_at: now - 10_000,
        last_pull_at: now - 20_000,
        last_reconciled_at: now - 30_000,
      },
      workload: { pending: 2, dead: 0 },
      conflicts: { open_conflicts: 0 },
    });

    expect(status).toMatchObject({
      enabled: false,
      configured: false,
      health: "disabled",
      authority: "d1",
      connection: { scope: "none", state: "not_configured", schemaVersion: null },
      workload: { scope: "unavailable", pending: null, dead: null, openConflicts: null },
      guidance: { mode: "commission" },
    });
  });

  it("suppresses workload totals for an environment-wide connection", () => {
    const status = projectAirtableOperatorStatus({
      envEnabled: true,
      now,
      connection: {
        id: "global-connection",
        event_id: null,
        authority: "airtable",
        enabled: 1,
        status: "healthy",
        schema_version: 1,
        webhook_configured: 1,
        webhook_expires_at: now + 3 * 24 * 60 * 60 * 1_000,
        last_push_at: now,
        last_pull_at: now,
        last_reconciled_at: now,
      },
      workload: { pending: 81, dead: 17 },
      conflicts: { open_conflicts: 9 },
    });

    expect(status).toMatchObject({
      health: "degraded",
      authority: "airtable",
      connection: { scope: "environment" },
      workload: { scope: "unavailable", pending: null, dead: null, openConflicts: null },
      guidance: { mode: "recover" },
    });
  });

  it("marks an Airtable authority as degraded when the connector is off", () => {
    const status = projectAirtableOperatorStatus({
      envEnabled: false,
      now,
      connection: {
        id: "connection-event-a",
        event_id: null,
        authority: "airtable",
        enabled: 1,
        status: "healthy",
        schema_version: 1,
        webhook_configured: 1,
        webhook_expires_at: now + 3 * 24 * 60 * 60 * 1_000,
        last_push_at: now,
        last_pull_at: now,
        last_reconciled_at: now,
      },
      workload: { pending: 0, dead: 0 },
      conflicts: { open_conflicts: 0 },
    });

    expect(status).toMatchObject({ enabled: false, health: "degraded", authority: "airtable", guidance: { mode: "recover" } });
  });
});
