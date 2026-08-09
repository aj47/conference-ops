import type { Context, Next } from "hono";
import type { AppEnv } from "./env";
import { dispatchPersistedJobs, persistOutboxJobs, type OutboxJob } from "./outbox-producer";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Database triggers capture the concrete entities. This middleware only sends
 * one cheap drain signal after a successful HTTP mutation; Cron remains the
 * recovery path when Queue transport is unavailable.
 */
export async function dispatchAirtableAfterMutation(c: Context<AppEnv>, next: Next) {
  await next();
  if (c.env.AIRTABLE_ENABLED !== "true" || c.env.DEMO_MODE === "true") return;
  if (!mutationMethods.has(c.req.method) || c.res.status < 200 || c.res.status >= 300) return;
  if (c.req.path.includes("/integrations/airtable/webhook")) return;
  const connection = await c.env.DB.prepare("SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1")
    .first<{ id: string }>();
  if (!connection) return;
  const job: OutboxJob = {
    kind: "airtable",
    idempotencyKey: `airtable-drain:${c.get("requestId")}`,
    payload: { action: "drain", connectionId: connection.id },
  };
  await persistOutboxJobs(c.env.DB, [job]);
  if (c.env.JOBS_QUEUE) {
    await dispatchPersistedJobs(c.env.JOBS_QUEUE, [job], (_failedJob, error) => {
      console.error(JSON.stringify({ event: "airtable.queue_failed", connectionId: connection.id, recovery: "scheduled_outbox", error: error instanceof Error ? error.message : String(error) }));
    });
  }
}
