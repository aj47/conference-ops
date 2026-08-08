import { describe, expect, it } from "vitest";
import { proposalToApplicantSubmission, submissionForPersistence } from "../../src/client/submission-proposal";
import type { Proposal } from "../../src/shared/domain";
import type { ApplicantSubmission } from "../../src/client/workspace";

const proposal: Proposal = {
  id: "proposal-draft",
  eventId: "event-a",
  title: "Operating a durable agent queue",
  summary: "A concrete account of the failure modes and recovery paths in a durable agent queue.",
  category: "Agents in production",
  format: "workshop",
  durationMinutes: 60,
  level: "advanced",
  status: "draft",
  version: 3,
  responses: {
    "repo-question": "https://example.com/queue",
    "field-workshop-needs": "A laptop with a recent Node.js runtime.",
    "custom-proof": "A month of production traces",
  },
  speakers: [
    { id: "speaker-a", name: "Ada María Rivera", email: "ada@example.com", title: "Staff Engineer", company: "Northstar", bio: "Builds durable systems.", profileComplete: true },
    { id: "speaker-b", name: "Bo Chen", email: "bo@example.com", title: "Researcher", company: "Open Lab", bio: "Studies agent evaluation.", profileComplete: true },
  ],
  submittedAt: "2026-08-08T12:00:00.000Z",
  reviewCount: 0,
  reviewerGroup: "Agent systems committee",
  tags: [],
};

describe("proposal draft restoration", () => {
  it("restores canonical answers, raw responses, and every speaker", () => {
    const restored = proposalToApplicantSubmission(proposal, {
      participantMin: 1,
      proposalFields: [
        { id: "repo-question", label: "Relevant project or repository", type: "url", required: false },
        { id: "field-workshop-needs", label: "Workshop setup requirements", type: "long_text", required: true },
      ],
    });

    expect(restored).toMatchObject({
      title: proposal.title,
      repoUrl: "https://example.com/queue",
      workshopNeeds: "A laptop with a recent Node.js runtime.",
      responses: proposal.responses,
    });
    expect(restored.speakers).toEqual([
      expect.objectContaining({ firstName: "Ada María", lastName: "Rivera", email: "ada@example.com" }),
      expect.objectContaining({ firstName: "Bo", lastName: "Chen", email: "bo@example.com" }),
    ]);
  });

  it("uses one verified owner for participant-disabled forms without changing enabled rosters", () => {
    const submission: ApplicantSubmission = {
      title: proposal.title,
      summary: proposal.summary,
      category: proposal.category,
      format: proposal.format,
      level: proposal.level,
      repoUrl: "",
      workshopNeeds: "",
      responses: {},
      speakers: [
        { firstName: "", lastName: "", email: "", title: "", company: "", bio: "" },
        { firstName: "Hidden", lastName: "Speaker", email: "hidden@example.com", title: "", company: "", bio: "" },
      ],
    };

    expect(submissionForPersistence(submission, false, {
      name: "Ada María Rivera",
      email: "ada.verified@example.com",
    }).speakers).toEqual([{
      firstName: "Ada María",
      lastName: "Rivera",
      email: "ada.verified@example.com",
      title: "",
      company: "",
      bio: "",
    }]);
    expect(submissionForPersistence(submission, true, {
      name: "Ada María Rivera",
      email: "ada.verified@example.com",
    })).toBe(submission);
  });
});
