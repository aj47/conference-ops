import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings, EmailBinding } from "../../src/server/env";
import { OUTBOX_STALE_AFTER_MS, type JobBody } from "../../src/jobs/outbox";

vi.mock("cloudflare:email", () => ({
  EmailMessage: class EmailMessage {},
}));

import jobsWorker from "../../src/jobs/index";

type SqlValue = string | number | bigint | Uint8Array | null;

class TestD1Statement {
  private values: SqlValue[] = [];

  constructor(readonly sql: string, private readonly database: DatabaseSync) {}

  bind(...values: SqlValue[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.database.prepare(this.sql).all(...this.values) as T[] };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
}

function databaseWithProcessingRow(updatedAt: number) {
  const database = new DatabaseSync(":memory:");
  database.exec(`CREATE TABLE outbox (
    id TEXT PRIMARY KEY,
    event_id TEXT,
    kind TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    payload TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL,
    available_at INTEGER NOT NULL,
    last_error TEXT,
    sent_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  database.prepare(`INSERT INTO outbox
    (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'processing', 5, ?, ?, ?)`)
    .run("job-1", "event-a", "email", "key-1", JSON.stringify({ kind: "communication", eventId: "event-a", recipient: "speaker@example.test" }), updatedAt, updatedAt, updatedAt);
  return database;
}

function bindings(database: DatabaseSync, send = vi.fn()) {
  return {
    DB: { prepare: (sql: string) => new TestD1Statement(sql, database) } as unknown as D1Database,
    UPLOADS: {} as R2Bucket,
    EMAIL: { send } as EmailBinding,
    ENVIRONMENT: "production",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.test",
    BETTER_AUTH_URL: "https://conference.example.test",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-api-tests",
    MAIL_FROM: "program@example.test",
    MAIL_REPLY_TO: "program@example.test",
  } satisfies Bindings;
}

function queueMessage(job: JobBody) {
  return {
    body: job,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

describe("outbox process exhaustion", () => {
  afterEach(() => vi.restoreAllMocks());

  it("marks a capped stale lease dead and retries the Queue message toward its DLQ", async () => {
    const now = 2_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const database = databaseWithProcessingRow(now - OUTBOX_STALE_AFTER_MS - 1);
    const emailSend = vi.fn();
    const message = queueMessage({ kind: "email", idempotencyKey: "key-1", payload: {} });

    await jobsWorker.queue({ messages: [message] } as unknown as MessageBatch<JobBody>, bindings(database, emailSend));

    expect(database.prepare("SELECT status, attempts FROM outbox WHERE id = 'job-1'").get()).toEqual({ status: "dead", attempts: 5 });
    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
    expect(emailSend).not.toHaveBeenCalled();
  });

  it("acknowledges a fresh duplicate without stealing or exhausting its active lease", async () => {
    const now = 2_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const database = databaseWithProcessingRow(now);
    const message = queueMessage({ kind: "email", idempotencyKey: "key-1", payload: {} });

    await jobsWorker.queue({ messages: [message] } as unknown as MessageBatch<JobBody>, bindings(database));

    expect(database.prepare("SELECT status, attempts FROM outbox WHERE id = 'job-1'").get()).toEqual({ status: "processing", attempts: 5 });
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();
  });
});
