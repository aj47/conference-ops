import type { ProposalStatus } from "../shared/domain";

export function applicantMayEditProposal(status: ProposalStatus) {
  return status === "draft" || status === "changes_requested" || status === "revision_open";
}

export function applicantMayWithdrawProposal(status: ProposalStatus) {
  return ["changes_requested", "revision_open", "submitted", "under_review", "accept_queue", "decline_queue", "waitlisted"].includes(status);
}

export function applicantMayOpenProposalRevision(status: ProposalStatus) {
  return ["submitted", "under_review", "accept_queue", "decline_queue", "waitlisted"].includes(status);
}
