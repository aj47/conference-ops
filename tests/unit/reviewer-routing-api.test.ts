import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
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

  prepare(sql: string) {
    return new Statement(sql, this);
  }

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
    CREATE TABLE reviewer_groups (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL,
      category TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE reviewer_group_members (
      reviewer_group_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (reviewer_group_id, user_id)
    );
    CREATE TABLE proposal_reviewer_groups (
      proposal_id TEXT NOT NULL, reviewer_group_id TEXT NOT NULL,
      PRIMARY KEY (proposal_id, reviewer_group_id)
    );
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, category TEXT NOT NULL,
      status TEXT NOT NULL, owner_user_id TEXT NOT NULL, updated_at INTEGER NOT NULL,
      review_cycle INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE review_rounds (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, round INTEGER NOT NULL, status TEXT NOT NULL);
    CREATE TABLE review_assignments (
      id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, round_id TEXT NOT NULL,
      reviewer_user_id TEXT NOT NULL, status TEXT NOT NULL, scores TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      review_cycle INTEGER NOT NULL DEFAULT 1,
      UNIQUE (proposal_id, round_id, reviewer_user_id, review_cycle)
    );
    CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT);
    CREATE TABLE proposal_speakers (proposal_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);

    INSERT INTO event_memberships VALUES
      ('event-a', 'organizer-a', 'organizer'),
      ('event-a', 'reviewer-a', 'reviewer'),
      ('event-a', 'reviewer-b', 'reviewer');
    INSERT INTO reviewer_groups VALUES ('group-agents', 'event-a', 'Old committee', 'Agents', 1, 1);
    INSERT INTO reviewer_group_members VALUES ('group-agents', 'reviewer-a', 1);
    INSERT INTO proposals VALUES
      ('proposal-multi', 'event-a', 'Agents, Evaluation', 'submitted', 'applicant-a', 1, 1),
      ('proposal-owned', 'event-a', 'Agents', 'submitted', 'reviewer-a', 1, 1);
    INSERT INTO review_rounds VALUES ('round-a', 'event-a', 1, 'active');
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
  };
}

function save(d1: TestD1, reviewerIds = ["reviewer-a", "reviewer-b"]) {
  return app.request("http://localhost/api/v1/events/event-a/reviewer-routing", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-event-role": "organizer" },
    body: JSON.stringify({ groups: [
      { id: "group-agents", name: "Agents committee", category: "Agents", reviewerIds },
      { name: "Evaluation committee", category: "Evaluation", reviewerIds: ["reviewer-b"] },
    ] }),
  }, bindings(d1));
}

describe("organizer reviewer routing", () => {
  it("maps multi-track proposals to the union of covered reviewers and rebuilds pending work", async () => {
    const d1 = fixture();

    const response = await save(d1);
    const payload = await response.json() as { data: { groups: Array<{ id: string; category: string }> } };

    expect(response.status).toBe(200);
    expect(payload.data.groups.map((group) => group.category)).toEqual(["Agents", "Evaluation"]);
    const evaluationGroupId = payload.data.groups.find((group) => group.category === "Evaluation")!.id;
    expect(d1.sqlite.prepare("SELECT proposal_id, reviewer_group_id FROM proposal_reviewer_groups ORDER BY proposal_id, reviewer_group_id").all()).toEqual(expect.arrayContaining([
      { proposal_id: "proposal-multi", reviewer_group_id: "group-agents" },
      { proposal_id: "proposal-multi", reviewer_group_id: evaluationGroupId },
      { proposal_id: "proposal-owned", reviewer_group_id: "group-agents" },
    ]));
    expect(d1.sqlite.prepare("SELECT proposal_id, reviewer_user_id FROM review_assignments ORDER BY proposal_id, reviewer_user_id").all()).toEqual([
      { proposal_id: "proposal-multi", reviewer_user_id: "reviewer-a" },
      { proposal_id: "proposal-multi", reviewer_user_id: "reviewer-b" },
      { proposal_id: "proposal-owned", reviewer_user_id: "reviewer-b" },
    ]);
    expect(d1.sqlite.prepare("SELECT id, status FROM proposals ORDER BY id").all()).toEqual([
      { id: "proposal-multi", status: "under_review" },
      { id: "proposal-owned", status: "under_review" },
    ]);
  });

  it("rejects routing to a user who has not accepted reviewer membership", async () => {
    const d1 = fixture();

    const response = await save(d1, ["reviewer-a", "foreign-user"]);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "REVIEWER_MEMBERSHIP_REQUIRED" } });
    expect(d1.sqlite.prepare("SELECT name FROM reviewer_groups WHERE id = 'group-agents'").get()).toEqual({ name: "Old committee" });
    expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM review_assignments").get()).toEqual({ count: 0 });
  });

  it("rejects comma-containing lane names before rebuilding assignments", async () => {
    const d1 = fixture();

    const response = await app.request("http://localhost/api/v1/events/event-a/reviewer-routing", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-event-role": "organizer" },
      body: JSON.stringify({ groups: [
        { id: "group-agents", name: "AI ethics committee", category: "AI, Ethics", reviewerIds: ["reviewer-a"] },
      ] }),
    }, bindings(d1));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { name: "ZodError", message: expect.stringContaining("Program lane names cannot contain commas") },
    });
    expect(d1.sqlite.prepare("SELECT name, category FROM reviewer_groups WHERE id = 'group-agents'").get()).toEqual({
      name: "Old committee",
      category: "Agents",
    });
    expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM review_assignments").get()).toEqual({ count: 0 });
  });
});
