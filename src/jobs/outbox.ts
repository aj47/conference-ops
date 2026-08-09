export const OUTBOX_MAX_DELIVERY_ATTEMPTS = 5;
export const OUTBOX_STALE_AFTER_MS = 10 * 60 * 1000;

export type OutboxKind = "email" | "calendar" | "accelevents" | "airtable";
export type OutboxStatus = "queued" | "processing" | "sent" | "failed" | "dead";

export interface JobBody {
  kind: OutboxKind;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export interface StoredOutboxRow {
  id: string;
  status: OutboxStatus;
  kind: OutboxKind;
  payload: string;
  attempts: number;
}

export const claimOutboxSql = `UPDATE outbox
  SET status = 'processing', attempts = attempts + 1, updated_at = ?
  WHERE id = ?
    AND attempts < ${OUTBOX_MAX_DELIVERY_ATTEMPTS}
    AND (status IN ('queued', 'failed') OR (status = 'processing' AND updated_at <= ?))`;

export const markExhaustedOutboxSql = `UPDATE outbox
  SET status = 'dead',
      last_error = COALESCE(last_error, 'Delivery attempts exhausted before the lease completed.'),
      updated_at = ?
  WHERE attempts >= ${OUTBOX_MAX_DELIVERY_ATTEMPTS}
    AND (status IN ('queued', 'failed') OR (status = 'processing' AND updated_at <= ?))`;

export const markExhaustedOutboxByIdSql = `UPDATE outbox
  SET status = 'dead',
      last_error = COALESCE(last_error, 'Delivery attempts exhausted before the lease completed.'),
      updated_at = ?
  WHERE id = ?
    AND attempts >= ${OUTBOX_MAX_DELIVERY_ATTEMPTS}
    AND (status IN ('queued', 'failed') OR (status = 'processing' AND updated_at <= ?))`;

export const selectDueOutboxSql = `SELECT id, idempotency_key, kind, payload FROM outbox
  WHERE available_at <= ?
    AND attempts < ${OUTBOX_MAX_DELIVERY_ATTEMPTS}
    AND (status IN ('queued', 'failed') OR (status = 'processing' AND updated_at <= ?))
  ORDER BY available_at LIMIT 50`;

export const markOutboxSentSql = `UPDATE outbox
  SET status = 'sent', sent_at = ?, updated_at = ?
  WHERE id = ? AND status = 'processing' AND updated_at = ?`;

export const markOutboxFailedSql = `UPDATE outbox
  SET status = ?, last_error = ?, available_at = ?, updated_at = ?
  WHERE id = ? AND status = 'processing' AND updated_at = ?`;

export class NonRetryableJobError extends Error {
  readonly retryable = false;
}

export class ExhaustedOutboxError extends Error {
  readonly retryable = true;

  constructor() {
    super("This outbox job exhausted its delivery attempts.");
  }
}

export function isRetryableJobError(error: unknown) {
  if (!error || typeof error !== "object" || !("retryable" in error)) return true;
  return (error as { retryable?: unknown }).retryable !== false;
}

export function retryDelaySeconds(attempt: number) {
  return Math.min(900, 2 ** Math.max(1, attempt) * 15);
}

export function outboxFailureState(attempts: number, retryable: boolean, now: number) {
  return {
    status: (!retryable || attempts >= OUTBOX_MAX_DELIVERY_ATTEMPTS ? "dead" : "failed") as Extract<OutboxStatus, "failed" | "dead">,
    availableAt: now + retryDelaySeconds(attempts) * 1000,
  };
}

interface QueueMessageControl {
  attempts: number;
  retry(options?: { delaySeconds?: number }): void;
  ack(): void;
}

export function settleQueueFailure(message: QueueMessageControl, error: unknown) {
  if (isRetryableJobError(error)) {
    message.retry({ delaySeconds: retryDelaySeconds(message.attempts) });
    return "retry" as const;
  }
  message.ack();
  return "ack" as const;
}
