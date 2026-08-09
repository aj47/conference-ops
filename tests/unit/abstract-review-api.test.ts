import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

const authState = vi.hoisted(() => ({ user: { id: "organizer-a", name: "Jordan Alvarez", email: "jordan@example.test" } }));
vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({ api: { getSession: async () => ({ user: authState.user }) }, handler: async () => new Response(null, { status: 404 }) }),
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
  async batch(statements: Statement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.sqlite.exec("COMMIT"); return results; }
    catch (error) { this.sqlite.exec("ROLLBACK"); throw error; }
  }
}

function fixture() {
  const d1 = new TestD1();
  d1.sqlite.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT NOT NULL, deleted_at INTEGER);
    CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, accepted_at INTEGER);
    CREATE TABLE review_rounds (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, round INTEGER NOT NULL, rubric TEXT NOT NULL, opens_at INTEGER, closes_at INTEGER, anonymized INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE review_round_reviewers (round_id TEXT NOT NULL, reviewer_user_id TEXT NOT NULL, assignment_cap INTEGER NOT NULL DEFAULT 25, created_at INTEGER NOT NULL, PRIMARY KEY (round_id, reviewer_user_id));
    CREATE TABLE proposals (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, category TEXT NOT NULL, status TEXT NOT NULL, owner_user_id TEXT NOT NULL, review_cycle INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT);
    CREATE TABLE proposal_speakers (proposal_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL, participant_role TEXT NOT NULL DEFAULT 'Presenter');
    CREATE TABLE review_assignments (id TEXT PRIMARY KEY, proposal_id TEXT NOT NULL, round_id TEXT NOT NULL, reviewer_user_id TEXT NOT NULL, review_cycle INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL, scores TEXT NOT NULL, total_score REAL, recommendation TEXT, notes TEXT, recused_at INTEGER, recusal_reason TEXT, submitted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (proposal_id, round_id, reviewer_user_id, review_cycle));
    CREATE TABLE ai_review_evaluations (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, proposal_id TEXT NOT NULL, round_id TEXT NOT NULL, score REAL NOT NULL, rationale TEXT NOT NULL, model_label TEXT NOT NULL, overridden_score REAL, override_reason TEXT, overridden_by TEXT, overridden_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, UNIQUE (proposal_id, round_id));
    CREATE TABLE outbox (id TEXT PRIMARY KEY, event_id TEXT, kind TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, available_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO events VALUES ('event-a', 'DevFlow Conf 2027', NULL);
    INSERT INTO user VALUES ('organizer-a', 'Jordan Alvarez', 'jordan@example.test'), ('reviewer-a', 'Sam Whitfield', 'sam@example.test'), ('reviewer-b', 'Morgan Lee', 'morgan@example.test');
    INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'organizer', 1), ('event-a', 'reviewer-a', 'reviewer', 1), ('event-a', 'reviewer-b', 'reviewer', 1);
    INSERT INTO proposals VALUES
      ('proposal-ci', 'event-a', 'Taming 40-Minute CI', 'Incremental builds and cache verification at monorepo scale.', 'Platform & Infra', 'submitted', 'speaker-a', 1),
      ('proposal-ai', 'event-a', 'Your AI Pair Programmer Is Lying', 'Verification patterns for production AI engineering teams.', 'AI Engineering', 'submitted', 'speaker-b', 1),
      ('proposal-docs', 'event-a', 'Docs That Answer Back', 'Retrieval-grounded documentation with observable citations.', 'Developer Experience', 'submitted', 'speaker-c', 1);
  `);
  return d1;
}

function bindings(d1: TestD1): Bindings {
  return { DB: d1 as unknown as D1Database, UPLOADS: {} as R2Bucket, ENVIRONMENT: "local", DEMO_MODE: "false", PUBLIC_APP_URL: "https://conference.example.test", BETTER_AUTH_URL: "https://conference.example.test", BETTER_AUTH_SECRET: "test-secret-long-enough-for-api-tests", MAIL_FROM: "program@example.test", MAIL_REPLY_TO: "program@example.test" };
}

function request(d1: TestD1, path: string, init: RequestInit = {}, role = "organizer") {
  return app.request(`http://localhost/api/v1/events/event-a${path}`, { ...init, headers: { "content-type": "application/json", "x-event-role": role, ...init.headers } }, bindings(d1));
}

