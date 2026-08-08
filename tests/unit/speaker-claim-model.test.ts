import { describe, expect, it } from "vitest";
import {
  isSpeakerClaimEventId,
  speakerPortalDestination,
} from "../../src/client/speaker-claim-model";

describe("speaker claim model", () => {
  it("accepts opaque event IDs used by invitation routes", () => {
    expect(isSpeakerClaimEventId("event-aie-2026")).toBe(true);
    expect(isSpeakerClaimEventId("019fe042-5993-7580-98ca-d0fdd4d23c95")).toBe(true);
  });

  it("rejects missing, path-like, and oversized event IDs", () => {
    expect(isSpeakerClaimEventId("")).toBe(false);
    expect(isSpeakerClaimEventId("../event-a")).toBe(false);
    expect(isSpeakerClaimEventId("event/a")).toBe(false);
    expect(isSpeakerClaimEventId("a".repeat(129))).toBe(false);
  });

  it("uses the speaker portal as the post-claim destination", () => {
    expect(speakerPortalDestination()).toBe("/portal/home?role=speaker");
    expect(speakerPortalDestination("event-aie-2026")).toBe("/portal/home?eventId=event-aie-2026&role=speaker");
  });
});
