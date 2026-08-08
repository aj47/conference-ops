import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import {
  dispatchPersistedJobs,
  insertOutboxJobSql,
  type OutboxJob,
} from "../../src/server/outbox-producer";

function createOutboxDatabase() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    event_id TEXT,
    kind TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    available_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  return db;
}

describe("outbox producer", () => {
  it("stores a canonical payload once for an idempotency key", () => {
    const db = createOutboxDatabase();
    const insert = db.prepare(insertOutboxJobSql);
    const now = 100;

    insert.run("job-1", "event-1", "email", "acceptance:speaker-1", JSON.stringify({ subject: "First" }), now, now, now);
    insert.run("job-2", "event-1", "email", "acceptance:speaker-1", JSON.stringify({ subject: "Conflicting" }), now + 1, now + 1, now + 1);

    expect(db.prepare("SELECT id, payload, status, attempts FROM outbox").all()).toEqual([{
      id: "job-1",
      payload: JSON.stringify({ subject: "First" }),
      status: "queued",
      attempts: 0,
    }]);
  });

  it("continues dispatching after a Queue transport failure", async () => {
    const jobs: OutboxJob[] = [
      { kind: "email", idempotencyKey: "one", payload: { eventId: "event-1" } },
      { kind: "email", idempotencyKey: "two", payload: { eventId: "event-1" } },
    ];
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce(undefined);
    const onFailure = vi.fn();

    const dispatched = await dispatchPersistedJobs({ send } as unknown as Queue, jobs, onFailure);

    expect(dispatched).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onFailure).toHaveBeenCalledWith(jobs[0], expect.any(Error));
  });
});
