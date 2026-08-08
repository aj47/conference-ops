import type { OnboardingTask, ProgramSession, WorkspaceSnapshot } from "../shared/domain";

const DAY_MS = 86_400_000;

/**
 * Mirrors the production acceptance transaction for the in-browser demo.
 * Deterministic IDs keep repeated clicks and React retries idempotent.
 */
export function activateDemoAcceptance(
  workspace: WorkspaceSnapshot,
  proposalId: string,
  providedSessionId?: string,
): WorkspaceSnapshot {
  const proposal = workspace.proposals.find((candidate) => candidate.id === proposalId);
  if (!proposal) return workspace;

  const tasks: OnboardingTask[] = [...workspace.tasks];
  const eventStart = new Date(workspace.event.startsAt).getTime();
  for (const template of workspace.taskTemplates ?? []) {
    if (template.targetType !== "contact" && template.targetType !== "submission") continue;
    for (const speaker of proposal.speakers) {
      const targetProposalId = template.targetType === "submission" ? proposal.id : undefined;
      const id = `demo-task-${template.id}-${speaker.id}-${targetProposalId ?? "contact"}`;
      if (tasks.some((task) => task.id === id)) continue;
      const dueAt = new Date(eventStart - template.relativeDueDays * DAY_MS).toISOString();
      tasks.push({
        id,
        eventId: workspace.event.id,
        speakerId: speaker.id,
        title: template.title,
        description: template.description,
        dueAt,
        status: new Date(dueAt).getTime() < Date.now() ? "overdue" : "not_started",
        type: template.type,
        targetType: template.targetType,
        ...(targetProposalId ? { proposalId: targetProposalId, targetTitle: proposal.title } : {}),
        completionMode: template.completionMode,
        ...(template.fileRequestId ? { fileRequestId: template.fileRequestId } : {}),
        ...(template.formId && template.formFields
          ? {
              formId: template.formId,
              form: {
                id: `${template.formId}-version-1`,
                formId: template.formId,
                version: 1,
                title: template.title,
                description: template.description,
                fields: template.formFields,
                response: {},
              },
            }
          : {}),
      });
    }
  }

  const sessions: ProgramSession[] = workspace.sessions.some((session) => session.proposalId === proposal.id)
    ? workspace.sessions
    : [...workspace.sessions, {
        id: providedSessionId ?? `demo-session-${proposal.id}`,
        eventId: workspace.event.id,
        proposalId: proposal.id,
        origin: "proposal",
        title: proposal.title,
        description: proposal.summary,
        format: proposal.format,
        speakerIds: proposal.speakers.map((speaker) => speaker.id),
        speakerNames: proposal.speakers.map((speaker) => speaker.name),
        status: "unscheduled",
      }];

  return {
    ...workspace,
    proposals: workspace.proposals.map((candidate) => candidate.id === proposalId ? { ...candidate, status: "accepted" } : candidate),
    tasks,
    sessions,
  };
}
