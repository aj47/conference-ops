import type {
  CommunicationDelivery,
  CommunicationDeliveryKind,
  CommunicationDeliveryStatus,
} from "../shared/domain";

export interface CommunicationOutboxRow {
  id: unknown;
  eventId: unknown;
  transport: unknown;
  idempotencyKey: unknown;
  payload: unknown;
  status: unknown;
  attempts: unknown;
  lastError: unknown;
  sentAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

const deliveryStatuses = new Set<CommunicationDeliveryStatus>(["queued", "processing", "sent", "failed", "dead"]);
const explicitKinds = new Set<CommunicationDeliveryKind>([
  "submission_confirmation",
  "acceptance",
  "rejection",
  "revision_request",
  "reminder",
  "draft_reminder",
  "calendar",
  "staff_invitation",
  "operational_email",
]);

function recordFromJson(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function safeText(value: unknown, maximumLength: number) {
  if (typeof value !== "string") return undefined;
  const withoutControls = [...value].map((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
  const normalized = withoutControls.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maximumLength);
}

function safeTimestamp(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  const number = typeof value === "number" ? value : typeof value === "bigint" ? Number(value) : Number.NaN;
  if (!Number.isFinite(number)) return undefined;
  const date = new Date(number);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function sanitizeDiagnostic(value: unknown) {
  const text = safeText(value, 2_000);
  if (!text) return undefined;
  const redacted = text
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(authorization|token|secret|api[-_ ]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, "$1?[redacted]");
  return redacted.slice(0, 240);
}

function communicationKind(
  transport: "email" | "calendar",
  idempotencyKey: string,
  payload: Record<string, unknown>,
): CommunicationDeliveryKind {
  const explicit = safeText(payload.communicationKind, 40) as CommunicationDeliveryKind | undefined;
  if (explicit && explicitKinds.has(explicit)) return explicit;
  if (transport === "calendar" || payload.calendar) return "calendar";
  if (idempotencyKey.startsWith("submission-confirmation:")) return "submission_confirmation";
  if (idempotencyKey.startsWith("proposal-revision:")) return "revision_request";
  if (idempotencyKey.startsWith("proposal-decision:")) {
    if (idempotencyKey.includes(":accepted:")) return "acceptance";
    if (idempotencyKey.includes(":rejected:")) return "rejection";
  }
  if (idempotencyKey.startsWith("scheduled-task-reminder:")) return "reminder";
  if (idempotencyKey.startsWith("scheduled-cfp-draft:")) return "draft_reminder";
  if (idempotencyKey.startsWith("invitation:")) return "staff_invitation";
  return "operational_email";
}

/**
 * Projects the organizer delivery ledger from the durable outbox. Message
 * bodies, HTML, calendar attachments, and idempotency keys intentionally stop
 * at this boundary.
 */
export function projectCommunicationDelivery(row: CommunicationOutboxRow): CommunicationDelivery | null {
  const eventId = safeText(row.eventId, 255);
  const payload = recordFromJson(row.payload);
  if (!eventId || !payload || payload.kind !== "communication" || payload.eventId !== eventId) return null;
  const transport = row.transport === "email" || row.transport === "calendar" ? row.transport : null;
  const status = typeof row.status === "string" && deliveryStatuses.has(row.status as CommunicationDeliveryStatus)
    ? row.status as CommunicationDeliveryStatus
    : null;
  const id = safeText(row.id, 255);
  const idempotencyKey = safeText(row.idempotencyKey, 500);
  const recipient = safeText(payload.recipient, 320);
  const createdAt = safeTimestamp(row.createdAt);
  const updatedAt = safeTimestamp(row.updatedAt);
  if (!transport || !status || !id || !idempotencyKey || !recipient || !createdAt || !updatedAt) return null;

  return {
    id,
    kind: communicationKind(transport, idempotencyKey, payload),
    transport,
    recipient,
    ...(safeText(payload.recipientName, 160) ? { recipientName: safeText(payload.recipientName, 160) } : {}),
    subject: safeText(payload.subject, 255) ?? "(No subject)",
    status,
    attempts: Math.max(0, Math.floor(Number(row.attempts) || 0)),
    createdAt,
    updatedAt,
    ...(safeTimestamp(row.sentAt) ? { sentAt: safeTimestamp(row.sentAt) } : {}),
    ...(sanitizeDiagnostic(row.lastError) ? { lastError: sanitizeDiagnostic(row.lastError) } : {}),
  };
}

export function demoCommunicationDeliveries(eventId: string): CommunicationDelivery[] {
  const deliveries: CommunicationDelivery[] = [
    {
      id: "demo-delivery-acceptance",
      kind: "acceptance",
      transport: "email",
      recipient: "marco@example.com",
      recipientName: "Marco Ruiz",
      subject: "You're speaking at AI Engineer Summit 2026",
      status: "sent",
      attempts: 1,
      createdAt: "2026-08-08T07:45:00.000Z",
      updatedAt: "2026-08-08T07:45:08.000Z",
      sentAt: "2026-08-08T07:45:08.000Z",
    },
    {
      id: "demo-delivery-calendar",
      kind: "calendar",
      transport: "calendar",
      recipient: "priya@example.com",
      recipientName: "Priya Nair",
      subject: "Your AI Engineer Summit 2026 session is scheduled",
      status: "processing",
      attempts: 1,
      createdAt: "2026-08-08T07:31:00.000Z",
      updatedAt: "2026-08-08T07:31:04.000Z",
    },
    {
      id: "demo-delivery-reminder",
      kind: "reminder",
      transport: "email",
      recipient: "leah@example.com",
      recipientName: "Leah Okafor",
      subject: "Speaker tasks for AI Engineer Summit 2026",
      status: "failed",
      attempts: 2,
      createdAt: "2026-08-08T05:00:00.000Z",
      updatedAt: "2026-08-08T05:03:00.000Z",
      lastError: "Email provider unavailable. A retry remains scheduled.",
    },
    {
      id: "demo-delivery-confirmation",
      kind: "submission_confirmation",
      transport: "email",
      recipient: "leah@example.com",
      recipientName: "Leah Okafor",
      subject: "We received your AI Engineer Summit 2026 proposal",
      status: "sent",
      attempts: 1,
      createdAt: "2026-08-06T10:15:00.000Z",
      updatedAt: "2026-08-06T10:15:06.000Z",
      sentAt: "2026-08-06T10:15:06.000Z",
    },
  ];
  return deliveries.map((delivery) => ({ ...delivery, id: `${eventId}:${delivery.id}` }));
}
