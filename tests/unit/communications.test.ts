import { describe, expect, it } from "vitest";
import {
  ineligibleCommunicationRecipientIds,
  isEligibleCommunicationRecipient,
  type CommunicationRecipientEvidence,
} from "../../src/server/communications";

const recipient = (overrides: Partial<CommunicationRecipientEvidence> = {}): CommunicationRecipientEvidence => ({
  id: "speaker-a",
  acceptedProposal: 0,
  openTask: 0,
  scheduledSession: 0,
  ...overrides,
});

describe("operational communication audiences", () => {
  it("limits acceptance to accepted or converted proposal speakers", () => {
    expect(isEligibleCommunicationRecipient("acceptance", recipient({ acceptedProposal: 1 }))).toBe(true);
    expect(isEligibleCommunicationRecipient("acceptance", recipient({ openTask: 1 }))).toBe(false);
  });

  it("limits reminders to people with outstanding tasks", () => {
    expect(isEligibleCommunicationRecipient("reminder", recipient({ openTask: true }))).toBe(true);
    expect(isEligibleCommunicationRecipient("reminder", recipient({ acceptedProposal: true }))).toBe(false);
  });

  it("limits calendar delivery to people on scheduled or published sessions", () => {
    expect(isEligibleCommunicationRecipient("calendar", recipient({ scheduledSession: 1 }))).toBe(true);
    expect(isEligibleCommunicationRecipient("calendar", recipient({ acceptedProposal: 1 }))).toBe(false);
  });

  it("reports every ineligible recipient for a requested message kind", () => {
    expect(ineligibleCommunicationRecipientIds("reminder", [
      recipient({ id: "ready", openTask: 1 }),
      recipient({ id: "complete" }),
    ])).toEqual(["complete"]);
  });
});
