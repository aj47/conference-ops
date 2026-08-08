import { describe, expect, it } from "vitest";
import { eventRoleLandingPath, privateEventPath } from "../../src/client/private-routes";

describe("privateEventPath", () => {
  it("pins authenticated organizer and speaker routes to the active event", () => {
    expect(privateEventPath("/workspace", "event-secondary")).toBe("/workspace?eventId=event-secondary");
    expect(privateEventPath("/program-settings", "event-secondary")).toBe("/program-settings?eventId=event-secondary");
    expect(privateEventPath("/reviews?round=2#queue", "event secondary")).toBe("/reviews?round=2&eventId=event+secondary#queue");
    expect(privateEventPath("/portal/tasks", "event-secondary")).toBe("/portal/tasks?eventId=event-secondary");
  });

  it("replaces a stale event selection without dropping other route state", () => {
    expect(privateEventPath("/schedule?eventId=event-old&day=2", "event-new")).toBe(
      "/schedule?eventId=event-new&day=2",
    );
  });

  it("leaves public, authentication, invitation, claim, and external routes untouched", () => {
    for (const path of [
      "/events/event-secondary/agenda",
      "/submit/event-secondary",
      "/auth?returnTo=%2Fworkspace",
      "/invite/token",
      "/speaker/claim/event-secondary",
      "https://example.com/workspace",
    ]) {
      expect(privateEventPath(path, "event-secondary")).toBe(path);
    }
  });

  it("does not invent an event selection before the private workspace resolves", () => {
    expect(privateEventPath("/workspace", null)).toBe("/workspace");
  });

  it("keeps authenticated role landings scoped without changing the public applicant route", () => {
    expect(eventRoleLandingPath("organizer", "event-secondary", "conf-2026")).toBe(
      "/workspace?eventId=event-secondary&role=organizer",
    );
    expect(eventRoleLandingPath("reviewer", "event-secondary", "conf-2026")).toBe(
      "/reviews?eventId=event-secondary&role=reviewer",
    );
    expect(eventRoleLandingPath("speaker", "event-secondary", "conf-2026")).toBe(
      "/portal/home?eventId=event-secondary&role=speaker",
    );
    expect(eventRoleLandingPath("applicant", "event-secondary", "conf 2026")).toBe(
      "/submit/conf%202026",
    );
  });

  it("keeps only an allowlisted active role in private route state", () => {
    expect(privateEventPath("/portal/tasks?role=reviewer", "event-secondary")).toBe(
      "/portal/tasks?role=reviewer&eventId=event-secondary",
    );
    expect(privateEventPath("/portal/tasks?role=admin", "event-secondary")).toBe(
      "/portal/tasks?eventId=event-secondary",
    );
    expect(privateEventPath("/portal/tasks", "event-secondary", "speaker")).toBe(
      "/portal/tasks?eventId=event-secondary&role=speaker",
    );
  });
});
