import { describe, expect, it } from "vitest";
import { isAcceptedProposalStatus } from "../../src/shared/proposal-status";

describe("accepted proposal lifecycle", () => {
  it("keeps converted proposals in accepted audiences and readiness counts", () => {
    expect(isAcceptedProposalStatus("accepted")).toBe(true);
    expect(isAcceptedProposalStatus("session")).toBe(true);
  });

  it("excludes staged and non-accepted decisions", () => {
    expect(isAcceptedProposalStatus("accept_queue")).toBe(false);
    expect(isAcceptedProposalStatus("waitlisted")).toBe(false);
    expect(isAcceptedProposalStatus("rejected")).toBe(false);
  });
});
