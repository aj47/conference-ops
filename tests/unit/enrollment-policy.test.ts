import { describe, expect, it } from "vitest";
import { eventAcceptsSelfEnrollment } from "../../src/server/enrollment";

describe("public event enrollment policy", () => {
  it("only grants self-service applicant access while a published CFP is open", () => {
    expect(eventAcceptsSelfEnrollment("cfp_open", true)).toBe(true);
    expect(eventAcceptsSelfEnrollment("cfp_open", false)).toBe(false);
    expect(eventAcceptsSelfEnrollment("draft", true)).toBe(false);
    expect(eventAcceptsSelfEnrollment("review", true)).toBe(false);
    expect(eventAcceptsSelfEnrollment("agenda_published", true)).toBe(false);
    expect(eventAcceptsSelfEnrollment("archived", true)).toBe(false);
  });
});
