import { describe, expect, it } from "vitest";
import { buildCalendarInvite, type CalendarInviteInput } from "../../src/jobs/calendar";

function invite(overrides: Partial<CalendarInviteInput> = {}) {
  return buildCalendarInvite({
    method: "REQUEST",
    uid: "event-aie-2026:session-evals@conference-ops",
    sequence: 4,
    title: "The eval flywheel",
    description: "A production case study.",
    location: "Cowell Theater",
    startsAt: "2026-08-28T16:30:00.000Z",
    endsAt: "2026-08-28T17:00:00.000Z",
    organizerEmail: "program@example.test",
    organizerName: "Conference Ops",
    attendeeEmail: "speaker@example.test",
    attendeeName: "Marco Ruiz",
    ...overrides,
  });
}

describe("buildCalendarInvite", () => {
  it("emits a stable caller-provided UID, sequence, method, and UTC interval", () => {
    const first = invite();
    const rescheduled = invite({ sequence: 5 });

    expect(first).toContain("\r\nMETHOD:REQUEST\r\n");
    expect(first).toContain("\r\nUID:event-aie-2026:session-evals@conference-ops\r\n");
    expect(first).toContain("\r\nSEQUENCE:4\r\n");
    expect(first).toContain("\r\nDTSTART:20260828T163000Z\r\n");
    expect(first).toContain("\r\nDTEND:20260828T170000Z\r\n");
    expect(rescheduled).toContain("\r\nUID:event-aie-2026:session-evals@conference-ops\r\n");
    expect(rescheduled).toContain("\r\nSEQUENCE:5\r\n");
  });

  it("uses CANCEL and CANCELLED for a cancellation while preserving the UID", () => {
    const cancelled = invite({ method: "CANCEL", sequence: 6 });

    expect(cancelled).toContain("\r\nMETHOD:CANCEL\r\n");
    expect(cancelled).toContain("\r\nSTATUS:CANCELLED\r\n");
    expect(cancelled).toContain("\r\nUID:event-aie-2026:session-evals@conference-ops\r\n");
    expect(cancelled).toContain("\r\nSEQUENCE:6\r\n");
  });

  it("escapes backslashes, newlines, commas, and semicolons in text properties", () => {
    const ics = invite({
      title: "R&D, Agents; C:\\tools",
      description: "Line one\nLine two, semicolon; slash \\",
      location: "Hall A, level 2; west\\wing",
    });

    expect(ics).toContain("SUMMARY:R&D\\, Agents\\; C:\\\\tools");
    expect(ics).toContain("DESCRIPTION:Line one\\nLine two\\, semicolon\\; slash \\\\");
    expect(ics).toContain("LOCATION:Hall A\\, level 2\\; west\\\\wing");
  });

  it("folds every physical content line to at most 75 UTF-8 octets", () => {
    const title = "Agent reliability — déjà vu — ".repeat(8);
    const ics = invite({ title });
    const physicalLines = ics.split("\r\n").filter(Boolean);
    const summaryIndex = physicalLines.findIndex((line) => line.startsWith("SUMMARY:"));
    const summaryLines = [physicalLines[summaryIndex]];

    for (let index = summaryIndex + 1; physicalLines[index]?.startsWith(" "); index += 1) {
      summaryLines.push(physicalLines[index]);
    }

    expect(summaryLines.length).toBeGreaterThan(1);
    expect(
      summaryLines[0] + summaryLines.slice(1).map((line) => line.slice(1)).join(""),
    ).toBe(`SUMMARY:${title}`);
    for (const line of physicalLines) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("uses CRLF line endings and terminates the calendar", () => {
    const ics = invite();

    expect(ics).not.toMatch(/(?<!\r)\n/);
    expect(ics).toMatch(/BEGIN:VCALENDAR\r\n/);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
