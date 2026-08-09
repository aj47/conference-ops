import { describe, expect, it } from "vitest";
import type { ProposalStatus } from "../../src/shared/domain";
import { applicantMayEditProposal, applicantMayOpenProposalRevision, applicantMayWithdrawProposal } from "../../src/server/proposal-lifecycle";

const statuses: ProposalStatus[] = [
  "draft",
  "changes_requested",
  "revision_open",
  "submitted",
  "under_review",
  "accept_queue",
  "waitlisted",
  "accepted",
  "decline_queue",
  "rejected",
  "withdrawn",
  "session",
];

describe("applicant proposal lifecycle", () => {
  it("allows content edits only for a draft or a controlled revision", () => {
    expect(statuses.filter(applicantMayEditProposal)).toEqual(["draft", "changes_requested", "revision_open"]);
  });

  it("lets an applicant reopen every non-final submitted decision state", () => {
    expect(statuses.filter(applicantMayOpenProposalRevision)).toEqual(["submitted", "under_review", "accept_queue", "waitlisted", "decline_queue"]);
  });

  it("allows withdrawal while a decision is pending, but not after a final decision", () => {
    expect(statuses.filter(applicantMayWithdrawProposal)).toEqual([
      "changes_requested",
      "revision_open",
      "submitted",
      "under_review",
      "accept_queue",
      "waitlisted",
      "decline_queue",
    ]);
  });
});
