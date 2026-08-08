import { describe, expect, it } from "vitest";
import { reviewerAssignmentQueue } from "../../src/client/reviewer-queue";
import type { Proposal, ReviewAssignment } from "../../src/shared/domain";

describe("reviewer assignment queue", () => {
  it("includes only proposals assigned to the signed-in reviewer", () => {
    const proposals = [
      { id: "proposal-mine", title: "Mine" },
      { id: "proposal-other", title: "Other reviewer" },
      { id: "proposal-unassigned", title: "Unassigned" },
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
    ] as ReviewAssignment[];

    expect(reviewerAssignmentQueue(proposals, reviews, "reviewer-me").map(({ proposal, review }) => ({
      proposalId: proposal.id,
      reviewId: review.id,
    }))).toEqual([{ proposalId: "proposal-mine", reviewId: "review-mine" }]);
  });
});
