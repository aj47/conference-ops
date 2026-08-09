import { describe, expect, it } from "vitest";
import {
  chronologicalSessions,
  persistentScheduleConflicts,
  scheduleDayGroups,
  scheduleViewFromValue,
} from "../../src/client/schedule-views";
import type { EventRecord, ProgramSession } from "../../src/shared/domain";

const event: EventRecord = {
  id: "event-a",
  slug: "field-notes",
  name: "Field Notes",
  shortName: "Field Notes",
  description: "A two-day conference.",
  timezone: "America/Los_Angeles",
  startsAt: "2026-08-28T16:00:00.000Z",
  endsAt: "2026-08-30T00:00:00.000Z",
  venue: "Civic Hall",
  websiteUrl: "https://example.com",
  status: "agenda_published",
  cfpClosesAt: "2026-06-01T00:00:00.000Z",
  accent: "#b44d32",
};

function session(id: string, overrides: Partial<ProgramSession> = {}): ProgramSession {
  return {
    id,
    eventId: event.id,
    title: id,
    description: "Program session",
    speakerIds: [],
    speakerNames: [],
    status: "unscheduled",
    ...overrides,
  };
}

describe("schedule view state", () => {
  it("accepts known views and safely defaults to the placement board", () => {
    expect(scheduleViewFromValue("list")).toBe("list");
    expect(scheduleViewFromValue("week")).toBe("week");
    expect(scheduleViewFromValue("conflicts")).toBe("conflicts");
    expect(scheduleViewFromValue("unsupported")).toBe("board");
    expect(scheduleViewFromValue(null)).toBe("board");
  });
});

describe("schedule list and week projections", () => {
  it("orders placed sessions chronologically, then unplaced sessions by title", () => {
    const sessions = [
      session("zebra"),
      session("later", { startsAt: "2026-08-28T18:00:00.000Z", endsAt: "2026-08-28T19:00:00.000Z", status: "scheduled" }),
      session("alpha"),
      session("earlier", { startsAt: "2026-08-28T17:00:00.000Z", endsAt: "2026-08-28T18:00:00.000Z", status: "scheduled" }),
    ];

    expect(chronologicalSessions(sessions).map((item) => item.id)).toEqual(["earlier", "later", "alpha", "zebra"]);
  });

  it("builds every event day and places sessions in local-day, time order", () => {
    const groups = scheduleDayGroups(event, [
      session("day-two", { startsAt: "2026-08-29T17:00:00.000Z", endsAt: "2026-08-29T18:00:00.000Z", status: "scheduled" }),
      session("day-one-late", { startsAt: "2026-08-28T18:00:00.000Z", endsAt: "2026-08-28T19:00:00.000Z", status: "scheduled" }),
      session("not-placed"),
      session("day-one-early", { startsAt: "2026-08-28T17:00:00.000Z", endsAt: "2026-08-28T17:30:00.000Z", status: "published" }),
    ]);

    expect(groups.map((group) => group.key)).toEqual(["2026-08-28", "2026-08-29"]);
    expect(groups[0].sessions.map((item) => item.id)).toEqual(["day-one-early", "day-one-late"]);
    expect(groups[1].sessions.map((item) => item.id)).toEqual(["day-two"]);
  });
});

describe("persistent schedule conflicts", () => {
  const rooms = [{ id: "room-a", name: "Main Hall", capacity: 500 }];
  const tracks = [{ id: "track-a", name: "Build", color: "#b44d32" }];

  it("collapses every shared resource for one overlapping session pair", () => {
    const left = session("left", {
      roomId: "room-a",
      trackId: "track-a",
      speakerIds: ["speaker-a"],
      speakerNames: ["Ada Rivera"],
      startsAt: "2026-08-28T16:00:00.000Z",
      endsAt: "2026-08-28T17:00:00.000Z",
      status: "published",
    });
    const right = session("right", {
      roomId: "room-a",
      trackId: "track-a",
      speakerIds: ["speaker-a"],
      speakerNames: ["Ada Rivera"],
      startsAt: "2026-08-28T16:30:00.000Z",
      endsAt: "2026-08-28T17:30:00.000Z",
      status: "scheduled",
      overrideReason: "The shared stage is intentionally double-booked.",
    });

    const result = persistentScheduleConflicts([right, left], rooms, tracks);

    expect(result).toHaveLength(1);
    expect(result[0].sessions.map((item) => item.id)).toEqual(["left", "right"]);
    expect(result[0].resources).toEqual([
      { type: "room", id: "room-a", name: "Main Hall" },
      { type: "track", id: "track-a", name: "Build" },
      { type: "speaker", id: "speaker-a", name: "Ada Rivera" },
    ]);
  });

  it("ignores adjacency, unscheduled work, and time overlaps without shared resources", () => {
    const existing = session("existing", {
      roomId: "room-a",
      trackId: "track-a",
      speakerIds: ["speaker-a"],
      speakerNames: ["Ada Rivera"],
      startsAt: "2026-08-28T16:00:00.000Z",
      endsAt: "2026-08-28T17:00:00.000Z",
      status: "scheduled",
    });
    const adjacent = session("adjacent", {
      roomId: "room-a",
      trackId: "track-a",
      speakerIds: ["speaker-a"],
      speakerNames: ["Ada Rivera"],
      startsAt: existing.endsAt,
      endsAt: "2026-08-28T18:00:00.000Z",
      status: "scheduled",
    });
    const unrelated = session("unrelated", {
      roomId: "room-b",
      trackId: "track-b",
      speakerIds: ["speaker-b"],
      speakerNames: ["Bo Chen"],
      startsAt: "2026-08-28T16:15:00.000Z",
      endsAt: "2026-08-28T16:45:00.000Z",
      status: "scheduled",
    });

    expect(persistentScheduleConflicts([existing, adjacent, unrelated, session("unplaced")], rooms, tracks)).toEqual([]);
  });
});
