export type AgendaPublishErrorCode =
  | "AGENDA_EMPTY"
  | "AGENDA_SESSION_ID_INVALID"
  | "AGENDA_SESSION_NOT_FOUND"
  | "AGENDA_SESSION_OUTSIDE_EVENT"
  | "AGENDA_SESSION_UNSCHEDULED"
  | "AGENDA_CHANGED";

export class AgendaPublishError extends Error {
  readonly status: 409 | 422;
  readonly code: AgendaPublishErrorCode;
  readonly sessionIds: string[];

  constructor(status: 409 | 422, code: AgendaPublishErrorCode, message: string, sessionIds: readonly string[] = []) {
    super(message);
    this.name = "AgendaPublishError";
    this.status = status;
    this.code = code;
    this.sessionIds = [...sessionIds];
  }
}

export interface AgendaPublishSessionRow {
  id: string;
  eventId: string;
  status: string;
  startsAt: number | null;
  endsAt: number | null;
}

export interface AgendaPublishResult {
  eventId: string;
  sessionIds: string[];
  publishedSessions: number;
  newlyPublishedSessions: number;
  publishedAt: string;
}

export const selectAgendaSessionsByIdSql = `SELECT id, event_id AS eventId, status, starts_at AS startsAt, ends_at AS endsAt
  FROM program_sessions
  WHERE id IN (SELECT CAST(value AS TEXT) FROM json_each(?))`;

export const selectScheduledAgendaSessionsSql = `SELECT id, event_id AS eventId, status, starts_at AS startsAt, ends_at AS endsAt
  FROM program_sessions
  WHERE event_id = ? AND status = 'scheduled'
  ORDER BY id`;

/**
 * The cardinality guard makes this update all-or-nothing for the requested IDs:
 * no session changes if even one ID is missing, foreign, or not publishable.
 */
export const publishAgendaSessionsSql = `UPDATE program_sessions
  SET status = 'published', updated_at = ?, version = version + 1
  WHERE event_id = ?
    AND status = 'scheduled'
    AND starts_at IS NOT NULL
    AND ends_at IS NOT NULL
    AND ends_at > starts_at
    AND id IN (SELECT CAST(value AS TEXT) FROM json_each(?))
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.id = program_sessions.event_id AND e.deleted_at IS NULL
    )
    AND (
      SELECT COUNT(*)
      FROM json_each(?) selected
      JOIN program_sessions candidate ON candidate.id = CAST(selected.value AS TEXT)
      WHERE candidate.event_id = ?
        AND candidate.status IN ('scheduled', 'published')
        AND candidate.starts_at IS NOT NULL
        AND candidate.ends_at IS NOT NULL
        AND candidate.ends_at > candidate.starts_at
    ) = json_array_length(?)`;

/**
 * Run after publishAgendaSessionsSql in the same D1 batch. It advances the public
 * revision only when every requested session is now published for this event.
 */
export const publishAgendaEventSql = `UPDATE events
  SET status = 'agenda_published',
      public_agenda_revision = public_agenda_revision + 1,
      updated_at = ?
  WHERE id = ?
    AND deleted_at IS NULL
    AND json_array_length(?) > 0
    AND (
      SELECT COUNT(*)
      FROM json_each(?) selected
      JOIN program_sessions candidate ON candidate.id = CAST(selected.value AS TEXT)
      WHERE candidate.event_id = ?
        AND candidate.status = 'published'
        AND candidate.starts_at IS NOT NULL
        AND candidate.ends_at IS NOT NULL
        AND candidate.ends_at > candidate.starts_at
    ) = json_array_length(?)`;

