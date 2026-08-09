import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get("x-test-user") ?? "user-a";
        return { user: { id, name: id === "organizer-a" ? "Organizer A" : "Speaker A", email: `${id}@example.com` } };
      },
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
    CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT);
    CREATE TABLE submission_forms (id TEXT PRIMARY KEY, event_id TEXT NOT NULL);
    CREATE TABLE form_versions (id TEXT PRIMARY KEY, form_id TEXT NOT NULL, fields TEXT NOT NULL, settings TEXT NOT NULL);
    CREATE TABLE task_templates (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      completion_mode TEXT NOT NULL,
      form_version_id TEXT,
      file_request_id TEXT
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
      object_key TEXT,
      file_name TEXT,
      content_type TEXT,
      purpose TEXT NOT NULL,
      deleted_at INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE file_requests (id TEXT PRIMARY KEY, event_id TEXT NOT NULL);
    CREATE TABLE file_request_responses (
      id TEXT PRIMARY KEY,
      file_request_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      uploader_user_id TEXT NOT NULL,
      upload_ids TEXT NOT NULL,
      submitted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (file_request_id, target_id)
    );
    CREATE TABLE task_comments (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      author_user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
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

    INSERT INTO event_memberships VALUES
      ('event-a', 'user-a', 'speaker'),
      ('event-a', 'organizer-a', 'organizer');
    INSERT INTO user VALUES ('user-a', 'Speaker A'), ('organizer-a', 'Organizer A');
    INSERT INTO speaker_profiles VALUES
      ('speaker-a', 'event-a', 'user-a'),
      ('speaker-other', 'event-a', 'user-other'),
      ('speaker-b', 'event-b', 'user-a');
    INSERT INTO submission_forms VALUES ('form-a', 'event-a'), ('form-b', 'event-b');
    INSERT INTO form_versions VALUES
      ('version-a', 'form-a', '[]', '{}'),
      ('version-b', 'form-b', '[]', '{}');
    INSERT INTO file_requests VALUES ('request-a', 'event-a'), ('request-b', 'event-b');
    INSERT INTO task_templates VALUES
      ('manual-a', 'event-a', 'manual', NULL, NULL),
      ('manual-b', 'event-b', 'manual', NULL, NULL),
      ('upload-a', 'event-a', 'file_request', NULL, 'request-a'),
      ('upload-b', 'event-b', 'file_request', NULL, 'request-b'),
      ('form-a', 'event-a', 'form', 'version-a', NULL),
      ('form-b', 'event-b', 'form', 'version-b', NULL);
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
      ('upload-owned-a', 'event-a', 'user-a', 'event-a/user-a/upload-owned-a', 'slides-v1.pdf', 'application/pdf', 'slides', NULL, 100),
      ('upload-supporting-a', 'event-a', 'user-a', 'event-a/user-a/upload-supporting-a', 'slides-v2.pdf', 'application/pdf', 'supporting_document', NULL, 200),
      ('upload-headshot-a', 'event-a', 'user-a', 'event-a/user-a/upload-headshot-a', 'headshot.png', 'image/png', 'headshot', NULL, 100),
      ('upload-other-a', 'event-a', 'user-other', 'event-a/user-other/upload-other-a', 'other.pdf', 'application/pdf', 'slides', NULL, 100),
      ('upload-owned-b', 'event-b', 'user-a', 'event-b/user-a/upload-owned-b', 'event-b.pdf', 'application/pdf', 'slides', NULL, 100);
  `);
  return d1;
}

function bindings(d1: TestD1Database): Bindings {
  return {
    DB: d1 as unknown as D1Database,
    UPLOADS: {
      get: async (key: string) => ({
        body: new TextEncoder().encode(`stored:${key}`),
        httpEtag: '"task-artifact-etag"',
        writeHttpMetadata: (headers: Headers) => headers.set("content-type", "application/pdf"),
      }),
    } as unknown as R2Bucket,
    ENVIRONMENT: "local",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.test",
    BETTER_AUTH_URL: "https://conference.example.test",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-api-tests",
    MAIL_FROM: "program@example.test",
    MAIL_REPLY_TO: "program@example.test",
  };
}

function post(d1: TestD1Database, taskId: string, action: "complete" | "artifact" | "response" | "comments", body: unknown, userId = "user-a") {
  return app.request(`http://localhost/api/v1/events/event-a/tasks/${taskId}/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user": userId },
    body: JSON.stringify(body),
  }, bindings(d1));
}

