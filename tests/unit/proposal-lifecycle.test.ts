import { describe, expect, it } from "vitest";
import type { ProposalStatus } from "../../src/shared/domain";
import { applicantMayEditProposal, applicantMayWithdrawProposal } from "../../src/server/proposal-lifecycle";

const statuses: ProposalStatus[] = [
  "draft",
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
  it("only allows ordinary content edits before the proposal is submitted", () => {
    expect(statuses.filter(applicantMayEditProposal)).toEqual(["draft"]);
  });

  it("allows withdrawal while a decision is pending, but not after a final decision", () => {
    expect(statuses.filter(applicantMayWithdrawProposal)).toEqual([
      "submitted",
      "under_review",
      "accept_queue",
      "waitlisted",
      "decline_queue",
    ]);
  });
});
