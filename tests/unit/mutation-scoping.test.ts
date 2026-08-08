import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  isProfileComplete,
  publishFormEventSql,
  publishFormVersionSql,
  publishSubmissionFormSql,
  reopenSpeakerTaskSql,
  reopenTaskResponseSql,
} from "../../src/server/mutations";

describe("event-scoped mutation SQL", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE submission_forms (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        status TEXT NOT NULL,
        current_version INTEGER NOT NULL,
        published_version INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE form_versions (
        id TEXT PRIMARY KEY,
        form_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        published_at INTEGER
      );
      CREATE TABLE speaker_tasks (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        status TEXT NOT NULL,
        completed_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE task_responses (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        status TEXT NOT NULL,
        submitted_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      INSERT INTO events VALUES ('event-a', 'draft', 1), ('event-b', 'draft', 1);
      INSERT INTO submission_forms VALUES
        ('form-a', 'event-a', 'draft', 1, NULL, 1),
        ('form-b', 'event-b', 'draft', 1, NULL, 1);
      INSERT INTO form_versions VALUES
        ('version-a-1', 'form-a', 1, NULL),
        ('version-b-1', 'form-b', 1, NULL);
      INSERT INTO speaker_tasks VALUES
        ('task-a', 'event-a', 'complete', 10, 10),
        ('task-b', 'event-b', 'complete', 10, 10);
      INSERT INTO task_responses VALUES
        ('response-a', 'task-a', 'submitted', 10, 10),
        ('response-b', 'task-b', 'submitted', 10, 10);
    `);
  });

  it("does not publish another event's form or advance the caller event", () => {
    const now = 20;
    const version = db.prepare(publishFormVersionSql).run(now, "form-b", 1, "event-a", 1);
    const form = db.prepare(publishSubmissionFormSql).run(1, 1, now, "form-b", "event-a", 1, 1);
    const event = db.prepare(publishFormEventSql).run(now, "event-a", "form-b", 1, 1);

    expect(version.changes).toBe(0);
    expect(form.changes).toBe(0);
    expect(event.changes).toBe(0);
    expect(db.prepare("SELECT published_at FROM form_versions WHERE id = 'version-b-1'").get()).toEqual({ published_at: null });
    expect(db.prepare("SELECT status, updated_at FROM events WHERE id = 'event-a'").get()).toEqual({ status: "draft", updated_at: 1 });
  });

  it("publishes only a current version belonging to the event", () => {
    const now = 20;
    expect(db.prepare(publishFormVersionSql).run(now, "form-a", 1, "event-a", 1).changes).toBe(1);
    expect(db.prepare(publishSubmissionFormSql).run(1, 1, now, "form-a", "event-a", 1, 1).changes).toBe(1);
    expect(db.prepare(publishFormEventSql).run(now, "event-a", "form-a", 1, 1).changes).toBe(1);

    expect(db.prepare("SELECT status, published_version FROM submission_forms WHERE id = 'form-a'").get()).toEqual({ status: "published", published_version: 1 });
    expect(db.prepare("SELECT status FROM events WHERE id = 'event-a'").get()).toEqual({ status: "cfp_open" });
    expect(db.prepare("SELECT status FROM events WHERE id = 'event-b'").get()).toEqual({ status: "draft" });
  });

  it("cannot reopen a response through a task in another event", () => {
    const now = 20;
    expect(db.prepare(reopenSpeakerTaskSql).run(now, "task-b", "event-a").changes).toBe(0);
    expect(db.prepare(reopenTaskResponseSql).run(now, "task-b", "event-a").changes).toBe(0);

    expect(db.prepare("SELECT status, completed_at FROM speaker_tasks WHERE id = 'task-b'").get()).toEqual({ status: "complete", completed_at: 10 });
    expect(db.prepare("SELECT status, submitted_at FROM task_responses WHERE id = 'response-b'").get()).toEqual({ status: "submitted", submitted_at: 10 });
  });

  it("reopens the event-scoped task and its response together", () => {
    const now = 20;
    expect(db.prepare(reopenSpeakerTaskSql).run(now, "task-a", "event-a").changes).toBe(1);
    expect(db.prepare(reopenTaskResponseSql).run(now, "task-a", "event-a").changes).toBe(1);

    expect(db.prepare("SELECT status, completed_at FROM speaker_tasks WHERE id = 'task-a'").get()).toEqual({ status: "in_progress", completed_at: null });
    expect(db.prepare("SELECT status, submitted_at FROM task_responses WHERE id = 'response-a'").get()).toEqual({ status: "draft", submitted_at: null });
  });
});

describe("speaker profile completeness", () => {
  it("preserves completeness when a bio edit omits an existing headshot ID", () => {
    expect(isProfileComplete("Updated biography", undefined, "upload-existing")).toBe(true);
  });

  it("still requires both biography and an effective headshot", () => {
    expect(isProfileComplete("", undefined, "upload-existing")).toBe(false);
    expect(isProfileComplete("Biography", undefined, null)).toBe(false);
    expect(isProfileComplete("Biography", "upload-new", null)).toBe(true);
  });
});
