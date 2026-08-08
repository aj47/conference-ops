import type { Proposal, ReviewAssignment } from "../shared/domain";

export function reviewerAssignmentQueue(proposals: Proposal[], reviews: ReviewAssignment[], reviewerId: string) {
  const proposalsById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  return reviews.flatMap((review) => {
    if (review.reviewerId !== reviewerId) return [];
    const proposal = proposalsById.get(review.proposalId);
    return proposal && proposal.status !== "withdrawn" ? [{ proposal, review }] : [];
  });
}
