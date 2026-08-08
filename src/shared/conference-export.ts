import type { ProgramSession, SpeakerProfile, WorkspaceSnapshot } from "./domain";
import { isAcceptedProposalStatus } from "./proposal-status";

export interface ConferenceExportProjection {
  speakers: SpeakerProfile[];
  sessions: ProgramSession[];
}

function hasValidScheduledInterval(session: ProgramSession) {
  if (!session.startsAt || !session.endsAt) return false;
  const startsAt = new Date(session.startsAt).getTime();
  const endsAt = new Date(session.endsAt).getTime();
  return Number.isFinite(startsAt) && Number.isFinite(endsAt) && startsAt < endsAt;
}

function isDirectSession(session: ProgramSession) {
  return session.origin === "direct_guaranteed"
    || session.origin === "direct_sponsor"
    || session.origin === "direct_program";
}

/**
 * Produces the single downstream handoff audience used by every export format.
 *
 * Applicant PII enters the speaker map only after the proposal reaches an
 * accepted lifecycle state or a valid direct-program session explicitly names
 * that profile. Proposal-origin sessions retain the accepted-proposal gate.
 * Speaker names are rebuilt from the scoped profile map so stale workspace
 * labels cannot leak an excluded applicant.
 */
export function projectConferenceExport(workspace: WorkspaceSnapshot): ConferenceExportProjection {
  const eventProposals = workspace.proposals.filter((proposal) => proposal.eventId === workspace.event.id);
  const candidateSpeakerById = new Map<string, SpeakerProfile>();
  const acceptedProposalIds = new Set<string>();
  const acceptedSpeakerById = new Map<string, SpeakerProfile>();

  for (const proposal of eventProposals) {
    for (const speaker of proposal.speakers) {
      if (!candidateSpeakerById.has(speaker.id)) candidateSpeakerById.set(speaker.id, speaker);
    }
    if (!isAcceptedProposalStatus(proposal.status)) continue;
    acceptedProposalIds.add(proposal.id);
    for (const speaker of proposal.speakers) {
      if (!acceptedSpeakerById.has(speaker.id)) acceptedSpeakerById.set(speaker.id, speaker);
    }
  }

  const exportSpeakerById = new Map(acceptedSpeakerById);
  const sessions = workspace.sessions.flatMap((session) => {
    if (session.eventId !== workspace.event.id) return [];
    if (session.status !== "scheduled" && session.status !== "published") return [];
    if (!hasValidScheduledInterval(session)) return [];

    const direct = isDirectSession(session);
    if (!direct && (!session.proposalId || !acceptedProposalIds.has(session.proposalId))) return [];

    const speakerIds = [...new Set(session.speakerIds)];
    const eligibleSpeakerById = direct ? candidateSpeakerById : acceptedSpeakerById;
    if (speakerIds.some((speakerId) => !eligibleSpeakerById.has(speakerId))) return [];
    if (direct) {
      for (const speakerId of speakerIds) {
        if (!exportSpeakerById.has(speakerId)) exportSpeakerById.set(speakerId, eligibleSpeakerById.get(speakerId)!);
      }
    }

    return [{
      ...session,
      speakerIds,
      speakerNames: speakerIds.map((speakerId) => eligibleSpeakerById.get(speakerId)!.name),
    }];
  });

  return { speakers: [...exportSpeakerById.values()], sessions };
}
