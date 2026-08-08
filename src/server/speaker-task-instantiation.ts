const DAY_IN_MILLISECONDS = 86_400_000;

/**
 * Creates the onboarding tasks that apply when a proposal is accepted.
 *
 * Contact-target tasks are instantiated once per speaker, while
 * submission-target tasks are instantiated once per accepted proposal and
 * speaker. The target-aware NOT EXISTS predicate keeps repeated acceptance
 * idempotent even before the database unique indexes are considered.
 */
export const instantiateAcceptedSpeakerTasksSql = `INSERT INTO speaker_tasks
  (id, event_id, template_id, speaker_profile_id, proposal_id, title, description, type, status, due_at, created_at, updated_at)
  SELECT
    'task-' || lower(hex(randomblob(16))),
    p.event_id,
    tt.id,
    ps.speaker_profile_id,
    CASE WHEN tt.target_type = 'submission' THEN p.id ELSE NULL END,
    tt.title,
    tt.description,
    tt.type,
    CASE
      WHEN e.starts_at - (tt.relative_due_days * ${DAY_IN_MILLISECONDS}) < ? THEN 'overdue'
      ELSE 'not_started'
    END,
    e.starts_at - (tt.relative_due_days * ${DAY_IN_MILLISECONDS}),
    ?,
    ?
  FROM proposals p
  JOIN events e ON e.id = p.event_id
  JOIN proposal_speakers ps ON ps.proposal_id = p.id
  JOIN speaker_profiles sp
    ON sp.id = ps.speaker_profile_id
    AND sp.event_id = p.event_id
  JOIN task_templates tt
    ON tt.event_id = p.event_id
    AND tt.target_type IN ('contact', 'submission')
  WHERE p.id = ?
    AND p.event_id = ?
    AND p.status = 'accepted'
    AND NOT EXISTS (
      SELECT 1
      FROM speaker_tasks st
      WHERE st.event_id = p.event_id
        AND st.template_id = tt.id
        AND st.speaker_profile_id = ps.speaker_profile_id
        AND (
          (tt.target_type = 'contact' AND st.proposal_id IS NULL)
          OR (tt.target_type = 'submission' AND st.proposal_id = p.id)
        )
    )`;
