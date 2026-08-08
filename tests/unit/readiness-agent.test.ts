import { describe, expect, it } from "vitest";
import { readinessAnswer, readinessInsights } from "../../src/server/readiness-agent";
import { createDemoWorkspace } from "../../src/shared/demo-data";

describe("grounded readiness assistant", () => {
  it("prioritizes only evidence present in the current event snapshot", () => {
    const base = createDemoWorkspace();
    const workspace = {
      ...base,
      proposals: [{ ...base.proposals[0], status: "submitted" as const }],
      sessions: [{ ...base.sessions[0], status: "unscheduled" as const, startsAt: undefined, endsAt: undefined, roomId: undefined, trackId: undefined }],
      tasks: [{ ...base.tasks[0], status: "overdue" as const }],
    };

    const insights = readinessInsights(workspace);

    expect(insights.map((insight) => insight.id)).toEqual([
      "unassigned-review",
      "unscheduled-sessions",
      "speaker-tasks",
    ]);
    expect(insights[0].actionPath).toBe(`/program-settings?eventId=${base.event.id}`);
    expect(readinessAnswer(workspace, "What needs attention before we publish?")).toContain("accepted session needs a slot");
  });

  it("reports a clear runway without inventing work or taking action", () => {
    const base = createDemoWorkspace();
    const workspace = { ...base, proposals: [], sessions: [], tasks: [] };

    expect(readinessInsights(workspace)).toEqual([
      expect.objectContaining({ id: "clear-runway", priority: "watch", count: 0 }),
    ]);
    expect(readinessAnswer(workspace, "What should I do next?")).toContain("No unassigned reviews");
  });
});
