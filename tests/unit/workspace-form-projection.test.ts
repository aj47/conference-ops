import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { AuthActor } from "../../src/server/env";
import { workspaceFormRowsSql } from "../../src/server/workspace-forms";

function databaseWithPublishedAndDraftVersions() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE submission_forms (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL,
      current_version INTEGER NOT NULL,
      published_version INTEGER,
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
      fields TEXT NOT NULL
    );
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      form_version_id TEXT NOT NULL,
      status TEXT NOT NULL
    );

    INSERT INTO submission_forms VALUES ('form-a', 'event-a', 'published', 2, 1, 20);
    INSERT INTO form_versions VALUES
      ('form-a-v1', 'form-a', 1, 'Published title', 'Apply', 'Published welcome', 'Published copy', 'Published confirmation', 2, 1, '[{"id":"published-field"}]'),
      ('form-a-v2', 'form-a', 2, 'Private draft title', 'Draft', 'Private draft welcome', 'Unpublished copy', 'Unpublished confirmation', 4, 1, '[{"id":"private-draft-field"}]');
  `);
  return db;
}

describe("workspace form projection", () => {
  it("shows organizers the mutable current version", () => {
    const db = databaseWithPublishedAndDraftVersions();
    const row = db.prepare(workspaceFormRowsSql("organizer")).get("event-a") as Record<string, unknown>;

    expect(row.public_title).toBe("Private draft title");
    expect(row.fields).toContain("private-draft-field");
  });

  it.each<AuthActor["role"]>(["reviewer", "applicant", "speaker"])(
    "shows %s only the immutable published version",
    (role) => {
      const db = databaseWithPublishedAndDraftVersions();
      const row = db.prepare(workspaceFormRowsSql(role)).get("event-a") as Record<string, unknown>;

      expect(row.public_title).toBe("Published title");
      expect(row.welcome_copy).toBe("Published copy");
      expect(row.fields).toContain("published-field");
      expect(row.fields).not.toContain("private-draft-field");
    },
  );
});
