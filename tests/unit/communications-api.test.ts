import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";
import type { OutboxJob } from "../../src/server/outbox-producer";

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
  async run() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
}

class TestD1 {
  sqlite = new DatabaseSync(":memory:");
  prepare(sql: string) { return new Statement(sql, this); }
  async batch(statements: Statement[]) {
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

function fixture() {
  const d1 = new TestD1();
  d1.sqlite.exec(`
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT NOT NULL, venue TEXT NOT NULL, timezone TEXT NOT NULL);
    CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE proposals (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE proposal_speakers (proposal_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);
    CREATE TABLE speaker_tasks (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE rooms (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE program_sessions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      starts_at INTEGER, ends_at INTEGER, calendar_uid TEXT NOT NULL, calendar_sequence INTEGER NOT NULL,
      room_id TEXT, status TEXT NOT NULL
    );
    CREATE TABLE session_speakers (session_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);
    CREATE TABLE message_templates (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, kind TEXT NOT NULL,
      subject TEXT NOT NULL, html TEXT NOT NULL, text TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE outbox (
      id TEXT PRIMARY KEY, event_id TEXT, kind TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, available_at INTEGER NOT NULL,
      last_error TEXT, sent_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );

    INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'organizer');
    INSERT INTO events VALUES ('event-a', 'Conference A', 'Harbor Hall', 'America/Los_Angeles');
    INSERT INTO speaker_profiles VALUES ('speaker-a', 'event-a', 'Speaker A', 'speaker@example.test');
    INSERT INTO proposals VALUES ('proposal-a', 'event-a', 'Operational agents', 'accepted', 10);
    INSERT INTO proposal_speakers VALUES ('proposal-a', 'speaker-a');
    INSERT INTO speaker_tasks VALUES ('task-a', 'event-a', 'speaker-a', 'overdue');
    INSERT INTO rooms VALUES ('room-a', 'event-a', 'Main room');
    INSERT INTO program_sessions VALUES ('session-a', 'event-a', 'Operational agents', 'A useful session.', 1893456000000, 1893459600000, 'session-a@example.test', 3, 'room-a', 'scheduled');
    INSERT INTO session_speakers VALUES ('session-a', 'speaker-a');
    INSERT INTO message_templates VALUES
      ('template-acceptance', 'event-a', 'acceptance', 'Accepted: {{proposal.title}} · {{event.name}}', '<p>Hi {{speaker.name}}. Open {{speaker.portal_url}}; tasks {{task.count}}.</p>', 'Hi {{speaker.name}}. Open {{speaker.portal_url}}; tasks {{task.count}}.', 1),
      ('template-calendar', 'event-a', 'calendar', '{{session.title}} · {{event.name}}', '<p>{{speaker.name}}: {{session.title}} in {{session.room}}</p>', '{{speaker.name}}: {{session.title}} in {{session.room}}', 1);
  `);
  return d1;
}

function bindings(d1: TestD1, sent: OutboxJob[]): Bindings {
  return {
    DB: d1 as unknown as D1Database,
    UPLOADS: {} as R2Bucket,
    JOBS_QUEUE: { send: vi.fn(async (job: OutboxJob) => { sent.push(job); }) } as unknown as Queue,
    ENVIRONMENT: "local",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.test",
    BETTER_AUTH_URL: "https://conference.example.test",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-api-tests",
    MAIL_FROM: "Conference Ops <program@example.test>",
    MAIL_REPLY_TO: "program@example.test",
  };
}

async function send(d1: TestD1, sent: OutboxJob[], kind: "acceptance" | "calendar") {
  return app.request("http://localhost/api/v1/events/event-a/communications/send", {
    method: "POST",
    headers: { "content-type": "application/json", "x-event-role": "organizer", "idempotency-key": `send-${kind}` },
    body: JSON.stringify({ kind, recipientIds: ["speaker-a"] }),
  }, bindings(d1, sent));
}

async function history(d1: TestD1, sent: OutboxJob[], role = "organizer", eventId = "event-a") {
  return app.request(`http://localhost/api/v1/events/${eventId}/communications/history`, {
    headers: { "x-event-role": role },
  }, bindings(d1, sent));
}

describe("MVP communication delivery API", () => {
  it("persists and dispatches rendered acceptance and RFC-calendar jobs", async () => {
    const d1 = fixture();
    const sent: OutboxJob[] = [];

    const acceptance = await send(d1, sent, "acceptance");
    const calendar = await send(d1, sent, "calendar");

    expect(acceptance.status).toBe(202);
    expect(calendar.status).toBe(202);
    expect(await acceptance.json()).toMatchObject({ data: { queued: 1, dispatched: 1 } });
    expect(await calendar.json()).toMatchObject({ data: { queued: 1, dispatched: 1 } });
    expect(sent).toHaveLength(2);
    expect(sent[0].payload).toMatchObject({
      recipient: "speaker@example.test",
      subject: "Accepted: Operational agents · Conference A",
      text: expect.stringContaining("https://conference.example.test/speaker/claim/event-a"),
    });
    expect(JSON.stringify(sent[0].payload)).not.toContain("{{");
    expect(sent[1].kind).toBe("calendar");
    expect(sent[1].payload).toMatchObject({
      subject: "Operational agents · Conference A",
      text: "Speaker A: Operational agents in Main room",
      calendar: expect.objectContaining({ method: "REQUEST", uid: "session-a@example.test", sequence: 3, location: "Main room, Harbor Hall" }),
    });
    expect(d1.sqlite.prepare("SELECT kind, status FROM outbox ORDER BY idempotency_key").all()).toEqual([
      { kind: "email", status: "queued" },
      { kind: "calendar", status: "queued" },
    ]);
  });

  it("returns only sanitized, event-scoped communication delivery evidence to organizers", async () => {
    const d1 = fixture();
    const sent: OutboxJob[] = [];
    await send(d1, sent, "acceptance");
    d1.sqlite.prepare("UPDATE outbox SET status = 'failed', attempts = 2, last_error = ?, updated_at = ?")
      .run("Provider 503; Bearer private-token", 20);
    d1.sqlite.prepare(`INSERT INTO outbox
      (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "job-airtable",
      "event-a",
      "email",
      "not-a-communication",
      JSON.stringify({ kind: "airtable", eventId: "event-a", recipient: "hidden@example.test", subject: "Do not show" }),
      "queued",
      0,
      10,
      10,
      10,
    );
    d1.sqlite.prepare(`INSERT INTO outbox
      (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      "job-other-event",
      "event-b",
      "email",
      "submission-confirmation:proposal-b",
      JSON.stringify({ kind: "communication", eventId: "event-b", recipient: "other@example.test", subject: "Other event", text: "Other body" }),
      "sent",
      1,
      10,
      10,
      10,
    );

    const response = await history(d1, sent);
    expect(response.status).toBe(200);
    const payload = await response.json() as { data: { deliveries: Array<Record<string, unknown>> } };
    expect(payload.data.deliveries).toHaveLength(1);
    expect(payload.data.deliveries[0]).toMatchObject({
      kind: "acceptance",
      transport: "email",
      recipient: "speaker@example.test",
      subject: "Accepted: Operational agents · Conference A",
      status: "failed",
      attempts: 2,
      lastError: "Provider 503; Bearer [redacted]",
    });
    expect(payload.data.deliveries[0]).not.toHaveProperty("text");
    expect(payload.data.deliveries[0]).not.toHaveProperty("html");
    expect(payload.data.deliveries[0]).not.toHaveProperty("payload");
    expect(payload.data.deliveries[0]).not.toHaveProperty("idempotencyKey");
    expect(JSON.stringify(payload)).not.toContain("private-token");
    expect(JSON.stringify(payload)).not.toContain("hidden@example.test");
    expect(JSON.stringify(payload)).not.toContain("other@example.test");
  });

  it("rejects delivery-history access for a non-organizer event role", async () => {
    const d1 = fixture();
    d1.sqlite.prepare("INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'reviewer')").run();

    const response = await history(d1, [], "reviewer");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "ROLE_REQUIRED" } });
  });
});
