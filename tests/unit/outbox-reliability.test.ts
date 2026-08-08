import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ExhaustedOutboxError,
  NonRetryableJobError,
  OUTBOX_MAX_DELIVERY_ATTEMPTS,
  OUTBOX_STALE_AFTER_MS,
  claimOutboxSql,
  markExhaustedOutboxSql,
  markOutboxFailedSql,
  markOutboxSentSql,
  outboxFailureState,
  selectDueOutboxSql,
  settleQueueFailure,
} from "../../src/jobs/outbox";

describe("outbox delivery leases", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE outbox (
        id TEXT PRIMARY KEY,
        idempotency_key TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        available_at INTEGER NOT NULL,
        last_error TEXT,
        sent_at INTEGER,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO outbox (id, idempotency_key, kind, payload, status, attempts, available_at, updated_at)
      VALUES ('job-1', 'key-1', 'email', '{}', 'queued', 0, 1000, 1000);
    `);
  });

  it("allows one atomic claim and only reclaims a stale processing lease", () => {
    expect(db.prepare(claimOutboxSql).run(2000, "job-1", 2000 - OUTBOX_STALE_AFTER_MS).changes).toBe(1);
    expect(db.prepare(claimOutboxSql).run(2001, "job-1", 2001 - OUTBOX_STALE_AFTER_MS).changes).toBe(0);
    expect(db.prepare(claimOutboxSql).run(2000 + OUTBOX_STALE_AFTER_MS, "job-1", 2000).changes).toBe(1);
    expect(db.prepare("SELECT status, attempts FROM outbox WHERE id = 'job-1'").get()).toEqual({ status: "processing", attempts: 2 });
  });

  it("dead-letters an exhausted stale lease instead of claiming attempt six or re-enqueuing it", () => {
    db.prepare("UPDATE outbox SET status = 'processing', attempts = 5, updated_at = ? WHERE id = 'job-1'").run(2000);
    const staleAt = 2000 + OUTBOX_STALE_AFTER_MS;

    expect(db.prepare(claimOutboxSql).run(staleAt, "job-1", 2000).changes).toBe(0);
    expect(db.prepare("SELECT attempts FROM outbox WHERE id = 'job-1'").get()).toEqual({ attempts: 5 });

    expect(db.prepare(markExhaustedOutboxSql).run(staleAt, 2000).changes).toBe(1);
    expect(db.prepare("SELECT status, attempts, last_error FROM outbox WHERE id = 'job-1'").get()).toEqual({
      status: "dead",
      attempts: 5,
      last_error: "Delivery attempts exhausted before the lease completed.",
    });
    expect(db.prepare(selectDueOutboxSql).all(staleAt, 2000)).toEqual([]);
  });

  it("prevents an expired lease from recording another worker's completion", () => {
    db.prepare(claimOutboxSql).run(2000, "job-1", 0);
    expect(db.prepare(markOutboxSentSql).run(3000, 3000, "job-1", 1999).changes).toBe(0);
    expect(db.prepare(markOutboxSentSql).run(3000, 3000, "job-1", 2000).changes).toBe(1);
    expect(db.prepare("SELECT status, sent_at FROM outbox WHERE id = 'job-1'").get()).toEqual({ status: "sent", sent_at: 3000 });
  });

  it("backs off transient failures and marks the fifth failed delivery dead", () => {
    db.prepare(claimOutboxSql).run(2000, "job-1", 0);
    const transient = outboxFailureState(1, true, 3000);
    expect(transient).toEqual({ status: "failed", availableAt: 33000 });
    expect(db.prepare(markOutboxFailedSql).run(transient.status, "temporary", transient.availableAt, 3000, "job-1", 2000).changes).toBe(1);

    expect(outboxFailureState(5, true, 4000).status).toBe("dead");
    expect(outboxFailureState(1, false, 4000).status).toBe("dead");
  });
});

describe("Cloudflare Queue settlement", () => {
  it("retries an exhausted outbox row instead of acknowledging it, allowing max_retries to route it to the DLQ", () => {
    const message = { attempts: 5, retry: vi.fn(), ack: vi.fn() };

    expect(settleQueueFailure(message, new ExhaustedOutboxError())).toBe("retry");
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("acknowledges only explicitly non-retryable failures", () => {
    const message = { attempts: 1, retry: vi.fn(), ack: vi.fn() };

    expect(settleQueueFailure(message, new NonRetryableJobError("unsupported"))).toBe("ack");
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });

  it("keeps every deployed consumer's max retries aligned with the outbox limit and a DLQ", () => {
    const config = JSON.parse(readFileSync(resolve(process.cwd(), "wrangler.jobs.jsonc"), "utf8")) as {
      queues: { consumers: Array<{ max_retries: number; dead_letter_queue?: string }> };
      env: Record<string, { queues: { consumers: Array<{ max_retries: number; dead_letter_queue?: string }> } }>;
    };
    const consumers = [config.queues.consumers[0], ...Object.values(config.env).map((environment) => environment.queues.consumers[0])];

    for (const consumer of consumers) {
      expect(consumer.max_retries).toBe(OUTBOX_MAX_DELIVERY_ATTEMPTS);
      expect(consumer.dead_letter_queue).toMatch(/-dlq$/);
    }
  });
});
