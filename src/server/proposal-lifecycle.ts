import type { ProposalStatus } from "../shared/domain";

export function applicantMayEditProposal(status: ProposalStatus) {
  return status === "draft";
}

export function applicantMayWithdrawProposal(status: ProposalStatus) {
  return ["submitted", "under_review", "accept_queue", "decline_queue", "waitlisted"].includes(status);
}