export function normalizeAgendaSessionIds(sessionIds: readonly string[]): string[];
export function normalizeAgendaSessionIds(sessionIds: undefined): undefined;
export function normalizeAgendaSessionIds(sessionIds: readonly string[] | undefined): string[] | undefined;
export function normalizeAgendaSessionIds(sessionIds: readonly string[] | undefined): string[] | undefined {
  if (sessionIds === undefined) return undefined;

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const rawId of sessionIds) {
    const id = rawId.trim();
    if (!id) {
      throw new AgendaPublishError(422, "AGENDA_SESSION_ID_INVALID", "Every agenda session ID must be non-empty.");
    }
    if (!seen.has(id)) {
      seen.add(id);
      normalized.push(id);
    }
  }

  if (!normalized.length) {
    throw new AgendaPublishError(409, "AGENDA_EMPTY", "Schedule at least one session before publishing the agenda.");
  }
  return normalized;
}

function hasValidSchedule(row: AgendaPublishSessionRow) {
  return typeof row.startsAt === "number"
    && Number.isFinite(row.startsAt)
    && typeof row.endsAt === "number"
    && Number.isFinite(row.endsAt)
    && row.endsAt > row.startsAt;
}

export function validateAgendaPublishSelection(
  eventId: string,
  requestedSessionIds: readonly string[] | undefined,
  rows: readonly AgendaPublishSessionRow[],
): string[] {
  const requested = normalizeAgendaSessionIds(requestedSessionIds);
  const sessionIds = requested ?? normalizeAgendaSessionIds(rows.map((row) => row.id));
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const missing = sessionIds.filter((id) => !rowsById.has(id));
  if (missing.length) {
    throw new AgendaPublishError(422, "AGENDA_SESSION_NOT_FOUND", "One or more selected sessions no longer exist.", missing);
  }

  const foreign = sessionIds.filter((id) => rowsById.get(id)?.eventId !== eventId);
  if (foreign.length) {
    throw new AgendaPublishError(422, "AGENDA_SESSION_OUTSIDE_EVENT", "Every selected session must belong to this event.", foreign);
  }

  const unscheduled = sessionIds.filter((id) => {
    const row = rowsById.get(id)!;
    return !["scheduled", "published"].includes(row.status) || !hasValidSchedule(row);
  });
  if (unscheduled.length) {
    throw new AgendaPublishError(409, "AGENDA_SESSION_UNSCHEDULED", "Every selected session must have a valid schedule before publishing.", unscheduled);
  }

  return sessionIds;
}

export function agendaSessionPublishBindings(now: number, eventId: string, sessionIds: readonly string[]) {
  const encoded = JSON.stringify(sessionIds);
  return [now, eventId, encoded, encoded, eventId, encoded] as const;
}

export function agendaEventPublishBindings(now: number, eventId: string, sessionIds: readonly string[]) {
  const encoded = JSON.stringify(sessionIds);
  return [now, eventId, encoded, encoded, eventId, encoded] as const;
}

export async function publishAgendaAtomically(
  db: D1Database,
  eventId: string,
  requestedSessionIds?: readonly string[],
  now = Date.now(),
): Promise<AgendaPublishResult> {
  const requested = normalizeAgendaSessionIds(requestedSessionIds);
  const session = db.withSession("first-primary");
  const rows = requested
    ? await session.prepare(selectAgendaSessionsByIdSql).bind(JSON.stringify(requested)).all<AgendaPublishSessionRow>()
    : await session.prepare(selectScheduledAgendaSessionsSql).bind(eventId).all<AgendaPublishSessionRow>();
  const sessionIds = validateAgendaPublishSelection(eventId, requested, rows.results);

  const [sessionResult, eventResult] = await session.batch([
    session.prepare(publishAgendaSessionsSql).bind(...agendaSessionPublishBindings(now, eventId, sessionIds)),
    session.prepare(publishAgendaEventSql).bind(...agendaEventPublishBindings(now, eventId, sessionIds)),
  ]);

  if (Number(eventResult?.meta.changes ?? 0) !== 1) {
    throw new AgendaPublishError(
      409,
      "AGENDA_CHANGED",
      "The agenda changed while it was being published. Review the schedule and try again.",
      sessionIds,
    );
  }

  return {
    eventId,
    sessionIds,
    publishedSessions: sessionIds.length,
    newlyPublishedSessions: Number(sessionResult?.meta.changes ?? 0),
    publishedAt: new Date(now).toISOString(),
  };
}
