import { describe, expect, it } from "vitest";
import { invitationDestination } from "../../src/client/invitation-model";

describe("invitationDestination", () => {
  it("opens organizers in the event workspace", () => {
    expect(invitationDestination("organizer")).toBe("/workspace?role=organizer");
    expect(invitationDestination("organizer", "event-secondary")).toBe("/workspace?eventId=event-secondary&role=organizer");
  });

  it("opens reviewers at the review desk", () => {
    expect(invitationDestination("reviewer")).toBe("/reviews?role=reviewer");
    expect(invitationDestination("reviewer", "event-secondary")).toBe("/reviews?eventId=event-secondary&role=reviewer");
  });
});
