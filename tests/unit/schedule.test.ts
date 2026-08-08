import { describe, expect, it } from "vitest";
import { detectScheduleConflicts, intervalsOverlap, type ScheduleCandidate } from "../../src/server/schedule";
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
