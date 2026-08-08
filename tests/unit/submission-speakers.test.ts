import { describe, expect, it } from "vitest";
import {
  blankApplicantSpeaker,
  restoreApplicantSpeakers,
  speakerErrorKey,
  validateApplicantSpeakers,
  type ApplicantSpeaker,
} from "../../src/client/submission-speakers";

function speaker(patch: Partial<ApplicantSpeaker> = {}): ApplicantSpeaker {
  return {
    firstName: "Ada",
    lastName: "Rivera",
    email: "ada@example.com",
    title: "Staff Engineer",
    company: "Northstar",
    bio: "Builds reliable systems.",
    ...patch,
  };
}

describe("applicant speaker roster", () => {
  it("restores legacy single-speaker drafts and pads a newly raised minimum", () => {
    const restored = restoreApplicantSpeakers(undefined, speaker(), 2);

    expect(restored).toHaveLength(2);
    expect(restored[0]).toEqual(speaker());
    expect(restored[1]).toEqual(blankApplicantSpeaker());
    expect(restored[0]).not.toBe(restored[1]);
  });

  it("enforces the configured minimum and maximum", () => {
    expect(validateApplicantSpeakers([speaker()], 2, 4).participantCount).toBe(
      "Add 1 more speaker; this form requires at least 2.",
    );
    expect(validateApplicantSpeakers([
      speaker(),
      speaker({ email: "bo@example.com" }),
      speaker({ email: "cy@example.com" }),
    ], 1, 2).participantCount).toBe(
      "Remove 1 speaker; this form allows at most 2.",
    );
  });

  it("requires valid, case-insensitively distinct emails for every speaker", () => {
    const duplicateErrors = validateApplicantSpeakers([
      speaker({ email: "Ada@Example.com" }),
      speaker({ firstName: "Bo", email: " ada@example.com " }),
    ], 1, 4);

    expect(duplicateErrors[speakerErrorKey(0, "email")]).toBe(
      "Each speaker needs a distinct email address.",
    );
    expect(duplicateErrors[speakerErrorKey(1, "email")]).toBe(
      "Each speaker needs a distinct email address.",
    );

    const invalidErrors = validateApplicantSpeakers([
      speaker({ email: "not-an-email" }),
    ], 1, 4);
    expect(invalidErrors[speakerErrorKey(0, "email")]).toBe(
      "Enter a valid email address.",
    );
  });

  it("accepts a complete roster within its bounds", () => {
    expect(validateApplicantSpeakers([
      speaker(),
      speaker({ firstName: "Bo", lastName: "Chen", email: "bo@example.com" }),
    ], 1, 4)).toEqual({});
  });
});
