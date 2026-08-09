import { describe, expect, it } from "vitest";
import { buildAutoSchedulePlan } from "../../src/client/auto-schedule";
import type { ProgramSession } from "../../src/shared/domain";

const rooms = [
  { id: "room-a", name: "Main stage", capacity: 300 },
  { id: "room-b", name: "Studio", capacity: 80 },
];
const tracks = [
  { id: "track-build", name: "Build", color: "#315b61" },
  { id: "track-eval", name: "Evaluate", color: "#b65f3a" },
];
const slots = [
  { startsAt: "2027-06-10T16:00:00.000Z", dayEndsAt: "2027-06-10T18:00:00.000Z" },
  { startsAt: "2027-06-10T16:30:00.000Z", dayEndsAt: "2027-06-10T18:00:00.000Z" },
  { startsAt: "2027-06-10T17:00:00.000Z", dayEndsAt: "2027-06-10T18:00:00.000Z" },
];

function session(id: string, overrides: Partial<ProgramSession> = {}): ProgramSession {
  return {
    id,
    eventId: "event-a",
    title: id,
    description: "",
    speakerIds: [`speaker-${id}`],
    speakerNames: [id],
    status: "unscheduled",
    ...overrides,
  };
}

describe("deterministic schedule assistant", () => {
  it("places longer sessions first and uses parallel rooms only across distinct tracks", () => {
    const plan = buildAutoSchedulePlan({
      sessions: [session("short"), session("long")],
      rooms,
      tracks,
      slots,
      durationMinutes: { short: 30, long: 60 },
      preferredTrackIds: { short: "track-eval", long: "track-build" },
    });

    expect(plan.unplaced).toEqual([]);
    expect(plan.placements).toEqual([
      {
        sessionId: "long",
        roomId: "room-a",
        trackId: "track-build",
        startsAt: "2027-06-10T16:00:00.000Z",
        endsAt: "2027-06-10T17:00:00.000Z",
      },
      {
        sessionId: "short",
        roomId: "room-b",
        trackId: "track-eval",
        startsAt: "2027-06-10T16:00:00.000Z",
        endsAt: "2027-06-10T16:30:00.000Z",
      },
    ]);
  });

  it("avoids existing room, track, and speaker conflicts without creating overrides", () => {
    const existing = session("existing", {
      status: "scheduled",
      roomId: "room-a",
      trackId: "track-build",
      startsAt: "2027-06-10T16:00:00.000Z",
      endsAt: "2027-06-10T17:00:00.000Z",
      speakerIds: ["speaker-shared"],
    });
    const target = session("target", { speakerIds: ["speaker-shared"] });

    const plan = buildAutoSchedulePlan({
      sessions: [existing, target],
      rooms,
      tracks,
      slots,
      durationMinutes: { target: 30 },
      preferredTrackIds: { target: "track-build" },
    });

    expect(plan.placements[0]).toMatchObject({ sessionId: "target", startsAt: "2027-06-10T17:00:00.000Z" });
  });

  it("keeps sessions visible as unplaced when no complete safe slot exists", () => {
    const plan = buildAutoSchedulePlan({
      sessions: [session("workshop")],
      rooms: [rooms[0]],
      tracks: [tracks[0]],
      slots: [{ startsAt: "2027-06-10T17:30:00.000Z", dayEndsAt: "2027-06-10T18:00:00.000Z" }],
      durationMinutes: { workshop: 60 },
    });

    expect(plan.placements).toEqual([]);
    expect(plan.unplaced).toEqual([{ sessionId: "workshop", reason: "no_conflict_free_slot" }]);
  });

  it("explains missing rooms or tracks instead of inventing resources", () => {
    const plan = buildAutoSchedulePlan({
      sessions: [session("talk")],
      rooms: [],
      tracks,
      slots,
      durationMinutes: { talk: 30 },
    });

    expect(plan).toEqual({ placements: [], unplaced: [{ sessionId: "talk", reason: "no_resources" }] });
  });
});
