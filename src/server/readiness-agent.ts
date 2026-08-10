import type { ReadinessInsight, WorkspaceSnapshot } from "../shared/domain";
import { isOutstandingTaskStatus } from "../shared/task-status";

function eventPath(path: string, eventId: string) {
  const query = new URLSearchParams({ eventId });
  return `${path}?${query}`;
}

export function readinessInsights(workspace: WorkspaceSnapshot): ReadinessInsight[] {
  const insights: ReadinessInsight[] = [];
  const unassigned = workspace.proposals.filter((proposal) => proposal.status === "submitted").length;
  if (unassigned) insights.push({
    id: "unassigned-review",
    priority: "now",
    title: `${unassigned} submitted ${unassigned === 1 ? "talk has" : "talks have"} no active review assignment`,
    detail: "Map every CFP track to at least one accepted reviewer, then rebuild the queue.",
    count: unassigned,
    actionLabel: "Fix reviewer routing",
    actionPath: eventPath("/program-settings", workspace.event.id),
    effectSummary: "Opens track routing. No reviewer assignment changes until you save the mapping.",
    reversible: true,
    requiresConfirmation: true,
  });

  const pendingDecisions = workspace.proposals.filter((proposal) => proposal.status === "accept_queue" || proposal.status === "decline_queue").length;
  if (pendingDecisions) insights.push({
    id: "decision-queue",
    priority: "now",
    title: `${pendingDecisions} staged ${pendingDecisions === 1 ? "decision is" : "decisions are"} waiting`,
    detail: "Finalizing a decision sends the configured email; acceptance also creates the session and onboarding plan.",
    count: pendingDecisions,
    actionLabel: "Work proposal decisions",
    actionPath: eventPath("/proposals", workspace.event.id),
    effectSummary: "Opens staged decisions. A final approve or deny can send email and acceptance creates the session and speaker tasks.",
    reversible: false,
    requiresConfirmation: true,
  });

  const unscheduled = workspace.sessions.filter((session) => session.status === "unscheduled").length;
  if (unscheduled) insights.push({
    id: "unscheduled-sessions",
    priority: "now",
    title: `${unscheduled} accepted ${unscheduled === 1 ? "session needs" : "sessions need"} a slot`,
    detail: "Place each session on the day-and-room board; room, track, and speaker overlap checks run before the move commits.",
    count: unscheduled,
    actionLabel: "Open schedule board",
    actionPath: `${eventPath("/schedule", workspace.event.id)}&action=auto-plan`,
    effectSummary: "Builds a conflict-free draft for review. Nothing moves until you confirm; the applied draft can be undone in this session.",
    reversible: true,
    requiresConfirmation: true,
  });

  const overdue = workspace.tasks.filter((task) => task.status === "overdue").length;
  const outstanding = workspace.tasks.filter((task) => isOutstandingTaskStatus(task.status)).length;
  if (overdue || outstanding) insights.push({
    id: "speaker-tasks",
    priority: overdue ? "now" : "next",
    title: overdue ? `${overdue} speaker ${overdue === 1 ? "task is" : "tasks are"} overdue` : `${outstanding} speaker tasks remain`,
    detail: "Hotel, flight, profile, slides, and other organizer-authored tasks are visible in the same speaker workfile.",
    count: overdue || outstanding,
    actionLabel: "Open speaker operations",
    actionPath: eventPath("/speaker-ops", workspace.event.id),
    effectSummary: "Opens the exact speakers and tasks needing attention. Sending reminders remains a separate confirmed action.",
    reversible: true,
    requiresConfirmation: true,
  });

  const incompleteProfiles = new Map(
    workspace.proposals
      .filter((proposal) => proposal.status === "accepted" || proposal.status === "session")
      .flatMap((proposal) => proposal.speakers)
      .filter((speaker) => !speaker.profileComplete)
      .map((speaker) => [speaker.id, speaker]),
  ).size;
  if (incompleteProfiles) insights.push({
    id: "speaker-profiles",
    priority: "next",
    title: `${incompleteProfiles} accepted ${incompleteProfiles === 1 ? "speaker profile is" : "speaker profiles are"} incomplete`,
    detail: "Public speaker records stay unpublished until the essential profile fields and headshot are complete.",
    count: incompleteProfiles,
    actionLabel: "Review speaker profiles",
    actionPath: eventPath("/speaker-ops", workspace.event.id),
    effectSummary: "Opens profile readiness. Public visibility changes only after an organizer saves the record.",
    reversible: true,
    requiresConfirmation: true,
  });

  const scheduled = workspace.sessions.filter((session) => session.status === "scheduled").length;
  if (scheduled) insights.push({
    id: "agenda-release",
    priority: "next",
    title: `${scheduled} scheduled ${scheduled === 1 ? "session is" : "sessions are"} waiting to publish`,
    detail: "Publish when the room plan and speaker readiness are acceptable; calendar invitations can then be sent from the same center.",
    count: scheduled,
    actionLabel: "Open publish center",
    actionPath: eventPath("/publish", workspace.event.id),
    effectSummary: "Opens the release checklist and public preview. Publishing is a separate explicit confirmation.",
    reversible: false,
    requiresConfirmation: true,
  });

  if (!insights.length) insights.push({
    id: "clear-runway",
    priority: "watch",
    title: "The program runway is clear",
    detail: "No unassigned reviews, staged decisions, unscheduled sessions, or open speaker tasks need intervention right now.",
    count: 0,
    actionLabel: "Review the control room",
    actionPath: eventPath("/workspace", workspace.event.id),
    effectSummary: "Returns to the read-only operational summary.",
    reversible: true,
    requiresConfirmation: false,
  });
  return insights;
}

export function readinessAnswer(workspace: WorkspaceSnapshot, question: string | undefined) {
  const insights = readinessInsights(workspace);
  const now = insights.filter((insight) => insight.priority === "now");
  const prompt = question?.trim().toLocaleLowerCase() ?? "";
  const lead = now[0] ?? insights[0];
  if (prompt.includes("publish")) {
    const blocking = insights.filter((insight) => ["unscheduled-sessions", "speaker-tasks", "speaker-profiles", "agenda-release"].includes(insight.id));
    return blocking.length
      ? `Before publishing, work these evidence-backed items: ${blocking.map((item) => item.title).join("; ")}.`
      : "The current workspace snapshot shows no program-readiness blockers. Review the final public preview before publishing.";
  }
  if (prompt.includes("review")) {
    const reviewItems = insights.filter((insight) => ["unassigned-review", "decision-queue"].includes(insight.id));
    return reviewItems.length ? reviewItems.map((item) => item.title).join("; ") : "Every submitted proposal in the current snapshot has moved beyond the unassigned review stage.";
  }
  return lead.priority === "watch"
    ? lead.detail
    : `Start with “${lead.title}.” ${lead.detail}`;
}
