import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CommunicationDeliveryHistory } from "../../src/client/CommunicationDeliveryHistory";
import type { CommunicationDelivery } from "../../src/shared/domain";

const deliveries: CommunicationDelivery[] = [
  {
    id: "delivery-sent",
    kind: "acceptance",
    transport: "email",
    recipient: "speaker@example.test",
    recipientName: "Ada Rivera",
    subject: "You're speaking at Practical AI Summit",
    status: "sent",
    attempts: 1,
    createdAt: "2026-08-08T12:00:00.000Z",
    updatedAt: "2026-08-08T12:00:08.000Z",
    sentAt: "2026-08-08T12:00:08.000Z",
  },
  {
    id: "delivery-failed",
    kind: "reminder",
    transport: "email",
    recipient: "speaker-two@example.test",
    subject: "Speaker tasks due",
    status: "failed",
    attempts: 2,
    createdAt: "2026-08-08T13:00:00.000Z",
    updatedAt: "2026-08-08T13:03:00.000Z",
    lastError: "Email provider unavailable. A retry remains scheduled.",
  },
];

describe("organizer communication delivery ledger", () => {
  it("renders a scannable, labeled history with status, attempts, timestamps, and safe errors", () => {
    const markup = renderToStaticMarkup(<CommunicationDeliveryHistory deliveries={deliveries} loading={false} error={null} timezone="America/Los_Angeles" onRefresh={vi.fn()} />);

    expect(markup).toContain("What was sent, to whom, and what happened.");
    expect(markup).toContain("Acceptance decision");
    expect(markup).toContain("Ada Rivera");
    expect(markup).toContain("speaker@example.test");
    expect(markup).toContain("Sent");
    expect(markup).toContain("1 attempt");
    expect(markup).toContain("Delivered");
    expect(markup).toContain("Retrying");
    expect(markup).toContain("2 attempts");
    expect(markup).toContain("Last delivery error");
    expect(markup).toContain("Email provider unavailable");
    expect(markup).toContain("aria-label=\"Delivery status summary\"");
  });

  it("explains the empty state and keeps refresh available", () => {
    const markup = renderToStaticMarkup(<CommunicationDeliveryHistory deliveries={[]} loading={false} error={null} timezone="UTC" onRefresh={vi.fn()} />);
    expect(markup).toContain("No communications queued yet");
    expect(markup).toContain("Refresh history");
  });
});
