import type { ProgramSession, Room, Track } from "../shared/domain";

export interface AutoScheduleSlot {
  startsAt: string;
  dayEndsAt: string;
}

export interface AutoSchedulePlacement {
  sessionId: string;
  roomId: string;
  trackId: string;
  startsAt: string;
  endsAt: string;
}

export interface AutoScheduleUnplaced {
  sessionId: string;
  reason: "no_resources" | "no_conflict_free_slot";
}

export interface AutoSchedulePlan {
  placements: AutoSchedulePlacement[];
  unplaced: AutoScheduleUnplaced[];
}

interface AutoScheduleInput {
  sessions: ProgramSession[];
  rooms: Room[];
  tracks: Track[];
  slots: AutoScheduleSlot[];
  durationMinutes: Record<string, number>;
  preferredTrackIds?: Record<string, string | undefined>;
}

function overlaps(aStart: string, aEnd: string, bStart?: string, bEnd?: string) {
  if (!bStart || !bEnd) return false;
  return new Date(aStart).getTime() < new Date(bEnd).getTime()
    && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

function hasConflict(candidate: AutoSchedulePlacement, target: ProgramSession, scheduled: ProgramSession[]) {
  return scheduled.some((session) => {
    if (!overlaps(candidate.startsAt, candidate.endsAt, session.startsAt, session.endsAt)) return false;
    if (session.roomId === candidate.roomId || session.trackId === candidate.trackId) return true;
    return target.speakerIds.some((speakerId) => session.speakerIds.includes(speakerId));
  });
}

function trackOrder(tracks: Track[], preferred?: string) {
  if (!preferred || !tracks.some((track) => track.id === preferred)) return tracks;
  return [tracks.find((track) => track.id === preferred)!, ...tracks.filter((track) => track.id !== preferred)];
}

/**
 * Produces a deterministic, explainable plan. It never creates an override:
 * every placement is checked for room, track, and speaker overlap against both
 * the live schedule and earlier suggestions in this plan.
 */
export function buildAutoSchedulePlan(input: AutoScheduleInput): AutoSchedulePlan {
  const placements: AutoSchedulePlacement[] = [];
  const unplaced: AutoScheduleUnplaced[] = [];
  if (!input.rooms.length || !input.tracks.length || !input.slots.length) {
    return {
      placements,
      unplaced: input.sessions
        .filter((session) => session.status === "unscheduled")
        .map((session) => ({ sessionId: session.id, reason: "no_resources" as const })),
    };
  }

  const scheduled = input.sessions.filter((session) => session.startsAt && session.endsAt);
  const targets = input.sessions
    .filter((session) => session.status === "unscheduled")
    .sort((left, right) => {
      const durationDelta = (input.durationMinutes[right.id] ?? 30) - (input.durationMinutes[left.id] ?? 30);
      return durationDelta || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
    });

  for (const session of targets) {
    const duration = Math.max(5, Math.min(12 * 60, input.durationMinutes[session.id] ?? 30));
    let selected: AutoSchedulePlacement | undefined;
    for (const slot of input.slots) {
      const endsAt = new Date(new Date(slot.startsAt).getTime() + duration * 60_000).toISOString();
      if (new Date(endsAt).getTime() > new Date(slot.dayEndsAt).getTime()) continue;
      for (const track of trackOrder(input.tracks, input.preferredTrackIds?.[session.id])) {
        for (const room of input.rooms) {
          const candidate = { sessionId: session.id, roomId: room.id, trackId: track.id, startsAt: slot.startsAt, endsAt };
          if (!hasConflict(candidate, session, scheduled)) {
            selected = candidate;
            break;
          }
        }
        if (selected) break;
      }
      if (selected) break;
    }
    if (!selected) {
      unplaced.push({ sessionId: session.id, reason: "no_conflict_free_slot" });
      continue;
    }
    placements.push(selected);
    scheduled.push({
      ...session,
      roomId: selected.roomId,
      trackId: selected.trackId,
      startsAt: selected.startsAt,
      endsAt: selected.endsAt,
      status: "scheduled",
    });
  }

  return { placements, unplaced };
}
