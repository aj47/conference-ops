import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  AgendaPublishError,
  agendaContentApprovalBindings,
  agendaEventPublishBindings,
  agendaSessionPublishBindings,
  approveAgendaContentSql,
  normalizeAgendaSessionIds,
  publishAgendaEventSql,
  publishAgendaSessionsSql,
  validateAgendaPublishSelection,
  type AgendaPublishSessionRow,
} from "../../src/server/agenda-publish";

describe("agenda publish selection", () => {
  const scheduled = (overrides: Partial<AgendaPublishSessionRow> = {}): AgendaPublishSessionRow => ({
    id: "session-a",
    eventId: "event-a",
    status: "scheduled",
    startsAt: 100,
    endsAt: 200,
    ...overrides,
  });

  it("trims and de-duplicates explicitly selected IDs", () => {
    expect(normalizeAgendaSessionIds([" session-a ", "session-b", "session-a"])).toEqual(["session-a", "session-b"]);
  });

  it("rejects empty selections and blank IDs", () => {
    expect(() => normalizeAgendaSessionIds([])).toThrowError(expect.objectContaining({ code: "AGENDA_EMPTY" }));
    expect(() => normalizeAgendaSessionIds([" "])).toThrowError(expect.objectContaining({ code: "AGENDA_SESSION_ID_INVALID" }));
  });

  it("rejects missing, foreign, and unscheduled explicit targets", () => {
    expect(() => validateAgendaPublishSelection("event-a", ["missing"], [])).toThrowError(
      expect.objectContaining({ code: "AGENDA_SESSION_NOT_FOUND", sessionIds: ["missing"] }),
    );
    expect(() => validateAgendaPublishSelection("event-a", ["foreign"], [scheduled({ id: "foreign", eventId: "event-b" })])).toThrowError(
      expect.objectContaining({ code: "AGENDA_SESSION_OUTSIDE_EVENT", sessionIds: ["foreign"] }),
    );
    expect(() => validateAgendaPublishSelection("event-a", ["draft"], [scheduled({ id: "draft", status: "unscheduled" })])).toThrowError(
      expect.objectContaining({ code: "AGENDA_SESSION_UNSCHEDULED", sessionIds: ["draft"] }),
    );
    expect(() => validateAgendaPublishSelection("event-a", ["invalid-time"], [scheduled({ id: "invalid-time", endsAt: 100 })])).toThrowError(
      expect.objectContaining({ code: "AGENDA_SESSION_UNSCHEDULED", sessionIds: ["invalid-time"] }),
    );
  });

  it("accepts scheduled sessions and previously published sessions with valid times", () => {
    expect(validateAgendaPublishSelection(
      "event-a",
      ["session-a", "session-published"],
      [scheduled(), scheduled({ id: "session-published", status: "published" })],
    )).toEqual(["session-a", "session-published"]);
  });

  it("uses the empty-agenda error for publish-all when no scheduled rows exist", () => {
    expect(() => validateAgendaPublishSelection("event-a", undefined, [])).toThrowError(AgendaPublishError);
    expect(() => validateAgendaPublishSelection("event-a", undefined, [])).toThrowError(expect.objectContaining({ code: "AGENDA_EMPTY" }));
  });
});

describe("guarded agenda publication SQL", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE events (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        public_agenda_revision INTEGER NOT NULL,
        deleted_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE program_sessions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        status TEXT NOT NULL,
        starts_at INTEGER,
        ends_at INTEGER,
        version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE session_content_status (
        session_id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO events VALUES
        ('event-a', 'review', 0, NULL, 1),
        ('event-b', 'review', 0, NULL, 1),
        ('event-deleted', 'review', 0, 5, 1);
      INSERT INTO program_sessions VALUES
        ('scheduled-a', 'event-a', 'scheduled', 100, 200, 1, 1),
        ('published-a', 'event-a', 'published', 300, 400, 1, 1),
        ('unscheduled-a', 'event-a', 'unscheduled', NULL, NULL, 1, 1),
        ('scheduled-b', 'event-b', 'scheduled', 100, 200, 1, 1),
        ('scheduled-deleted', 'event-deleted', 'scheduled', 100, 200, 1, 1);
    `);
  });

  function publish(eventId: string, sessionIds: string[], now = 20) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const sessions = db.prepare(publishAgendaSessionsSql).run(...agendaSessionPublishBindings(now, eventId, sessionIds));
      const content = db.prepare(approveAgendaContentSql).run(...agendaContentApprovalBindings(now, eventId, sessionIds));
      const event = db.prepare(publishAgendaEventSql).run(...agendaEventPublishBindings(now, eventId, sessionIds));
      db.exec("COMMIT");
      return { sessionChanges: sessions.changes, contentChanges: content.changes, eventChanges: event.changes };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  it("publishes all valid selected sessions and advances the event in one batch shape", () => {
    expect(publish("event-a", ["scheduled-a", "published-a"])).toEqual({ sessionChanges: 1, contentChanges: 2, eventChanges: 1 });
    expect(db.prepare("SELECT status, version FROM program_sessions WHERE id = 'scheduled-a'").get()).toEqual({ status: "published", version: 2 });
    expect(db.prepare("SELECT status, version FROM program_sessions WHERE id = 'published-a'").get()).toEqual({ status: "published", version: 1 });
    expect(db.prepare("SELECT session_id, status FROM session_content_status ORDER BY session_id").all()).toEqual([
      { session_id: "published-a", status: "approved" },
      { session_id: "scheduled-a", status: "approved" },
    ]);
    expect(db.prepare("SELECT status, public_agenda_revision FROM events WHERE id = 'event-a'").get()).toEqual({ status: "agenda_published", public_agenda_revision: 1 });
  });

  it("does not partially publish when any selected session belongs to another event", () => {
    expect(publish("event-a", ["scheduled-a", "scheduled-b"])).toEqual({ sessionChanges: 0, contentChanges: 0, eventChanges: 0 });
    expect(db.prepare("SELECT status FROM program_sessions WHERE id = 'scheduled-a'").get()).toEqual({ status: "scheduled" });
    expect(db.prepare("SELECT status, public_agenda_revision FROM events WHERE id = 'event-a'").get()).toEqual({ status: "review", public_agenda_revision: 0 });
  });

  it("does not transition the event for empty, missing, or unscheduled selections", () => {
    expect(publish("event-a", [])).toEqual({ sessionChanges: 0, contentChanges: 0, eventChanges: 0 });
    expect(publish("event-a", ["missing"])).toEqual({ sessionChanges: 0, contentChanges: 0, eventChanges: 0 });
    expect(publish("event-a", ["unscheduled-a"])).toEqual({ sessionChanges: 0, contentChanges: 0, eventChanges: 0 });
    expect(db.prepare("SELECT status, public_agenda_revision FROM events WHERE id = 'event-a'").get()).toEqual({ status: "review", public_agenda_revision: 0 });
  });

  it("does not publish sessions for a soft-deleted event", () => {
    expect(publish("event-deleted", ["scheduled-deleted"])).toEqual({ sessionChanges: 0, contentChanges: 0, eventChanges: 0 });
    expect(db.prepare("SELECT status FROM program_sessions WHERE id = 'scheduled-deleted'").get()).toEqual({ status: "scheduled" });
  });
});
