import { describe, expect, it } from "vitest";
import { verifiedPrimarySpeakerMatches } from "../../src/server/submissions";

describe("submission speaker ownership", () => {
  it("only lets a verified account claim its own normalized primary email", () => {
    expect(verifiedPrimarySpeakerMatches(" Speaker@Example.com ", "speaker@example.com")).toBe(true);
    expect(verifiedPrimarySpeakerMatches("speaker@example.com", "other@example.com")).toBe(false);
  });
});
