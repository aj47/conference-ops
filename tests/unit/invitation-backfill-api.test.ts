import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

const authUser = vi.hoisted(() => ({
  id: "reviewer-new",
  name: "New Reviewer",
  email: "reviewer@example.com",
}));

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: { getSession: async () => ({ user: { ...authUser } }) },
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
    if (this.owner.failRunMatching?.test(this.sql)) throw new Error("Injected D1 batch failure");
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createDatabase(role: "reviewer" | "organizer" = "reviewer") {
  const d1 = new TestD1Database();
  const token = `${role}-invitation-token-that-is-long-enough`;
  const tokenHash = await sha256(token);
  d1.database.exec(`
    CREATE TABLE event_invitations (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      invited_by TEXT,
      accepted_at INTEGER,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE event_memberships (
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      invited_by TEXT,
      accepted_at INTEGER,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (event_id, user_id, role)
    );
    CREATE TABLE reviewer_groups (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL
    );
    CREATE TABLE reviewer_group_members (
      reviewer_group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (reviewer_group_id, user_id)
    );
    CREATE TABLE review_rounds (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      reviewer_group_id TEXT,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      owner_user_id TEXT NOT NULL
    );
    CREATE TABLE proposal_reviewer_groups (
      proposal_id TEXT NOT NULL,
      reviewer_group_id TEXT NOT NULL,
      PRIMARY KEY (proposal_id, reviewer_group_id)
    );
    CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT);
    CREATE TABLE proposal_speakers (proposal_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);
    CREATE TABLE review_assignments (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      reviewer_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      scores TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (proposal_id, round_id, reviewer_user_id)
    );

    INSERT INTO event_invitations VALUES (
      'invitation-a', 'event-a', 'reviewer@example.com', '${role}', '${tokenHash}',
      'organizer-a', NULL, ${Date.now() + 60_000}
    );
    INSERT INTO event_memberships VALUES ('event-a', 'reviewer-new', 'applicant', NULL, ${Date.now()}, ${Date.now()});
    INSERT INTO reviewer_groups VALUES ('group-build', 'event-a'), ('group-evaluate', 'event-a'), ('group-other', 'event-b');
    INSERT INTO review_rounds VALUES ('round-a', 'event-a', 1, 'active'), ('round-other', 'event-b', 1, 'active');
    INSERT INTO proposals VALUES
      ('proposal-build', 'event-a', 'group-build', 'submitted', 1, 'applicant-a'),
      ('proposal-evaluate', 'event-a', 'group-evaluate', 'under_review', 1, 'applicant-b'),
      ('proposal-owned', 'event-a', 'group-build', 'submitted', 1, 'reviewer-new'),
      ('proposal-co-speaker', 'event-a', 'group-build', 'submitted', 1, 'applicant-c'),
      ('proposal-draft', 'event-a', 'group-build', 'draft', 1, 'applicant-d'),
      ('proposal-other', 'event-b', 'group-other', 'submitted', 1, 'applicant-e');
    INSERT INTO proposal_reviewer_groups VALUES
      ('proposal-build', 'group-build'),
      ('proposal-evaluate', 'group-evaluate'),
      ('proposal-owned', 'group-build'),
      ('proposal-co-speaker', 'group-build'),
      ('proposal-draft', 'group-build'),
      ('proposal-other', 'group-other');
    INSERT INTO speaker_profiles VALUES ('speaker-reviewer-new', 'event-a', 'reviewer-new');
    INSERT INTO proposal_speakers VALUES ('proposal-co-speaker', 'speaker-reviewer-new');
  `);
  return { d1, token };
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
    MAIL_FROM: "Conference Ops <program@example.test>",
    MAIL_REPLY_TO: "program@example.test",
  };
}

async function accept(d1: TestD1Database, token: string) {
  return app.request("http://localhost/api/v1/invitations/accept", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token }),
  }, bindings(d1));
}

describe("reviewer invitation acceptance API", () => {
  beforeEach(() => {
    authUser.id = "reviewer-new";
    authUser.name = "New Reviewer";
    authUser.email = "reviewer@example.com";
  });

  it("atomically joins reviewer groups, materializes the routed backlog, and promotes submitted proposals", async () => {
    const { d1, token } = await createDatabase();

    const response = await accept(d1, token);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { accepted: true, eventId: "event-a", role: "reviewer" } });
    expect(d1.database.prepare("SELECT reviewer_group_id FROM reviewer_group_members WHERE user_id = ? ORDER BY reviewer_group_id").all(authUser.id)).toEqual([
      { reviewer_group_id: "group-build" },
      { reviewer_group_id: "group-evaluate" },
    ]);
    expect(d1.database.prepare("SELECT proposal_id, reviewer_user_id FROM review_assignments ORDER BY proposal_id").all()).toEqual([
      { proposal_id: "proposal-build", reviewer_user_id: "reviewer-new" },
      { proposal_id: "proposal-evaluate", reviewer_user_id: "reviewer-new" },
    ]);
    expect(d1.database.prepare("SELECT status FROM proposals WHERE id = 'proposal-build'").get()).toEqual({ status: "under_review" });
    expect(d1.database.prepare("SELECT status FROM proposals WHERE id = 'proposal-owned'").get()).toEqual({ status: "submitted" });
    expect(d1.database.prepare("SELECT status FROM proposals WHERE id = 'proposal-co-speaker'").get()).toEqual({ status: "submitted" });
    expect(d1.database.prepare("SELECT accepted_at IS NOT NULL AS accepted FROM event_invitations WHERE id = 'invitation-a'").get()).toEqual({ accepted: 1 });
  });

  it("does not create reviewer routing or assignments for an organizer invitation", async () => {
    const { d1, token } = await createDatabase("organizer");

    const response = await accept(d1, token);

    expect(response.status).toBe(200);
    expect(d1.database.prepare("SELECT role FROM event_memberships ORDER BY role").all()).toEqual([{ role: "applicant" }, { role: "organizer" }]);
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM reviewer_group_members").get()).toEqual({ count: 0 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM review_assignments").get()).toEqual({ count: 0 });
    expect(d1.database.prepare("SELECT status FROM proposals WHERE id = 'proposal-build'").get()).toEqual({ status: "submitted" });
  });

  it("rolls back membership and invitation acceptance when backlog materialization fails", async () => {
    const { d1, token } = await createDatabase();
    d1.failRunMatching = /INSERT OR IGNORE INTO review_assignments/;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await accept(d1, token);
    logged.mockRestore();

    expect(response.status).toBe(500);
    expect(d1.database.prepare("SELECT role FROM event_memberships").all()).toEqual([{ role: "applicant" }]);
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM reviewer_group_members").get()).toEqual({ count: 0 });
    expect(d1.database.prepare("SELECT accepted_at FROM event_invitations WHERE id = 'invitation-a'").get()).toEqual({ accepted_at: null });
  });
});
