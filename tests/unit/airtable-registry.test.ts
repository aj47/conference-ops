import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AIRTABLE_ENTITY_REGISTRY, airtableEntity, validateAirtableRemoteValue } from "../../src/shared/airtable-schema";

describe("Airtable canonical entity registry", () => {
  it("uses unique static entity and table identifiers and excludes credential state", () => {
    expect(new Set(AIRTABLE_ENTITY_REGISTRY.map((entry) => entry.entityType)).size).toBe(AIRTABLE_ENTITY_REGISTRY.length);
    expect(new Set(AIRTABLE_ENTITY_REGISTRY.map((entry) => entry.tableName)).size).toBe(AIRTABLE_ENTITY_REGISTRY.length);
    for (const forbidden of ["account", "session", "verification", "outbox", "integration_sync_records"]) {
      expect(AIRTABLE_ENTITY_REGISTRY.some((entry) => entry.tableName === forbidden)).toBe(false);
    }
    expect(airtableEntity("person")?.selectColumns).not.toContain("password");
    expect(airtableEntity("event_invitation")?.selectColumns).not.toContain("token_hash");
    expect(airtableEntity("speaker_profile")?.remoteMutableColumns).not.toContain("profile_complete");
    expect(airtableEntity("program_session")?.remoteMutableColumns).toEqual(expect.arrayContaining(["title", "description"]));
  });

  it("validates and safely coerces every directly editable Airtable value", () => {
    expect(validateAirtableRemoteValue("room", "capacity", "250")).toEqual({ ok: true, value: 250 });
    expect(validateAirtableRemoteValue("communication_schedule", "enabled", "false")).toEqual({ ok: true, value: false });
    expect(validateAirtableRemoteValue("resource_page", "slug", " Speaker-Guide ")).toEqual({ ok: true, value: "speaker-guide" });
    expect(validateAirtableRemoteValue("room", "capacity", -1)).toMatchObject({ ok: false });
    expect(validateAirtableRemoteValue("communication_schedule", "offset_days", 61)).toMatchObject({ ok: false });
    expect(validateAirtableRemoteValue("event", "accent", "red")).toMatchObject({ ok: false });
    expect(validateAirtableRemoteValue("event", "website_url", "javascript:alert(1)")).toMatchObject({ ok: false });
    expect(validateAirtableRemoteValue("resource_page", "embed_url", "https://user:password@example.test/private")).toMatchObject({ ok: false });
    expect(validateAirtableRemoteValue("resource_page", "slug", "../../admin")).toMatchObject({ ok: false });
    expect(validateAirtableRemoteValue("speaker_task", "due_at", null)).toMatchObject({ ok: false });
    expect(validateAirtableRemoteValue("speaker_profile", "profile_complete", true)).toMatchObject({ ok: false });
  });

  it("has insert, update, and delete capture triggers for every registered table", () => {
    const directory = new URL("../../migrations/", import.meta.url);
    const migrations = readdirSync(directory)
      .filter((file) => file.endsWith(".sql"))
      .sort()
      .map((file) => readFileSync(new URL(file, directory), "utf8"))
      .join("\n");
    for (const entity of AIRTABLE_ENTITY_REGISTRY) {
      for (const action of ["insert", "update", "delete"]) {
        expect(migrations).toContain(`CREATE TRIGGER "airtable_${entity.tableName}_${action}"`);
      }
    }
    expect(migrations).not.toMatch(/WHEN EXISTS \(SELECT 1 FROM airtable_connections WHERE enabled = 1\)/);
    expect(migrations).toContain("WHERE enabled = 1 AND event_id IS NULL");
  });
});
