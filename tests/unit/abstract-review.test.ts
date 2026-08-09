import { describe, expect, it } from "vitest";
import { boundedProposalEvaluation, reviewResultsCsv } from "../../src/server/abstract-review";
import { workspaceProposalForRole } from "../../src/server/workspace";
import type { Proposal } from "../../src/shared/domain";

const proposal: Proposal = {
  id: "proposal-ci",
  eventId: "event-a",
  title: "Taming 40-Minute CI: Incremental Builds at Monorepo Scale",
  summary: "A production case study about incremental builds, cache invalidation, and verification patterns that cut monorepo CI latency without hiding failed work.",
  category: "Platform & Infra",
  format: "talk",
  durationMinutes: 40,
  level: "advanced",
  status: "under_review",
  speakers: [{ id: "speaker-priya", name: "Priya Raman", email: "priya@example.test", title: "Engineer", company: "Latticework Systems", bio: "Build systems engineer", profileComplete: true, participantRole: "Primary presenter" }],
  submittedAt: "2026-08-01T00:00:00.000Z",
  reviewCount: 0,
  tags: ["ci", "monorepo"],
  responses: {
    "audience-outcome": "A repeatable cache-verification playbook.",
    "speaker-phone": "+1 415 555 0100",
  },
  customResponses: [
    { fieldId: "audience-outcome", label: "Audience outcome", type: "long_text", section: "proposal", value: "A repeatable cache-verification playbook." },
    { fieldId: "speaker-phone", label: "Mobile phone", type: "short_text", section: "participant", value: "+1 415 555 0100" },
  ],
  form: {
    id: "form-cfp",
    eventId: "event-a",
    name: "Call for proposals",
    version: 2,
    status: "published",
    welcomeTitle: "Submit",
    welcomeCopy: "Share the evidence.",
    confirmationCopy: "Received.",
    maxSpeakers: 4,
    allowMultipleDrafts: true,
    fields: [
      { id: "audience-outcome", label: "Audience outcome", type: "long_text", required: true, section: "proposal" },
      { id: "speaker-phone", label: "Mobile phone", type: "short_text", required: false, section: "participant" },
    ],
    submissions: 1,
    updatedAt: "2026-08-01T00:00:00.000Z",
  },
};

describe("abstract review safeguards", () => {
  it("redacts presenter identity only from an anonymized reviewer projection", () => {
    const anonymized = workspaceProposalForRole(proposal, "reviewer", true);
    expect(anonymized.speakers).toEqual([]);
    expect(anonymized.responses).toBeUndefined();
    expect(anonymized.customResponses).toEqual([
      expect.objectContaining({ fieldId: "audience-outcome", section: "proposal" }),
    ]);
    expect(anonymized.form?.fields.map((field) => field.id)).toEqual(["audience-outcome"]);
    expect(JSON.stringify(anonymized)).not.toContain("+1 415 555 0100");
    expect(workspaceProposalForRole(proposal, "reviewer", false).speakers[0]).toMatchObject({ name: "Priya Raman", company: "Latticework Systems" });
    expect(workspaceProposalForRole(proposal, "organizer", true).speakers[0]).toMatchObject({ name: "Priya Raman", participantRole: "Primary presenter" });
    expect(workspaceProposalForRole(proposal, "organizer", true).responses?.["speaker-phone"]).toBe("+1 415 555 0100");
  });

  it("produces proposal-specific bounded reasoning with an explicit organizer boundary", () => {
    const result = boundedProposalEvaluation({
      title: proposal.title,
      summary: proposal.summary,
      category: proposal.category,
      rubric: [{ id: "originality", label: "Originality", type: "numeric", weight: 2, maxScore: 5 }],
    });
    expect(result.score).toBeGreaterThanOrEqual(1);
    expect(result.score).toBeLessThanOrEqual(5);
    expect(result.rationale).toMatch(/incremental|builds|monorepo/i);
    expect(result.rationale).toContain("program chair must review");
  });

  it("exports criterion responses and neutralizes every spreadsheet formula marker after leading controls", () => {
    const csv = reviewResultsCsv([{
      proposalId: "proposal-ci",
      title: "\t=HYPERLINK(\"https://example.test\")",
      category: "+SUM(1,1)",
      round: "Initial Review",
      reviewer: "-2+3",
      status: "submitted",
      aggregateScore: 3.33,
      responses: { originality: 4, relevance: 2, recommendation: "Accept", comments: "@IMPORTXML(\"https://example.test\")" },
      recommendation: "yes",
      notes: " =CMD()",
    }]);
    expect(csv).toContain(`"'\t=HYPERLINK(""https://example.test"")"`);
    expect(csv).toContain(`"'+SUM(1,1)"`);
    expect(csv).toContain(`"'-2+3"`);
    expect(csv).toContain(`"'@IMPORTXML(""https://example.test"")"`);
    expect(csv).toContain(`"' =CMD()"`);
    expect(csv.split("\r\n")[0]).toContain("originality");
  });
});
