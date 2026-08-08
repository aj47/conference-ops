import type { WorkspaceSnapshot } from "../shared/domain";
import { isAcceptedProposalStatus } from "../shared/proposal-status";
import { isOutstandingTaskStatus } from "../shared/task-status";
import { privateEventPath } from "./private-routes";
import { publicSubmissionPath } from "./public-routes";

export interface OrganizerTrialStep {
  id: string;
  label: string;
  detail: string;
  complete: boolean;
  to: string;
  external?: boolean;
}

export function organizerTrialSteps(workspace: WorkspaceSnapshot, eventId = workspace.event.id): OrganizerTrialStep[] {
  const eventProposals = workspace.proposals.filter((proposal) => proposal.eventId === eventId);
  const accepted = eventProposals.filter((proposal) => isAcceptedProposalStatus(proposal.status));
  const acceptedSpeakerIds = new Set(accepted.flatMap((proposal) => proposal.speakers.map((speaker) => speaker.id)));
  const acceptedTasks = workspace.tasks.filter((task) => task.eventId === eventId && acceptedSpeakerIds.has(task.speakerId));
  const eventSessions = workspace.sessions.filter((session) => session.eventId === eventId);
  const publishedForm = workspace.forms.some((form) => form.eventId === eventId && form.status === "published");
  const reviewerPresent = workspace.actors.some((actor) => actor.role === "reviewer");
  const reviewed = eventProposals.some((proposal) => proposal.reviewCount > 0);
  const scheduled = eventSessions.some((session) => Boolean(session.startsAt && session.roomId && session.trackId));
  const agendaPublished = eventSessions.some((session) => session.status === "published");

  return [
    {
      id: "event",
      label: "Confirm event details",
      detail: "Dates, timezone, venue, purpose, and public slug",
      complete: Boolean(workspace.event.description.trim() && workspace.event.venue.trim()),
      to: privateEventPath("/workspace", eventId),
    },
    {
      id: "cfp",
      label: "Publish the CFP",
      detail: "Review fields, participant rules, deadline, and confirmation",
      complete: publishedForm,
      to: privateEventPath("/forms", eventId),
    },
    {
      id: "reviewer",
      label: "Invite a reviewer",
      detail: "Add at least one committee member before testing review",
      complete: reviewerPresent,
      to: privateEventPath("/workspace?action=invite-staff", eventId),
    },
    {
      id: "submission",
      label: "Receive a test proposal",
      detail: "Open the public link in a separate browser account",
      complete: eventProposals.length > 0,
      to: publicSubmissionPath(workspace.event.slug),
      external: true,
    },
    {
      id: "review",
      label: "Complete a review",
      detail: "Score the configured rubric and submit the recommendation",
      complete: reviewed,
      to: privateEventPath("/reviews", eventId),
    },
    {
      id: "decision",
      label: "Accept a proposal",
      detail: "Use the acceptance queue before recording the final decision",
      complete: accepted.length > 0,
      to: privateEventPath("/proposals", eventId),
    },
    {
      id: "onboarding",
      label: "Complete speaker onboarding",
      detail: "Claim the profile and resolve the generated speaker tasks",
      complete: accepted.length > 0 && acceptedTasks.length > 0 && acceptedTasks.every((task) => !isOutstandingTaskStatus(task.status)),
      to: privateEventPath("/speaker-ops", eventId),
    },
    {
      id: "schedule",
      label: "Place a session",
      detail: "Confirm rooms and tracks, then assign a valid time",
      complete: scheduled,
      to: privateEventPath("/schedule", eventId),
    },
    {
      id: "publish",
      label: "Publish the agenda",
      detail: "Release scheduled additions and inspect the public program",
      complete: agendaPublished,
      to: privateEventPath("/publish", eventId),
    },
  ];
}
