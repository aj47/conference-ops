import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: {
      getSession: async () => ({ user: { id: "organizer-a", name: "Organizer A", email: "organizer@example.com" } }),
    },
    handler: async () => new Response(null, { status: 404 }),
  }),
}));

import app from "../../src/server/index";

type SqlValue = string | number | bigint | Uint8Array | null;

class TestD1Statement {
  private values: SqlValue[] = [];

  constructor(
    readonly sql: string,
    private readonly owner: TestD1Database,
  ) {}

  bind(...values: SqlValue[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.owner.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.owner.database.prepare(this.sql).all(...this.values) as T[] };
  }

  async run() {
    if (this.owner.failRunMatching?.test(this.sql)) throw new Error("Injected audit failure");
    const result = this.owner.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
}

class TestD1Database {
  readonly database = new DatabaseSync(":memory:");
  failRunMatching?: RegExp;

  prepare(sql: string) {
    return new TestD1Statement(sql, this);
  }

  async batch(statements: TestD1Statement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDatabase() {
  const d1 = new TestD1Database();
  d1.database.exec(`
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE rooms (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE tracks (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE program_sessions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      room_id TEXT,
      track_id TEXT,
      starts_at INTEGER,
      ends_at INTEGER,
      override_reason TEXT,
      calendar_sequence INTEGER NOT NULL,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      proposal_id TEXT,
      origin TEXT,
      description TEXT,
      format TEXT,
      capacity INTEGER,
      ceu_credits TEXT,
      client_id TEXT,
      calendar_uid TEXT,
      created_at INTEGER
    );
    CREATE TABLE session_speakers (session_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      event_id TEXT,
      actor_user_id TEXT,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata TEXT NOT NULL,
      request_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    INSERT INTO events VALUES ('event-a', 'org-a', 0, 2000, NULL);
    INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'organizer');
    INSERT INTO rooms VALUES ('room-old', 'event-a', 'Old room'), ('room-main', 'event-a', 'Main room');
    INSERT INTO tracks VALUES ('track-old', 'event-a', 'Old track'), ('track-main', 'event-a', 'Main track');
    INSERT INTO speaker_profiles VALUES ('speaker-a', 'event-a', 'Speaker A'), ('speaker-b', 'event-b', 'Speaker B');
    INSERT INTO program_sessions (id, event_id, title, status, room_id, track_id, starts_at, ends_at, override_reason, calendar_sequence, version, updated_at) VALUES
      ('session-target', 'event-a', 'Target session', 'unscheduled', 'room-old', 'track-old', 100, 200, NULL, 0, 1, 1),
      ('session-conflict', 'event-a', 'Existing session', 'scheduled', 'room-main', 'track-main', 500, 700, NULL, 0, 1, 1);
    INSERT INTO session_speakers VALUES ('session-target', 'speaker-a'), ('session-conflict', 'speaker-a');
  `);
  return d1;
}

function bindings(d1: TestD1Database): Bindings {
  return {
    DB: d1 as unknown as D1Database,
    UPLOADS: {} as R2Bucket,
    ENVIRONMENT: "local",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.test",
    BETTER_AUTH_URL: "https://conference.example.test",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-api-tests",
    MAIL_FROM: "program@example.test",
    MAIL_REPLY_TO: "program@example.test",
  };
}

function schedule(d1: TestD1Database) {
  return app.request("http://localhost/api/v1/events/event-a/sessions/session-target/schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      roomId: "room-main",
      trackId: "track-main",
      startsAt: new Date(500).toISOString(),
      endsAt: new Date(700).toISOString(),
      overrideReason: "Program chair approved this intentional overlap.",
    }),
  }, bindings(d1));
}

function createDirectSession(d1: TestD1Database, format: "talk" | "break" | "networking", speakerIds: string[]) {
  return app.request("http://localhost/api/v1/events/event-a/sessions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `${format} direct session`,
      description: "A direct program commitment.",
      kind: "program",
      format,
      speakerIds,
    }),
  }, bindings(d1));
}

describe("schedule conflict override audit", () => {
  let d1: TestD1Database;

  beforeEach(() => {
    d1 = createDatabase();
  });

  it("persists one audit row with the overridden placement", async () => {
    const response = await schedule(d1);

    expect(response.status).toBe(200);
    expect(d1.database.prepare("SELECT room_id, track_id, starts_at, ends_at, override_reason FROM program_sessions WHERE id = 'session-target'").get()).toEqual({
      room_id: "room-main",
      track_id: "track-main",
      starts_at: 500,
      ends_at: 700,
      override_reason: "Program chair approved this intentional overlap.",
    });
    expect(d1.database.prepare("SELECT action, entity_id FROM audit_logs").get()).toEqual({ action: "schedule.conflict_overridden", entity_id: "session-target" });
  });

  it("rolls the placement back when the required audit insert fails", async () => {
    d1.failRunMatching = /INSERT INTO audit_logs/;

    const response = await schedule(d1);

    expect(response.status).toBe(500);
    expect(d1.database.prepare("SELECT room_id, track_id, starts_at, ends_at, override_reason, version FROM program_sessions WHERE id = 'session-target'").get()).toEqual({
      room_id: "room-old",
      track_id: "track-old",
      starts_at: 100,
      ends_at: 200,
      override_reason: null,
      version: 1,
    });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
  });

  it("requires an existing event speaker for direct content sessions", async () => {
    const missing = await createDirectSession(d1, "talk", []);
    const crossEvent = await createDirectSession(d1, "talk", ["speaker-b"]);
    const created = await createDirectSession(d1, "talk", ["speaker-a"]);

    expect([missing.status, crossEvent.status, created.status]).toEqual([422, 422, 201]);
    expect(await missing.json()).toMatchObject({ error: { code: "SESSION_SPEAKER_REQUIRED" } });
    expect(await crossEvent.json()).toMatchObject({ error: { code: "SPEAKER_NOT_FOUND" } });
    const payload = await created.json() as { data: { id: string } };
    expect(d1.database.prepare("SELECT speaker_profile_id FROM session_speakers WHERE session_id = ?").all(payload.data.id)).toEqual([{ speaker_profile_id: "speaker-a" }]);
  });

  it("allows speaker-free breaks and networking blocks", async () => {
    const breakResponse = await createDirectSession(d1, "break", []);
    const networkingResponse = await createDirectSession(d1, "networking", []);

    expect([breakResponse.status, networkingResponse.status]).toEqual([201, 201]);
    expect(d1.database.prepare("SELECT format FROM program_sessions WHERE origin = 'direct_program' ORDER BY format").all()).toEqual([
      { format: "break" },
      { format: "networking" },
    ]);
  });
});