const initialPlan = {
  name: "Initial Review", status: "active", opensAt: "2026-08-01T00:00:00.000Z", closesAt: "2026-10-15T23:59:00.000Z", anonymized: true,
  reviewerIds: ["reviewer-a"], reviewerCaps: { "reviewer-a": 5 },
  rubric: [
    { id: "originality", label: "Originality", type: "numeric", weight: 2, maxScore: 5 },
    { id: "relevance", label: "Relevance", type: "numeric", weight: 1, maxScore: 5 },
    { id: "recommendation", label: "Recommendation", type: "dropdown", weight: 1, maxScore: 5, options: ["Accept", "Maybe", "Reject"] },
    { id: "comments", label: "Comments", type: "text", weight: 1, maxScore: 5 },
  ],
};

describe("abstract review depth API", () => {
  let d1: TestD1;
  beforeEach(() => { d1 = fixture(); authState.user = { id: "organizer-a", name: "Jordan Alvarez", email: "jordan@example.test" }; });

  it("persists two dated rounds with independent scorecards, privacy, and reviewer pools", async () => {
    const first = await request(d1, "/review-plans", { method: "POST", body: JSON.stringify(initialPlan) });
    const second = await request(d1, "/review-plans", { method: "POST", body: JSON.stringify({ ...initialPlan, name: "Final Review", status: "draft", opensAt: "2026-10-16T00:00:00.000Z", closesAt: "2026-11-30T23:59:00.000Z", anonymized: false, reviewerIds: ["reviewer-b"], reviewerCaps: { "reviewer-b": 3 }, rubric: [{ id: "final", label: "Final Score", type: "numeric", weight: 1, maxScore: 10 }, { id: "comments", label: "Comments", type: "text", weight: 1, maxScore: 5 }] }) });
    const reloaded = await request(d1, "/review-plans");
    const payload = await reloaded.json() as { data: { plans: Array<{ name: string; anonymized: boolean; reviewerIds: string[]; reviewerCaps: Record<string, number>; rubric: Array<{ type: string }> }> } };
    expect([first.status, second.status, reloaded.status]).toEqual([201, 201, 200]);
    expect(payload.data.plans).toMatchObject([
      { name: "Initial Review", anonymized: true, reviewerIds: ["reviewer-a"], reviewerCaps: { "reviewer-a": 5 }, rubric: [{ type: "numeric" }, { type: "numeric" }, { type: "dropdown" }, { type: "text" }] },
      { name: "Final Review", anonymized: false, reviewerIds: ["reviewer-b"], reviewerCaps: { "reviewer-b": 3 }, rubric: [{ type: "numeric" }, { type: "text" }] },
    ]);
  });

  it("targets exactly two submissions, reports round-specific aggregate progress, and queues reminders", async () => {
    const created = await request(d1, "/review-plans", { method: "POST", body: JSON.stringify(initialPlan) });
    const roundId = (await created.json() as { data: { id: string } }).data.id;
    const assigned = await request(d1, "/abstract-review/assignments", { method: "PUT", body: JSON.stringify({ roundId, reviewerId: "reviewer-a", proposalIds: ["proposal-ci", "proposal-ai"], assignmentCap: 5 }) });
    d1.sqlite.prepare("UPDATE review_assignments SET status = 'submitted', scores = ?, total_score = 3.33, submitted_at = 10 WHERE proposal_id = 'proposal-ci'").run(JSON.stringify({ originality: 4, relevance: 2, recommendation: "Accept", comments: "Strong evidence" }));
    const overviewBefore = await request(d1, "/abstract-review");
    const overview = await overviewBefore.json() as { data: { assignments: Array<{ proposalId: string; status: string }>; results: Array<{ proposalId: string; roundId: string; aggregateScore: number; reviewCount: number }> } };
    const reminded = await request(d1, "/abstract-review/reminders", { method: "POST", body: JSON.stringify({ roundId, reviewerIds: ["reviewer-a"] }) });
    expect(assigned.status).toBe(200);
    expect(overview.data.assignments.map((item) => item.proposalId).sort()).toEqual(["proposal-ai", "proposal-ci"]);
    expect(overview.data.results).toEqual([{ proposalId: "proposal-ci", roundId, aggregateScore: 3.33, reviewCount: 1 }]);
    expect(reminded.status).toBe(202);
    expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM outbox").get()).toEqual({ count: 1 });
  });

  it("enforces the stored round cap instead of a client-supplied cap", async () => {
    const created = await request(d1, "/review-plans", {
      method: "POST",
      body: JSON.stringify({ ...initialPlan, reviewerCaps: { "reviewer-a": 1 } }),
    });
    const roundId = (await created.json() as { data: { id: string } }).data.id;

    const response = await request(d1, "/abstract-review/assignments", {
      method: "PUT",
      body: JSON.stringify({ roundId, reviewerId: "reviewer-a", proposalIds: ["proposal-ci", "proposal-ai"], assignmentCap: 500 }),
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "REVIEW_ASSIGNMENT_CAP" } });
    expect(d1.sqlite.prepare("SELECT assignment_cap FROM review_round_reviewers WHERE round_id = ? AND reviewer_user_id = 'reviewer-a'").get(roundId)).toEqual({ assignment_cap: 1 });
    expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM review_assignments").get()).toEqual({ count: 0 });
  });

  it("refuses an exact-set update that would silently omit immutable submitted evidence", async () => {
    const created = await request(d1, "/review-plans", { method: "POST", body: JSON.stringify(initialPlan) });
    const roundId = (await created.json() as { data: { id: string } }).data.id;
    await request(d1, "/abstract-review/assignments", {
      method: "PUT",
      body: JSON.stringify({ roundId, reviewerId: "reviewer-a", proposalIds: ["proposal-ci", "proposal-ai"], assignmentCap: 5 }),
    });
    d1.sqlite.prepare("UPDATE review_assignments SET status = 'submitted', submitted_at = 10 WHERE proposal_id = 'proposal-ci'").run();

    const response = await request(d1, "/abstract-review/assignments", {
      method: "PUT",
      body: JSON.stringify({ roundId, reviewerId: "reviewer-a", proposalIds: ["proposal-ai"], assignmentCap: 500 }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "REVIEW_ASSIGNMENT_IMMUTABLE" } });
    expect(d1.sqlite.prepare("SELECT proposal_id, status FROM review_assignments ORDER BY proposal_id").all()).toEqual([
      { proposal_id: "proposal-ai", status: "pending" },
      { proposal_id: "proposal-ci", status: "submitted" },
    ]);
  });

  it("removes pending work and revokes queue access when a reviewer leaves a round pool", async () => {
    const created = await request(d1, "/review-plans", { method: "POST", body: JSON.stringify(initialPlan) });
    const roundId = (await created.json() as { data: { id: string } }).data.id;
    await request(d1, "/abstract-review/assignments", {
      method: "PUT",
      body: JSON.stringify({ roundId, reviewerId: "reviewer-a", proposalIds: ["proposal-ci", "proposal-ai"], assignmentCap: 5 }),
    });
    d1.sqlite.prepare("UPDATE review_assignments SET status = 'submitted', submitted_at = 10 WHERE proposal_id = 'proposal-ci'").run();

    const updated = await request(d1, `/review-plans/${roundId}`, {
      method: "PUT",
      body: JSON.stringify({ ...initialPlan, reviewerIds: ["reviewer-b"], reviewerCaps: { "reviewer-b": 3 } }),
    });
    expect(updated.status).toBe(200);
    expect(d1.sqlite.prepare("SELECT proposal_id, status FROM review_assignments ORDER BY proposal_id").all()).toEqual([
      { proposal_id: "proposal-ci", status: "submitted" },
    ]);

    authState.user = { id: "reviewer-a", name: "Sam Whitfield", email: "sam@example.test" };
    const directWrite = await request(d1, "/proposals/proposal-ci/review", {
      method: "POST",
      body: JSON.stringify({ scores: {}, recommendation: "yes", notes: "Attempt after pool removal.", submit: false }),
    }, "reviewer");
    expect(directWrite.status).toBe(404);
    expect(await directWrite.json()).toMatchObject({ error: { code: "REVIEW_ASSIGNMENT_NOT_FOUND" } });
  });

  it("records reviewer recusal without altering submitted reviews", async () => {
    const created = await request(d1, "/review-plans", { method: "POST", body: JSON.stringify(initialPlan) });
    const roundId = (await created.json() as { data: { id: string } }).data.id;
    await request(d1, "/abstract-review/assignments", { method: "PUT", body: JSON.stringify({ roundId, reviewerId: "reviewer-a", proposalIds: ["proposal-ci"], assignmentCap: 5 }) });
    authState.user = { id: "reviewer-a", name: "Sam Whitfield", email: "sam@example.test" };
    const response = await request(d1, "/proposals/proposal-ci/review/recuse", { method: "POST", body: JSON.stringify({ reason: "I advised this speaker on the submitted work." }) }, "reviewer");
    expect(response.status).toBe(200);
    expect(d1.sqlite.prepare("SELECT recusal_reason, status FROM review_assignments").get()).toEqual({ recusal_reason: "I advised this speaker on the submitted work.", status: "pending" });
  });

  it("stores a distinguishable AI first pass, persists human override, and exports formula-safe criteria", async () => {
    const created = await request(d1, "/review-plans", { method: "POST", body: JSON.stringify(initialPlan) });
    const roundId = (await created.json() as { data: { id: string } }).data.id;
    const evaluated = await request(d1, "/proposals/proposal-ci/ai-evaluation", { method: "POST", body: JSON.stringify({ roundId }) });
    const evaluation = (await evaluated.json() as { data: { id: string; rationale: string; score: number } }).data;
    const overridden = await request(d1, `/ai-evaluations/${evaluation.id}/override`, { method: "PUT", body: JSON.stringify({ score: 2.5, reason: "Committee has direct evidence that the method is already common." }) });
    d1.sqlite.prepare("UPDATE proposals SET title = '\t=CMD()' WHERE id = 'proposal-ci'").run();
    d1.sqlite.prepare("INSERT INTO review_assignments VALUES ('review-export', 'proposal-ci', ?, 'reviewer-a', 1, 'submitted', ?, 3.33, 'yes', '@IMPORTXML(\"https://example.test\")', NULL, NULL, 10, 1, 1)").run(roundId, JSON.stringify({ originality: 4, relevance: 2, recommendation: "Accept", comments: "+SUM(1,1)" }));
    const exported = await request(d1, "/exports/reviews.csv");
    const csv = await exported.text();
    expect(evaluated.status).toBe(201);
    expect(evaluation.rationale).toMatch(/incremental|builds|monorepo/i);
    expect(overridden.status).toBe(200);
    expect(d1.sqlite.prepare("SELECT overridden_score, override_reason FROM ai_review_evaluations").get()).toEqual({ overridden_score: 2.5, override_reason: "Committee has direct evidence that the method is already common." });
    expect(exported.headers.get("content-disposition")).toContain("review-results.csv");
    expect(csv).toContain(`"'\t=CMD()"`);
    expect(csv).toContain(`"'+SUM(1,1)"`);
    expect(csv).toContain(`"'@IMPORTXML(""https://example.test"")"`);
  });
});
