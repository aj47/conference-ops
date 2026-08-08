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

export interface SessionPlacementUpdate {
  eventId: string;
  sessionId: string;
  roomId: string;
  trackId: string;
  startsAt: number;
  endsAt: number;
  overrideReason?: string;
  now: number;
}

/**
 * Published sessions are the live agenda record. Moving one must keep it public;
 * newly placed sessions remain staged until the agenda publish action runs.
 */
export const updateSessionPlacementSql = `UPDATE program_sessions
  SET room_id = ?, track_id = ?, starts_at = ?, ends_at = ?, status = CASE WHEN status = 'published' THEN 'published' ELSE 'scheduled' END, override_reason = ?, calendar_sequence = calendar_sequence + 1, version = version + 1, updated_at = ?
  WHERE id = ? AND event_id = ? AND (
    ? IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM program_sessions other
      WHERE other.event_id = ? AND other.id <> ? AND other.starts_at < ? AND other.ends_at > ? AND (
        other.room_id = ? OR other.track_id = ? OR EXISTS (
          SELECT 1 FROM session_speakers target_speaker JOIN session_speakers other_speaker ON other_speaker.speaker_profile_id = target_speaker.speaker_profile_id
          WHERE target_speaker.session_id = ? AND other_speaker.session_id = other.id
        )
      )
    )
  )`;

export function sessionPlacementUpdateBindings(update: SessionPlacementUpdate) {
  return [
    update.roomId,
    update.trackId,
    update.startsAt,
    update.endsAt,
    update.overrideReason ?? null,
    update.now,
    update.sessionId,
    update.eventId,
    update.overrideReason ?? null,
    update.eventId,
    update.sessionId,
    update.endsAt,
    update.startsAt,
    update.roomId,
    update.trackId,
    update.sessionId,
  ] as const;
}

export const auditScheduleConflictOverrideSql = `INSERT INTO audit_logs
  (id, organization_id, event_id, actor_user_id, action, entity_type, entity_id, summary, metadata, request_id, created_at)
  SELECT ?, e.organization_id, e.id, ?, 'schedule.conflict_overridden', 'session', target.id, ?, ?, ?, ?
  FROM events e
  JOIN program_sessions target ON target.id = ? AND target.event_id = e.id
  WHERE e.id = ?
    AND target.room_id = ?
    AND target.track_id = ?
    AND target.starts_at = ?
    AND target.ends_at = ?
    AND target.override_reason = ?
    AND target.updated_at = ?`;

export function scheduleConflictOverrideAuditBindings(input: {
  auditId: string;
  actorUserId: string;
  eventId: string;
  sessionId: string;
  summary: string;
  metadata: string;
  requestId: string;
  roomId: string;
  trackId: string;
  startsAt: number;
  endsAt: number;
  overrideReason: string;
  now: number;
}) {
  return [
    input.auditId,
    input.actorUserId,
    input.summary,
    input.metadata,
    input.requestId,
    input.now,
    input.sessionId,
    input.eventId,
    input.roomId,
    input.trackId,
    input.startsAt,
    input.endsAt,
    input.overrideReason,
    input.now,
  ] as const;
}

export function intervalsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

export function scheduleWindowError(
  startsAt: string,
  endsAt: string,
  eventStartsAt: string | number | Date,
  eventEndsAt: string | number | Date,
) {
  const start = new Date(startsAt).getTime();
  const end = new Date(endsAt).getTime();
  const eventStart = new Date(eventStartsAt).getTime();
  const eventEnd = new Date(eventEndsAt).getTime();
  if (![start, end, eventStart, eventEnd].every(Number.isFinite)) return "INVALID_INTERVAL" as const;
  if (start >= end) return "INVALID_INTERVAL" as const;
  if (start < eventStart || end > eventEnd) return "OUTSIDE_EVENT_WINDOW" as const;
  return null;
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
