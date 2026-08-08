import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  detectScheduleConflicts,
  intervalsOverlap,
  scheduleWindowError,
  sessionPlacementUpdateBindings,
  updateSessionPlacementSql,
  type ScheduleCandidate,
} from "../../src/server/schedule";
import type { ProgramSession } from "../../src/shared/domain";

const names = {
  rooms: { "room-a": "Main Hall", "room-b": "Studio" },
  tracks: { "track-a": "Build", "track-b": "Operate" },
  speakers: { "speaker-a": "Ada Rivera", "speaker-b": "Bo Chen" },
};

const existing: ProgramSession = {
  id: "session-existing",
  eventId: "event-1",
  title: "Shipping reliable agents",
  description: "A field report.",
  roomId: "room-a",
  trackId: "track-a",
  speakerIds: ["speaker-a"],
  speakerNames: ["Ada Rivera"],
  startsAt: "2026-08-28T16:00:00.000Z",
  endsAt: "2026-08-28T17:00:00.000Z",
  status: "scheduled",
};

function candidate(overrides: Partial<ScheduleCandidate> = {}): ScheduleCandidate {
  return {
    id: "session-candidate",
    title: "Candidate session",
    roomId: "room-b",
    trackId: "track-b",
    speakerIds: ["speaker-b"],
    startsAt: "2026-08-28T16:30:00.000Z",
    endsAt: "2026-08-28T17:30:00.000Z",
    ...overrides,
  };
}

describe("intervalsOverlap", () => {
  it("detects partial overlap and containment", () => {
    expect(
      intervalsOverlap(
        "2026-08-28T16:00:00.000Z",
        "2026-08-28T17:00:00.000Z",
        "2026-08-28T16:30:00.000Z",
        "2026-08-28T17:30:00.000Z",
      ),
    ).toBe(true);
    expect(
      intervalsOverlap(
        "2026-08-28T16:00:00.000Z",
        "2026-08-28T18:00:00.000Z",
        "2026-08-28T16:30:00.000Z",
        "2026-08-28T17:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("treats adjacent half-open intervals as non-overlapping", () => {
    expect(
      intervalsOverlap(
        "2026-08-28T16:00:00.000Z",
        "2026-08-28T17:00:00.000Z",
        "2026-08-28T17:00:00.000Z",
        "2026-08-28T18:00:00.000Z",
      ),
    ).toBe(false);
  });
});

describe("scheduleWindowError", () => {
  const eventStart = "2026-08-28T15:00:00.000Z";
  const eventEnd = "2026-08-30T01:00:00.000Z";

  it("accepts a session fully contained in the event window", () => {
    expect(scheduleWindowError(
      "2026-08-28T16:00:00.000Z",
      "2026-08-28T17:00:00.000Z",
      eventStart,
      eventEnd,
    )).toBeNull();
  });

  it("rejects reversed, invalid, and out-of-event intervals", () => {
    expect(scheduleWindowError(eventStart, eventStart, eventStart, eventEnd)).toBe("INVALID_INTERVAL");
    expect(scheduleWindowError("not-a-date", eventEnd, eventStart, eventEnd)).toBe("INVALID_INTERVAL");
    expect(scheduleWindowError("2026-08-28T14:59:00.000Z", "2026-08-28T16:00:00.000Z", eventStart, eventEnd)).toBe("OUTSIDE_EVENT_WINDOW");
    expect(scheduleWindowError("2026-08-29T23:00:00.000Z", "2026-08-30T01:01:00.000Z", eventStart, eventEnd)).toBe("OUTSIDE_EVENT_WINDOW");
  });
});

describe("live agenda placement updates", () => {
  it.each([
    ["published", "published"],
    ["scheduled", "scheduled"],
    ["unscheduled", "scheduled"],
  ] as const)("moves a %s session without taking an already-live record offline", (initialStatus, expectedStatus) => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE program_sessions (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        room_id TEXT,
        track_id TEXT,
        starts_at INTEGER,
        ends_at INTEGER,
        status TEXT NOT NULL,
        override_reason TEXT,
        calendar_sequence INTEGER NOT NULL,
        version INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE session_speakers (
        session_id TEXT NOT NULL,
        speaker_profile_id TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO program_sessions VALUES (?, 'event-a', 'room-old', 'track-old', 100, 200, ?, NULL, 0, 1, 1)")
      .run("session-a", initialStatus);

    const result = db.prepare(updateSessionPlacementSql).run(...sessionPlacementUpdateBindings({
      eventId: "event-a",
      sessionId: "session-a",
      roomId: "room-new",
      trackId: "track-new",
      startsAt: 300,
      endsAt: 400,
      now: 20,
    }));

    expect(result.changes).toBe(1);
    expect(db.prepare("SELECT room_id, track_id, starts_at, ends_at, status, calendar_sequence, version FROM program_sessions WHERE id = 'session-a'").get()).toEqual({
      room_id: "room-new",
      track_id: "track-new",
      starts_at: 300,
      ends_at: 400,
      status: expectedStatus,
      calendar_sequence: 1,
      version: 2,
    });
  });
});

describe("detectScheduleConflicts", () => {
  const resourceCases: Array<["room" | "track" | "speaker", Partial<ScheduleCandidate>, string]> = [
    ["room", { roomId: "room-a" }, "Main Hall"],
    ["track", { trackId: "track-a" }, "Build"],
    ["speaker", { speakerIds: ["speaker-a"] }, "Ada Rivera"],
  ];

  it.each(resourceCases)("reports an overlapping %s resource", (type, overrides, resourceName) => {
    const conflicts = detectScheduleConflicts(candidate(overrides), [existing], names);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      type,
      resourceName,
      sessionId: existing.id,
      sessionTitle: existing.title,
      startsAt: existing.startsAt,
      endsAt: existing.endsAt,
    });
  });

  it("reports room, track, and speaker conflicts independently for one session", () => {
    const conflicts = detectScheduleConflicts(
      candidate({ roomId: "room-a", trackId: "track-a", speakerIds: ["speaker-a"] }),
      [existing],
      names,
    );

    expect(conflicts.map((conflict) => conflict.type)).toEqual(["room", "track", "speaker"]);
  });

  it("returns no conflicts for adjacent sessions using the same resources", () => {
    const conflicts = detectScheduleConflicts(
      candidate({
        roomId: "room-a",
        trackId: "track-a",
        speakerIds: ["speaker-a"],
        startsAt: existing.endsAt,
        endsAt: "2026-08-28T18:00:00.000Z",
      }),
      [existing],
      names,
    );

    expect(conflicts).toEqual([]);
  });

  it("returns no conflicts when time overlaps but resources do not", () => {
    expect(detectScheduleConflicts(candidate(), [existing], names)).toEqual([]);
  });

  it("ignores the session being rescheduled and unscheduled records", () => {
    const unscheduled: ProgramSession = {
      ...existing,
      id: "session-unscheduled",
      startsAt: undefined,
      endsAt: undefined,
      status: "unscheduled",
    };
    const editingSelf = candidate({
      id: existing.id,
      roomId: "room-a",
      trackId: "track-a",
      speakerIds: ["speaker-a"],
    });

    expect(detectScheduleConflicts(editingSelf, [existing, unscheduled], names)).toEqual([]);
  });
});
