import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: {
      getSession: async () => ({ user: { id: "reviewer-a", name: "Reviewer A", email: "reviewer@example.com" } }),
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
    if (this.owner.failRunMatching?.test(this.sql)) throw new Error("Injected review persistence failure");
    if (this.owner.noOpRunMatching?.test(this.sql)) return { success: true, meta: { changes: 0 }, results: [] };
    const result = this.owner.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
}

class TestD1Database {
  readonly database = new DatabaseSync(":memory:");
  failRunMatching?: RegExp;
  noOpRunMatching?: RegExp;

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
    CREATE TABLE events (id TEXT PRIMARY KEY);
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      review_cycle INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT);
    CREATE TABLE proposal_speakers (proposal_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);
    CREATE TABLE review_rounds (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      rubric TEXT NOT NULL,
      status TEXT NOT NULL
    );
    CREATE TABLE review_assignments (
      id TEXT PRIMARY KEY,
      proposal_id TEXT NOT NULL,
      round_id TEXT NOT NULL,
      reviewer_user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      scores TEXT NOT NULL,
      total_score REAL,
      recommendation TEXT,
      notes TEXT,
      submitted_at INTEGER,
      updated_at INTEGER NOT NULL,
      review_cycle INTEGER NOT NULL DEFAULT 1
    );

    INSERT INTO events VALUES ('event-a');
    INSERT INTO event_memberships VALUES ('event-a', 'reviewer-a', 'reviewer');
    INSERT INTO proposals VALUES
      ('proposal-reviewable', 'event-a', 'applicant-a', 'submitted', 1, 1, 1),
      ('proposal-final', 'event-a', 'applicant-b', 'accepted', 2, 2, 1),
      ('proposal-self-owned', 'event-a', 'reviewer-a', 'submitted', 1, 1, 1),
      ('proposal-self-speaking', 'event-a', 'applicant-c', 'submitted', 1, 1, 1);
    INSERT INTO speaker_profiles VALUES ('speaker-reviewer-a', 'event-a', 'reviewer-a');
    INSERT INTO proposal_speakers VALUES ('proposal-self-speaking', 'speaker-reviewer-a');
    INSERT INTO review_rounds VALUES ('round-a', 'event-a', 1, '[{"id":"fit","label":"Program fit","weight":1,"maxScore":5}]', 'active');
    INSERT INTO review_assignments VALUES
      ('review-reviewable', 'proposal-reviewable', 'round-a', 'reviewer-a', 'pending', '{}', NULL, NULL, NULL, NULL, 1, 1),
      ('review-final', 'proposal-final', 'round-a', 'reviewer-a', 'pending', '{}', NULL, NULL, NULL, NULL, 1, 1),
      ('review-self-owned', 'proposal-self-owned', 'round-a', 'reviewer-a', 'pending', '{}', NULL, NULL, NULL, NULL, 1, 1),
      ('review-self-speaking', 'proposal-self-speaking', 'round-a', 'reviewer-a', 'pending', '{}', NULL, NULL, NULL, NULL, 1, 1);
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

