import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

const authUser = vi.hoisted(() => ({
  id: "applicant-a",
  name: "Applicant A",
  email: "applicant@example.com",
}));

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: {
      getSession: async () => ({ user: { ...authUser } }),
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
    if (this.owner.staleSubmissionCountReads > 0 && this.sql.includes("SUM(CASE WHEN p.status = 'draft'")) {
      this.owner.staleSubmissionCountReads -= 1;
      return { drafts: 0, submitted: 0 } as T;
    }
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
  staleSubmissionCountReads = 0;

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
    CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE submission_forms (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL,
      published_version INTEGER NOT NULL,
      collects_participants INTEGER NOT NULL,
      closes_at INTEGER,
      max_submissions_per_user INTEGER,
      confirmation_email_enabled INTEGER NOT NULL
    );
    CREATE TABLE form_versions (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      fields TEXT NOT NULL,
      settings TEXT NOT NULL,
      confirmation_copy TEXT NOT NULL,
      max_speakers INTEGER NOT NULL,
      allow_multiple_drafts INTEGER NOT NULL
    );
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      form_version_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      reviewer_group_id TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      category TEXT NOT NULL,
      format TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      level TEXT NOT NULL,
      responses TEXT NOT NULL,
      status TEXT NOT NULL,
      submitted_at INTEGER,
      version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE reviewer_groups (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, category TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE reviewer_group_members (reviewer_group_id TEXT NOT NULL, user_id TEXT NOT NULL);
    CREATE TABLE proposal_reviewer_groups (
      proposal_id TEXT NOT NULL,
      reviewer_group_id TEXT NOT NULL,
      PRIMARY KEY (proposal_id, reviewer_group_id)
    );
    CREATE TABLE review_rounds (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, round INTEGER NOT NULL, rubric TEXT NOT NULL, status TEXT NOT NULL);
    CREATE TABLE speaker_profiles (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      event_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      title TEXT NOT NULL,
      company TEXT NOT NULL,
      bio TEXT NOT NULL,
      profile_complete INTEGER NOT NULL,
      published INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE proposal_speakers (proposal_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL, sort_order INTEGER NOT NULL, PRIMARY KEY (proposal_id, speaker_profile_id));
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (proposal_id, round_id, reviewer_user_id)
    );
    CREATE TABLE outbox (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      kind TEXT NOT NULL,
      idempotency_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      status TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      available_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE message_templates (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      kind TEXT,
      subject TEXT NOT NULL,
      html TEXT NOT NULL,
      text TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO events VALUES ('event-a', 'Conference A');
    INSERT INTO event_memberships VALUES
      ('event-a', 'applicant-a', 'applicant'),
      ('event-a', 'reviewer-a', 'reviewer'),
      ('event-a', 'reviewer-b', 'reviewer'),
      ('event-a', 'reviewer-history', 'reviewer');
    INSERT INTO submission_forms VALUES ('form-a', 'event-a', 'published', 1, 1, 4102444800000, 3, 1);
    INSERT INTO form_versions VALUES (
      'form-version-a',
      'form-a',
      1,
      '[{"id":"field-category","label":"Program category","type":"select","required":true,"section":"proposal","options":["Build"]}]',
      '{}',
      'Your proposal is in review.',
      4,
      1
    );
    INSERT INTO proposals VALUES (
      'proposal-a', 'event-a', 'form-version-a', 'applicant-a', NULL,
      'Old draft title', 'An old summary long enough to be valid.', 'Build', 'talk', 30, 'intermediate', '{}',
      'draft', NULL, 1, 1, 1
    );
    INSERT INTO reviewer_groups VALUES ('group-build', 'event-a', 'Build', 1);
    INSERT INTO proposal_reviewer_groups VALUES ('proposal-a', 'group-build');
    INSERT INTO reviewer_group_members VALUES ('group-build', 'reviewer-a'), ('group-build', 'reviewer-b');
    INSERT INTO review_rounds VALUES ('round-a', 'event-a', 1, '[{"id":"fit","label":"Program fit","weight":1,"maxScore":5}]', 'active');
    INSERT INTO speaker_profiles VALUES
      ('speaker-primary', 'applicant-a', 'event-a', 'Old Applicant', 'applicant@example.com', '', '', '', 0, 0, 1, 1),
      ('speaker-old-co', NULL, 'event-a', 'Old Co-speaker', 'old@example.com', '', '', '', 0, 0, 1, 1);
    INSERT INTO proposal_speakers VALUES ('proposal-a', 'speaker-primary', 0), ('proposal-a', 'speaker-old-co', 1);
  `);
  d1.database.prepare("UPDATE form_versions SET settings = ? WHERE id = 'form-version-a'").run(JSON.stringify({
    submissionControls: {
      submissionType: "abstract",
      collectsParticipants: true,
      maxSubmissionsPerUser: 3,
      redirectToPortal: true,
      confirmationEmailEnabled: true,
      closesAt: "2100-01-01T00:00:00.000Z",
    },
  }));
  return d1;
}

function bindings(d1: TestD1Database): Bindings {
  return {
    DB: d1 as unknown as D1Database,
    UPLOADS: {} as R2Bucket,
    JOBS_QUEUE: { send: vi.fn(async () => undefined) } as unknown as Queue,
    ENVIRONMENT: "local",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.test",
    BETTER_AUTH_URL: "https://conference.example.test",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-api-tests",
    MAIL_FROM: "Conference Ops <program@example.test>",
    MAIL_REPLY_TO: "program@example.test",
  };
}

const submissionBody = {
  expectedVersion: 1,
  title: "Atomic conference proposal",
  summary: "A complete summary with enough concrete detail for submission.",
  category: "Build",
  format: "talk",
  durationMinutes: 30,
  level: "intermediate",
  responses: { "field-category": "Build" },
  speakers: [
    { name: "Applicant A", email: "applicant@example.com", title: "Engineer", company: "Example", bio: "Primary speaker bio" },
    { name: "New Co-speaker", email: "new@example.com", title: "Researcher", company: "Example", bio: "Co-speaker bio" },
  ],
  submit: true,
};

function newSubmissionBody(submit: boolean, coSpeakerEmail: string) {
  return {
    formId: "form-a",
    title: submit ? "Submitted concurrent proposal" : "Concurrent draft proposal",
    summary: "A complete summary with enough concrete detail for a new submission.",
    category: "Build",
    format: "talk",
    durationMinutes: 30,
    level: "intermediate",
    responses: { "field-category": "Build" },
    speakers: [
      { name: "Applicant A", email: "applicant@example.com", title: "Engineer", company: "Example", bio: "Primary speaker bio" },
      { name: "Concurrent Co-speaker", email: coSpeakerEmail, title: "Researcher", company: "Example", bio: "Co-speaker bio" },
    ],
    submit,
  };
}

function setNewSubmissionPolicy(d1: TestD1Database, maxSubmissionsPerUser: number, allowMultipleDrafts: boolean) {
  const stored = d1.database.prepare("SELECT settings FROM form_versions WHERE id = 'form-version-a'").get() as { settings: string };
  const settings = JSON.parse(stored.settings) as Record<string, unknown>;
  d1.database.prepare("UPDATE submission_forms SET max_submissions_per_user = ? WHERE id = 'form-a'").run(maxSubmissionsPerUser);
  d1.database.prepare("UPDATE form_versions SET allow_multiple_drafts = ?, settings = ? WHERE id = 'form-version-a'").run(
    allowMultipleDrafts ? 1 : 0,
    JSON.stringify({
      ...settings,
      submissionControls: {
        ...(settings.submissionControls as Record<string, unknown>),
        maxSubmissionsPerUser,
      },
    }),
  );
}

function setParticipantMinimum(d1: TestD1Database, participantMin: number, collectsParticipants: boolean) {
  const stored = d1.database.prepare("SELECT settings FROM form_versions WHERE id = 'form-version-a'").get() as { settings: string };
  const settings = JSON.parse(stored.settings) as Record<string, unknown>;
  d1.database.prepare("UPDATE submission_forms SET collects_participants = ? WHERE id = 'form-a'").run(collectsParticipants ? 1 : 0);
  d1.database.prepare("UPDATE form_versions SET settings = ? WHERE id = 'form-version-a'").run(JSON.stringify({
    ...settings,
    participantMin,
    submissionControls: {
      ...(settings.submissionControls as Record<string, unknown>),
      collectsParticipants,
    },
  }));
}

function apiRequest(d1: TestD1Database, path: string, init: RequestInit) {
  return app.request(`http://localhost${path}`, init, bindings(d1));
}

describe("production proposal lifecycle API", () => {
  beforeEach(() => {
    authUser.id = "applicant-a";
    authUser.name = "Applicant A";
    authUser.email = "applicant@example.com";
  });

  it("submits a saved draft with roster, assignments, status, and confirmation outbox in one batch", async () => {
    const d1 = createDatabase();
    const response = await apiRequest(d1, "/api/v1/events/event-a/submissions/proposal-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submissionBody),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { id: "proposal-a", status: "under_review", assignments: 2, version: 2, confirmationQueued: true },
    });
    expect(d1.database.prepare("SELECT title, status, version, reviewer_group_id FROM proposals WHERE id = 'proposal-a'").get()).toEqual({
      title: "Atomic conference proposal",
      status: "under_review",
      version: 2,
      reviewer_group_id: "group-build",
    });
    expect(d1.database.prepare("SELECT reviewer_user_id, status FROM review_assignments ORDER BY reviewer_user_id").all()).toEqual([
      { reviewer_user_id: "reviewer-a", status: "pending" },
      { reviewer_user_id: "reviewer-b", status: "pending" },
    ]);
    expect(d1.database.prepare(`SELECT sp.email FROM proposal_speakers ps JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id
      WHERE ps.proposal_id = 'proposal-a' ORDER BY ps.sort_order`).all()).toEqual([
      { email: "applicant@example.com" },
      { email: "new@example.com" },
    ]);
    expect(d1.database.prepare("SELECT idempotency_key, status FROM outbox").all()).toEqual([
      { idempotency_key: "submission-confirmation:proposal-a", status: "queued" },
    ]);
  });

  it("does not assign a reviewer to a proposal they submit themselves", async () => {
    const d1 = createDatabase();
    authUser.id = "reviewer-a";
    authUser.name = "Reviewer A";
    authUser.email = "reviewer@example.com";
    const body = {
      ...newSubmissionBody(true, "reviewer-co-speaker@example.com"),
      speakers: [
        { name: "Reviewer A", email: "reviewer@example.com", title: "Reviewer", company: "Example", bio: "Reviewer speaker bio" },
        { name: "Co-speaker", email: "reviewer-co-speaker@example.com", title: "Engineer", company: "Example", bio: "Co-speaker bio" },
      ],
    };

    const response = await apiRequest(d1, "/api/v1/events/event-a/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { data: { id: string; assignments: number; status: string } };

    expect(response.status).toBe(201);
    expect(payload.data).toMatchObject({ assignments: 1, status: "under_review" });
    expect(d1.database.prepare("SELECT reviewer_user_id FROM review_assignments WHERE proposal_id = ?").all(payload.data.id)).toEqual([
      { reviewer_user_id: "reviewer-b" },
    ]);
  });

  it("routes one submission to the union of reviewers covering every selected track", async () => {
    const d1 = createDatabase();
    d1.database.prepare("UPDATE form_versions SET fields = ? WHERE id = 'form-version-a'").run(JSON.stringify([
      { id: "field-category", label: "Program category", type: "multi_select", required: true, section: "proposal", options: ["Build", "Evaluate"] },
    ]));
    d1.database.exec(`
      INSERT INTO reviewer_groups VALUES ('group-evaluate', 'event-a', 'Evaluate', 1);
      INSERT INTO reviewer_group_members VALUES ('group-evaluate', 'reviewer-history');
    `);
    const body = {
      ...newSubmissionBody(true, "multi-track@example.com"),
      category: "Forged lane that must be ignored",
      responses: { "field-category": ["Build", "Evaluate"] },
    };

    const response = await apiRequest(d1, "/api/v1/events/event-a/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { data: { id: string } };

    expect(response.status).toBe(201);
    expect(d1.database.prepare("SELECT category FROM proposals WHERE id = ?").get(payload.data.id)).toEqual({ category: "Build, Evaluate" });
    expect(d1.database.prepare("SELECT reviewer_group_id FROM proposal_reviewer_groups WHERE proposal_id = ? ORDER BY reviewer_group_id").all(payload.data.id)).toEqual([
      { reviewer_group_id: "group-build" },
      { reviewer_group_id: "group-evaluate" },
    ]);
    expect(d1.database.prepare("SELECT reviewer_user_id FROM review_assignments WHERE proposal_id = ? ORDER BY reviewer_user_id").all(payload.data.id)).toEqual([
      { reviewer_user_id: "reviewer-a" },
      { reviewer_user_id: "reviewer-b" },
      { reviewer_user_id: "reviewer-history" },
    ]);
  });

  it("does not assign a claimed co-speaker to review the proposal", async () => {
    const d1 = createDatabase();
    d1.database.prepare(`INSERT INTO speaker_profiles
      (id, user_id, event_id, name, email, title, company, bio, profile_complete, published, created_at, updated_at)
      VALUES ('speaker-reviewer-a', 'reviewer-a', 'event-a', 'Reviewer A', 'reviewer@example.com', '', '', '', 0, 0, 1, 1)`).run();
    const body = {
      ...submissionBody,
      speakers: [
        submissionBody.speakers[0],
        { ...submissionBody.speakers[1], name: "Reviewer A", email: "reviewer@example.com" },
      ],
    };

    const response = await apiRequest(d1, "/api/v1/events/event-a/submissions/proposal-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { assignments: 1, status: "under_review" } });
    expect(d1.database.prepare("SELECT reviewer_user_id FROM review_assignments WHERE proposal_id = 'proposal-a'").all()).toEqual([
      { reviewer_user_id: "reviewer-b" },
    ]);
  });

  it("validates an older draft with its pinned controls after live form controls change", async () => {
    const d1 = createDatabase();
    d1.database.exec("UPDATE submission_forms SET collects_participants = 0, closes_at = 1, confirmation_email_enabled = 0 WHERE id = 'form-a'");

    const response = await apiRequest(d1, "/api/v1/events/event-a/submissions/proposal-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submissionBody),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: "under_review", confirmationQueued: true } });
    expect(d1.database.prepare("SELECT status, version FROM proposals WHERE id = 'proposal-a'").get()).toEqual({ status: "under_review", version: 2 });
    expect(d1.database.prepare("SELECT idempotency_key FROM outbox").get()).toEqual({ idempotency_key: "submission-confirmation:proposal-a" });
  });

  it("enforces the configured participant minimum on both new and saved submissions", async () => {
    const d1 = createDatabase();
    setParticipantMinimum(d1, 3, true);

    const created = await apiRequest(d1, "/api/v1/events/event-a/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newSubmissionBody(false, "minimum-co-speaker@example.com")),
    });
    const updated = await apiRequest(d1, "/api/v1/events/event-a/submissions/proposal-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submissionBody),
    });

    expect([created.status, updated.status]).toEqual([422, 422]);
    expect(await created.json()).toMatchObject({ error: { code: "SPEAKER_MINIMUM" } });
    expect(await updated.json()).toMatchObject({ error: { code: "SPEAKER_MINIMUM" } });
    expect(d1.database.prepare("SELECT title, status, version FROM proposals WHERE id = 'proposal-a'").get()).toEqual({ title: "Old draft title", status: "draft", version: 1 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM proposals").get()).toEqual({ count: 1 });
  });

  it("does not apply the participant minimum when participant collection is disabled", async () => {
    const d1 = createDatabase();
    setParticipantMinimum(d1, 3, false);
    const primaryOnly = [submissionBody.speakers[0]];

    const created = await apiRequest(d1, "/api/v1/events/event-a/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...newSubmissionBody(false, "unused@example.com"), speakers: primaryOnly }),
    });
    const updated = await apiRequest(d1, "/api/v1/events/event-a/submissions/proposal-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...submissionBody, speakers: primaryOnly, submit: false }),
    });

    expect([created.status, updated.status]).toEqual([201, 200]);
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM proposal_speakers WHERE proposal_id = 'proposal-a'").get()).toEqual({ count: 1 });
  });

  it("enforces the one-draft policy inside the insert despite a stale preflight and leaves no orphans", async () => {
    const d1 = createDatabase();
    d1.database.exec("DELETE FROM proposal_speakers; DELETE FROM proposals;");
    setNewSubmissionPolicy(d1, 3, false);

    const first = await apiRequest(d1, "/api/v1/events/event-a/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newSubmissionBody(false, "first-draft@example.com")),
    });
    expect(first.status).toBe(201);

    d1.staleSubmissionCountReads = 1;
    const rejected = await apiRequest(d1, "/api/v1/events/event-a/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newSubmissionBody(false, "rejected-draft@example.com")),
    });

    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: { code: "DRAFT_ALREADY_EXISTS" } });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM proposals").get()).toEqual({ count: 1 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM proposal_speakers").get()).toEqual({ count: 2 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM speaker_profiles WHERE email = 'rejected-draft@example.com'").get()).toEqual({ count: 0 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM review_assignments").get()).toEqual({ count: 0 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM outbox").get()).toEqual({ count: 0 });
  });

  it("enforces the account cap inside the insert despite a stale preflight and guards every side effect", async () => {
    const d1 = createDatabase();
    d1.database.exec("DELETE FROM proposal_speakers; DELETE FROM proposals;");
    setNewSubmissionPolicy(d1, 1, true);

    const first = await apiRequest(d1, "/api/v1/events/event-a/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newSubmissionBody(true, "first-submitted@example.com")),
    });
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ data: { status: "under_review", assignments: 2, confirmationQueued: true } });

    d1.staleSubmissionCountReads = 1;
    const rejected = await apiRequest(d1, "/api/v1/events/event-a/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(newSubmissionBody(true, "rejected-submitted@example.com")),
    });

    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: { code: "SUBMISSION_LIMIT_REACHED" } });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM proposals").get()).toEqual({ count: 1 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM proposal_speakers").get()).toEqual({ count: 2 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM speaker_profiles WHERE email = 'rejected-submitted@example.com'").get()).toEqual({ count: 0 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM review_assignments").get()).toEqual({ count: 2 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM outbox").get()).toEqual({ count: 1 });
    const confirmation = d1.database.prepare("SELECT payload FROM outbox").get() as { payload: string };
    expect(JSON.parse(confirmation.payload)).toMatchObject({
      text: expect.stringContaining("https://conference.example.test/portal/home?eventId=event-a&role=applicant"),
      html: expect.stringContaining("https://conference.example.test/portal/home?eventId=event-a&amp;role=applicant"),
    });
  });

  it("rolls the draft, roster, assignments, and outbox back together when assignment materialization fails", async () => {
    const d1 = createDatabase();
    d1.failRunMatching = /INSERT OR IGNORE INTO review_assignments/;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await apiRequest(d1, "/api/v1/events/event-a/submissions/proposal-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submissionBody),
    });
    logged.mockRestore();

    expect(response.status).toBe(500);
    expect(d1.database.prepare("SELECT title, status, version FROM proposals WHERE id = 'proposal-a'").get()).toEqual({
      title: "Old draft title",
      status: "draft",
      version: 1,
    });
    expect(d1.database.prepare(`SELECT sp.email FROM proposal_speakers ps JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id
      WHERE ps.proposal_id = 'proposal-a' ORDER BY ps.sort_order`).all()).toEqual([
      { email: "applicant@example.com" },
      { email: "old@example.com" },
    ]);
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM speaker_profiles").get()).toEqual({ count: 2 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM review_assignments").get()).toEqual({ count: 0 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM outbox").get()).toEqual({ count: 0 });
  });

  it("withdraws atomically, revokes open work, preserves submitted history, and rejects later reviewer writes", async () => {
    const d1 = createDatabase();
    d1.database.exec(`
      UPDATE proposals SET status = 'under_review' WHERE id = 'proposal-a';
      INSERT INTO review_assignments VALUES
        ('review-pending', 'proposal-a', 'round-a', 'reviewer-a', 'pending', '{}', NULL, NULL, NULL, NULL, 1, 1),
        ('review-progress', 'proposal-a', 'round-a', 'reviewer-b', 'in_progress', '{"fit":4}', 4, 'yes', 'A useful draft note.', NULL, 1, 1),
        ('review-submitted', 'proposal-a', 'round-a', 'reviewer-history', 'submitted', '{"fit":5}', 5, 'strong_yes', 'A complete submitted review.', 2, 1, 2);
    `);

    const withdrawn = await apiRequest(d1, "/api/v1/events/event-a/submissions/proposal-a/withdraw", { method: "POST" });
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toMatchObject({ data: { id: "proposal-a", status: "withdrawn", revokedAssignments: 2 } });
    expect(d1.database.prepare("SELECT status, version FROM proposals WHERE id = 'proposal-a'").get()).toEqual({ status: "withdrawn", version: 2 });
    expect(d1.database.prepare("SELECT id, status FROM review_assignments").all()).toEqual([
      { id: "review-submitted", status: "submitted" },
    ]);

    authUser.id = "reviewer-history";
    authUser.name = "Historical Reviewer";
    authUser.email = "reviewer-history@example.com";
    const review = await apiRequest(d1, "/api/v1/events/event-a/proposals/proposal-a/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scores: { fit: 5 }, recommendation: "strong_yes", notes: "This should not be accepted now.", submit: true }),
    });

    expect(review.status).toBe(409);
    expect(await review.json()).toMatchObject({ error: { code: "REVIEW_PROPOSAL_LOCKED" } });
    expect(d1.database.prepare("SELECT status, notes FROM review_assignments WHERE id = 'review-submitted'").get()).toEqual({
      status: "submitted",
      notes: "A complete submitted review.",
    });
  });
});
