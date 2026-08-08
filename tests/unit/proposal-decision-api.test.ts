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
    const result = this.owner.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
}

class TestD1Database {
  readonly database = new DatabaseSync(":memory:");

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
    CREATE TABLE events (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, starts_at INTEGER NOT NULL);
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL,
      decided_at INTEGER,
      updated_at INTEGER NOT NULL,
      version INTEGER NOT NULL
    );
    CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL);
    CREATE TABLE proposal_speakers (proposal_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);
    CREATE TABLE task_templates (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      relative_due_days INTEGER NOT NULL
    );
    CREATE TABLE speaker_tasks (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      template_id TEXT,
      speaker_profile_id TEXT NOT NULL,
      proposal_id TEXT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
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

    INSERT INTO events VALUES ('event-a', 'org-a', 4102444800000);
    INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'organizer');
    INSERT INTO proposals VALUES
      ('proposal-draft', 'event-a', 'draft', NULL, 1, 1),
      ('proposal-review', 'event-a', 'under_review', NULL, 1, 1),
      ('proposal-review-2', 'event-a', 'under_review', NULL, 1, 1);
    INSERT INTO speaker_profiles VALUES ('speaker-a', 'event-a');
    INSERT INTO proposal_speakers VALUES
      ('proposal-draft', 'speaker-a'),
      ('proposal-review', 'speaker-a'),
      ('proposal-review-2', 'speaker-a');
    INSERT INTO task_templates VALUES
      ('template-profile', 'event-a', 'Complete profile', 'Add public details.', 'profile', 'contact', 7),
      ('template-slides', 'event-a', 'Upload slides', 'Provide the final deck.', 'upload', 'submission', 7);
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

function decide(d1: TestD1Database, proposalId: string, status: "accept_queue" | "accepted" | "decline_queue" | "rejected" | "waitlisted") {
  return app.request(`http://localhost/api/v1/events/event-a/proposals/${proposalId}/decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ status, note: "Program committee lifecycle test." }),
  }, bindings(d1));
}

describe("proposal decision API finality", () => {
  let d1: TestD1Database;

  beforeEach(() => {
    d1 = createDatabase();
  });

  it("rejects organizer decisions on applicant drafts and direct final decisions", async () => {
    const draft = await decide(d1, "proposal-draft", "accept_queue");
    const directFinal = await decide(d1, "proposal-review", "accepted");

    expect(draft.status).toBe(409);
    expect((await draft.json() as { error: { code: string } }).error.code).toBe("PROPOSAL_TRANSITION_INVALID");
    expect(directFinal.status).toBe(409);
    expect((await directFinal.json() as { error: { code: string } }).error.code).toBe("PROPOSAL_TRANSITION_INVALID");
    expect(d1.database.prepare("SELECT id, status, version FROM proposals ORDER BY id").all()).toEqual([
      { id: "proposal-draft", status: "draft", version: 1 },
      { id: "proposal-review", status: "under_review", version: 1 },
      { id: "proposal-review-2", status: "under_review", version: 1 },
    ]);
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM speaker_tasks").get()).toEqual({ count: 0 });
  });

  it("requires a staged queue, creates onboarding once, and locks the final decision", async () => {
    const staged = await decide(d1, "proposal-review", "accept_queue");
    const accepted = await decide(d1, "proposal-review", "accepted");
    const redecided = await decide(d1, "proposal-review", "rejected");

    expect(staged.status).toBe(200);
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ data: { status: "accepted", speakerTasksCreated: 2 } });
    expect(redecided.status).toBe(409);
    expect((await redecided.json() as { error: { code: string } }).error.code).toBe("PROPOSAL_TRANSITION_INVALID");
    expect(d1.database.prepare("SELECT status, decided_at IS NOT NULL AS decided, version FROM proposals WHERE id = 'proposal-review'").get()).toEqual({ status: "accepted", decided: 1, version: 3 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()).toEqual({ count: 2 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM speaker_tasks").get()).toEqual({ count: 2 });
  });

  it("creates contact tasks once and submission tasks for each accepted proposal", async () => {
    await decide(d1, "proposal-review", "accept_queue");
    const acceptedFirst = await decide(d1, "proposal-review", "accepted");
    await decide(d1, "proposal-review-2", "accept_queue");
    const acceptedSecond = await decide(d1, "proposal-review-2", "accepted");
    const acceptedAgain = await decide(d1, "proposal-review-2", "accepted");

    expect(acceptedFirst.status).toBe(200);
    expect(await acceptedFirst.json()).toMatchObject({ data: { speakerTasksCreated: 2 } });
    expect(acceptedSecond.status).toBe(200);
    expect(await acceptedSecond.json()).toMatchObject({ data: { speakerTasksCreated: 1 } });
    expect(acceptedAgain.status).toBe(409);
    expect(d1.database.prepare(`SELECT template_id, speaker_profile_id, proposal_id
      FROM speaker_tasks ORDER BY template_id, proposal_id`).all()).toEqual([
      { template_id: "template-profile", speaker_profile_id: "speaker-a", proposal_id: null },
      { template_id: "template-slides", speaker_profile_id: "speaker-a", proposal_id: "proposal-review" },
      { template_id: "template-slides", speaker_profile_id: "speaker-a", proposal_id: "proposal-review-2" },
    ]);
  });
});
