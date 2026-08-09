import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: { getSession: async () => ({ user: { id: "organizer-a", name: "Organizer A", email: "organizer@example.test" } }) },
    handler: async () => new Response(null, { status: 404 }),
  }),
}));

import app from "../../src/server/index";

type SqlValue = string | number | bigint | Uint8Array | null;

class Statement {
  private values: SqlValue[] = [];
  constructor(readonly sql: string, private readonly owner: TestD1) {}
  bind(...values: SqlValue[]) { this.values = values; return this; }
  async first<T>() { return (this.owner.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>() { return { results: this.owner.sqlite.prepare(this.sql).all(...this.values) as T[] }; }
  async run() { const result = this.owner.sqlite.prepare(this.sql).run(...this.values); return { success: true, meta: { changes: Number(result.changes) }, results: [] }; }
}

class TestD1 {
  sqlite = new DatabaseSync(":memory:");
  prepare(sql: string) { return new Statement(sql, this); }
  async batch(statements: Statement[]) { return Promise.all(statements.map((statement) => statement.run())); }
}

function fixture() {
  const d1 = new TestD1();
  d1.sqlite.exec(`
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE airtable_connections (
      id TEXT PRIMARY KEY, event_id TEXT, base_id TEXT NOT NULL, records_table_id TEXT NOT NULL,
      commands_table_id TEXT NOT NULL, authority TEXT NOT NULL, enabled INTEGER NOT NULL,
      status TEXT NOT NULL, schema_version INTEGER NOT NULL, webhook_id TEXT, webhook_cursor INTEGER NOT NULL,
      webhook_expires_at INTEGER, last_push_at INTEGER, last_pull_at INTEGER, last_reconciled_at INTEGER,
      reconciliation_started_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE airtable_change_queue (
      id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, entity_type TEXT NOT NULL, local_key TEXT NOT NULL,
      operation TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, available_at INTEGER NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1, lease_expires_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE airtable_conflicts (
      id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, entity_type TEXT NOT NULL, local_key TEXT NOT NULL,
      airtable_record_id TEXT, reason TEXT NOT NULL, local_hash TEXT, remote_hash TEXT, remote_payload TEXT NOT NULL,
      status TEXT NOT NULL, resolved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'organizer');
    INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'reviewer');
    INSERT INTO airtable_connections VALUES (
      'connection-a', NULL, 'base-a-private', 'records-table-private', 'commands-table-private',
      'd1', 1, 'healthy', 1, 'webhook-private', 4, 1786399200000, 1786208390000,
      1786208380000, 1786208370000, NULL, 'provider detail must stay private', 1786200000000, 1786200000000
    );
    INSERT INTO airtable_connections VALUES (
      'connection-b', 'event-b', 'base-b-private', 'records-b', 'commands-b',
      'd1', 1, 'healthy', 1, 'webhook-b', 4, 1786399200000, 1786208390000,
      1786208380000, 1786208370000, NULL, NULL, 1786200000000, 1786200000000
    );
    INSERT INTO airtable_change_queue VALUES ('queue-a', 'connection-a', 'proposal', '["proposal-a"]', 'upsert', 'queued', 0, 0, 1, NULL, NULL, 0, 0);
    INSERT INTO airtable_change_queue VALUES ('dead-a', 'connection-a', 'proposal', '["proposal-dead"]', 'upsert', 'dead', 5, 0, 1, NULL, 'secret raw failure', 0, 0);
    INSERT INTO airtable_change_queue VALUES ('queue-b', 'connection-b', 'proposal', '["proposal-b"]', 'upsert', 'queued', 0, 0, 1, NULL, NULL, 0, 0);
    INSERT INTO airtable_conflicts VALUES ('conflict-a', 'connection-a', 'proposal', '["proposal-a"]', 'record-private', 'hash mismatch', NULL, NULL, '{"private":"payload"}', 'open', NULL, 0, 0);
    INSERT INTO airtable_conflicts VALUES ('conflict-b', 'connection-b', 'proposal', '["proposal-b"]', 'record-b', 'hash mismatch', NULL, NULL, '{"private":"other-event"}', 'open', NULL, 0, 0);
  `);
  return d1;
}

function bindings(d1: TestD1): Bindings {
  return {
    DB: d1 as unknown as D1Database,
    UPLOADS: {} as R2Bucket,
    ENVIRONMENT: "local",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.test",
    BETTER_AUTH_URL: "https://conference.example.test",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-api-tests",
    MAIL_FROM: "Conference Ops <program@example.test>",
    MAIL_REPLY_TO: "program@example.test",
    AIRTABLE_ENABLED: "true",
    AIRTABLE_BASE_ID: "base-a-private",
    AIRTABLE_TOKEN: "token-private",
    AIRTABLE_WEBHOOK_MAC_SECRET: "mac-private",
  };
}

describe("organizer Airtable status API", () => {
  let d1: TestD1;
  beforeEach(() => { d1 = fixture(); });

  it("returns only event-scoped, redacted operational status", async () => {
    const response = await app.request("http://localhost/api/v1/events/event-a/integrations/airtable/status", {
      headers: { "x-event-role": "organizer" },
    }, bindings(d1));
    const payload = await response.json() as { data: Record<string, unknown> };
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.data).toMatchObject({
      authority: "d1",
      connection: { scope: "environment", state: "healthy" },
      workload: { scope: "unavailable", pending: null, dead: null, openConflicts: null },
      health: "degraded",
    });
    expect(serialized).not.toMatch(/base-a-private|records-table-private|commands-table-private|webhook-private|provider detail|secret raw failure|record-private|private.*payload|token-private|mac-private|proposal-b|other-event/);
  });

  it("rejects non-organizer event roles", async () => {
    const response = await app.request("http://localhost/api/v1/events/event-a/integrations/airtable/status", {
      headers: { "x-event-role": "reviewer" },
    }, bindings(d1));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "ROLE_REQUIRED" } });
  });
});
