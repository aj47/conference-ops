import type { EventRecord } from "../shared/domain";

export function eventAcceptsSelfEnrollment(
  eventStatus: EventRecord["status"],
  hasOpenPublishedForm: boolean,
) {
  return eventStatus === "cfp_open" && hasOpenPublishedForm;
}

export const selfEnrollmentEventSql = `SELECT e.id, e.status,
  EXISTS (
    SELECT 1 FROM submission_forms sf
    WHERE sf.event_id = e.id
      AND sf.kind = 'cfp'
      AND sf.status = 'published'
      AND sf.published_version IS NOT NULL
      AND (sf.opens_at IS NULL OR sf.opens_at <= ?)
      AND (sf.closes_at IS NULL OR sf.closes_at >= ?)
  ) AS has_open_published_form
FROM events e
WHERE e.id = ? AND e.deleted_at IS NULL`;
