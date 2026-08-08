import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { workspaceReviewFromRow, workspaceReviewRowsSql } from "../../src/server/workspace";

describe("workspace review projection", () => {
  it("projects the active round rubric and saved criterion scores", () => {
    expect(workspaceReviewFromRow({
      id: "review-1",
      proposal_id: "proposal-1",
      reviewer_user_id: "reviewer-1",
      round: 2,
      round_name: "Final calibration",
      status: "in_progress",
      rubric: JSON.stringify([
        { id: "fit", label: "Program fit", weight: 2, maxScore: 5, description: "Matches the audience" },
        { id: "proof", label: "Evidence", weight: 3, maxScore: 10 },
      ]),
      scores: JSON.stringify({ fit: 5, proof: 7, ignored: "bad" }),
      total_score: 4.12,
      recommendation: "yes",
      notes: "Specific evidence supports the recommendation.",
    })).toEqual({
      id: "review-1",
      proposalId: "proposal-1",
      reviewerId: "reviewer-1",
      round: 2,
      roundName: "Final calibration",
      status: "in_progress",
      rubric: [
        { id: "fit", label: "Program fit", weight: 2, maxScore: 5, description: "Matches the audience" },
        { id: "proof", label: "Evidence", weight: 3, maxScore: 10, description: undefined },
      ],
      scores: { fit: 5, proof: 7 },
      score: 4.12,
      recommendation: "yes",
      notes: "Specific evidence supports the recommendation.",
    });
  });

  it("keeps the workspace readable when a round rubric needs repair", () => {
    expect(workspaceReviewFromRow({
      id: "review-2",
      proposal_id: "proposal-2",
      reviewer_user_id: "reviewer-1",
      round: 1,
      status: "pending",
      rubric: "not-json",
      scores: "{}",
      total_score: null,
    })).toMatchObject({
      roundName: "Round 1",
      rubric: [],
      scores: {},
      score: undefined,
    });
  });
});

describe("workspace review visibility", () => {
  it("keeps only reviewable proposals in reviewer queues while preserving organizer history", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE proposals (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, owner_user_id TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE speaker_profiles (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT);
      CREATE TABLE proposal_speakers (proposal_id TEXT NOT NULL, speaker_profile_id TEXT NOT NULL);
      CREATE TABLE review_rounds (id TEXT PRIMARY KEY, event_id TEXT NOT NULL, round INTEGER NOT NULL, name TEXT NOT NULL, rubric TEXT NOT NULL, status TEXT NOT NULL);
      CREATE TABLE review_assignments (
        id TEXT PRIMARY KEY,
        proposal_id TEXT NOT NULL,
        round_id TEXT NOT NULL,
        reviewer_user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        scores TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO proposals VALUES
        ('proposal-active', 'event-a', 'applicant-a', 'under_review'),
        ('proposal-final', 'event-a', 'applicant-b', 'accepted'),
        ('proposal-withdrawn', 'event-a', 'applicant-c', 'withdrawn'),
        ('proposal-self-owned', 'event-a', 'reviewer-a', 'under_review'),
        ('proposal-claim-later', 'event-a', 'applicant-d', 'under_review');
      INSERT INTO speaker_profiles VALUES ('speaker-claim-later', 'event-a', NULL);
      INSERT INTO proposal_speakers VALUES ('proposal-claim-later', 'speaker-claim-later');
      INSERT INTO review_rounds VALUES ('round-a', 'event-a', 1, 'Program review', '[]', 'active');
      INSERT INTO review_assignments VALUES
        ('review-active', 'proposal-active', 'round-a', 'reviewer-a', 'pending', '{}', 1),
        ('review-final', 'proposal-final', 'round-a', 'reviewer-a', 'submitted', '{}', 2),
        ('review-withdrawn', 'proposal-withdrawn', 'round-a', 'reviewer-a', 'submitted', '{}', 3),
        ('review-other', 'proposal-active', 'round-a', 'reviewer-b', 'pending', '{}', 4),
        ('review-self-owned', 'proposal-self-owned', 'round-a', 'reviewer-a', 'pending', '{}', 5),
        ('review-claim-later', 'proposal-claim-later', 'round-a', 'reviewer-a', 'pending', '{}', 6);
    `);

    const reviewerRowsBeforeClaim = db.prepare(workspaceReviewRowsSql).all("event-a", "reviewer", "reviewer-a", "reviewer-a", "reviewer-a");
    db.prepare("UPDATE speaker_profiles SET user_id = 'reviewer-a' WHERE id = 'speaker-claim-later'").run();
    const reviewerRowsAfterClaim = db.prepare(workspaceReviewRowsSql).all("event-a", "reviewer", "reviewer-a", "reviewer-a", "reviewer-a");
    const organizerRows = db.prepare(workspaceReviewRowsSql).all("event-a", "organizer", "organizer-a", "organizer-a", "organizer-a");

    expect(reviewerRowsBeforeClaim.map((row) => row.id)).toEqual(["review-active", "review-claim-later"]);
    expect(reviewerRowsAfterClaim.map((row) => row.id)).toEqual(["review-active"]);
    expect(organizerRows.map((row) => row.id)).toEqual(["review-active", "review-final", "review-withdrawn", "review-other", "review-self-owned", "review-claim-later"]);
    expect(db.prepare("SELECT status FROM review_assignments WHERE id = 'review-withdrawn'").get()).toEqual({ status: "submitted" });
  });
});
