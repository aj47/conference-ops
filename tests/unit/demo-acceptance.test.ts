import { describe, expect, it } from "vitest";
import { activateDemoAcceptance } from "../../src/client/demo-acceptance";
import { createDemoWorkspace } from "../../src/shared/demo-data";

describe("demo acceptance activation", () => {
  it("creates the session and organizer-authored onboarding plan exactly once", () => {
    const base = createDemoWorkspace();
    const proposal = base.proposals.find((candidate) => !base.sessions.some((session) => session.proposalId === candidate.id))!;
    const staged = {
      ...base,
      proposals: base.proposals.map((candidate) => candidate.id === proposal.id ? { ...candidate, status: "accept_queue" as const } : candidate),
      tasks: base.tasks.filter((task) => !proposal.speakers.some((speaker) => speaker.id === task.speakerId)),
    };

    const activated = activateDemoAcceptance(staged, proposal.id, "session-auto");
    const retried = activateDemoAcceptance(activated, proposal.id, "session-other");

    expect(activated.proposals.find((candidate) => candidate.id === proposal.id)?.status).toBe("accepted");
    expect(activated.sessions).toContainEqual(expect.objectContaining({ id: "session-auto", proposalId: proposal.id, status: "unscheduled" }));
    expect(activated.tasks.filter((task) => proposal.speakers.some((speaker) => speaker.id === task.speakerId))).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Hotel stay requirements", completionMode: "form" }),
      expect.objectContaining({ title: "Flight reimbursement", completionMode: "form" }),
      expect.objectContaining({ title: "Upload final slides", proposalId: proposal.id, completionMode: "file_request" }),
    ]));
    expect(retried.sessions).toHaveLength(activated.sessions.length);
    expect(retried.tasks).toHaveLength(activated.tasks.length);
  });
});
