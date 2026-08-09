import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    CREATE TABLE submission_forms (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL,
      kind TEXT NOT NULL, target_type TEXT NOT NULL, submission_type TEXT NOT NULL,
      collects_participants INTEGER NOT NULL, status TEXT NOT NULL, current_version INTEGER NOT NULL,
      published_version INTEGER, redirect_to_portal INTEGER NOT NULL, confirmation_email_enabled INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE form_versions (
      id TEXT PRIMARY KEY, form_id TEXT NOT NULL, version INTEGER NOT NULL,
      public_title TEXT NOT NULL, page_heading TEXT NOT NULL, welcome_title TEXT NOT NULL,
      welcome_copy TEXT NOT NULL, confirmation_copy TEXT NOT NULL, max_speakers INTEGER NOT NULL,
      allow_multiple_drafts INTEGER NOT NULL, fields TEXT NOT NULL, settings TEXT NOT NULL,
      published_at INTEGER, created_by TEXT, created_at INTEGER NOT NULL,
      UNIQUE (form_id, version)
    );
    CREATE TABLE file_requests (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, instructions_html TEXT NOT NULL,
      target_type TEXT NOT NULL, required INTEGER NOT NULL, status TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE task_templates (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      type TEXT NOT NULL, target_type TEXT NOT NULL, completion_mode TEXT NOT NULL,
      relative_due_days INTEGER NOT NULL, external_url TEXT, form_version_id TEXT, file_request_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE speaker_tasks (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, template_id TEXT);
    CREATE TABLE message_templates (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, kind TEXT, name TEXT NOT NULL,
      subject TEXT NOT NULL, html TEXT NOT NULL, text TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE communication_schedules (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, kind TEXT NOT NULL, enabled INTEGER NOT NULL,
      offset_days INTEGER NOT NULL, last_run_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (event_id, kind)
    );
    INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'organizer');
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

function request(d1: TestD1, path: string, method: "POST" | "PUT" | "DELETE", body?: unknown) {
  return app.request(`http://localhost/api/v1/events/event-a${path}`, {
    method,
    headers: { "content-type": "application/json", "x-event-role": "organizer" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, bindings(d1));
}

describe("organizer program configuration API", () => {
  let d1: TestD1;

  beforeEach(() => {
    d1 = fixture();
  });

  it("creates and versions a persistent speaker questionnaire, then safely removes an unused template", async () => {
    const created = await request(d1, "/task-templates", "POST", {
      title: "Hotel stay requirements",
      description: "Tell the team whether you need a room.",
      type: "form",
      targetType: "contact",
      relativeDueDays: 21,
      fields: [
        { id: "hotel-needed", label: "Do you need a hotel?", type: "checkbox", required: true, section: "proposal" },
        { id: "hotel-type", label: "Room type", type: "select", required: false, section: "proposal", options: ["Single", "Shared"], condition: { sourceFieldId: "hotel-needed", operator: "equals", value: "true" } },
      ],
    });
    const createdPayload = await created.json() as { data: { id: string; formId: string } };

    expect(created.status).toBe(201);
    expect(createdPayload.data.formId).toBeTruthy();
    expect(d1.sqlite.prepare("SELECT kind, status, current_version, published_version FROM submission_forms").get()).toEqual({ kind: "portal", status: "published", current_version: 1, published_version: 1 });
    expect(JSON.parse((d1.sqlite.prepare("SELECT fields FROM form_versions").get() as { fields: string }).fields)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "hotel-type", options: ["Single", "Shared"] }),
    ]));

    const updated = await request(d1, `/task-templates/${createdPayload.data.id}`, "PUT", {
      title: "Travel and hotel requirements",
      description: "Share current travel and lodging needs.",
      type: "form",
      targetType: "contact",
      relativeDueDays: 18,
      fields: [
        { id: "travel-mode", label: "Primary travel mode", type: "select", required: true, section: "proposal", options: ["Flight", "Rail", "Drive"] },
      ],
    });

    expect(updated.status).toBe(200);
    expect(d1.sqlite.prepare("SELECT current_version, published_version FROM submission_forms").get()).toEqual({ current_version: 2, published_version: 2 });
    expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM form_versions").get()).toEqual({ count: 2 });
    expect(d1.sqlite.prepare("SELECT title, relative_due_days FROM task_templates").get()).toEqual({ title: "Travel and hotel requirements", relative_due_days: 18 });

    const removed = await request(d1, `/task-templates/${createdPayload.data.id}`, "DELETE");
    expect(removed.status).toBe(200);
    expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM task_templates").get()).toEqual({ count: 0 });
  });

  it("persists one editable template per message kind and one scheduled rule per automation kind", async () => {
    const message = {
      name: "Acceptance decision",
      subject: "Welcome to {{event.name}}",
      text: "Hi {{speaker.name}}, open {{speaker.portal_url}}",
      html: "<p>Hi {{speaker.name}}, open <a href=\"{{speaker.portal_url}}\">your portal</a>.</p>",
    };
    expect((await request(d1, "/message-templates/acceptance", "PUT", message)).status).toBe(200);
    expect((await request(d1, "/message-templates/acceptance", "PUT", { ...message, subject: "You're in · {{event.name}}" })).status).toBe(200);
    expect(d1.sqlite.prepare("SELECT kind, subject FROM message_templates").all()).toEqual([
      { kind: "acceptance", subject: "You're in · {{event.name}}" },
    ]);

    expect((await request(d1, "/reminder-rules/task_overdue", "PUT", { enabled: true, offsetDays: 2 })).status).toBe(200);
    expect((await request(d1, "/reminder-rules/task_overdue", "PUT", { enabled: false, offsetDays: 4 })).status).toBe(200);
    expect(d1.sqlite.prepare("SELECT kind, enabled, offset_days FROM communication_schedules").all()).toEqual([
      { kind: "task_overdue", enabled: 0, offset_days: 4 },
    ]);
  });

  it("accepts HTTPS action links only for manual tasks", async () => {
    const valid = await request(d1, "/task-templates", "POST", {
      title: "Confirm attendance",
      description: "Open the scheduling page, confirm, then mark this task complete.",
      type: "calendar",
      targetType: "contact",
      relativeDueDays: 7,
      externalUrl: "https://schedule.example.test/speaker/confirm",
    });
    const insecure = await request(d1, "/task-templates", "POST", {
      title: "Insecure attendance",
      description: "This link must be rejected.",
      type: "calendar",
      targetType: "contact",
      relativeDueDays: 7,
      externalUrl: "http://schedule.example.test/speaker/confirm",
    });
    const linkedUpload = await request(d1, "/task-templates", "POST", {
      title: "Upload with unrelated link",
      description: "This task already has a file action.",
      type: "upload",
      targetType: "submission",
      relativeDueDays: 7,
      externalUrl: "https://schedule.example.test/unrelated",
    });

    expect(valid.status).toBe(201);
    expect(insecure.status).toBe(400);
    expect(linkedUpload.status).toBe(400);
    expect(d1.sqlite.prepare("SELECT completion_mode, external_url FROM task_templates").get()).toEqual({
      completion_mode: "manual",
      external_url: "https://schedule.example.test/speaker/confirm",
    });
  });
});
