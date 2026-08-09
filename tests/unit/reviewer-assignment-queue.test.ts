import { describe, expect, it } from "vitest";
import { reviewerAssignmentQueue } from "../../src/client/reviewer-queue";
import type { Proposal, ReviewAssignment } from "../../src/shared/domain";

describe("reviewer assignment queue", () => {
  it("includes only proposals assigned to the signed-in reviewer", () => {
    const proposals = [
      { id: "proposal-mine", title: "Mine", status: "under_review" },
      { id: "proposal-other", title: "Other reviewer", status: "submitted" },
      { id: "proposal-unassigned", title: "Unassigned", status: "submitted" },
      { id: "proposal-revision", title: "Applicant revision", status: "changes_requested" },
      {
        id: "proposal-resubmitted",
        title: "Resubmitted applicant revision",
        status: "under_review",
        revisionRequest: { note: "Please add deployment evidence.", requestedAt: "2026-08-08T12:00:00.000Z" },
      },
      { id: "proposal-withdrawn", title: "Withdrawn", status: "withdrawn" },
    ] as Proposal[];
    const baseReview = {
      round: 1,
      roundName: "Program review",
      status: "pending",
      rubric: [{ id: "fit", label: "Fit", weight: 1, maxScore: 5 }],
      scores: {},
    } satisfies Partial<ReviewAssignment>;
    const reviews = [
      { ...baseReview, id: "review-mine", proposalId: "proposal-mine", reviewerId: "reviewer-me" },
      { ...baseReview, id: "review-other", proposalId: "proposal-other", reviewerId: "reviewer-other" },
      { ...baseReview, id: "review-missing", proposalId: "proposal-not-visible", reviewerId: "reviewer-me" },
      { ...baseReview, id: "review-withdrawn", proposalId: "proposal-withdrawn", reviewerId: "reviewer-me" },
      { ...baseReview, id: "review-revision", proposalId: "proposal-revision", reviewerId: "reviewer-me" },
      {
        ...baseReview,
        id: "review-preserved",
        proposalId: "proposal-resubmitted",
        reviewerId: "reviewer-me",
        status: "submitted",
        submittedAt: "2026-08-08T11:00:00.000Z",
      },
    ] as ReviewAssignment[];

    expect(reviewerAssignmentQueue(proposals, reviews, "reviewer-me").map(({ proposal, review }) => ({
      proposalId: proposal.id,
      reviewId: review.id,
    }))).toEqual([{ proposalId: "proposal-mine", reviewId: "review-mine" }]);
  });
});
