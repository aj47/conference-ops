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
      name TEXT NOT NULL,
      slug TEXT NOT NULL,
      kind TEXT NOT NULL,
      target_type TEXT NOT NULL,
      status TEXT NOT NULL,
      current_version INTEGER NOT NULL,
      published_version INTEGER,
      submission_type TEXT NOT NULL,
      collects_participants INTEGER NOT NULL,
      max_submissions_per_user INTEGER,
      redirect_to_portal INTEGER NOT NULL,
      confirmation_email_enabled INTEGER NOT NULL,
      closes_at INTEGER,
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
      settings TEXT NOT NULL
    );
    CREATE TABLE proposals (
      id TEXT PRIMARY KEY,
      form_version_id TEXT NOT NULL,
      status TEXT NOT NULL
    );

    INSERT INTO submission_forms VALUES ('form-a', 'event-a', 'CFP', 'external-cfp', 'cfp', 'submission', 'published', 2, 1, 'abstract', 1, 3, 1, 1, 100, 20);
    INSERT INTO form_versions VALUES
      ('form-a-v1', 'form-a', 1, 'Published title', 'Apply', 'Published welcome', 'Published copy', 'Published confirmation', 2, 1, '[{"id":"published-field"}]', '{"proposalSectionTitle":"Published section","submissionControls":{"submissionType":"abstract","collectsParticipants":true,"maxSubmissionsPerUser":3,"redirectToPortal":true,"confirmationEmailEnabled":true,"closesAt":"2027-01-01T00:00:00.000Z"}}'),
      ('form-a-v2', 'form-a', 2, 'Private draft title', 'Draft', 'Private draft welcome', 'Unpublished copy', 'Unpublished confirmation', 4, 1, '[{"id":"private-draft-field"}]', '{"proposalSectionTitle":"Private draft section","submissionControls":{"submissionType":"session","collectsParticipants":false,"maxSubmissionsPerUser":9,"redirectToPortal":false,"confirmationEmailEnabled":false,"closesAt":"2027-02-01T00:00:00.000Z"}}');
  `);
  return db;
}

describe("workspace form projection", () => {
  it("shows organizers the mutable current version", () => {
    const db = databaseWithPublishedAndDraftVersions();
    const row = db.prepare(workspaceFormRowsSql("organizer")).get("event-a") as Record<string, unknown>;

    expect(row.public_title).toBe("Private draft title");
    expect(row.fields).toContain("private-draft-field");
    expect(row.settings).toContain("Private draft section");
    expect(row.settings).toContain('"submissionType":"session"');
    expect(row.legacy_submission_type).toBe("abstract");
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
      expect(row.settings).toContain("Published section");
      expect(row.settings).not.toContain("Private draft section");
      expect(row.settings).toContain('"submissionType":"abstract"');
    },
  );
});
