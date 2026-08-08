import { EmailMessage } from "cloudflare:email";
import { buildCalendarInvite, buildRawEmail } from "./calendar";
import { AcceleventsClient } from "./accelevents";
import type { Bindings } from "../server/env";
import {
  ExhaustedOutboxError,
  NonRetryableJobError,
  OUTBOX_STALE_AFTER_MS,
  claimOutboxSql,
  isRetryableJobError,
  markExhaustedOutboxByIdSql,
  markExhaustedOutboxSql,
  markOutboxFailedSql,
  markOutboxSentSql,
  outboxFailureState,
  selectDueOutboxSql,
  settleQueueFailure,
  type JobBody,
  type OutboxKind,
  type StoredOutboxRow,
} from "./outbox";

async function ensureOutbox(env: Bindings, job: JobBody) {
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO outbox (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)")
    .bind(crypto.randomUUID(), job.payload.eventId ? String(job.payload.eventId) : null, job.kind, job.idempotencyKey, JSON.stringify(job.payload), now, now, now)
    .run();
  return env.DB.prepare("SELECT id, status, kind, payload, attempts FROM outbox WHERE idempotency_key = ?")
    .bind(job.idempotencyKey)
    .first<StoredOutboxRow>();
}

function parseStoredPayload(value: string) {
  try {
    const payload: unknown = JSON.parse(value);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Expected an object payload");
    return payload as Record<string, unknown>;
  } catch (error) {
    throw new NonRetryableJobError(`Stored outbox payload is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function sendAuthEmail(env: Bindings, payload: Record<string, unknown>) {
  const recipient = String(payload.recipient ?? "");
  const url = String(payload.url ?? env.PUBLIC_APP_URL);
  const kind = String(payload.kind ?? "verification");
  const subject = kind === "password_reset" ? "Reset your Conference Ops password" : "Verify your Conference Ops email";
  const action = kind === "password_reset" ? "Reset password" : "Verify email";
  const raw = buildRawEmail({
    from: env.MAIL_FROM,
    to: recipient,
    replyTo: env.MAIL_REPLY_TO,
    subject,
    text: `${action}: ${url}\n\nThis link expires soon. If you did not request it, ignore this message.`,
    html: `<p>${action} to continue in Conference Ops.</p><p><a href="${url}">${action}</a></p><p>This link expires soon. If you did not request it, ignore this message.</p>`,
  });
  if (!env.EMAIL) throw new Error("Cloudflare Email binding is not configured");
  await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, recipient, raw));
}

async function sendCalendarEmail(env: Bindings, payload: Record<string, unknown>) {
  const calendar = payload.calendar as Record<string, unknown>;
  const recipient = String(payload.recipient);
  const method = calendar.method === "CANCEL" ? "CANCEL" : "REQUEST";
  const ics = buildCalendarInvite({
    method,
    uid: String(calendar.uid),
    sequence: Number(calendar.sequence ?? 0),
    title: String(calendar.title),
    description: String(calendar.description ?? ""),
    location: String(calendar.location ?? ""),
    startsAt: String(calendar.startsAt),
    endsAt: String(calendar.endsAt),
    organizerEmail: env.MAIL_REPLY_TO,
    organizerName: String(calendar.organizerName ?? "Conference Ops"),
    attendeeEmail: recipient,
    attendeeName: String(payload.recipientName ?? recipient),
  });
  const raw = buildRawEmail({
    from: env.MAIL_FROM,
    to: recipient,
    replyTo: env.MAIL_REPLY_TO,
    subject: String(payload.subject ?? `${method === "CANCEL" ? "Cancelled: " : ""}${String(calendar.title)}`),
    text: String(payload.text ?? "Your conference schedule has been updated."),
    html: String(payload.html ?? "<p>Your conference schedule has been updated.</p>"),
    calendar: { method, ics },
  });
  if (!env.EMAIL) throw new Error("Cloudflare Email binding is not configured");
  await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, recipient, raw));
}

async function sendCommunicationEmail(env: Bindings, payload: Record<string, unknown>) {
  const recipient = String(payload.recipient ?? "");
  if (!recipient) throw new Error("Communication recipient is missing");
  const raw = buildRawEmail({
    from: env.MAIL_FROM,
    to: recipient,
    replyTo: env.MAIL_REPLY_TO,
    subject: String(payload.subject ?? "Conference Ops update"),
    text: String(payload.text ?? "You have an update in Conference Ops."),
    html: String(payload.html ?? "<p>You have an update in Conference Ops.</p>"),
  });
  if (!env.EMAIL) throw new Error("Cloudflare Email binding is not configured");
  await env.EMAIL.send(new EmailMessage(env.MAIL_FROM, recipient, raw));
}

export async function processJob(env: Bindings, job: JobBody) {
  const row = await ensureOutbox(env, job);
  if (!row || row.status === "sent") return;
  if (row.status === "dead") throw new ExhaustedOutboxError();

  const claimedAt = Date.now();
  const claim = await env.DB.prepare(claimOutboxSql)
    .bind(claimedAt, row.id, claimedAt - OUTBOX_STALE_AFTER_MS)
    .run();
  // A fresh processing row is already owned by another delivery. Acknowledge this
  // duplicate without performing the external side effect a second time.
  if (!claim.meta.changes) {
    // Fresh processing rows belong to another consumer and duplicate queue
    // deliveries are safe to acknowledge. A capped stale lease is different:
    // transition it once to D1 dead state and keep retrying this Queue message
    // so Cloudflare's configured max_retries also routes it to the DLQ.
    const exhausted = await env.DB.prepare(markExhaustedOutboxByIdSql)
      .bind(claimedAt, row.id, claimedAt - OUTBOX_STALE_AFTER_MS)
      .run();
    if (exhausted.meta.changes) throw new ExhaustedOutboxError();
    return;
  }
  try {
    // Once an idempotency key exists, the D1 row is canonical. Never deliver a
    // conflicting queue body's payload under an existing key.
    const payload = parseStoredPayload(row.payload);
    if (row.kind === "accelevents") {
      const client = new AcceleventsClient(env);
      await client.preflight();
      throw new NonRetryableJobError("Accelevents entity upserts are not enabled; use the inspectable CSV export.");
    } else if (row.kind === "calendar" || payload.calendar) {
      await sendCalendarEmail(env, payload);
    } else if (payload.kind === "communication") {
      await sendCommunicationEmail(env, payload);
    } else {
      await sendAuthEmail(env, payload);
    }
    const completedAt = Date.now();
    const completion = await env.DB.prepare(markOutboxSentSql).bind(completedAt, completedAt, row.id, claimedAt).run();
    if (!completion.meta.changes) throw new Error("The outbox delivery lease expired before completion could be recorded.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = isRetryableJobError(error);
    const failedAt = Date.now();
    const failure = outboxFailureState(row.attempts + 1, retryable, failedAt);
    await env.DB.prepare(markOutboxFailedSql)
      .bind(failure.status, message.slice(0, 2000), failure.availableAt, failedAt, row.id, claimedAt)
      .run();
    throw error;
  }
}

export default {
  async queue(batch: MessageBatch<JobBody>, env: Bindings) {
    for (const message of batch.messages) {
      try {
        await processJob(env, message.body);
        message.ack();
      } catch (error) {
        settleQueueFailure(message, error);
      }
    }
  },
  async scheduled(_controller: ScheduledController, env: Bindings) {
    if (!env.JOBS_QUEUE) return;
    const now = Date.now();
    // A worker may terminate after claiming a row but before its catch block can
    // record the final attempt. Close those stale leases before selecting due
    // work so Cron cannot create a fresh, unbounded retry cycle.
    await env.DB.prepare(markExhaustedOutboxSql)
      .bind(now, now - OUTBOX_STALE_AFTER_MS)
      .run();
    const due = await env.DB.prepare(selectDueOutboxSql)
      .bind(now, now - OUTBOX_STALE_AFTER_MS)
      .all<{ id: string; idempotency_key: string; kind: OutboxKind; payload: string }>();
    for (const row of due.results) {
      try {
        await env.JOBS_QUEUE.send({ kind: row.kind, idempotencyKey: row.idempotency_key, payload: parseStoredPayload(row.payload) });
      } catch (error) {
        if (error instanceof NonRetryableJobError) {
          await env.DB.prepare("UPDATE outbox SET status = 'dead', last_error = ?, updated_at = ? WHERE id = ? AND status <> 'sent'")
            .bind(error.message.slice(0, 2000), Date.now(), row.id)
            .run();
          continue;
        }
        console.error(JSON.stringify({ event: "outbox.requeue_failed", outboxId: row.id, error: error instanceof Error ? error.message : String(error) }));
      }
    }
  },
};