function download(d1: TestD1Database, taskId: string, uploadId: string, userId = "user-a") {
  return app.request(`http://localhost/api/v1/events/event-a/tasks/${taskId}/artifacts/${uploadId}`, {
    headers: { "x-test-user": userId },
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
    expect(JSON.parse((d1.database.prepare("SELECT upload_ids FROM file_request_responses").get() as { upload_ids: string }).upload_ids)).toEqual(["upload-owned-a"]);
  });

  it("accepts task-compatible files but rejects a profile headshot as task evidence", async () => {
    const headshot = await post(d1, "task-upload-a", "artifact", { uploadId: "upload-headshot-a" });
    const supporting = await post(d1, "task-upload-a", "artifact", { uploadId: "upload-supporting-a" });

    expect(headshot.status).toBe(422);
    expect(await headshot.json()).toMatchObject({ error: { code: "TASK_ARTIFACT_INVALID" } });
    expect(supporting.status).toBe(200);
    expect(d1.database.prepare("SELECT status, artifact_upload_id FROM speaker_tasks WHERE id = 'task-upload-a'").get()).toEqual({ status: "complete", artifact_upload_id: "upload-supporting-a" });
  });

  it("keeps file replacements in chronological order without duplicating retries", async () => {
    expect((await post(d1, "task-upload-a", "artifact", { uploadId: "upload-owned-a" })).status).toBe(200);
    expect((await post(d1, "task-upload-a", "artifact", { uploadId: "upload-supporting-a" })).status).toBe(200);
    expect((await post(d1, "task-upload-a", "artifact", { uploadId: "upload-supporting-a" })).status).toBe(200);

    const stored = d1.database.prepare("SELECT upload_ids FROM file_request_responses WHERE target_id = 'task-upload-a'").get() as { upload_ids: string };
    expect(JSON.parse(stored.upload_ids)).toEqual(["upload-owned-a", "upload-supporting-a"]);
  });

  it("downloads an earlier version only through its authorized task history", async () => {
    await post(d1, "task-upload-a", "artifact", { uploadId: "upload-owned-a" });
    await post(d1, "task-upload-a", "artifact", { uploadId: "upload-supporting-a" });

    const prior = await download(d1, "task-upload-a", "upload-owned-a");
    const wrongTask = await download(d1, "task-upload-other", "upload-owned-a");
    const unrelated = await download(d1, "task-upload-a", "upload-other-a");
    const organizer = await download(d1, "task-upload-a", "upload-owned-a", "organizer-a");

    expect([prior.status, organizer.status]).toEqual([200, 200]);
    expect([wrongTask.status, unrelated.status]).toEqual([404, 404]);
    expect(prior.headers.get("content-disposition")).toContain("slides-v1.pdf");
    expect(prior.headers.get("cache-control")).toBe("private, no-store");
  });

  it("lets the task owner and organizer comment but hides another speaker's task", async () => {
    const owner = await post(d1, "task-upload-a", "comments", { body: "  Can you confirm the PDF opened?  " });
    const organizer = await post(d1, "task-upload-a", "comments", { body: "Confirmed — the deck is readable." }, "organizer-a");
    const otherTask = await post(d1, "task-upload-other", "comments", { body: "I should not be able to post here." });

    expect([owner.status, organizer.status, otherTask.status]).toEqual([201, 201, 404]);
    expect(await owner.json()).toMatchObject({ data: { authorName: "Speaker A", body: "Can you confirm the PDF opened?" } });
    const comments = d1.database.prepare("SELECT author_user_id, body FROM task_comments").all();
    expect(comments).toHaveLength(2);
    expect(comments).toEqual(expect.arrayContaining([
      { author_user_id: "organizer-a", body: "Confirmed — the deck is readable." },
      { author_user_id: "user-a", body: "Can you confirm the PDF opened?" },
    ]));
  });
});
