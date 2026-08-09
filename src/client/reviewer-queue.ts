import type { Proposal, ReviewAssignment } from "../shared/domain";

export function reviewerAssignmentQueue(proposals: Proposal[], reviews: ReviewAssignment[], reviewerId: string) {
  const proposalsById = new Map(proposals.map((proposal) => [proposal.id, proposal]));
  return reviews.flatMap((review) => {
    if (review.reviewerId !== reviewerId) return [];
    const proposal = proposalsById.get(review.proposalId);
    if (!proposal || !["submitted", "under_review"].includes(proposal.status)) return [];
    const isPreservedPreRevisionEvidence = review.status === "submitted" && proposal.revisionRequest && (
      !review.submittedAt || new Date(review.submittedAt).getTime() <= new Date(proposal.revisionRequest.requestedAt).getTime()
    );
    return isPreservedPreRevisionEvidence ? [] : [{ proposal, review }];
  });
}
