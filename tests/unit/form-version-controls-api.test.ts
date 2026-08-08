import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";
import { defaultFormVersionSettings } from "../../src/shared/form-settings";
import { formVersionSettingsWithControls } from "../../src/shared/form-version-controls";

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: {
      getSession: async () => ({ user: { id: "organizer-a", name: "Organizer A", email: "organizer@example.com" } }),
    },
    handler: async () => new Response(null, { status: 404 }),
  }),
}));

import app from "../../src/server/index";

type SqlValue = string | number | bigint | Uint8Array | null;

class TestD1Statement {
  private values: SqlValue[] = [];

  constructor(readonly sql: string, private readonly owner: TestD1Database) {}

  bind(...values: SqlValue[]) {
    this.values = values;
    return this;
  }

  async first<T>() {
    return (this.owner.database.prepare(this.sql).get(...this.values) as T | undefined) ?? null;
  }

  async all<T>() {
    return { results: this.owner.database.prepare(this.sql).all(...this.values) as T[] };
  }

  async run() {
    const result = this.owner.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) }, results: [] };
  }
}

class TestD1Database {
  readonly database = new DatabaseSync(":memory:");

  prepare(sql: string) {
    return new TestD1Statement(sql, this);
  }

  async batch(statements: TestD1Statement[]) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function createDatabase(fields: unknown[]) {
  const d1 = new TestD1Database();
  const publishedSettings = formVersionSettingsWithControls(defaultFormVersionSettings, {
    submissionType: "abstract",
    collectsParticipants: true,
    maxSubmissionsPerUser: 3,
    redirectToPortal: true,
    confirmationEmailEnabled: true,
    closesAt: "2027-05-01T20:00:00.000Z",
  });
  d1.database.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE event_memberships (event_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL);
    CREATE TABLE submission_forms (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_type TEXT NOT NULL,
      submission_type TEXT NOT NULL,
      collects_participants INTEGER NOT NULL,
      status TEXT NOT NULL,
      current_version INTEGER NOT NULL,
      published_version INTEGER,
      max_submissions_per_user INTEGER,
      redirect_to_portal INTEGER NOT NULL,
      confirmation_email_enabled INTEGER NOT NULL,
      closes_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE form_versions (
      id TEXT PRIMARY KEY,
      form_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      public_title TEXT NOT NULL,
      page_heading TEXT NOT NULL,
      welcome_title TEXT NOT NULL,
      welcome_copy TEXT NOT NULL,
      confirmation_copy TEXT NOT NULL,
      max_speakers INTEGER NOT NULL,
      allow_multiple_drafts INTEGER NOT NULL,
      fields TEXT NOT NULL,
      settings TEXT NOT NULL,
      created_by TEXT NOT NULL,
      published_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE (form_id, version)
    );
    CREATE TABLE reviewer_groups (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE reviewer_group_members (reviewer_group_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (reviewer_group_id, user_id));

    INSERT INTO events VALUES ('event-a', 'cfp_open', 1);
    INSERT INTO event_memberships VALUES ('event-a', 'organizer-a', 'organizer');
    INSERT INTO submission_forms VALUES (
      'form-a', 'event-a', 'Published CFP', 'cfp', 'cfp', 'submission', 'abstract', 1,
      'published', 1, 1, 3, 1, 1, ${Date.parse("2027-05-01T20:00:00.000Z")}, 1, 1
    );
  `);
  d1.database.prepare(`INSERT INTO form_versions
    (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, created_by, published_at, created_at)
    VALUES (?, 'form-a', 1, 'Published call', 'Apply', 'Published call', 'Published welcome', 'Published confirmation', 4, 1, ?, ?, 'organizer-a', 1, 1)`)
    .run("form-a-v1", JSON.stringify(fields), JSON.stringify(publishedSettings));
  return d1;
}

function bindings(d1: TestD1Database): Bindings {
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

const categoryField = { id: "field-category", label: "Program lane", type: "select", required: true, section: "proposal", options: ["Build"] } as const;
const titleField = { id: "field-title", label: "Session title", type: "short_text", required: true, section: "proposal" } as const;

function draftBody(fields: unknown[]) {
  return {
    expectedVersion: 1,
    name: "Private revised CFP",
    publicTitle: "Private revised call",
    pageHeading: "Propose",
    submissionType: "session",
    collectsParticipants: false,
    welcomeTitle: "Private revised call",
    welcomeCopy: "Private welcome",
    confirmationCopy: "Private confirmation",
    maxSpeakers: 1,
    maxSubmissionsPerUser: 9,
    closesAt: "2027-06-01T20:00:00.000Z",
    allowMultipleDrafts: false,
    redirectToPortal: false,
    confirmationEmailEnabled: false,
    settings: defaultFormVersionSettings,
    fields,
  };
}

describe("versioned form controls API", () => {
  it("keeps published controls unchanged when an organizer saves a private next version", async () => {
    const d1 = createDatabase([titleField, categoryField]);
    d1.database.prepare("UPDATE form_versions SET settings = ? WHERE id = 'form-a-v1'").run(JSON.stringify(defaultFormVersionSettings));
    const response = await app.request("http://localhost/api/v1/events/event-a/forms/form-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draftBody([titleField, categoryField])),
    }, bindings(d1));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { version: 2, status: "draft" } });
    expect(d1.database.prepare(`SELECT current_version, published_version, submission_type, collects_participants,
      max_submissions_per_user, redirect_to_portal, confirmation_email_enabled, closes_at
      FROM submission_forms WHERE id = 'form-a'`).get()).toEqual({
      current_version: 2,
      published_version: 1,
      submission_type: "abstract",
      collects_participants: 1,
      max_submissions_per_user: 3,
      redirect_to_portal: 1,
      confirmation_email_enabled: 1,
      closes_at: Date.parse("2027-05-01T20:00:00.000Z"),
    });
    const stored = d1.database.prepare("SELECT settings FROM form_versions WHERE form_id = 'form-a' AND version = 2").get() as { settings: string };
    expect(JSON.parse(stored.settings)).toMatchObject({
      submissionControls: {
        submissionType: "session",
        collectsParticipants: false,
        maxSubmissionsPerUser: 9,
        redirectToPortal: false,
        confirmationEmailEnabled: false,
        closesAt: "2027-06-01T20:00:00.000Z",
      },
    });
    const published = d1.database.prepare("SELECT settings FROM form_versions WHERE id = 'form-a-v1'").get() as { settings: string };
    expect(JSON.parse(published.settings)).toMatchObject({
      ...defaultFormVersionSettings,
      submissionControls: {
        submissionType: "abstract",
        collectsParticipants: true,
        maxSubmissionsPerUser: 3,
        redirectToPortal: true,
        confirmationEmailEnabled: true,
        closesAt: "2027-05-01T20:00:00.000Z",
      },
    });
  });

  it("creates immutable draft revisions and rejects a stale second-tab save", async () => {
    const d1 = createDatabase([titleField, categoryField]);
    const firstBody = draftBody([titleField, categoryField]);
    const first = await app.request("http://localhost/api/v1/events/event-a/forms/form-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(firstBody),
    }, bindings(d1));
    const stale = await app.request("http://localhost/api/v1/events/event-a/forms/form-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...firstBody, publicTitle: "Stale tab overwrite" }),
    }, bindings(d1));
    const third = await app.request("http://localhost/api/v1/events/event-a/forms/form-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...firstBody, expectedVersion: 2, publicTitle: "Third immutable revision" }),
    }, bindings(d1));

    expect(first.status).toBe(200);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "FORM_VERSION_CONFLICT" } });
    expect(third.status).toBe(200);
    expect(await third.json()).toMatchObject({ data: { version: 3 } });
    expect(d1.database.prepare("SELECT current_version FROM submission_forms WHERE id = 'form-a'").get()).toEqual({ current_version: 3 });
    expect(d1.database.prepare("SELECT version, public_title FROM form_versions WHERE form_id = 'form-a' ORDER BY version").all()).toEqual([
      { version: 1, public_title: "Published call" },
      { version: 2, public_title: "Private revised call" },
      { version: 3, public_title: "Third immutable revision" },
    ]);
  });

  it("preserves a just-published revision and saves the organizer's edits as the next draft", async () => {
    const d1 = createDatabase([titleField, categoryField]);
    const initialBody = { ...draftBody([titleField, categoryField]), confirmationEmailEnabled: true };
    const saved = await app.request("http://localhost/api/v1/events/event-a/forms/form-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(initialBody),
    }, bindings(d1));
    expect(saved.status).toBe(200);
    const published = await app.request("http://localhost/api/v1/events/event-a/forms/form-a/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 2 }),
    }, bindings(d1));
    expect(published.status).toBe(200);

    const postPublishSave = await app.request("http://localhost/api/v1/events/event-a/forms/form-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...initialBody, expectedVersion: 2, publicTitle: "Post-publish private revision" }),
    }, bindings(d1));

    expect(postPublishSave.status).toBe(200);
    expect(await postPublishSave.json()).toMatchObject({ data: { version: 3, status: "draft" } });
    expect(d1.database.prepare("SELECT current_version, published_version FROM submission_forms WHERE id = 'form-a'").get()).toEqual({ current_version: 3, published_version: 2 });
    expect(d1.database.prepare("SELECT version, public_title, published_at IS NOT NULL AS published FROM form_versions WHERE form_id = 'form-a' AND version IN (2, 3) ORDER BY version").all()).toEqual([
      { version: 2, public_title: "Private revised call", published: 1 },
      { version: 3, public_title: "Post-publish private revision", published: 0 },
    ]);
  });

  it("freezes legacy published controls while saving an already-open private draft", async () => {
    const d1 = createDatabase([titleField, categoryField]);
    d1.database.prepare("UPDATE form_versions SET settings = ? WHERE id = 'form-a-v1'").run(JSON.stringify({
      ...defaultFormVersionSettings,
      retainedLegacyKey: "keep-me",
    }));
    d1.database.prepare(`INSERT INTO form_versions
      (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, created_by, published_at, created_at)
      VALUES ('form-a-v2', 'form-a', 2, 'Existing private call', 'Apply', 'Existing private call', 'Private copy', 'Private confirmation', 4, 1, ?, ?, 'organizer-a', NULL, 2)`)
      .run(JSON.stringify([titleField, categoryField]), JSON.stringify(formVersionSettingsWithControls(defaultFormVersionSettings, {
        submissionType: "session",
        collectsParticipants: false,
        maxSubmissionsPerUser: 9,
        redirectToPortal: false,
        confirmationEmailEnabled: false,
        closesAt: "2027-06-01T20:00:00.000Z",
      })));
    d1.database.exec("UPDATE submission_forms SET current_version = 2 WHERE id = 'form-a'");

    const saved = await app.request("http://localhost/api/v1/events/event-a/forms/form-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...draftBody([titleField, categoryField]), expectedVersion: 2, publicTitle: "Next private call", confirmationEmailEnabled: true }),
    }, bindings(d1));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ data: { version: 3 } });
    const published = await app.request("http://localhost/api/v1/events/event-a/forms/form-a/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 3 }),
    }, bindings(d1));
    expect(published.status).toBe(200);

    const legacy = d1.database.prepare("SELECT settings FROM form_versions WHERE id = 'form-a-v1'").get() as { settings: string };
    expect(JSON.parse(legacy.settings)).toMatchObject({
      retainedLegacyKey: "keep-me",
      submissionControls: {
        submissionType: "abstract",
        collectsParticipants: true,
        maxSubmissionsPerUser: 3,
        redirectToPortal: true,
        confirmationEmailEnabled: true,
        closesAt: "2027-05-01T20:00:00.000Z",
      },
    });
    expect(d1.database.prepare("SELECT current_version, published_version, submission_type, collects_participants, max_submissions_per_user FROM submission_forms WHERE id = 'form-a'").get()).toEqual({
      current_version: 3,
      published_version: 3,
      submission_type: "session",
      collects_participants: 0,
      max_submissions_per_user: 9,
    });
  });

  it("requires an optimistic version on every draft update", async () => {
    const d1 = createDatabase([titleField, categoryField]);
    const body: Record<string, unknown> = draftBody([titleField, categoryField]);
    delete body.expectedVersion;
    const response = await app.request("http://localhost/api/v1/events/event-a/forms/form-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, bindings(d1));

    expect(response.status).toBe(400);
    expect(d1.database.prepare("SELECT current_version FROM submission_forms WHERE id = 'form-a'").get()).toEqual({ current_version: 1 });
  });

  it("promotes intentionally cleared optional controls instead of reviving legacy values", async () => {
    const d1 = createDatabase([titleField, categoryField]);
    const body: Record<string, unknown> = { ...draftBody([titleField, categoryField]), confirmationEmailEnabled: true };
    delete body.maxSubmissionsPerUser;
    delete body.closesAt;
    const saved = await app.request("http://localhost/api/v1/events/event-a/forms/form-a", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }, bindings(d1));
    expect(saved.status).toBe(200);

    const published = await app.request("http://localhost/api/v1/events/event-a/forms/form-a/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 2 }),
    }, bindings(d1));

    expect(published.status).toBe(200);
    expect(d1.database.prepare("SELECT max_submissions_per_user, closes_at FROM submission_forms WHERE id = 'form-a'").get()).toEqual({
      max_submissions_per_user: null,
      closes_at: null,
    });
    const stored = d1.database.prepare("SELECT settings FROM form_versions WHERE form_id = 'form-a' AND version = 2").get() as { settings: string };
    expect(JSON.parse(stored.settings).submissionControls).not.toHaveProperty("maxSubmissionsPerUser");
    expect(JSON.parse(stored.settings).submissionControls).not.toHaveProperty("closesAt");
  });

  it("rejects publication without exactly one required unconditional category dropdown", async () => {
    const evidenceField = { id: "field-evidence", label: "Evidence", type: "long_text", required: true, section: "proposal" } as const;
    const d1 = createDatabase([titleField, evidenceField]);
    d1.database.exec("UPDATE submission_forms SET status = 'draft', published_version = NULL; UPDATE form_versions SET published_at = NULL;");
    const response = await app.request("http://localhost/api/v1/events/event-a/forms/form-a/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    }, bindings(d1));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: { code: "FORM_CATEGORY_INVALID", fieldErrors: { category: expect.stringContaining("exactly one") } },
    });
    expect(d1.database.prepare("SELECT status, published_version FROM submission_forms WHERE id = 'form-a'").get()).toEqual({ status: "draft", published_version: null });
    expect(d1.database.prepare("SELECT published_at FROM form_versions WHERE id = 'form-a-v1'").get()).toEqual({ published_at: null });
  });
});
