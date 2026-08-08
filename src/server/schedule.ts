import type { ProgramSession, ScheduleConflict } from "../shared/domain";

export interface ScheduleCandidate {
  id: string;
  title: string;
  roomId?: string;
  trackId?: string;
  speakerIds: string[];
  startsAt: string;
  endsAt: string;
}

export function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

export function detectScheduleConflicts(
  candidate: ScheduleCandidate,
  sessions: ProgramSession[],
  names: { rooms: Record<string, string>; tracks: Record<string, string>; speakers: Record<string, string> },
): ScheduleConflict[] {
  const conflicts: ScheduleConflict[] = [];
  for (const session of sessions) {
    if (session.id === candidate.id || !session.startsAt || !session.endsAt) continue;
    if (!intervalsOverlap(candidate.startsAt, candidate.endsAt, session.startsAt, session.endsAt)) continue;

    if (candidate.roomId && candidate.roomId === session.roomId) {
      conflicts.push({ type: "room", resourceId: candidate.roomId, resourceName: names.rooms[candidate.roomId] ?? candidate.roomId, sessionId: session.id, sessionTitle: session.title, startsAt: session.startsAt, endsAt: session.endsAt });
    }
    if (candidate.trackId && candidate.trackId === session.trackId) {
      conflicts.push({ type: "track", resourceId: candidate.trackId, resourceName: names.tracks[candidate.trackId] ?? candidate.trackId, sessionId: session.id, sessionTitle: session.title, startsAt: session.startsAt, endsAt: session.endsAt });
    }
    for (const speakerId of candidate.speakerIds.filter((id) => session.speakerIds.includes(id))) {
      conflicts.push({ type: "speaker", resourceId: speakerId, resourceName: names.speakers[speakerId] ?? speakerId, sessionId: session.id, sessionTitle: session.title, startsAt: session.startsAt, endsAt: session.endsAt });
    }
  }
  return conflicts;
}
