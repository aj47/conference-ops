import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import app from "../../src/server/index";
import type { Bindings } from "../../src/server/env";
import { publishAgendaAtomically } from "../../src/server/agenda-publish";

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
  withSession() { return this; }
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
    CREATE TABLE events (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL, name TEXT NOT NULL, short_name TEXT NOT NULL,
      description TEXT NOT NULL, timezone TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
      cfp_closes_at INTEGER NOT NULL, venue TEXT NOT NULL, website_url TEXT, accent TEXT NOT NULL,
      status TEXT NOT NULL, public_agenda_revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER
    );
    CREATE TABLE submission_forms (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, slug TEXT, name TEXT NOT NULL, status TEXT NOT NULL,
      published_version INTEGER NOT NULL, submission_type TEXT NOT NULL, collects_participants INTEGER NOT NULL,
      max_submissions_per_user INTEGER NOT NULL, redirect_to_portal INTEGER NOT NULL,
      confirmation_email_enabled INTEGER NOT NULL, closes_at INTEGER, updated_at INTEGER NOT NULL,
      kind TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE form_versions (
      form_id TEXT NOT NULL, version INTEGER NOT NULL, public_title TEXT NOT NULL, page_heading TEXT NOT NULL,
      welcome_title TEXT NOT NULL, welcome_copy TEXT NOT NULL, confirmation_copy TEXT NOT NULL,
      max_speakers INTEGER NOT NULL, allow_multiple_drafts INTEGER NOT NULL, settings TEXT NOT NULL, fields TEXT NOT NULL
    );
    CREATE TABLE tracks (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL);
    CREATE TABLE rooms (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL);
    CREATE TABLE program_sessions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, proposal_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL,
      format TEXT NOT NULL, starts_at INTEGER, ends_at INTEGER, track_id TEXT, room_id TEXT, status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE session_content_status (
      session_id TEXT PRIMARY KEY, event_id TEXT NOT NULL, status TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE session_speakers (session_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);
    CREATE TABLE speaker_profiles (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL, company TEXT NOT NULL,
      bio TEXT NOT NULL, pronouns TEXT, city TEXT, profile_complete INTEGER NOT NULL, published INTEGER NOT NULL,
      headshot_upload_id TEXT
    );
    CREATE TABLE uploads (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, purpose TEXT NOT NULL, deleted_at INTEGER);
    CREATE TABLE resource_pages (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, slug TEXT NOT NULL, summary TEXT NOT NULL,
      sanitized_html TEXT NOT NULL, embed_url TEXT, updated_at INTEGER NOT NULL, status TEXT NOT NULL
    );

    INSERT INTO events VALUES (
      'event-a', 'summit-2026', 'Summit 2026', 'SUMMIT', 'Field notes', 'America/Los_Angeles',
      1787932800000, 1788019200000, 1787846400000, 'Fort Mason', NULL, '#e05b3f', 'agenda_published', 0, 0, NULL
    );
    INSERT INTO program_sessions
      (id, event_id, proposal_id, title, description, format, starts_at, ends_at, track_id, room_id, status)
    VALUES
      ('session-approved', 'event-a', NULL, 'Approved session', 'Ready for attendees', 'talk', 1787932800000, 1787936400000, NULL, NULL, 'published'),
      ('session-missing-status', 'event-a', NULL, 'Unreviewed session', 'Must stay private', 'talk', 1787936400000, 1787940000000, NULL, NULL, 'published'),
      ('session-draft', 'event-a', NULL, 'Draft session', 'Must stay private', 'talk', 1787940000000, 1787943600000, NULL, NULL, 'published');
    INSERT INTO session_content_status (session_id, event_id, status) VALUES
      ('session-approved', 'event-a', 'approved'),
      ('session-draft', 'event-a', 'draft');
  `);
  return d1;
}

function bindings(d1: TestD1): Bindings {
  return {
    DB: d1 as unknown as D1Database,
    UPLOADS: {} as R2Bucket,
    ENVIRONMENT: "production",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.test",
    BETTER_AUTH_URL: "https://conference.example.test",
    BETTER_AUTH_SECRET: "public-content-approval-test-secret",
    MAIL_FROM: "program@example.test",
    MAIL_REPLY_TO: "program@example.test",
  };
}

describe("public content approval boundary", () => {
  it("includes only explicitly approved published sessions", async () => {
    const d1 = fixture();
    const response = await app.request(
      "https://conference.example.test/api/v1/public/events/summit-2026",
      undefined,
      bindings(d1),
    );
    const payload = await response.json() as { data: { sessions: Array<{ id: string; title: string }> } };

    expect(response.status).toBe(200);
    expect(payload.data.sessions).toEqual([
      expect.objectContaining({ id: "session-approved", title: "Approved session" }),
    ]);
  });

  it("treats organizer agenda publication as explicit approval for the selected sessions only", async () => {
    const d1 = fixture();
    d1.sqlite.exec(`
      INSERT INTO program_sessions (id, event_id, proposal_id, title, description, format, starts_at, ends_at, track_id, room_id, status)
      VALUES
        ('session-to-publish', 'event-a', NULL, 'Newly approved session', 'Approved by the publish action', 'talk', 1787950000000, 1787953600000, NULL, NULL, 'scheduled'),
        ('session-unselected', 'event-a', NULL, 'Still private session', 'Not selected by the organizer', 'talk', 1787953600000, 1787957200000, NULL, NULL, 'scheduled');
    `);

    const published = await publishAgendaAtomically(d1 as unknown as D1Database, "event-a", ["session-to-publish"], 100);
    const response = await app.request(
      "https://conference.example.test/api/v1/public/events/summit-2026",
      undefined,
      bindings(d1),
    );
    const payload = await response.json() as { data: { sessions: Array<{ id: string }> } };

    expect(published).toMatchObject({ publishedSessions: 1, approvedSessions: 1 });
    expect(payload.data.sessions.map((session) => session.id)).toContain("session-to-publish");
    expect(payload.data.sessions.map((session) => session.id)).not.toContain("session-unselected");
    expect(d1.sqlite.prepare("SELECT status FROM session_content_status WHERE session_id = 'session-to-publish'").get()).toEqual({ status: "approved" });
    expect(d1.sqlite.prepare("SELECT status FROM program_sessions WHERE id = 'session-unselected'").get()).toEqual({ status: "scheduled" });
  });
});
