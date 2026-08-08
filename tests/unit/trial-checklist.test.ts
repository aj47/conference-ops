import { describe, expect, it } from "vitest";
import { organizerTrialSteps } from "../../src/client/trial-checklist";
import { createDemoWorkspace } from "../../src/shared/demo-data";

describe("organizer trial checklist", () => {
  it("links every private step to the active event and opens the public submission separately", () => {
    const workspace = createDemoWorkspace();
    const steps = organizerTrialSteps(workspace);
    const publicStep = steps.find((step) => step.id === "submission");

    expect(steps).toHaveLength(9);
    expect(publicStep).toMatchObject({ to: "/submit/ai-engineer-summit-2026", external: true });
    expect(steps.filter((step) => !step.external).every((step) => new URL(step.to, "https://conference.test").searchParams.get("eventId") === workspace.event.id)).toBe(true);
    expect(steps.find((step) => step.id === "reviewer")?.to).toContain("action=invite-staff");
  });

  it("starts a fresh event with only the details step complete", () => {
    const workspace = createDemoWorkspace();
    workspace.forms = workspace.forms.map((form) => ({ ...form, status: "draft" }));
    workspace.actors = workspace.actors.filter((actor) => actor.role !== "reviewer");
    workspace.proposals = [];
    workspace.tasks = [];
    workspace.sessions = [];

    expect(organizerTrialSteps(workspace).filter((step) => step.complete).map((step) => step.id)).toEqual(["event"]);
  });

  it("requires all accepted-speaker tasks to be resolved before onboarding completes", () => {
    const workspace = createDemoWorkspace();
    const acceptedSpeaker = workspace.proposals.find((proposal) => proposal.status === "accepted")?.speakers[0];
    expect(acceptedSpeaker).toBeDefined();
    workspace.tasks = workspace.tasks.filter((task) => task.speakerId === acceptedSpeaker!.id);
    workspace.tasks = workspace.tasks.map((task) => ({ ...task, status: "complete" as const }));

    expect(organizerTrialSteps(workspace).find((step) => step.id === "onboarding")?.complete).toBe(true);
    workspace.tasks[0] = { ...workspace.tasks[0], status: "overdue" };
    expect(organizerTrialSteps(workspace).find((step) => step.id === "onboarding")?.complete).toBe(false);
  });
});
