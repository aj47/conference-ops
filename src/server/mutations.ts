export const publishFormVersionSql = `UPDATE form_versions
  SET published_at = COALESCE(published_at, ?)
  WHERE form_id = ? AND version = ?
    AND EXISTS (
      SELECT 1 FROM submission_forms sf
      WHERE sf.id = form_versions.form_id
        AND sf.event_id = ?
        AND sf.current_version = ?
    )`;

export const publishSubmissionFormSql = `UPDATE submission_forms
  SET status = 'published', current_version = ?, published_version = ?, updated_at = ?
  WHERE id = ? AND event_id = ? AND current_version = ?
    AND EXISTS (
      SELECT 1 FROM form_versions fv
      WHERE fv.form_id = submission_forms.id AND fv.version = ?
    )`;

export const publishFormEventSql = `UPDATE events
  SET status = CASE WHEN status = 'draft' THEN 'cfp_open' ELSE status END, updated_at = ?
  WHERE id = ?
    AND EXISTS (
      SELECT 1 FROM submission_forms sf
      WHERE sf.id = ?
        AND sf.event_id = events.id
        AND sf.current_version = ?
        AND sf.published_version = ?
        AND sf.status = 'published'
    )`;

export const reopenSpeakerTaskSql = `UPDATE speaker_tasks
  SET status = 'in_progress', completed_at = NULL, updated_at = ?
  WHERE id = ? AND event_id = ?`;

export const reopenTaskResponseSql = `UPDATE task_responses
  SET status = 'draft', submitted_at = NULL, updated_at = ?
  WHERE task_id = ?
    AND EXISTS (
      SELECT 1 FROM speaker_tasks st
      WHERE st.id = task_responses.task_id AND st.event_id = ?
    )`;

export function isProfileComplete(
  bio: string,
  requestedHeadshotUploadId: string | undefined,
  existingHeadshotUploadId: string | null,
) {
  return bio.trim().length > 0 && Boolean(requestedHeadshotUploadId ?? existingHeadshotUploadId);
}

export const updateProposalDecisionSql = `UPDATE proposals
  SET status = ?, decided_at = ?, updated_at = ?, version = version + 1
  WHERE id = ? AND event_id = ? AND status NOT IN ('withdrawn', 'session')`;

export const auditProposalDecisionSql = `INSERT INTO audit_logs
  (id, organization_id, event_id, actor_user_id, action, entity_type, entity_id, summary, metadata, request_id, created_at)
  SELECT ?, e.organization_id, e.id, ?, 'proposal.decision_changed', 'proposal', ?, ?, ?, ?, ?
  FROM events e
  WHERE e.id = ?
    AND EXISTS (
      SELECT 1 FROM proposals p
      WHERE p.id = ? AND p.event_id = e.id AND p.status = ?
    )`;
