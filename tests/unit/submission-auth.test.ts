import { describe, expect, it } from "vitest";
import { submissionAccountError, submissionAccountState } from "../../src/client/submission-auth";

describe("production submission account state", () => {
  it("does not impose production account rules on the demo", () => {
    expect(submissionAccountState("demo", false, null, "speaker@example.com")).toEqual({ kind: "demo" });
  });

  it("requires a verified signed-in account in API mode", () => {
    const anonymous = submissionAccountState("api", false, null, "speaker@example.com");
    const unverified = submissionAccountState(
      "api",
      false,
      { email: "speaker@example.com", emailVerified: false },
      "speaker@example.com",
    );

    expect(anonymous).toEqual({ kind: "anonymous" });
    expect(submissionAccountError(anonymous)).toMatch(/sign in or create/i);
    expect(unverified).toEqual({ kind: "unverified", email: "speaker@example.com" });
    expect(submissionAccountError(unverified)).toContain("Verify speaker@example.com");
  });

  it("blocks another draft owner but accepts normalized matching email", () => {
    const user = { email: "Speaker@Example.com", emailVerified: true };
    const mismatch = submissionAccountState("api", false, user, "other@example.com");

    expect(mismatch).toEqual({
      kind: "mismatch",
      email: "Speaker@Example.com",
      draftEmail: "other@example.com",
    });
    expect(submissionAccountError(mismatch)).toMatch(/other@example.com.*Speaker@Example.com/);
    expect(submissionAccountState("api", false, user, " speaker@example.com ")).toEqual({
      kind: "verified",
      email: "Speaker@Example.com",
    });
  });

  it("keeps the account step blocked while the session check is pending", () => {
    const state = submissionAccountState("api", true, undefined, "");
    expect(state).toEqual({ kind: "checking" });
    expect(submissionAccountError(state)).toMatch(/check your conference account/i);
  });
});
