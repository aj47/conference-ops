import { describe, expect, it } from "vitest";
import { isOutstandingTaskStatus, isResolvedTaskStatus } from "../../src/shared/task-status";

describe("speaker task lifecycle", () => {
  it.each(["not_started", "in_progress", "overdue"] as const)("treats %s as outstanding work", (status) => {
    expect(isOutstandingTaskStatus(status)).toBe(true);
    expect(isResolvedTaskStatus(status)).toBe(false);
  });

  it.each(["complete", "waived"] as const)("treats %s as resolved and non-actionable", (status) => {
    expect(isOutstandingTaskStatus(status)).toBe(false);
    expect(isResolvedTaskStatus(status)).toBe(true);
  });
});
