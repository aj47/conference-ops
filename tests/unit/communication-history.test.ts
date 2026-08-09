import { describe, expect, it } from "vitest";
import {
  demoCommunicationDeliveries,
  projectCommunicationDelivery,
  type CommunicationOutboxRow,
} from "../../src/server/communication-history";

function row(patch: Partial<CommunicationOutboxRow> = {}): CommunicationOutboxRow {
  return {
    id: "delivery-a",
    eventId: "event-a",
    transport: "email",
    idempotencyKey: "proposal-decision:proposal-a:accepted:speaker-a",
    payload: JSON.stringify({
      kind: "communication",
      eventId: "event-a",
      recipient: "speaker@example.test",
      recipientName: "Speaker A",
      subject: "You're speaking at Conference A",
      text: "Private message body",
      html: "<p>Private message body</p>",
    }),
    status: "sent",
    attempts: 1,
    lastError: null,
    sentAt: Date.UTC(2026, 7, 8, 12, 0, 8),
    createdAt: Date.UTC(2026, 7, 8, 12),
    updatedAt: Date.UTC(2026, 7, 8, 12, 0, 8),
    ...patch,
  };
}

describe("communication delivery history projection", () => {
  it("returns the organizer audit fields without bodies, HTML, calendar data, or idempotency keys", () => {
    const delivery = projectCommunicationDelivery(row());

    expect(delivery).toEqual({
      id: "delivery-a",
      kind: "acceptance",
      transport: "email",
      recipient: "speaker@example.test",
      recipientName: "Speaker A",
      subject: "You're speaking at Conference A",
      status: "sent",
      attempts: 1,
      createdAt: "2026-08-08T12:00:00.000Z",
      updatedAt: "2026-08-08T12:00:08.000Z",
      sentAt: "2026-08-08T12:00:08.000Z",
    });
    expect(delivery).not.toHaveProperty("text");
    expect(delivery).not.toHaveProperty("html");
    expect(delivery).not.toHaveProperty("payload");
    expect(delivery).not.toHaveProperty("idempotencyKey");
  });

  it.each([
    ["submission-confirmation:proposal-a", "email", "submission_confirmation"],
    ["proposal-decision:proposal-a:rejected:speaker-a", "email", "rejection"],
    ["proposal-revision:proposal-a:3:speaker-a", "email", "revision_request"],
    ["scheduled-task-reminder:event-a:speaker-a:2026-08-08", "email", "reminder"],
    ["scheduled-cfp-draft:event-a:proposal-a:deadline", "email", "draft_reminder"],
    ["invitation:invitation-a", "email", "staff_invitation"],
    ["send-a:speaker-a:session-a", "calendar", "calendar"],
  ])("classifies legacy %s rows as %s delivery history", (idempotencyKey, transport, expectedKind) => {
    expect(projectCommunicationDelivery(row({ idempotencyKey, transport }))?.kind).toBe(expectedKind);
  });

  it("uses an explicit operational kind for new queue jobs", () => {
    const payload = JSON.stringify({
      kind: "communication",
      communicationKind: "reminder",
      eventId: "event-a",
      recipient: "speaker@example.test",
      subject: "Tasks due",
    });
    expect(projectCommunicationDelivery(row({ idempotencyKey: "opaque-operation:speaker-a", payload }))?.kind).toBe("reminder");
  });

  it("fails closed for cross-event and non-communication payloads", () => {
    expect(projectCommunicationDelivery(row({ payload: JSON.stringify({ kind: "communication", eventId: "event-b", recipient: "speaker@example.test" }) }))).toBeNull();
    expect(projectCommunicationDelivery(row({ payload: JSON.stringify({ kind: "airtable", eventId: "event-a", recipient: "speaker@example.test" }) }))).toBeNull();
    expect(projectCommunicationDelivery(row({ payload: "not json" }))).toBeNull();
  });

  it("redacts credentials and URL query strings from bounded delivery diagnostics", () => {
    const delivery = projectCommunicationDelivery(row({
      status: "failed",
      lastError: "Provider 503; Authorization=top-secret Bearer secret-token https://mail.example.test/send?key=private-value",
      sentAt: null,
    }));
    expect(delivery?.lastError).toContain("Authorization=[redacted]");
    expect(delivery?.lastError).toContain("Bearer [redacted]");
    expect(delivery?.lastError).toContain("https://mail.example.test/send?[redacted]");
    expect(delivery?.lastError).not.toContain("top-secret");
    expect(delivery?.lastError).not.toContain("secret-token");
    expect(delivery?.lastError).not.toContain("private-value");
  });

  it("provides useful demo states without leaking event scope", () => {
    const deliveries = demoCommunicationDeliveries("event-demo");
    expect(new Set(deliveries.map((delivery) => delivery.status))).toEqual(new Set(["sent", "processing", "failed"]));
    expect(deliveries.every((delivery) => delivery.id.startsWith("event-demo:"))).toBe(true);
  });
});
