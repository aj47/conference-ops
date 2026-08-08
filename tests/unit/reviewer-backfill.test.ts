import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { backfillReviewerAssignmentsSql, promoteAssignedBacklogSql } from "../../src/server/reviewer-backfill";

describe("reviewer invitation backlog", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE proposals (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, reviewer_group_id TEXT, status TEXT NOT NULL, updated_at INTEGER NOT NULL, owner_user_id TEXT NOT NULL);
      CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT);
      CREATE TABLE proposal_speakers (proposal_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);
      CREATE TABLE reviewer_groups (id TEXT PRIMARY KEY, event_id TEXT NOT NULL);
      CREATE TABLE reviewer_group_members (reviewer_group_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (reviewer_group_id, user_id));
      CREATE TABLE review_rounds (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, round INTEGER NOT NULL, status TEXT NOT NULL);
      CREATE TABLE review_assignments (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        reviewer_user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        scores TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (proposal_id, round_id, reviewer_user_id)
      );

      INSERT INTO reviewer_groups VALUES ('group-a', 'event-a'), ('group-b', 'event-a'), ('group-other', 'event-b');
      INSERT INTO reviewer_group_members VALUES ('group-a', 'reviewer-new');
      INSERT INTO review_rounds VALUES ('round-a', 'event-a', 1, 'active'), ('round-old', 'event-a', 0, 'closed'), ('round-other', 'event-b', 1, 'active');
      INSERT INTO proposals VALUES
        ('proposal-a', 'event-a', 'group-a', 'submitted', 1, 'applicant-a'),
        ('proposal-already-reviewing', 'event-a', 'group-a', 'under_review', 1, 'applicant-b'),
        ('proposal-owned', 'event-a', 'group-a', 'submitted', 1, 'reviewer-new'),
        ('proposal-co-speaker', 'event-a', 'group-a', 'submitted', 1, 'applicant-c'),
        ('proposal-other-group', 'event-a', 'group-b', 'submitted', 1, 'applicant-d'),
        ('proposal-draft', 'event-a', 'group-a', 'draft', 1, 'applicant-e'),
        ('proposal-withdrawn', 'event-a', 'group-a', 'withdrawn', 1, 'applicant-f'),
        ('proposal-other-event', 'event-b', 'group-other', 'submitted', 1, 'applicant-g');
      INSERT INTO speaker_profiles VALUES ('speaker-reviewer', 'event-a', 'reviewer-new');
      INSERT INTO proposal_speakers VALUES ('proposal-co-speaker', 'speaker-reviewer');
    `);
  });

  function backfill(now = 20) {
    const inserted = db.prepare(backfillReviewerAssignmentsSql)
      .run("reviewer-new", now, now, "reviewer-new", "event-a", "reviewer-new", "reviewer-new");
    const promoted = db.prepare(promoteAssignedBacklogSql).run(now, "event-a");
    return { inserted, promoted };
  }

  it("assigns only routed, reviewable proposals in the invited reviewer's event", () => {
    const { inserted, promoted } = backfill();

    expect(inserted.changes).toBe(2);
    expect(promoted.changes).toBe(1);
    expect(db.prepare("SELECT proposal_id, round_id, reviewer_user_id FROM review_assignments ORDER BY proposal_id").all()).toEqual([
      { proposal_id: "proposal-a", round_id: "round-a", reviewer_user_id: "reviewer-new" },
      { proposal_id: "proposal-already-reviewing", round_id: "round-a", reviewer_user_id: "reviewer-new" },
    ]);
    expect(db.prepare("SELECT id, status FROM proposals ORDER BY id").all()).toContainEqual({ id: "proposal-a", status: "under_review" });
    expect(db.prepare("SELECT status FROM proposals WHERE id = 'proposal-other-group'").get()).toEqual({ status: "submitted" });
    expect(db.prepare("SELECT status FROM proposals WHERE id = 'proposal-owned'").get()).toEqual({ status: "submitted" });
    expect(db.prepare("SELECT status FROM proposals WHERE id = 'proposal-co-speaker'").get()).toEqual({ status: "submitted" });
    expect(db.prepare("SELECT status FROM proposals WHERE id = 'proposal-withdrawn'").get()).toEqual({ status: "withdrawn" });
  });

  it("is idempotent when invitation acceptance is retried", () => {
    expect(backfill().inserted.changes).toBe(2);
    expect(backfill(30).inserted.changes).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM review_assignments").get()).toEqual({ count: 2 });
  });
});
