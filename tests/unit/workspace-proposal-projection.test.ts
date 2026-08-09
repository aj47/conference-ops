import { describe, expect, it } from "vitest";
import type { Proposal } from "../../src/shared/domain";
import { workspaceProposalForRole } from "../../src/server/workspace";

const proposal: Proposal = {
  id: "proposal-a",
  eventId: "event-a",
  title: "Private projection contract",
  summary: "A proposal with enough detail to exercise role projection.",
  category: "Build",
  format: "talk",
  durationMinutes: 30,
  level: "intermediate",
  status: "under_review",
  revisionRequest: {
    note: "Clarify the benchmark and move this proposal to the evaluation track.",
    requestedAt: "2026-08-04T12:00:00.000Z",
    requestedBy: "organizer",
  },
  speakers: [],
  submittedAt: "2026-08-01T00:00:00.000Z",
  score: 4.75,
  reviewCount: 2,
  reviewerGroup: "Security committee",
  tags: [],
};

function serializedProjection(role: "organizer" | "reviewer" | "applicant" | "speaker") {
  return JSON.parse(JSON.stringify(workspaceProposalForRole(proposal, role))) as Record<string, unknown>;
}

describe("production workspace proposal role projection", () => {
  it.each(["applicant", "speaker"] as const)("omits internal review signal from the serialized %s snapshot", (role) => {
    const serialized = serializedProjection(role);

    expect(serialized).not.toHaveProperty("score");
    expect(serialized).not.toHaveProperty("reviewerGroup");
    expect(serialized).toMatchObject({ id: "proposal-a", reviewCount: 2, status: "under_review" });
  });

  it.each(["organizer", "reviewer"] as const)("keeps review signal in the serialized %s snapshot", (role) => {
    expect(serializedProjection(role)).toMatchObject({ score: 4.75, reviewerGroup: "Security committee" });
  });

  it("shows the latest revision note to the owning applicant but not a later reviewer", () => {
    expect(serializedProjection("applicant")).toMatchObject({ revisionRequest: { note: expect.stringContaining("benchmark") } });
    expect(serializedProjection("reviewer")).not.toHaveProperty("revisionRequest");
    expect(serializedProjection("organizer")).toMatchObject({ revisionRequest: { requestedAt: "2026-08-04T12:00:00.000Z", requestedBy: "organizer" } });
  });

  it("does not mutate the organizer projection reused in the same request", () => {
    workspaceProposalForRole(proposal, "applicant");
    expect(proposal).toMatchObject({ score: 4.75, reviewerGroup: "Security committee" });
  });
});
