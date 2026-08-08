import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: {
      getSession: async () => ({ user: { id: "user-a", name: "Speaker A", email: "speaker-a@example.com" } }),
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
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT);
    CREATE TABLE submission_forms (id TEXT PRIMARY KEY, event_id TEXT NOT NULL);
    CREATE TABLE form_versions (id TEXT PRIMARY KEY, form_id TEXT NOT NULL, fields TEXT NOT NULL, settings TEXT NOT NULL);
    CREATE TABLE task_templates (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      completion_mode TEXT NOT NULL,
      form_version_id TEXT
    );
    CREATE TABLE speaker_tasks (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      template_id TEXT,
      speaker_profile_id TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      artifact_upload_id TEXT,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE uploads (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      purpose TEXT NOT NULL,
      deleted_at INTEGER
    );
    CREATE TABLE task_responses (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      respondent_user_id TEXT NOT NULL,
      responses TEXT NOT NULL,
      status TEXT NOT NULL,
      submitted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    INSERT INTO event_memberships VALUES ('event-a', 'user-a', 'speaker');
    INSERT INTO speaker_profiles VALUES
      ('speaker-a', 'event-a', 'user-a'),
      ('speaker-other', 'event-a', 'user-other'),
      ('speaker-b', 'event-b', 'user-a');
    INSERT INTO submission_forms VALUES ('form-a', 'event-a'), ('form-b', 'event-b');
    INSERT INTO form_versions VALUES
      ('version-a', 'form-a', '[]', '{}'),
      ('version-b', 'form-b', '[]', '{}');
    INSERT INTO task_templates VALUES
      ('manual-a', 'event-a', 'manual', NULL),
      ('manual-b', 'event-b', 'manual', NULL),
      ('upload-a', 'event-a', 'file_request', NULL),
      ('upload-b', 'event-b', 'file_request', NULL),
      ('form-a', 'event-a', 'form', 'version-a'),
      ('form-b', 'event-b', 'form', 'version-b');
    INSERT INTO speaker_tasks VALUES
      ('task-manual-a', 'event-a', 'manual-a', 'speaker-a', 'profile', 'not_started', NULL, NULL, 1),
      ('task-manual-other', 'event-a', 'manual-a', 'speaker-other', 'profile', 'not_started', NULL, NULL, 1),
      ('task-manual-b', 'event-b', 'manual-b', 'speaker-b', 'profile', 'not_started', NULL, NULL, 1),
      ('task-upload-a', 'event-a', 'upload-a', 'speaker-a', 'upload', 'not_started', NULL, NULL, 1),
      ('task-upload-other', 'event-a', 'upload-a', 'speaker-other', 'upload', 'not_started', NULL, NULL, 1),
      ('task-upload-b', 'event-b', 'upload-b', 'speaker-b', 'upload', 'not_started', NULL, NULL, 1),
      ('task-form-a', 'event-a', 'form-a', 'speaker-a', 'form', 'not_started', NULL, NULL, 1),
      ('task-form-other', 'event-a', 'form-a', 'speaker-other', 'form', 'not_started', NULL, NULL, 1),
      ('task-form-b', 'event-b', 'form-b', 'speaker-b', 'form', 'not_started', NULL, NULL, 1);
    INSERT INTO uploads VALUES
      ('upload-owned-a', 'event-a', 'user-a', 'slides', NULL),
      ('upload-supporting-a', 'event-a', 'user-a', 'supporting_document', NULL),
      ('upload-headshot-a', 'event-a', 'user-a', 'headshot', NULL),
      ('upload-other-a', 'event-a', 'user-other', 'slides', NULL),
      ('upload-owned-b', 'event-b', 'user-a', 'slides', NULL);
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

function post(d1: TestD1Database, taskId: string, action: "complete" | "artifact" | "response", body: unknown) {
  return app.request(`http://localhost/api/v1/events/event-a/tasks/${taskId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }, bindings(d1));
}

describe("speaker task mutation API scoping", () => {
  let d1: TestD1Database;

  beforeEach(() => {
    d1 = createDatabase();
  });

  it("rejects cross-event and cross-account task, artifact, and form mutations", async () => {
    const completeOtherEvent = await post(d1, "task-manual-b", "complete", { complete: true });
    const completeOtherAccount = await post(d1, "task-manual-other", "complete", { complete: true });
    const artifactOtherEventTask = await post(d1, "task-upload-b", "artifact", { uploadId: "upload-owned-a" });
    const artifactOtherEventUpload = await post(d1, "task-upload-a", "artifact", { uploadId: "upload-owned-b" });
    const artifactOtherAccount = await post(d1, "task-upload-other", "artifact", { uploadId: "upload-owned-a" });
    const artifactOtherAccountUpload = await post(d1, "task-upload-a", "artifact", { uploadId: "upload-other-a" });
    const formOtherEvent = await post(d1, "task-form-b", "response", { responses: {}, submit: false });
    const formOtherAccount = await post(d1, "task-form-other", "response", { responses: {}, submit: false });

    expect([completeOtherEvent.status, completeOtherAccount.status]).toEqual([409, 409]);
    expect([artifactOtherEventTask.status, artifactOtherEventUpload.status, artifactOtherAccount.status, artifactOtherAccountUpload.status]).toEqual([422, 422, 422, 422]);
    expect([formOtherEvent.status, formOtherAccount.status]).toEqual([404, 404]);
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM speaker_tasks WHERE status <> 'not_started' OR artifact_upload_id IS NOT NULL").get()).toEqual({ count: 0 });
    expect(d1.database.prepare("SELECT COUNT(*) AS count FROM task_responses").get()).toEqual({ count: 0 });
  });

  it("persists each mutation for the signed-in speaker inside the requested event", async () => {
    const completed = await post(d1, "task-manual-a", "complete", { complete: true });
    const artifact = await post(d1, "task-upload-a", "artifact", { uploadId: "upload-owned-a" });
    const form = await post(d1, "task-form-a", "response", { responses: {}, submit: false });

    expect([completed.status, artifact.status, form.status]).toEqual([200, 200, 200]);
    expect(d1.database.prepare("SELECT status, artifact_upload_id FROM speaker_tasks WHERE id = 'task-upload-a'").get()).toEqual({ status: "complete", artifact_upload_id: "upload-owned-a" });
    expect(d1.database.prepare("SELECT status FROM speaker_tasks WHERE id = 'task-form-a'").get()).toEqual({ status: "in_progress" });
    expect(d1.database.prepare("SELECT task_id, respondent_user_id, status FROM task_responses").get()).toEqual({ task_id: "task-form-a", respondent_user_id: "user-a", status: "draft" });
  });

  it("accepts task-compatible files but rejects a profile headshot as task evidence", async () => {
    const headshot = await post(d1, "task-upload-a", "artifact", { uploadId: "upload-headshot-a" });
    const supporting = await post(d1, "task-upload-a", "artifact", { uploadId: "upload-supporting-a" });

    expect(headshot.status).toBe(422);
    expect(await headshot.json()).toMatchObject({ error: { code: "TASK_ARTIFACT_INVALID" } });
    expect(supporting.status).toBe(200);
    expect(d1.database.prepare("SELECT status, artifact_upload_id FROM speaker_tasks WHERE id = 'task-upload-a'").get()).toEqual({ status: "complete", artifact_upload_id: "upload-supporting-a" });
  });
});
