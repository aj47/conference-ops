import type { Bindings } from "./env";

export type OutboxJobKind = "email" | "calendar" | "accelevents" | "airtable";

export interface OutboxJob {
  kind: OutboxJobKind;
  idempotencyKey: string;
  payload: Record<string, unknown>;
}

export const insertOutboxJobSql = `INSERT OR IGNORE INTO outbox
  (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`;

export function prepareOutboxJob(
  db: D1Database,
  job: OutboxJob,
  now = Date.now(),
  id = crypto.randomUUID(),
) {
  const eventId = typeof job.payload.eventId === "string" && job.payload.eventId
    ? job.payload.eventId
    : null;
  return db.prepare(insertOutboxJobSql).bind(
    id,
    eventId,
    job.kind,
    job.idempotencyKey,
    JSON.stringify(job.payload),
    now,
    now,
    now,
  );
}

export async function persistOutboxJobs(
  db: D1Database,
  jobs: OutboxJob[],
  now = Date.now(),
) {
  if (!jobs.length) return;
  await db.batch(jobs.map((job) => prepareOutboxJob(db, job, now)));
}

/**
 * Queue delivery is only a fast path. Every caller must persist the jobs first,
 * so a transport failure can be recovered by the scheduled outbox dispatcher.
 */
export async function dispatchPersistedJobs(
  queue: NonNullable<Bindings["JOBS_QUEUE"]>,
  jobs: OutboxJob[],
  onFailure: (job: OutboxJob, error: unknown) => void = () => undefined,
) {
  let dispatched = 0;
  for (const job of jobs) {
    try {
      await queue.send(job);
      dispatched += 1;
    } catch (error) {
      onFailure(job, error);
    }
  }
  return dispatched;
}