function review(d1: TestD1Database, proposalId: string, submit: boolean, notes: string) {
  return app.request(`http://localhost/api/v1/events/event-a/proposals/${proposalId}/review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scores: { fit: 4 }, recommendation: "yes", notes, submit }),
  }, bindings(d1));
}

describe("review lifecycle immutability", () => {
  let d1: TestD1Database;

  beforeEach(() => {
    d1 = createDatabase();
  });

  it("allows pending to draft to submitted, then rejects any overwrite of the submitted review", async () => {
    const draft = await review(d1, "proposal-reviewable", false, "Initial evidence note.");
    expect(d1.database.prepare("SELECT status, version FROM proposals WHERE id = 'proposal-reviewable'").get()).toEqual({ status: "submitted", version: 1 });
    const submitted = await review(d1, "proposal-reviewable", true, "Final immutable evidence.");
    const overwrite = await review(d1, "proposal-reviewable", true, "Attempted changed evidence.");

    expect(draft.status).toBe(200);
    expect(submitted.status).toBe(200);
    expect(overwrite.status).toBe(409);
    expect((await overwrite.json() as { error: { code: string } }).error.code).toBe("REVIEW_ALREADY_SUBMITTED");
    expect(d1.database.prepare("SELECT status, scores, total_score, recommendation, notes FROM review_assignments WHERE id = 'review-reviewable'").get()).toEqual({
      status: "submitted",
      scores: '{"fit":4}',
      total_score: 4,
      recommendation: "yes",
      notes: "Final immutable evidence.",
    });
    expect(d1.database.prepare("SELECT status, version FROM proposals WHERE id = 'proposal-reviewable'").get()).toEqual({ status: "under_review", version: 2 });
  });

  it("submits a final review without another proposal version bump when review is already underway", async () => {
    d1.database.exec("UPDATE proposals SET status = 'under_review', version = 4 WHERE id = 'proposal-reviewable'");

    const response = await review(d1, "proposal-reviewable", true, "Final evidence after another reviewer began.");

    expect(response.status).toBe(200);
    expect(d1.database.prepare("SELECT status, version FROM proposals WHERE id = 'proposal-reviewable'").get()).toEqual({ status: "under_review", version: 4 });
    expect(d1.database.prepare("SELECT status FROM review_assignments WHERE id = 'review-reviewable'").get()).toEqual({ status: "submitted" });
  });

  it("rolls the immutable review back when submitted-proposal promotion throws", async () => {
    d1.failRunMatching = /UPDATE proposals SET status = 'under_review'/;

    const response = await review(d1, "proposal-reviewable", true, "Final evidence that must remain atomic.");

    expect(response.status).toBe(500);
    expect(d1.database.prepare("SELECT status, version FROM proposals WHERE id = 'proposal-reviewable'").get()).toEqual({ status: "submitted", version: 1 });
    expect(d1.database.prepare("SELECT status, scores, notes FROM review_assignments WHERE id = 'review-reviewable'").get()).toEqual({ status: "pending", scores: "{}", notes: null });
  });

  it("forces a rollback and conflict when submitted-proposal promotion unexpectedly changes no row", async () => {
    d1.noOpRunMatching = /UPDATE proposals SET status = 'under_review'/;

    const response = await review(d1, "proposal-reviewable", true, "Final evidence guarded by the rollback sentinel.");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "REVIEW_LOCKED" } });
    expect(d1.database.prepare("SELECT status, version FROM proposals WHERE id = 'proposal-reviewable'").get()).toEqual({ status: "submitted", version: 1 });
    expect(d1.database.prepare("SELECT status, scores, notes FROM review_assignments WHERE id = 'review-reviewable'").get()).toEqual({ status: "pending", scores: "{}", notes: null });
  });

  it("rejects a pending review once its proposal has a final decision", async () => {
    const response = await review(d1, "proposal-final", true, "Too late to change evidence.");

    expect(response.status).toBe(409);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("REVIEW_PROPOSAL_LOCKED");
    expect(d1.database.prepare("SELECT status, scores, notes FROM review_assignments WHERE id = 'review-final'").get()).toEqual({ status: "pending", scores: "{}", notes: null });
  });

  it("rejects legacy assignments when the reviewer owns or speaks on the proposal", async () => {
    const ownerResponse = await review(d1, "proposal-self-owned", true, "Attempted owner self-review.");
    const speakerResponse = await review(d1, "proposal-self-speaking", true, "Attempted speaker self-review.");

    expect([ownerResponse.status, speakerResponse.status]).toEqual([404, 404]);
    expect(await ownerResponse.json()).toMatchObject({ error: { code: "REVIEW_ASSIGNMENT_NOT_FOUND" } });
    expect(await speakerResponse.json()).toMatchObject({ error: { code: "REVIEW_ASSIGNMENT_NOT_FOUND" } });
    expect(d1.database.prepare("SELECT id, status, scores, notes FROM review_assignments WHERE id IN ('review-self-owned', 'review-self-speaking') ORDER BY id").all()).toEqual([
      { id: "review-self-owned", status: "pending", scores: "{}", notes: null },
      { id: "review-self-speaking", status: "pending", scores: "{}", notes: null },
    ]);
  });
});
