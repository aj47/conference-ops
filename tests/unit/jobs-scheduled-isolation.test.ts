import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

const scheduledMocks = vi.hoisted(() => ({
  prepareReminders: vi.fn(),
  enabledConnections: vi.fn(),
  drainAirtable: vi.fn(),
  refreshWebhook: vi.fn(),
}));

vi.mock("cloudflare:email", () => ({
  EmailMessage: class EmailMessage {},
}));

vi.mock("../../src/jobs/reminders", () => ({
  prepareScheduledReminders: scheduledMocks.prepareReminders,
}));

vi.mock("../../src/jobs/airtable-sync", () => ({
  drainAirtableChanges: scheduledMocks.drainAirtable,
  enabledAirtableConnections: scheduledMocks.enabledConnections,
  enqueueFullAirtableReconciliation: vi.fn(),
  pullAirtableChanges: vi.fn(),
  refreshAirtableWebhook: scheduledMocks.refreshWebhook,
}));

import jobsWorker from "../../src/jobs/index";

class ScheduledStatement {
  constructor(private readonly sql: string) {}

  bind() {
    return this;
  }

  async run() {
    return { success: true, meta: { changes: 0 }, results: [] };
  }

  async all<T>() {
    if (this.sql.includes("FROM outbox") && this.sql.includes("available_at <= ?")) {
      return { results: [{
        id: "outbox-a",
        idempotency_key: "scheduled-recovery-a",
        kind: "email",
        payload: JSON.stringify({ kind: "communication", eventId: "event-a", recipient: "speaker@example.test" }),
      }] as T[] };
    }
    return { results: [] as T[] };
  }
}

describe("Jobs scheduled failure isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(123_456);
    scheduledMocks.prepareReminders.mockRejectedValue(new Error("reminder query failed"));
    scheduledMocks.enabledConnections.mockResolvedValue([{ id: "connection-a" }]);
    scheduledMocks.drainAirtable.mockResolvedValue({ claimed: 0 });
    scheduledMocks.refreshWebhook.mockResolvedValue({ refreshed: false });
  });

  afterEach(() => vi.restoreAllMocks());

  it("logs a reminder failure and still runs Airtable maintenance and outbox recovery", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = {
      DB: { prepare: (sql: string) => new ScheduledStatement(sql) } as unknown as D1Database,
      JOBS_QUEUE: { send } as unknown as Queue,
      AIRTABLE_ENABLED: "true",
    } as Bindings;

    await jobsWorker.scheduled({} as ScheduledController, env);

    expect(logged).toHaveBeenCalledWith(expect.stringContaining('"event":"reminders.scheduled_prepare_failed"'));
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("reminder query failed"));
    expect(scheduledMocks.enabledConnections).toHaveBeenCalledWith(env.DB);
    expect(scheduledMocks.drainAirtable).toHaveBeenCalledWith(env, expect.objectContaining({ connectionId: "connection-a" }));
    expect(scheduledMocks.refreshWebhook).toHaveBeenCalledWith(env, "connection-a", 123_456);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "scheduled-recovery-a" }));
  });
});
