import { describe, expect, it } from "vitest";
import { controlRoomExceptions } from "../../src/client/control-room-exceptions";

describe("Control Room exception destinations", () => {
  it("uses the schedule workflow as the primary action for an unscheduled-only queue", () => {
    expect(controlRoomExceptions("event a", [], [], 1)).toEqual([
      {
        kind: "schedule",
        key: "schedule:unscheduled",
        title: "1 unscheduled session",
        detail: "Needs room and time",
        to: "/schedule?eventId=event+a",
        action: "Place unscheduled session",
      },
    ]);
  });

  it("keeps a speaker task first and preserves its exact event-scoped deep link", () => {
    const exceptions = controlRoomExceptions(
      "event-a",
      [{ id: "task & one", speakerId: "speaker/a", title: "Upload final slides" }],
      [{ id: "speaker-b", name: "Priya Nair" }],
      2,
    );

    expect(exceptions.map((item) => item.kind)).toEqual(["task", "profile", "schedule"]);
    const taskUrl = new URL(exceptions[0].to, "https://conference.test");
    expect(exceptions[0].action).toBe("Open speaker task");
    expect(taskUrl.pathname).toBe("/speaker-ops");
    expect(Object.fromEntries(taskUrl.searchParams)).toEqual({
      eventId: "event-a",
      speakerId: "speaker/a",
      taskId: "task & one",
    });
    expect(exceptions[2]).toMatchObject({
      action: "Place unscheduled sessions",
      to: "/schedule?eventId=event-a",
    });
  });

  it("omits the action source when the exception queue is empty", () => {
    expect(controlRoomExceptions("event-a", [], [], 0)).toEqual([]);
  });
});
