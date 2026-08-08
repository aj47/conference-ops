import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { prepareScheduledReminders } from "../../src/jobs/reminders";
import type { Bindings } from "../../src/server/env";

type SqlValue = string | number | bigint | Uint8Array | null;

class TestStatement {
  private values: SqlValue[] = [];

  constructor(private readonly database: DatabaseSync, private readonly sql: string) {}

  bind(...values: SqlValue[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[] };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
}

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL, deleted_at INTEGER);
    CREATE TABLE communication_schedules (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, kind TEXT NOT NULL, enabled INTEGER NOT NULL,
      offset_days INTEGER NOT NULL, last_run_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE (event_id, kind)
    );
    CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE speaker_tasks (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL,
      status TEXT NOT NULL, due_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE message_templates (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, kind TEXT NOT NULL,
      subject TEXT NOT NULL, text TEXT NOT NULL, html TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
    CREATE TABLE submission_forms (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL, closes_at INTEGER
    );
    CREATE TABLE form_versions (id TEXT PRIMARY KEY, form_id TEXT NOT NULL);
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
      form_version_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL
    );
    CREATE TABLE outbox (
      id TEXT PRIMARY KEY, event_id TEXT, kind TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL, available_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  return sqlite;
}

describe("scheduled communication rules", () => {
  it("ages due tasks, creates real deduplicated task and draft email jobs, and records the run", async () => {
    const now = Date.UTC(2030, 0, 10, 12);
    const day = 86_400_000;
    const sqlite = database();
    sqlite.exec(`
      INSERT INTO events VALUES ('event-a', 'Conference A', 'conference-a', NULL);
      INSERT INTO communication_schedules VALUES
        ('rule-task', 'event-a', 'task_overdue', 1, 2, NULL, 1, 1),
        ('rule-draft', 'event-a', 'cfp_draft', 1, 2, NULL, 1, 1);
      INSERT INTO speaker_profiles VALUES ('speaker-a', 'event-a', 'Speaker A', 'speaker@example.test');
      INSERT INTO speaker_tasks VALUES ('task-a', 'event-a', 'speaker-a', 'in_progress', ${now - 3 * day}, 1);
      INSERT INTO message_templates VALUES (
        'template-reminder', 'event-a', 'reminder',
        'Tasks · {{event.name}}',
        'Hi {{speaker.name}}, finish {{task.count}} task(s): {{speaker.portal_url}}',
        '<p>Hi {{speaker.name}}, finish {{task.count}} task(s): <a href="{{speaker.portal_url}}">portal</a></p>',
        1
      );
      INSERT INTO users VALUES ('applicant-a', 'Applicant A', 'applicant@example.test');
      INSERT INTO submission_forms VALUES ('form-a', 'event-a', 'cfp', 'published', ${now + day});
      INSERT INTO form_versions VALUES ('version-a', 'form-a');
      INSERT INTO proposals VALUES ('proposal-a', 'event-a', 'applicant-a', 'version-a', 'A useful draft', 'draft');
    `);
    const db = { prepare: (sql: string) => new TestStatement(sqlite, sql) } as unknown as D1Database;
    const env = { DB: db, PUBLIC_APP_URL: "https://conference.example.test" } as Bindings;

    expect(await prepareScheduledReminders(env, now)).toEqual({ created: 2, rules: 2 });
    expect(await prepareScheduledReminders(env, now)).toEqual({ created: 0, rules: 2 });
    expect(sqlite.prepare("SELECT status FROM speaker_tasks WHERE id = 'task-a'").get()).toEqual({ status: "overdue" });
    expect(sqlite.prepare("SELECT kind, status FROM outbox ORDER BY idempotency_key").all()).toEqual([
      { kind: "email", status: "queued" },
      { kind: "email", status: "queued" },
    ]);
    const payloads = sqlite.prepare("SELECT payload FROM outbox ORDER BY idempotency_key").all() as Array<{ payload: string }>;
    expect(payloads.map(({ payload }) => JSON.parse(payload))).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipient: "applicant@example.test", text: expect.stringContaining("/submit/conference-a?edit=proposal-a") }),
      expect.objectContaining({ recipient: "speaker@example.test", subject: "Tasks · Conference A", text: expect.stringContaining("task(s): https://conference.example.test/portal/tasks?eventId=event-a&role=speaker") }),
    ]));
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM communication_schedules WHERE last_run_at = ?").get(now)).toEqual({ count: 2 });
  });
});
