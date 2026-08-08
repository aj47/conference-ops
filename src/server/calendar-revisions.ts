/**
 * These revision updates must immediately follow the event/room mutation in
 * the same D1 batch. SQLite's changes() value is therefore the affected-row
 * count from that mutation: a failed write cannot advance calendar state.
 */
export const bumpEventCalendarRevisionsSql = `UPDATE program_sessions
  SET calendar_sequence = calendar_sequence + 1, version = version + 1, updated_at = ?
  WHERE event_id = ?
    AND status IN ('scheduled', 'published')
    AND ? = 1
    AND changes() > 0`;

export const bumpRoomCalendarRevisionsSql = `UPDATE program_sessions
  SET calendar_sequence = calendar_sequence + 1, version = version + 1, updated_at = ?
  WHERE event_id = ?
    AND room_id = ?
    AND status IN ('scheduled', 'published')
    AND ? = 1
    AND changes() > 0`;

export function eventInviteFieldsChanged(
  current: { name: string; venue: string },
  next: { name: string; venue: string },
) {
  return current.name !== next.name || current.venue !== next.venue;
}
