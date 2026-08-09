import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";
import { airtableAuthorityPromotionBlockers, canonicalJson, drainAirtableChanges, pullAirtableChanges, resolveAirtableAuthority } from "../../src/jobs/airtable-sync";

type SqlValue = string | number | bigint | Uint8Array | null;

class Statement {
  private values: SqlValue[] = [];

  constructor(readonly sql: string, private readonly owner: TestD1) {}

  bind(...values: SqlValue[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.owner.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.owner.sqlite.prepare(this.sql).all(...this.values) as T[] };
  }

  async run() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
}

class TestD1 {
  sqlite = new DatabaseSync(":memory:");
  beforeBatch?: () => void | Promise<void>;

  prepare(sql: string) {
    return new Statement(sql, this);
  }

  async batch(statements: Statement[]) {
    if (this.beforeBatch) {
      const beforeBatch = this.beforeBatch;
      this.beforeBatch = undefined;
      await beforeBatch();
    }
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function fixture(authority: "d1" | "airtable" = "d1") {
  const d1 = new TestD1();
  d1.sqlite.exec(`
    CREATE TABLE airtable_connections (
      id TEXT PRIMARY KEY, event_id TEXT, base_id TEXT NOT NULL, records_table_id TEXT NOT NULL, commands_table_id TEXT NOT NULL,
      authority TEXT NOT NULL, enabled INTEGER NOT NULL, status TEXT NOT NULL, webhook_id TEXT,
      webhook_cursor INTEGER NOT NULL, webhook_expires_at INTEGER, last_push_at INTEGER, last_pull_at INTEGER,
      last_reconciled_at INTEGER, reconciliation_started_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE airtable_change_queue (
      id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, entity_type TEXT NOT NULL, local_key TEXT NOT NULL,
      operation TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, available_at INTEGER NOT NULL,
      generation INTEGER NOT NULL DEFAULT 1, lease_expires_at INTEGER, last_error TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (connection_id, entity_type, local_key)
    );
    CREATE TABLE airtable_record_maps (
      connection_id TEXT NOT NULL, entity_type TEXT NOT NULL, local_key TEXT NOT NULL, airtable_record_id TEXT NOT NULL,
      last_local_hash TEXT, last_remote_hash TEXT, last_remote_transaction INTEGER, last_synced_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, PRIMARY KEY (connection_id, entity_type, local_key),
      UNIQUE (connection_id, airtable_record_id)
    );
    CREATE TABLE airtable_conflicts (
      id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, entity_type TEXT NOT NULL, local_key TEXT NOT NULL,
      airtable_record_id TEXT, reason TEXT NOT NULL, local_hash TEXT, remote_hash TEXT, remote_payload TEXT NOT NULL,
      status TEXT NOT NULL, resolved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE airtable_commands (
      id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, airtable_record_id TEXT NOT NULL, command_type TEXT NOT NULL,
      target_entity TEXT NOT NULL, target_key TEXT NOT NULL, parameters TEXT NOT NULL, idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL, result TEXT NOT NULL, last_error TEXT, requested_at INTEGER NOT NULL, processed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (connection_id, airtable_record_id), UNIQUE (connection_id, idempotency_key)
    );
    CREATE TABLE tracks (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE program_sessions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, proposal_id TEXT, origin TEXT NOT NULL,
      title TEXT NOT NULL, description TEXT NOT NULL, format TEXT NOT NULL, capacity INTEGER,
      ceu_credits TEXT, client_id TEXT, track_id TEXT, room_id TEXT, starts_at INTEGER, ends_at INTEGER,
      status TEXT NOT NULL, override_reason TEXT, calendar_uid TEXT NOT NULL,
      calendar_sequence INTEGER NOT NULL, version INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE speaker_profiles (
      id TEXT PRIMARY KEY, user_id TEXT, event_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
      title TEXT NOT NULL, company TEXT NOT NULL, bio TEXT NOT NULL, pronouns TEXT, city TEXT,
      headshot_upload_id TEXT, profile_complete INTEGER NOT NULL, published INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  d1.sqlite.prepare(`INSERT INTO airtable_connections
    (id, event_id, base_id, records_table_id, commands_table_id, authority, enabled, status, webhook_id, webhook_cursor,
     webhook_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'syncing', ?, 0, ?, 1, 1)`)
    .run("connection-a", null, "appTestBase123", "tblRecords123", "tblCommands123", authority, "achWebhook123", Date.now() + 86_400_000);
  d1.sqlite.prepare("INSERT INTO tracks VALUES (?, ?, ?, ?, ?, ?)").run("track-a", "event-a", "Old name", "#112233", 1, 1);
  return d1;
}

function bindings(d1: TestD1) {
  return {
    DB: d1 as unknown as D1Database,
    UPLOADS: {} as R2Bucket,
    ENVIRONMENT: "pilot",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.test",
    BETTER_AUTH_URL: "https://conference.example.test",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-api-tests",
    MAIL_FROM: "program@example.test",
    MAIL_REPLY_TO: "program@example.test",
    AIRTABLE_ENABLED: "true",
    AIRTABLE_BASE_ID: "appTestBase123",
    AIRTABLE_TOKEN: "pat-test",
    AIRTABLE_MAX_REQUESTS_PER_SECOND: "4",
  } satisfies Bindings & { fetch?: typeof fetch };
}

function insertTrackChange(d1: TestD1, id: string, status = "queued") {
  d1.sqlite.prepare(`INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
    VALUES (?, 'connection-a', 'track', ?, 'upsert', ?, 0, 1, 0, NULL, NULL, 1, 1)`)
    .run(id, JSON.stringify(["track-a"]), status);
}

function installTrackUpdateCapture(d1: TestD1) {
  d1.sqlite.exec(`CREATE TRIGGER airtable_tracks_update AFTER UPDATE ON tracks
    BEGIN
      INSERT INTO airtable_change_queue
        (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
      VALUES
        ('trigger-change', 'connection-a', 'track', json_array(NEW.id), 'upsert', 'queued', 0, 1, 0, NULL, NULL, 1, 1)
      ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
        operation = excluded.operation, status = 'queued', attempts = 0,
        generation = airtable_change_queue.generation + 1, available_at = excluded.available_at,
        lease_expires_at = NULL, last_error = NULL, updated_at = excluded.updated_at;
    END;`);
}

function workflowCommandFetcher(command: { id?: string; authority: "d1" | "airtable" }, updates: Array<Record<string, unknown>>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/webhooks/achWebhook123/payloads")) return Response.json({ cursor: 1, mightHaveMore: false, payloads: [] });
    if (url.includes("/tblCommands123?") && !init?.method) return Response.json({ records: [{ id: command.id ?? "recCommand123", fields: {
      "Command Type": "set_authority",
      "Target Entity": "",
      "Target Key": "",
      "Parameters JSON": JSON.stringify({ authority: command.authority }),
      "Idempotency Key": command.id ?? `authority-${command.authority}`,
      Status: "Pending",
    } }] });
    if (url.includes(`/tblCommands123/${command.id ?? "recCommand123"}`) && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body)) as { fields: Record<string, unknown> };
      updates.push(body.fields);
      return Response.json({ id: command.id ?? "recCommand123", fields: body.fields });
    }
    throw new Error(`Unexpected Airtable request: ${url}`);
  });
}

const originalTrackPayload = { id: "track-a", event_id: "event-a", name: "Old name", color: "#112233", created_at: 1, updated_at: 1 };

async function trackHash(payload: Record<string, unknown>, localKey = JSON.stringify(["track-a"]), entityType = "track") {
  const input = canonicalJson({ entityType, localKey, deleted: false, payload });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function seedMappedTrack(d1: TestD1, airtableRecordId = "recTrack123") {
  const hash = await trackHash(originalTrackPayload);
  d1.sqlite.prepare(`INSERT INTO airtable_record_maps
    (connection_id, entity_type, local_key, airtable_record_id, last_local_hash, last_remote_hash, last_remote_transaction, last_synced_at, updated_at)
    VALUES ('connection-a', 'track', '["track-a"]', ?, ?, ?, NULL, 10, 10)`)
    .run(airtableRecordId, hash, hash);
  return hash;
}

function trackRemoteFields(payload: Record<string, unknown>, hash: string, overrides: Record<string, unknown> = {}) {
  return {
    "External Key": 'track:["track-a"]',
    "Entity Type": "track",
    "Event ID": "event-a",
    "Display Name": "Old name",
    "Payload JSON": JSON.stringify(payload),
    Deleted: false,
    "Source Version": "1",
    "Sync Hash": hash,
    "Source Updated At": new Date(1).toISOString(),
    "Last Synced At": new Date(10).toISOString(),
    ...overrides,
  };
}

function inboundRecordFetcher(recordId: string, fields: Record<string, unknown>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/webhooks/achWebhook123/payloads")) {
      return Response.json({ cursor: 1, mightHaveMore: false, changedTablesById: { tblRecords123: { changedRecordsById: { [recordId]: {} } } } });
    }
    if (url.includes(`/tblRecords123/${recordId}`)) return Response.json({ id: recordId, fields });
    if (url.includes("/tblCommands123?")) return Response.json({ records: [] });
    throw new Error(`Unexpected Airtable request: ${url}`);
  });
}

describe("Airtable synchronization", () => {
  it("does not import Workflow Command record IDs as canonical business records", async () => {
    const d1 = fixture();
    const requests: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      requests.push(url);
      if (url.includes("/webhooks/achWebhook123/payloads")) {
        return Response.json({
          cursor: 1,
          mightHaveMore: false,
          payloads: [{
            changedTablesById: {
              tblCommands123: { createdRecordsById: { recCommand123: {} } },
            },
          }],
        });
      }
      if (url.includes("/tblCommands123?")) return Response.json({ records: [] });
      throw new Error(`Unexpected Airtable request: ${url}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      expect(await pullAirtableChanges(bindings(d1), "connection-a", 100)).toEqual({ records: 0, commands: 0 });
      expect(requests.some((url) => url.includes("/tblRecords123/recCommand123"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("pushes canonical records idempotently and suppresses a subsequent echo", async () => {
    const d1 = fixture();
    insertTrackChange(d1, "change-a");
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, unknown> }> };
      requests.push({ url: String(input), body: body as unknown as Record<string, unknown> });
      return Response.json({ records: body.records.map((record) => ({ id: "recTrack123", fields: record.fields })) });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      const first = await drainAirtableChanges(bindings(d1), { connectionId: "connection-a", now: 10 });
      expect(first).toMatchObject({ synced: 1, failed: 0 });
      expect(requests[0].body).toMatchObject({ performUpsert: { fieldsToMergeOn: ["External Key"] } });
      const fields = ((requests[0].body.records as Array<{ fields: Record<string, unknown> }>)[0]).fields;
      expect(fields).toMatchObject({ "External Key": 'track:["track-a"]', "Entity Type": "track", "Event ID": "event-a", Deleted: false });
      expect(JSON.parse(String(fields["Payload JSON"]))).toMatchObject({ id: "track-a", name: "Old name" });

      insertTrackChange(d1, "change-b");
      const second = await drainAirtableChanges(bindings(d1), { connectionId: "connection-a", now: 20 });
      expect(second).toMatchObject({ echoed: 1, synced: 0, failed: 0 });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM airtable_change_queue").get()).toEqual({ count: 0 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves a trigger-coalesced newer generation after an in-flight push succeeds", async () => {
    const d1 = fixture();
    installTrackUpdateCapture(d1);
    insertTrackChange(d1, "change-race-success");
    let calls = 0;
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, unknown> }> };
      if (calls === 1) d1.sqlite.prepare("UPDATE tracks SET name = 'New name', updated_at = 2 WHERE id = 'track-a'").run();
      return Response.json({ records: body.records.map((record) => ({ id: "recTrack123", fields: record.fields })) });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      expect(await drainAirtableChanges(bindings(d1), { connectionId: "connection-a", now: 10 })).toMatchObject({ claimed: 1, synced: 1, failed: 0 });
      expect(d1.sqlite.prepare("SELECT status, attempts, generation FROM airtable_change_queue WHERE id = 'change-race-success'").get())
        .toEqual({ status: "queued", attempts: 0, generation: 2 });

      expect(await drainAirtableChanges(bindings(d1), { connectionId: "connection-a", now: 20 })).toMatchObject({ claimed: 1, synced: 1, failed: 0 });
      expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM airtable_change_queue").get()).toEqual({ count: 0 });
      const secondBody = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as { records: Array<{ fields: Record<string, unknown> }> };
      expect(JSON.parse(String(secondBody.records[0].fields["Payload JSON"]))).toMatchObject({ name: "New name", updated_at: 2 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves a trigger-coalesced newer generation when an in-flight row becomes an echo", async () => {
    const d1 = fixture();
    insertTrackChange(d1, "change-initial");
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, unknown> }> };
      return Response.json({ records: body.records.map((record) => ({ id: "recTrack123", fields: record.fields })) });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      await drainAirtableChanges(bindings(d1), { connectionId: "connection-a", now: 10 });
      installTrackUpdateCapture(d1);
      insertTrackChange(d1, "change-race-echo");
      d1.beforeBatch = () => {
        d1.sqlite.prepare("UPDATE tracks SET name = 'New after echo', updated_at = 3 WHERE id = 'track-a'").run();
      };

      expect(await drainAirtableChanges(bindings(d1), { connectionId: "connection-a", now: 20 })).toMatchObject({ claimed: 1, echoed: 1, failed: 0 });
      expect(d1.sqlite.prepare("SELECT status, attempts, generation FROM airtable_change_queue WHERE id = 'change-race-echo'").get())
        .toEqual({ status: "queued", attempts: 0, generation: 2 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves a trigger-coalesced newer generation when the older push fails", async () => {
    const d1 = fixture();
    installTrackUpdateCapture(d1);
    insertTrackChange(d1, "change-race-failure");
    const fetcher = vi.fn(async () => {
      d1.sqlite.prepare("UPDATE tracks SET name = 'New after failure', updated_at = 4 WHERE id = 'track-a'").run();
      throw new Error("synthetic provider outage");
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      expect(await drainAirtableChanges(bindings(d1), { connectionId: "connection-a", now: 10 })).toMatchObject({ claimed: 1, synced: 0, failed: 0 });
      expect(d1.sqlite.prepare("SELECT status, attempts, generation, last_error FROM airtable_change_queue WHERE id = 'change-race-failure'").get())
        .toEqual({ status: "queued", attempts: 0, generation: 2, last_error: null });
      expect(d1.sqlite.prepare("SELECT status FROM airtable_connections WHERE id = 'connection-a'").get()).toEqual({ status: "syncing" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stamps reconciliation only after its queue drains", async () => {
    const d1 = fixture();
    d1.sqlite.prepare("UPDATE airtable_connections SET reconciliation_started_at = 5, last_reconciled_at = NULL, status = 'syncing' WHERE id = 'connection-a'").run();
    insertTrackChange(d1, "change-reconcile");
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, unknown> }> };
      return Response.json({ records: body.records.map((record) => ({ id: "recTrack123", fields: record.fields })) });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      expect(d1.sqlite.prepare("SELECT last_reconciled_at FROM airtable_connections WHERE id = 'connection-a'").get()).toEqual({ last_reconciled_at: null });
      await drainAirtableChanges(bindings(d1), { connectionId: "connection-a", now: 40 });
      expect(d1.sqlite.prepare("SELECT status, last_reconciled_at, reconciliation_started_at FROM airtable_connections WHERE id = 'connection-a'").get())
        .toEqual({ status: "healthy", last_reconciled_at: 40, reconciliation_started_at: null });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does not report a successful push as healthy while dead work or conflicts remain", async () => {
    const d1 = fixture();
    insertTrackChange(d1, "change-health");
    d1.sqlite.prepare(`INSERT INTO airtable_change_queue
      (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
      VALUES ('dead-other', 'connection-a', 'track', '["missing-track"]', 'upsert', 'dead', 5, 1, 0, NULL, 'failed', 1, 1)`).run();
    d1.sqlite.prepare(`INSERT INTO airtable_conflicts VALUES
      ('conflict-other', 'connection-a', 'track', '["other-track"]', NULL, 'conflict', NULL, NULL, '{}', 'open', NULL, 1, 1)`).run();
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, unknown> }> };
      return Response.json({ records: body.records.map((record) => ({ id: "recTrack123", fields: record.fields })) });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      await drainAirtableChanges(bindings(d1), { connectionId: "connection-a", now: 50 });
      expect(d1.sqlite.prepare("SELECT status FROM airtable_connections WHERE id = 'connection-a'").get()).toEqual({ status: "blocked" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("keeps the connector degraded when a later successful slice follows failed work", async () => {
    const d1 = fixture();
    d1.sqlite.prepare("DELETE FROM tracks").run();
    for (let index = 0; index < 11; index += 1) {
      const trackId = `track-${String(index).padStart(2, "0")}`;
      d1.sqlite.prepare("INSERT INTO tracks VALUES (?, 'event-a', ?, '#112233', 1, 1)").run(trackId, `Track ${index}`);
      d1.sqlite.prepare(`INSERT INTO airtable_change_queue
        (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
        VALUES (?, 'connection-a', 'track', ?, 'upsert', 'queued', 0, 1, 0, NULL, NULL, 1, 1)`)
        .run(`change-${index}`, JSON.stringify([trackId]));
    }
    let calls = 0;
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) throw new Error("synthetic first-slice outage");
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, unknown> }> };
      return Response.json({ records: body.records.map((record) => ({ id: "recLastTrack", fields: record.fields })) });
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      expect(await drainAirtableChanges(bindings(d1), { connectionId: "connection-a", now: 60, limit: 11 }))
        .toMatchObject({ claimed: 11, synced: 1, failed: 10 });
      expect(d1.sqlite.prepare("SELECT status FROM airtable_connections WHERE id = 'connection-a'").get()).toEqual({ status: "degraded" });
      expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM airtable_change_queue WHERE status = 'failed'").get()).toEqual({ count: 10 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("imports explicitly mutable fields when Airtable is authoritative", async () => {
    const d1 = fixture("airtable");
    const priorHash = await seedMappedTrack(d1);
    const remotePayload = { id: "track-a", event_id: "event-a", name: "Airtable name", color: "#445566", created_at: 1, updated_at: 1 };
    const webhookUrls: string[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/webhooks/achWebhook123/payloads")) {
        webhookUrls.push(url);
        if (webhookUrls.length === 1) {
          return Response.json({ cursor: 2, mightHaveMore: true, changedTablesById: { tblRecords123: { changedRecordsById: { recTrack123: {} } } } });
        }
        return Response.json({ cursor: 3, mightHaveMore: false, changedTablesById: { tblRecords123: { changedRecordsById: { recTrack123: {} } } } });
      }
      if (url.includes("/tblRecords123/recTrack123")) {
        return Response.json({ id: "recTrack123", fields: trackRemoteFields(remotePayload, priorHash) });
      }
      if (url.includes("/tblCommands123?")) return Response.json({ records: [] });
      throw new Error(`Unexpected Airtable request: ${url}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      const result = await pullAirtableChanges(bindings(d1), "connection-a", 100);
      expect(result).toEqual({ records: 1, commands: 0 });
      expect(webhookUrls).toHaveLength(2);
      expect(webhookUrls[1]).toContain("cursor=2");
      expect(d1.sqlite.prepare("SELECT name, color, updated_at FROM tracks WHERE id = 'track-a'").get()).toEqual({ name: "Airtable name", color: "#445566", updated_at: 100 });
      expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM airtable_conflicts").get()).toEqual({ count: 0 });
      expect(d1.sqlite.prepare("SELECT webhook_cursor FROM airtable_connections WHERE id = 'connection-a'").get()).toEqual({ webhook_cursor: 3 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("preserves the pushed sync timestamp across a self-echo before an Airtable-authored edit", async () => {
    const d1 = fixture("airtable");
    const priorHash = await seedMappedTrack(d1);
    const editedPayload = { ...originalTrackPayload, name: "Airtable name", color: "#445566" };
    let pull = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/webhooks/achWebhook123/payloads")) {
        pull += 1;
        return Response.json({ cursor: pull, mightHaveMore: false, changedTablesById: { tblRecords123: { changedRecordsById: { recTrack123: {} } } } });
      }
      if (url.includes("/tblRecords123/recTrack123")) {
        return Response.json({ id: "recTrack123", fields: trackRemoteFields(pull === 1 ? originalTrackPayload : editedPayload, priorHash) });
      }
      if (url.includes("/tblCommands123?")) return Response.json({ records: [] });
      throw new Error(`Unexpected Airtable request: ${url}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      expect(await pullAirtableChanges(bindings(d1), "connection-a", 100)).toEqual({ records: 1, commands: 0 });
      expect(d1.sqlite.prepare("SELECT last_synced_at FROM airtable_record_maps WHERE connection_id = 'connection-a'").get())
        .toEqual({ last_synced_at: 10 });

      expect(await pullAirtableChanges(bindings(d1), "connection-a", 200)).toEqual({ records: 1, commands: 0 });
      expect(d1.sqlite.prepare("SELECT name, color, updated_at FROM tracks WHERE id = 'track-a'").get())
        .toEqual({ name: "Airtable name", color: "#445566", updated_at: 200 });
      expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM airtable_conflicts").get()).toEqual({ count: 0 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("advances version, calendar sequence, and updated time for Airtable-authored session content", async () => {
    const d1 = fixture("airtable");
    const localKey = JSON.stringify(["session-a"]);
    const localPayload = {
      id: "session-a",
      event_id: "event-a",
      proposal_id: null,
      origin: "direct_program",
      title: "Old session title",
      description: "Old description",
      format: "talk",
      capacity: 100,
      ceu_credits: null,
      client_id: null,
      track_id: null,
      room_id: null,
      starts_at: null,
      ends_at: null,
      status: "unscheduled",
      override_reason: null,
      calendar_uid: "session-a@conference-ops",
      calendar_sequence: 0,
      version: 1,
      created_at: 1,
      updated_at: 1,
    };
    d1.sqlite.prepare(`INSERT INTO program_sessions
      (id, event_id, proposal_id, origin, title, description, format, capacity, ceu_credits, client_id,
       track_id, room_id, starts_at, ends_at, status, override_reason, calendar_uid, calendar_sequence,
       version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(localPayload) as SqlValue[]);
    const priorHash = await trackHash(localPayload, localKey, "program_session");
    d1.sqlite.prepare(`INSERT INTO airtable_record_maps
      (connection_id, entity_type, local_key, airtable_record_id, last_local_hash, last_remote_hash, last_remote_transaction, last_synced_at, updated_at)
      VALUES ('connection-a', 'program_session', ?, 'recSession123', ?, ?, NULL, 10, 10)`)
      .run(localKey, priorHash, priorHash);
    const remotePayload = { ...localPayload, title: "Airtable session title", description: "Airtable description" };
    const fields = {
      "External Key": `program_session:${localKey}`,
      "Entity Type": "program_session",
      "Event ID": "event-a",
      "Display Name": "Old session title · talk",
      "Payload JSON": JSON.stringify(remotePayload),
      Deleted: false,
      "Source Version": "1",
      "Sync Hash": priorHash,
      "Source Updated At": new Date(1).toISOString(),
      "Last Synced At": new Date(10).toISOString(),
    };
    const fetcher = inboundRecordFetcher("recSession123", fields);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      expect(await pullAirtableChanges(bindings(d1), "connection-a", 100)).toEqual({ records: 1, commands: 0 });
      expect(d1.sqlite.prepare(`SELECT title, description, version, calendar_sequence, updated_at
        FROM program_sessions WHERE id = 'session-a'`).get()).toEqual({
        title: "Airtable session title",
        description: "Airtable description",
        version: 2,
        calendar_sequence: 1,
        updated_at: 100,
      });
      expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM airtable_conflicts").get()).toEqual({ count: 0 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("recomputes protected speaker profile completeness after an Airtable-authored bio edit", async () => {
    const d1 = fixture("airtable");
    const localKey = JSON.stringify(["speaker-a"]);
    const localPayload = {
      id: "speaker-a",
      user_id: "user-a",
      event_id: "event-a",
      name: "Speaker A",
      email: "speaker@example.test",
      title: "Engineer",
      company: "Example",
      bio: "A complete profile.",
      pronouns: null,
      city: null,
      headshot_upload_id: "upload-headshot",
      profile_complete: 1,
      published: 0,
      created_at: 1,
      updated_at: 1,
    };
    d1.sqlite.prepare(`INSERT INTO speaker_profiles
      (id, user_id, event_id, name, email, title, company, bio, pronouns, city, headshot_upload_id,
       profile_complete, published, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...Object.values(localPayload) as SqlValue[]);
    const priorHash = await trackHash(localPayload, localKey, "speaker_profile");
    d1.sqlite.prepare(`INSERT INTO airtable_record_maps
      (connection_id, entity_type, local_key, airtable_record_id, last_local_hash, last_remote_hash, last_remote_transaction, last_synced_at, updated_at)
      VALUES ('connection-a', 'speaker_profile', ?, 'recSpeaker123', ?, ?, NULL, 10, 10)`)
      .run(localKey, priorHash, priorHash);
    const remotePayload = { ...localPayload, bio: "" };
    const fields = {
      "External Key": `speaker_profile:${localKey}`,
      "Entity Type": "speaker_profile",
      "Event ID": "event-a",
      "Display Name": "Speaker A · speaker@example.test",
      "Payload JSON": JSON.stringify(remotePayload),
      Deleted: false,
      "Source Version": "1",
      "Sync Hash": priorHash,
      "Source Updated At": new Date(1).toISOString(),
      "Last Synced At": new Date(10).toISOString(),
    };
    const fetcher = inboundRecordFetcher("recSpeaker123", fields);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      expect(await pullAirtableChanges(bindings(d1), "connection-a", 100)).toEqual({ records: 1, commands: 0 });
      expect(d1.sqlite.prepare(`SELECT bio, profile_complete, updated_at
        FROM speaker_profiles WHERE id = 'speaker-a'`).get()).toEqual({ bio: "", profile_complete: 0, updated_at: 100 });
      expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM airtable_conflicts").get()).toEqual({ count: 0 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("turns an invalid Airtable field value into a conflict without mutating D1", async () => {
    const d1 = fixture("airtable");
    const priorHash = await seedMappedTrack(d1);
    const remotePayload = { id: "track-a", event_id: "event-a", name: "Old name", color: "javascript:red", created_at: 1, updated_at: 1 };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/webhooks/achWebhook123/payloads")) {
        return Response.json({ cursor: 1, mightHaveMore: false, changedTablesById: { tblRecords123: { changedRecordsById: { recTrack123: {} } } } });
      }
      if (url.includes("/tblRecords123/recTrack123")) return Response.json({ id: "recTrack123", fields: trackRemoteFields(remotePayload, priorHash) });
      if (url.includes("/tblCommands123?")) return Response.json({ records: [] });
      throw new Error(`Unexpected Airtable request: ${url}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      await pullAirtableChanges(bindings(d1), "connection-a", 100);
      expect(d1.sqlite.prepare("SELECT color FROM tracks WHERE id = 'track-a'").get()).toEqual({ color: "#112233" });
      expect(d1.sqlite.prepare("SELECT reason FROM airtable_conflicts WHERE connection_id = 'connection-a'").get())
        .toEqual({ reason: expect.stringContaining("Invalid Airtable value for color") });
      expect(d1.sqlite.prepare("SELECT status FROM airtable_connections WHERE id = 'connection-a'").get()).toEqual({ status: "blocked" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects rekeying a mapped Airtable record to a different local entity", async () => {
    const d1 = fixture("airtable");
    const priorHash = await seedMappedTrack(d1);
    d1.sqlite.prepare("INSERT INTO tracks VALUES ('track-b', 'event-a', 'Track B', '#445566', 1, 1)").run();
    const trackBPayload = { id: "track-b", event_id: "event-a", name: "Injected name", color: "#445566", created_at: 1, updated_at: 1 };
    const fetcher = inboundRecordFetcher("recTrack123", trackRemoteFields(trackBPayload, priorHash, {
      "External Key": 'track:["track-b"]',
      "Display Name": "Track B",
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      await pullAirtableChanges(bindings(d1), "connection-a", 100);
      expect(d1.sqlite.prepare("SELECT name FROM tracks WHERE id = 'track-b'").get()).toEqual({ name: "Track B" });
      expect(d1.sqlite.prepare("SELECT entity_type, local_key, reason FROM airtable_conflicts").get()).toMatchObject({
        entity_type: "track",
        local_key: '["track-a"]',
        reason: expect.stringContaining("Rekeying canonical records is not allowed"),
      });
      expect(d1.sqlite.prepare("SELECT local_key FROM airtable_record_maps WHERE airtable_record_id = 'recTrack123'").get()).toEqual({ local_key: '["track-a"]' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects a duplicate Airtable record that claims an already-mapped External Key", async () => {
    const d1 = fixture("airtable");
    const priorHash = await seedMappedTrack(d1);
    const fetcher = inboundRecordFetcher("recDuplicate", trackRemoteFields({ ...originalTrackPayload, name: "Duplicate edit" }, priorHash));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      await pullAirtableChanges(bindings(d1), "connection-a", 100);
      expect(d1.sqlite.prepare("SELECT name FROM tracks WHERE id = 'track-a'").get()).toEqual({ name: "Old name" });
      expect(d1.sqlite.prepare("SELECT reason FROM airtable_conflicts").get()).toEqual({ reason: expect.stringContaining("Duplicate canonical records are not allowed") });
      expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM airtable_record_maps").get()).toEqual({ count: 1 });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects payload-key mismatches, unknown payload fields, and malformed mapped External Keys", async () => {
    for (const scenario of [
      {
        name: "payload key mismatch",
        fields: (hash: string) => trackRemoteFields({ ...originalTrackPayload, id: "track-b" }, hash),
        reason: "does not match the External Key",
      },
      {
        name: "unexpected payload field",
        fields: (hash: string) => trackRemoteFields({ ...originalTrackPayload, admin: true }, hash),
        reason: "unexpected fields: admin",
      },
      {
        name: "malformed mapped key",
        fields: (hash: string) => trackRemoteFields(originalTrackPayload, hash, { "External Key": "not-a-canonical-key" }),
        reason: "malformed or unknown External Key",
      },
    ]) {
      const d1 = fixture("airtable");
      const priorHash = await seedMappedTrack(d1);
      const fetcher = inboundRecordFetcher("recTrack123", scenario.fields(priorHash));
      const originalFetch = globalThis.fetch;
      globalThis.fetch = fetcher as typeof fetch;
      try {
        await pullAirtableChanges(bindings(d1), "connection-a", 100);
        expect(d1.sqlite.prepare("SELECT name, color FROM tracks WHERE id = 'track-a'").get(), scenario.name)
          .toEqual({ name: "Old name", color: "#112233" });
        expect(String((d1.sqlite.prepare("SELECT reason FROM airtable_conflicts").get() as { reason: string }).reason), scenario.name)
          .toContain(scenario.reason);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  });

  it("conflicts on protected derived-field drift before treating an unchanged payload as an echo", async () => {
    const d1 = fixture("airtable");
    const priorHash = await seedMappedTrack(d1);
    const fetcher = inboundRecordFetcher("recTrack123", trackRemoteFields(originalTrackPayload, priorHash, {
      "Display Name": "Forged searchable label",
      "Sync Hash": "forged-hash",
    }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      await pullAirtableChanges(bindings(d1), "connection-a", 100);
      expect(d1.sqlite.prepare("SELECT reason FROM airtable_conflicts").get()).toEqual({
        reason: expect.stringMatching(/Protected derived fields changed: .*Display Name.*Sync Hash/),
      });
      expect(d1.sqlite.prepare("SELECT status FROM airtable_connections WHERE id = 'connection-a'").get()).toEqual({ status: "blocked" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects Airtable authority until health, webhook, reconciliation, queue, and conflicts are clean", async () => {
    const d1 = fixture();
    insertTrackChange(d1, "pending-cutover");
    d1.sqlite.prepare(`INSERT INTO airtable_change_queue
      (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
      VALUES ('dead-cutover', 'connection-a', 'track', '["dead"]', 'upsert', 'dead', 5, 1, 0, NULL, 'failed', 1, 1)`).run();
    d1.sqlite.prepare(`INSERT INTO airtable_conflicts VALUES
      ('conflict-cutover', 'connection-a', 'track', '["conflict"]', NULL, 'conflict', NULL, NULL, '{}', 'open', NULL, 1, 1)`).run();
    d1.sqlite.prepare("UPDATE airtable_connections SET webhook_expires_at = 50, reconciliation_started_at = 10, last_reconciled_at = NULL, status = 'blocked' WHERE id = 'connection-a'").run();
    const blockers = await airtableAuthorityPromotionBlockers(bindings(d1).DB, "connection-a", 100);
    expect(blockers.join(" | ")).toMatch(/health is blocked/);
    expect(blockers.join(" | ")).toMatch(/webhook is expired/);
    expect(blockers.join(" | ")).toMatch(/reconciliation is still running/);
    expect(blockers.join(" | ")).toMatch(/has not completed/);
    expect(blockers.join(" | ")).toMatch(/queued or retrying/);
    expect(blockers.join(" | ")).toMatch(/dead change/);
    expect(blockers.join(" | ")).toMatch(/open conflict/);

    const updates: Array<Record<string, unknown>> = [];
    const fetcher = workflowCommandFetcher({ authority: "airtable" }, updates);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      await pullAirtableChanges(bindings(d1), "connection-a", 100);
      expect(d1.sqlite.prepare("SELECT authority FROM airtable_connections WHERE id = 'connection-a'").get()).toEqual({ authority: "d1" });
      expect(updates.at(-1)).toMatchObject({ Status: "Rejected", Error: expect.stringContaining("cannot become the source of truth") });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("promotes Airtable authority only after the connector is verified clean", async () => {
    const d1 = fixture();
    d1.sqlite.prepare("UPDATE airtable_connections SET status = 'healthy', last_reconciled_at = 80, reconciliation_started_at = NULL WHERE id = 'connection-a'").run();
    const updates: Array<Record<string, unknown>> = [];
    const fetcher = workflowCommandFetcher({ authority: "airtable" }, updates);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      await pullAirtableChanges(bindings(d1), "connection-a", 100);
      expect(d1.sqlite.prepare("SELECT authority FROM airtable_connections WHERE id = 'connection-a'").get()).toEqual({ authority: "airtable" });
      expect(updates.at(-1)).toMatchObject({ Status: "Succeeded", Error: "" });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("fails closed for non-null event-scoped connections in a two-event database", async () => {
    const d1 = fixture();
    d1.sqlite.prepare(`INSERT INTO airtable_connections
      (id, event_id, base_id, records_table_id, commands_table_id, authority, enabled, status, webhook_id,
       webhook_cursor, webhook_expires_at, last_reconciled_at, created_at, updated_at)
      VALUES ('connection-event-b', 'event-b', 'appEventScoped', 'tblEventRecords', 'tblEventCommands', 'd1', 1,
        'healthy', 'achEventWebhook', 0, 1000, 50, 1, 1)`).run();
    d1.sqlite.prepare(`INSERT INTO airtable_change_queue
      (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
      VALUES ('event-b-change', 'connection-event-b', 'track', '["track-a"]', 'upsert', 'queued', 0, 1, 0, NULL, NULL, 1, 1)`).run();
    const fetcher = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      expect(await drainAirtableChanges({ ...bindings(d1), AIRTABLE_BASE_ID: "" }, { connectionId: "connection-event-b", now: 100 }))
        .toEqual({ claimed: 0, synced: 0, echoed: 0, failed: 0 });
      expect(fetcher).not.toHaveBeenCalled();
      expect(d1.sqlite.prepare("SELECT status, generation FROM airtable_change_queue WHERE id = 'event-b-change'").get())
        .toEqual({ status: "queued", generation: 1 });
      await expect(airtableAuthorityPromotionBlockers(bindings(d1).DB, "connection-event-b", 100))
        .resolves.toContain("event-scoped connectors are unsupported; use the environment-wide connector");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("makes conflict direction explicit", () => {
    expect(resolveAirtableAuthority("d1", false)).toBe("restore_airtable");
    expect(resolveAirtableAuthority("airtable", false)).toBe("apply_airtable");
    expect(resolveAirtableAuthority("airtable", true)).toBe("ignore");
  });

  it("rejects reuse of a command idempotency key with different parameters", async () => {
    const d1 = fixture();
    let commandListCalls = 0;
    let cursor = 0;
    const commandUpdates: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/webhooks/achWebhook123/payloads")) return Response.json({ cursor: ++cursor, mightHaveMore: false, payloads: [] });
      if (url.includes("/tblCommands123?") && !init?.method) {
        commandListCalls += 1;
        const authority = commandListCalls === 1 ? "d1" : "airtable";
        return Response.json({ records: [{ id: "recCommand123", fields: {
          "Command Type": "set_authority",
          "Target Entity": "",
          "Target Key": "",
          "Parameters JSON": JSON.stringify({ authority }),
          "Idempotency Key": "authority-once",
          Status: "Pending",
        } }] });
      }
      if (url.includes("/tblCommands123/recCommand123") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body)) as { fields: Record<string, unknown> };
        commandUpdates.push(body.fields);
        return Response.json({ id: "recCommand123", fields: body.fields });
      }
      throw new Error(`Unexpected Airtable request: ${url}`);
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetcher as typeof fetch;
    try {
      expect(await pullAirtableChanges(bindings(d1), "connection-a", 100)).toEqual({ records: 0, commands: 1 });
      expect(await pullAirtableChanges(bindings(d1), "connection-a", 200)).toEqual({ records: 0, commands: 1 });
      expect(d1.sqlite.prepare("SELECT authority FROM airtable_connections WHERE id = 'connection-a'").get()).toEqual({ authority: "d1" });
      expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM airtable_commands").get()).toEqual({ count: 1 });
      expect(commandUpdates.map((fields) => fields.Status)).toEqual(["Succeeded", "Rejected"]);
      expect(commandUpdates[1].Error).toContain("already used");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
