export type OperationalCommunicationKind = "reminder" | "acceptance" | "calendar";

export interface CommunicationRecipientEvidence {
  id: string;
  acceptedProposal: number | boolean;
  openTask: number | boolean;
  scheduledSession: number | boolean;
}

export function isEligibleCommunicationRecipient(
  kind: OperationalCommunicationKind,
  recipient: CommunicationRecipientEvidence,
) {
  if (kind === "acceptance") return Boolean(recipient.acceptedProposal);
  if (kind === "reminder") return Boolean(recipient.openTask);
  return Boolean(recipient.scheduledSession);
}

export function ineligibleCommunicationRecipientIds(
  kind: OperationalCommunicationKind,
  recipients: readonly CommunicationRecipientEvidence[],
) {
  return recipients
    .filter((recipient) => !isEligibleCommunicationRecipient(kind, recipient))
    .map((recipient) => recipient.id);
}
