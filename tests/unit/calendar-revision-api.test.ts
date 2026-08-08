import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

  constructor(readonly sql: string, private readonly owner: TestD1Database) {}

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
    if (this.owner.failRunMatching?.test(this.sql)) throw new Error("Injected calendar revision failure");
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
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      short_name TEXT NOT NULL,
      description TEXT NOT NULL,
      timezone TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL,
      cfp_closes_at INTEGER,
      venue TEXT NOT NULL,
      website_url TEXT,
      accent TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE rooms (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, capacity INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE program_sessions (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      room_id TEXT,
      status TEXT NOT NULL,
      calendar_sequence INTEGER NOT NULL,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO events VALUES
      ('event-a', 'event-a', 'Event A', 'A', 'Original', 'America/Los_Angeles', 1787932800000, 1788019200000, 1785254400000, 'Venue A', 'https://example.test/a', '#123456', 1, NULL),
      ('event-b', 'taken-slug', 'Event B', 'B', 'Other', 'America/Los_Angeles', 1787932800000, 1788019200000, 1785254400000, 'Venue B', 'https://example.test/b', '#654321', 1, NULL);
    INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'organizer');
    INSERT INTO rooms VALUES
      ('room-a', 'event-a', 'Old room', 100, 1),
      ('room-other', 'event-a', 'Other room', 50, 1),
      ('room-foreign', 'event-b', 'Foreign room', 80, 1);
    INSERT INTO program_sessions VALUES
      ('scheduled-a', 'event-a', 'room-a', 'scheduled', 2, 3, 1),
      ('published-a', 'event-a', 'room-a', 'published', 4, 5, 1),
      ('unscheduled-a', 'event-a', 'room-a', 'unscheduled', 0, 1, 1),
      ('other-room-a', 'event-a', 'room-other', 'scheduled', 7, 8, 1),
      ('foreign', 'event-b', 'room-foreign', 'published', 9, 10, 1);
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

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: "Event A",
    shortName: "EA",
    description: "Updated description",
    timezone: "America/Los_Angeles",
    startsAt: "2026-08-28T16:00:00.000Z",
    endsAt: "2026-08-29T01:00:00.000Z",
    cfpClosesAt: "2026-07-28T16:00:00.000Z",
    venue: "Venue A",
    websiteUrl: "https://example.test/a",
    accent: "#123456",
    ...overrides,
  };
}

function updateEvent(d1: TestD1Database, overrides: Record<string, unknown> = {}) {
  return app.request("http://localhost/api/v1/events/event-a", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(eventPayload(overrides)),
  }, bindings(d1));
}

function updateRoom(d1: TestD1Database, body: { name: string; capacity: number }) {
  return app.request("http://localhost/api/v1/events/event-a/rooms/room-a", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, bindings(d1));
}

function revisions(d1: TestD1Database) {
  return d1.database.prepare("SELECT id, calendar_sequence, version FROM program_sessions ORDER BY id").all();
}

describe("calendar sequence revisions from rendered invite fields", () => {
  let d1: TestD1Database;

  beforeEach(() => {
    d1 = createDatabase();
  });

  afterEach(() => vi.restoreAllMocks());

  it("bumps scheduled and published sessions for an event name or venue change only", async () => {
    const response = await updateEvent(d1, { name: "Renamed Event A" });

    expect(response.status).toBe(200);
    expect(revisions(d1)).toEqual([
      { id: "foreign", calendar_sequence: 9, version: 10 },
      { id: "other-room-a", calendar_sequence: 8, version: 9 },
      { id: "published-a", calendar_sequence: 5, version: 6 },
      { id: "scheduled-a", calendar_sequence: 3, version: 4 },
      { id: "unscheduled-a", calendar_sequence: 0, version: 1 },
    ]);
  });

  it("does not bump calendar state for irrelevant event edits or a failed slug update", async () => {
    const before = revisions(d1);
    const irrelevant = await updateEvent(d1, { description: "Only the public description changed." });
    const failed = await updateEvent(d1, { slug: "taken-slug", name: "Should not persist" });

    expect(irrelevant.status).toBe(200);
    expect(failed.status).toBe(409);
    expect(revisions(d1)).toEqual(before);
    expect(d1.database.prepare("SELECT name FROM events WHERE id = 'event-a'").get()).toEqual({ name: "Event A" });
  });

  it("bumps only scheduled or published sessions in a successfully renamed room", async () => {
    const response = await updateRoom(d1, { name: "New room", capacity: 120 });

    expect(response.status).toBe(200);
    expect(revisions(d1)).toEqual([
      { id: "foreign", calendar_sequence: 9, version: 10 },
      { id: "other-room-a", calendar_sequence: 7, version: 8 },
      { id: "published-a", calendar_sequence: 5, version: 6 },
      { id: "scheduled-a", calendar_sequence: 3, version: 4 },
      { id: "unscheduled-a", calendar_sequence: 0, version: 1 },
    ]);
  });

  it("does not bump for capacity-only or failed duplicate room updates", async () => {
    const before = revisions(d1);
    const capacityOnly = await updateRoom(d1, { name: "Old room", capacity: 120 });
    const failed = await updateRoom(d1, { name: "Other room", capacity: 120 });

    expect(capacityOnly.status).toBe(200);
    expect(failed.status).toBe(409);
    expect(revisions(d1)).toEqual(before);
  });

  it("rolls the room mutation back when the calendar revision write fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    d1.failRunMatching = /UPDATE program_sessions/;

    const response = await updateRoom(d1, { name: "New room", capacity: 120 });

    expect(response.status).toBe(500);
    expect(d1.database.prepare("SELECT name, capacity FROM rooms WHERE id = 'room-a'").get()).toEqual({ name: "Old room", capacity: 100 });
    expect(d1.database.prepare("SELECT calendar_sequence FROM program_sessions WHERE id = 'scheduled-a'").get()).toEqual({ calendar_sequence: 2 });
  });
});
