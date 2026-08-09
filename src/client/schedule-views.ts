import type { EventRecord, ProgramSession, Room, Track } from "../shared/domain";
import { eventDateKey, eventDayOptions } from "./event-time";

export const scheduleViewIds = ["list", "board", "week", "conflicts"] as const;
export type ScheduleViewId = (typeof scheduleViewIds)[number];

export interface ScheduleDayGroup {
  key: string;
  label: string;
  sessions: ProgramSession[];
}

export interface PersistentScheduleConflict {
  id: string;
  sessions: [ProgramSession, ProgramSession];
  resources: Array<{
    type: "room" | "track" | "speaker";
    id: string;
    name: string;
  }>;
}

export function scheduleViewFromValue(value: string | null | undefined): ScheduleViewId {
  return scheduleViewIds.includes(value as ScheduleViewId) ? value as ScheduleViewId : "board";
}

export function chronologicalSessions(sessions: ProgramSession[]) {
  return [...sessions].sort((left, right) => {
    if (!left.startsAt && !right.startsAt) return left.title.localeCompare(right.title);
    if (!left.startsAt) return 1;
    if (!right.startsAt) return -1;
    return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
      || left.title.localeCompare(right.title);
  });
}

export function scheduleDayGroups(event: EventRecord, sessions: ProgramSession[]): ScheduleDayGroup[] {
  const placed = chronologicalSessions(sessions.filter((session) => session.startsAt && session.endsAt));
  return eventDayOptions(event, placed).map((day) => ({
    ...day,
    sessions: placed.filter((session) => eventDateKey(session.startsAt!, event.timezone) === day.key),
  }));
}

function intervalsOverlap(left: ProgramSession, right: ProgramSession) {
  if (!left.startsAt || !left.endsAt || !right.startsAt || !right.endsAt) return false;
  return new Date(left.startsAt).getTime() < new Date(right.endsAt).getTime()
    && new Date(right.startsAt).getTime() < new Date(left.endsAt).getTime();
}

function speakerName(session: ProgramSession, speakerId: string) {
  const index = session.speakerIds.indexOf(speakerId);
  return index >= 0 ? session.speakerNames[index] : undefined;
}

export function persistentScheduleConflicts(
  sessions: ProgramSession[],
  rooms: Room[],
  tracks: Track[],
): PersistentScheduleConflict[] {
  const placed = chronologicalSessions(sessions.filter((session) => session.startsAt && session.endsAt));
  const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
  const trackNames = new Map(tracks.map((track) => [track.id, track.name]));
  const conflicts: PersistentScheduleConflict[] = [];

  for (let leftIndex = 0; leftIndex < placed.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < placed.length; rightIndex += 1) {
      const left = placed[leftIndex];
      const right = placed[rightIndex];
      if (!intervalsOverlap(left, right)) continue;

      const resources: PersistentScheduleConflict["resources"] = [];
      if (left.roomId && left.roomId === right.roomId) {
        resources.push({ type: "room", id: left.roomId, name: roomNames.get(left.roomId) ?? "Unknown room" });
      }
      if (left.trackId && left.trackId === right.trackId) {
        resources.push({ type: "track", id: left.trackId, name: trackNames.get(left.trackId) ?? "Unknown track" });
      }
      for (const id of left.speakerIds.filter((speakerId) => right.speakerIds.includes(speakerId))) {
        resources.push({
          type: "speaker",
          id,
          name: speakerName(left, id) ?? speakerName(right, id) ?? "Unknown speaker",
        });
      }
      if (!resources.length) continue;

      conflicts.push({
        id: `${left.id}:${right.id}`,
        sessions: [left, right],
        resources,
      });
    }
  }

  return conflicts;
}
