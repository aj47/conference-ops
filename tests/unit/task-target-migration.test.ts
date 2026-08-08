import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL("../../migrations/0004_regular_queen_noir.sql", import.meta.url),
  "utf8",
);

function applyMigration(db: DatabaseSync) {
  for (const statement of migrationSql.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) {
    db.exec(statement);
  }
}

describe("speaker task proposal-target migration", () => {
  it("preserves duplicate legacy NULL targets while enforcing new proposal targets", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE proposals (id TEXT PRIMARY KEY);
      CREATE TABLE speaker_tasks (
        id TEXT PRIMARY KEY,
        template_id TEXT,
        speaker_profile_id TEXT NOT NULL
      );
      INSERT INTO proposals VALUES ('proposal-a'), ('proposal-b');
      INSERT INTO speaker_tasks VALUES
        ('legacy-task-a', 'template-slides', 'speaker-a'),
        ('legacy-task-b', 'template-slides', 'speaker-a');
    `);

    expect(() => applyMigration(db)).not.toThrow();
    expect(db.prepare("SELECT id, proposal_id FROM speaker_tasks ORDER BY id").all()).toEqual([
      { id: "legacy-task-a", proposal_id: null },
      { id: "legacy-task-b", proposal_id: null },
    ]);

    db.prepare("UPDATE speaker_tasks SET proposal_id = 'proposal-a' WHERE id = 'legacy-task-a'").run();
    expect(() => db.prepare("UPDATE speaker_tasks SET proposal_id = 'proposal-a' WHERE id = 'legacy-task-b'").run()).toThrow();
    expect(() => db.prepare("UPDATE speaker_tasks SET proposal_id = 'proposal-b' WHERE id = 'legacy-task-b'").run()).not.toThrow();
    expect(db.prepare("SELECT on_delete FROM pragma_foreign_key_list('speaker_tasks') WHERE \"table\" = 'proposals'").get()).toEqual({ on_delete: "CASCADE" });
  });
});
