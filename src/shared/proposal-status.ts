import type { ProposalStatus } from "./domain";

/**
 * Conversion preserves the accepted program decision while advancing the
 * proposal into its linked-session lifecycle state.
 */
export function isAcceptedProposalStatus(status: ProposalStatus) {
  return status === "accepted" || status === "session";
}
