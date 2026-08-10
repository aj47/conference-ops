import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: { getSession: async () => ({ user: { id: "organizer-a", name: "Organizer A", email: "organizer@example.test" } }) },
    handler: async () => new Response(null, { status: 404 }),
  }),
}));

import app from "../../src/server/index";

type SqlValue = string | number | bigint | Uint8Array | null;

class Statement {
  private values: SqlValue[] = [];
  constructor(readonly sql: string, private readonly owner: TestD1) {}
  bind(...values: SqlValue[]) { this.values = values; return this; }
  async first<T>() { return (this.owner.sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null; }
  async all<T>() { return { results: this.owner.sqlite.prepare(this.sql).all(...this.values) as T[] }; }
  async run() {
    const result = this.owner.sqlite.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
}

class TestD1 {
  sqlite = new DatabaseSync(":memory:");
  prepare(sql: string) { return new Statement(sql, this); }
  async batch(statements: Statement[]) {
    this.sqlite.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

function fixture() {
  const d1 = new TestD1();
  d1.sqlite.exec(`
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE events (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, accent TEXT NOT NULL,
      logo_upload_id TEXT, updated_at INTEGER NOT NULL, deleted_at INTEGER
    );
    CREATE TABLE uploads (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
      purpose TEXT NOT NULL, deleted_at INTEGER
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, event_id TEXT,
      actor_user_id TEXT, action TEXT NOT NULL, entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL, summary TEXT NOT NULL, metadata TEXT NOT NULL,
      request_id TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'organizer');
    INSERT INTO events VALUES ('event-a', 'org-a', '#111111', '11111111-1111-4111-8111-111111111111', 1, NULL);
    INSERT INTO uploads VALUES ('22222222-2222-4222-8222-222222222222', 'event-b', 'organizer-a', 'event_logo', NULL);
  `);
  return d1;
}

function bindings(d1: TestD1): Bindings {
  return {
    DB: d1 as unknown as D1Database,
    UPLOADS: {} as R2Bucket,
    ENVIRONMENT: "local",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.test",
    BETTER_AUTH_URL: "https://conference.example.test",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-api-tests",
    MAIL_FROM: "Conference Ops <program@example.test>",
    MAIL_REPLY_TO: "program@example.test",
  };
}

function saveBrand(d1: TestD1, body: { accent: string; logoUploadId?: string | null }, role = "organizer") {
  return app.request("http://localhost/api/v1/events/event-a/brand", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-event-role": role },
    body: JSON.stringify(body),
  }, bindings(d1));
}

describe("event brand API", () => {
  it("persists an organizer brand update and its organization-scoped audit", async () => {
    const d1 = fixture();

    const response = await saveBrand(d1, { accent: "#2D6A6C", logoUploadId: null });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: { accent: "#2d6a6c" } });
    expect(d1.sqlite.prepare("SELECT accent, logo_upload_id FROM events WHERE id = 'event-a'").get()).toEqual({
      accent: "#2d6a6c",
      logo_upload_id: null,
    });
    expect(d1.sqlite.prepare("SELECT organization_id, event_id, action FROM audit_logs").get()).toEqual({
      organization_id: "org-a",
      event_id: "event-a",
      action: "event.brand_updated",
    });
  });

  it("rejects a cross-event logo and a non-organizer role", async () => {
    const d1 = fixture();
    d1.sqlite.prepare("INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'reviewer')").run();

    const foreignLogo = await saveBrand(d1, { accent: "#2d6a6c", logoUploadId: "22222222-2222-4222-8222-222222222222" });
    const reviewer = await saveBrand(d1, { accent: "#2d6a6c" }, "reviewer");

    expect(foreignLogo.status).toBe(422);
    await expect(foreignLogo.json()).resolves.toMatchObject({ error: { code: "EVENT_LOGO_INVALID" } });
    expect(reviewer.status).toBe(403);
    await expect(reviewer.json()).resolves.toMatchObject({ error: { code: "ROLE_REQUIRED" } });
  });
});
