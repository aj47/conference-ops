import { describe, expect, it } from "vitest";
import { eventIdFromApiPath } from "../../src/server/http";

describe("event-scoped API path parsing", () => {
  it("extracts and decodes an event ID before route params are available", () => {
    expect(eventIdFromApiPath("/api/v1/events/event-aie-2026/proposals/p-1/decision")).toBe("event-aie-2026");
    expect(eventIdFromApiPath("/api/v1/events/event%20one/uploads")).toBe("event one");
  });

  it("does not infer event scope for global, malformed, or lookalike routes", () => {
    expect(eventIdFromApiPath("/api/v1/bootstrap")).toBeUndefined();
    expect(eventIdFromApiPath("/api/v1/event/event-a")).toBeUndefined();
    expect(eventIdFromApiPath("/api/v1/events/%E0%A4%A/tasks")).toBeUndefined();
  });
});
