import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";

vi.mock("../../src/server/auth", () => ({
  createAuth: () => ({
    api: { getSession: async () => ({ user: { id: "user-speaker", name: "Priya Raman", email: "priya@example.test" } }) },
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
    CREATE TABLE speaker_profiles (
      id TEXT PRIMARY KEY, user_id TEXT, event_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '', bio TEXT NOT NULL DEFAULT '', pronouns TEXT,
      city TEXT, headshot_upload_id TEXT, profile_complete INTEGER NOT NULL DEFAULT 0,
      published INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(email, event_id)
    );
    CREATE TABLE speaker_operations (
      speaker_profile_id TEXT PRIMARY KEY, event_id TEXT NOT NULL, workflow_status TEXT NOT NULL,
      social_links TEXT NOT NULL, travel_details TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE uploads (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, object_key TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL, content_type TEXT NOT NULL, byte_size INTEGER NOT NULL, purpose TEXT NOT NULL,
      public INTEGER NOT NULL DEFAULT 0, deleted_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE file_requests (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, instructions_html TEXT NOT NULL,
      target_type TEXT NOT NULL, required INTEGER NOT NULL, status TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE task_templates (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
      type TEXT NOT NULL, target_type TEXT NOT NULL, completion_mode TEXT NOT NULL,
      relative_due_days INTEGER NOT NULL, external_url TEXT, form_version_id TEXT, file_request_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE speaker_tasks (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, template_id TEXT, speaker_profile_id TEXT NOT NULL,
      proposal_id TEXT, title TEXT NOT NULL, description TEXT NOT NULL, type TEXT NOT NULL,
      status TEXT NOT NULL, external_url TEXT, artifact_upload_id TEXT, due_at INTEGER NOT NULL,
      completed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE file_request_responses (
      id TEXT PRIMARY KEY, file_request_id TEXT NOT NULL, target_id TEXT NOT NULL, uploader_user_id TEXT NOT NULL,
      upload_ids TEXT NOT NULL DEFAULT '[]', submitted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(file_request_id, target_id)
    );
    CREATE TABLE program_sessions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, proposal_id TEXT, title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unscheduled',
      format TEXT NOT NULL DEFAULT 'talk', starts_at INTEGER, room_id TEXT,
      calendar_sequence INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE proposals (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL);
    CREATE TABLE session_speakers (
      session_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL,
      PRIMARY KEY(session_id, speaker_profile_id)
    );
    CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE task_comments (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, task_id TEXT NOT NULL,
      author_user_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE session_content_status (
      session_id TEXT PRIMARY KEY, event_id TEXT NOT NULL, status TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE content_revisions (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      version INTEGER NOT NULL, snapshot TEXT NOT NULL, editor_user_id TEXT, editor_name TEXT NOT NULL,
      restored_from_version INTEGER, created_at INTEGER NOT NULL,
      UNIQUE(event_id, entity_type, entity_id, version)
    );
    INSERT INTO event_memberships VALUES ('event-a', 'user-speaker', 'organizer');
    INSERT INTO event_memberships VALUES ('event-a', 'user-speaker', 'speaker');
    INSERT INTO speaker_profiles VALUES (
      'speaker-a', 'user-speaker', 'event-a', 'Priya Raman', 'priya@example.test', 'Staff Engineer',
      'Latticework', 'Original bio', 'she/her', 'San Francisco', NULL, 0, 0, 1, 1
    );
    INSERT INTO speaker_operations VALUES ('speaker-a', 'event-a', 'confirmed', '{"website":"https://old.example"}', 'Private arrival and lodging notes', 1, 1);
    INSERT INTO program_sessions
      (id, event_id, proposal_id, title, description, status, format, calendar_sequence, version, updated_at)
    VALUES ('session-a', 'event-a', NULL, 'Original session title', 'Original session description', 'scheduled', 'talk', 4, 8, 1);
    INSERT INTO session_speakers VALUES ('session-a', 'speaker-a');
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
    BETTER_AUTH_SECRET: "speaker-content-test-secret-is-long-enough",
    MAIL_FROM: "Conference Ops <program@example.test>",
    MAIL_REPLY_TO: "program@example.test",
  };
}

function request(d1: TestD1, path: string, method: "POST" | "PUT", role: "organizer" | "speaker", body: unknown) {
  return app.request(`http://localhost/api/v1/events/event-a${path}`, {
    method,
    headers: { "content-type": "application/json", "x-event-role": role },
    body: JSON.stringify(body),
  }, bindings(d1));
}

function loadSpeakerContent(d1: TestD1, role: "organizer" | "speaker") {
  return app.request("http://localhost/api/v1/events/event-a/speaker-content", {
    headers: { "x-event-role": role },
  }, bindings(d1));
}

function updateLegacyProfile(d1: TestD1, role: "organizer" | "speaker", demo: boolean) {
  return app.request("http://localhost/api/v1/events/event-a/speakers/speaker-a/profile", {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      "x-event-role": role,
      ...(demo ? { "x-demo-actor": role === "organizer" ? "user-organizer" : "user-speaker" } : {}),
    },
    body: JSON.stringify({
      name: "Priya Raman",
      title: "Staff Engineer",
      company: "Latticework",
      bio: "Organizer-reviewed speaker bio",
      publish: true,
    }),
  }, { ...bindings(d1), DEMO_MODE: demo ? "true" : "false" });
}

describe("speaker and content workflow API", () => {
  let d1: TestD1;
  beforeEach(() => { d1 = fixture(); });

  it.each([
    ["persisted", false],
    ["demo", true],
  ])("reserves legacy profile publication for organizers in %s mode", async (_mode, demo) => {
    const speakerResponse = await updateLegacyProfile(d1, "speaker", demo);

    expect(speakerResponse.status).toBe(403);
    expect(await speakerResponse.json()).toMatchObject({ error: { code: "ROLE_REQUIRED" } });
    expect(d1.sqlite.prepare("SELECT published FROM speaker_profiles WHERE id = 'speaker-a'").get()).toEqual({ published: 0 });

    const organizerResponse = await updateLegacyProfile(d1, "organizer", demo);

    expect(organizerResponse.status).toBe(200);
    expect(await organizerResponse.json()).toMatchObject({ data: { id: "speaker-a", publish: true } });
    expect(d1.sqlite.prepare("SELECT published FROM speaker_profiles WHERE id = 'speaker-a'").get())
      .toEqual({ published: demo ? 0 : 1 });
  });

  it("does not disclose private travel details in the speaker snapshot", async () => {
    const response = await loadSpeakerContent(d1, "speaker");
    const payload = await response.json() as { data: { speakers: Array<{ id: string; travelDetails: string }> } };

    expect(response.status).toBe(200);
    expect(payload.data.speakers).toEqual([
      expect.objectContaining({ id: "speaker-a", travelDetails: "" }),
    ]);
    expect(JSON.stringify(payload)).not.toContain("Private arrival and lodging notes");
    expect(d1.sqlite.prepare("SELECT travel_details FROM speaker_operations WHERE speaker_profile_id = 'speaker-a'").get())
      .toEqual({ travel_details: "Private arrival and lodging notes" });
  });

  it("prevents speaker self-service from changing organizer workflow, publication, identity, email, or travel fields", async () => {
    const response = await request(d1, "/speakers/speaker-a/manage", "PUT", "speaker", {
      name: "Malicious Rename",
      email: "takeover@example.test",
      title: "Principal Engineer",
      company: "Latticework",
      bio: "Portal-edited bio",
      pronouns: "she/her",
      city: "Oakland",
      workflowStatus: "declined",
      socialLinks: { website: "https://new.example" },
      travelDetails: "Vegetarian",
      published: true,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { travelDetails: "" } });
    expect(d1.sqlite.prepare("SELECT name, email, title, bio, published FROM speaker_profiles WHERE id = 'speaker-a'").get()).toEqual({
      name: "Priya Raman",
      email: "priya@example.test",
      title: "Principal Engineer",
      bio: "Portal-edited bio",
      published: 0,
    });
    expect(d1.sqlite.prepare("SELECT workflow_status, social_links, travel_details FROM speaker_operations WHERE speaker_profile_id = 'speaker-a'").get()).toEqual({
      workflow_status: "confirmed",
      social_links: '{"website":"https://new.example"}',
      travel_details: "Private arrival and lodging notes",
    });
  });

  it("creates a durable file-request template and retains both upload versions on repeat submission", async () => {
    const created = await request(d1, "/speaker-tasks/bulk", "POST", "organizer", {
      title: "Upload Session Presentation",
      description: "Final slide deck as a PDF, 16:9 aspect ratio.",
      dueAt: "2027-05-01T12:00:00.000Z",
      kind: "file_request",
      speakerIds: ["speaker-a"],
    });
    const createdPayload = await created.json() as { data: { taskIds: string[] } };
    const taskId = createdPayload.data.taskIds[0];

    expect(created.status).toBe(201);
    expect(d1.sqlite.prepare("SELECT completion_mode, file_request_id FROM task_templates").get()).toEqual({
      completion_mode: "file_request",
      file_request_id: expect.any(String),
    });
    expect(d1.sqlite.prepare("SELECT template_id FROM speaker_tasks WHERE id = ?").get(taskId)).toEqual({ template_id: expect.any(String) });

    d1.sqlite.prepare("INSERT INTO uploads (id, event_id, owner_user_id, file_name, content_type, byte_size, purpose, created_at) VALUES (?, 'event-a', 'user-speaker', 'slides.pdf', 'application/pdf', 12, 'slides', ?)").run("upload-v1", 10);
    d1.sqlite.prepare("INSERT INTO uploads (id, event_id, owner_user_id, file_name, content_type, byte_size, purpose, created_at) VALUES (?, 'event-a', 'user-speaker', 'slides.pdf', 'application/pdf', 14, 'slides', ?)").run("upload-v2", 20);

    expect((await request(d1, `/tasks/${taskId}/artifact`, "POST", "speaker", { uploadId: "upload-v1" })).status).toBe(200);
    expect((await request(d1, `/tasks/${taskId}/artifact`, "POST", "speaker", { uploadId: "upload-v2" })).status).toBe(200);

    const response = d1.sqlite.prepare("SELECT upload_ids FROM file_request_responses").get() as { upload_ids: string };
    expect(JSON.parse(response.upload_ids)).toEqual(["upload-v1", "upload-v2"]);
    expect(d1.sqlite.prepare("SELECT artifact_upload_id, status FROM speaker_tasks WHERE id = ?").get(taskId)).toEqual({
      artifact_upload_id: "upload-v2",
      status: "complete",
    });
  });

  it("rejects a headshot reference that is not an organizer-owned headshot in the event", async () => {
    d1.sqlite.prepare("INSERT INTO uploads (id, event_id, owner_user_id, file_name, content_type, byte_size, purpose, created_at) VALUES ('foreign-upload', 'event-a', 'someone-else', 'slides.pdf', 'application/pdf', 12, 'slides', 10)").run();
    const response = await request(d1, "/speakers/manage", "POST", "organizer", {
      name: "Dana Kowalski",
      email: "dana@example.test",
      title: "Founder",
      company: "Flowstate",
      bio: "Speaker bio",
      workflowStatus: "invited",
      socialLinks: {},
      travelDetails: "",
      headshotUploadId: "foreign-upload",
      published: false,
    });

    expect(response.status).toBe(422);
    expect(d1.sqlite.prepare("SELECT COUNT(*) AS count FROM speaker_profiles WHERE email = 'dana@example.test'").get()).toEqual({ count: 0 });
  });

  it.each([
    ["a non-HTTPS scheme", "javascript:alert(1)"],
    ["embedded credentials", "https://user:password@example.test/profile"],
  ])("rejects social links with %s", async (_label, website) => {
    const response = await request(d1, "/speakers/speaker-a/manage", "PUT", "speaker", {
      name: "Priya Raman",
      email: "priya@example.test",
      title: "Staff Engineer",
      company: "Latticework",
      bio: "Attempted unsafe social edit",
      workflowStatus: "confirmed",
      socialLinks: { website },
      travelDetails: "",
      published: false,
    });

    expect(response.status).toBe(400);
    expect(d1.sqlite.prepare("SELECT bio FROM speaker_profiles WHERE id = 'speaker-a'").get()).toEqual({ bio: "Original bio" });
    expect(d1.sqlite.prepare("SELECT social_links FROM speaker_operations WHERE speaker_profile_id = 'speaker-a'").get()).toEqual({
      social_links: '{"website":"https://old.example"}',
    });
  });

  it("bumps scheduled-session calendar sequence atomically on content save and restore, but not on rejected writes", async () => {
    const rejected = await request(d1, "/sessions/session-a/content", "PUT", "organizer", {
      title: "Rejected title",
      description: "This update names a speaker from another event.",
      contentStatus: "in_review",
      speakerIds: ["speaker-does-not-exist"],
    });
    expect(rejected.status).toBe(422);
    expect(d1.sqlite.prepare("SELECT title, calendar_sequence, version FROM program_sessions WHERE id = 'session-a'").get()).toEqual({
      title: "Original session title",
      calendar_sequence: 4,
      version: 8,
    });

    const saved = await request(d1, "/sessions/session-a/content", "PUT", "organizer", {
      title: "Updated session title",
      description: "Updated session description",
      contentStatus: "approved",
      speakerIds: ["speaker-a"],
    });
    expect(saved.status).toBe(200);
    expect(d1.sqlite.prepare("SELECT title, calendar_sequence, version FROM program_sessions WHERE id = 'session-a'").get()).toEqual({
      title: "Updated session title",
      calendar_sequence: 5,
      version: 9,
    });

    const originalRevision = d1.sqlite.prepare("SELECT id FROM content_revisions WHERE entity_id = 'session-a' AND version = 1").get() as { id: string };
    const restored = await request(d1, `/sessions/session-a/content/restore/${originalRevision.id}`, "POST", "organizer", {});
    expect(restored.status).toBe(200);
    expect(d1.sqlite.prepare("SELECT title, description, calendar_sequence, version FROM program_sessions WHERE id = 'session-a'").get()).toEqual({
      title: "Original session title",
      description: "Original session description",
      calendar_sequence: 6,
      version: 10,
    });
  });
});
