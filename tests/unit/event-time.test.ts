import { describe, expect, it } from "vitest";
import {
  dateTimeLocalToInstant,
  eventDateKey,
  eventDayOptions,
  formatEventDateRange,
  formatEventTicket,
  instantToDateTimeLocal,
  scheduleSlotStarts,
  timeZoneAbbreviation,
} from "../../src/client/event-time";

const event = {
  startsAt: "2026-08-28T16:00:00.000Z",
  endsAt: "2026-08-30T01:00:00.000Z",
  timezone: "America/Los_Angeles",
};

describe("event-aware date and schedule formatting", () => {
  it("formats event ranges and compact tickets from the event timezone", () => {
    expect(formatEventDateRange(event)).toBe("August 28–29, 2026");
    expect(formatEventTicket(event)).toBe("28—29 AUG 2026");
    expect(timeZoneAbbreviation(event.startsAt, event.timezone)).toBe("PDT");
  });

  it("uses the local event day instead of the UTC day", () => {
    expect(eventDateKey("2026-08-29T01:30:00.000Z", "America/Los_Angeles")).toBe("2026-08-28");
    expect(eventDateKey("2026-08-29T01:30:00.000Z", "Asia/Singapore")).toBe("2026-08-29");
  });

  it("round-trips timezone-local form values and rejects DST gaps", () => {
    const local = "2026-11-12T09:45";
    const instant = dateTimeLocalToInstant(local, "America/New_York");
    expect(instant).toBe("2026-11-12T14:45:00.000Z");
    expect(instantToDateTimeLocal(instant, "America/New_York")).toBe(local);
    expect(() => dateTimeLocalToInstant("2026-03-08T02:30", "America/New_York")).toThrow(/does not exist/);
  });

  it("builds all event days and includes irregular scheduled starts in the grid", () => {
    const sessions = [{ startsAt: "2026-08-28T17:10:00.000Z" }, { startsAt: "2026-08-29T17:00:00.000Z" }];
    const days = eventDayOptions(event, sessions);
    expect(days.map((day) => day.key)).toEqual(["2026-08-28", "2026-08-29"]);
    const firstDaySlots = scheduleSlotStarts(event, days[0], sessions);
    expect(firstDaySlots[0]).toBe("2026-08-28T16:00:00.000Z");
    expect(firstDaySlots.at(-1)).toBe("2026-08-29T00:30:00.000Z");
    expect(firstDaySlots).toContain("2026-08-28T17:10:00.000Z");
    expect(firstDaySlots).toHaveLength(19);
  });

  it("offers every half-hour placement through the end of a full event day", () => {
    const days = eventDayOptions(event);
    const secondDaySlots = scheduleSlotStarts(event, days[1], []);

    expect(secondDaySlots[0]).toBe("2026-08-29T16:00:00.000Z");
    expect(secondDaySlots.at(-1)).toBe("2026-08-30T00:30:00.000Z");
    expect(secondDaySlots).toHaveLength(18);
  });

  it("treats an exact-midnight end as exclusive", () => {
    const oneDay = {
      startsAt: "2026-08-28T13:00:00.000Z",
      endsAt: "2026-08-29T04:00:00.000Z",
      timezone: "America/New_York",
    };
    expect(formatEventDateRange(oneDay)).toBe("August 28, 2026");
    expect(eventDayOptions(oneDay)).toHaveLength(1);
  });
});
