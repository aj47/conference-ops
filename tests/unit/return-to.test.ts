import { describe, expect, it } from "vitest";
import { safeReturnTo } from "../../src/client/return-to";

describe("safeReturnTo", () => {
  it("keeps same-origin application paths, queries, and fragments", () => {
    expect(safeReturnTo("/portal/tasks?filter=open#next")).toBe("/portal/tasks?filter=open#next");
  });

  it.each([
    null,
    "",
    "portal/tasks",
    "//evil.example/steal",
    "/\\evil.example/steal",
    "https://evil.example/steal",
    "javascript:alert(1)",
  ])("rejects an external or malformed return target: %s", (value) => {
    expect(safeReturnTo(value)).toBe("/");
  });
});
