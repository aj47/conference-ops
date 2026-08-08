/**
 * Materializes the active-round backlog when a reviewer joins an event.
 * Group membership, proposal routing, round selection, and proposal status are
 * all scoped inside the INSERT so accepting an organizer invitation cannot
 * accidentally create review work. Proposal owners and verified claimed
 * co-speakers are never assigned to evaluate their own submission.
 */
export const backfillReviewerAssignmentsSql = `INSERT OR IGNORE INTO review_assignments
  (id, proposal_id, round_id, reviewer_user_id, status, scores, created_at, updated_at)
  SELECT
    'review-' || lower(hex(randomblob(16))),
    p.id,
    rr.id,
    ?,
    'pending',
    '{}',
    ?,
    ?
  FROM proposals p
  JOIN reviewer_groups rg
    ON rg.id = p.reviewer_group_id
    AND rg.event_id = p.event_id
  JOIN reviewer_group_members rgm
    ON rgm.reviewer_group_id = rg.id
    AND rgm.user_id = ?
  JOIN review_rounds rr
    ON rr.id = (
      SELECT active.id
      FROM review_rounds active
      WHERE active.event_id = p.event_id
        AND active.status = 'active'
      ORDER BY active.round
      LIMIT 1
    )
  WHERE p.event_id = ?
    AND p.status IN ('submitted', 'under_review')
    AND p.owner_user_id <> ?
    AND NOT EXISTS (
      SELECT 1
      FROM proposal_speakers ps
      JOIN speaker_profiles sp
        ON sp.id = ps.speaker_profile_id
        AND sp.event_id = p.event_id
      WHERE ps.proposal_id = p.id
        AND sp.user_id = ?
    )`;

export const promoteAssignedBacklogSql = `UPDATE proposals
  SET status = 'under_review', updated_at = ?
  WHERE event_id = ?
    AND status = 'submitted'
    AND EXISTS (
      SELECT 1
      FROM review_assignments ra
      JOIN review_rounds rr
        ON rr.id = ra.round_id
        AND rr.event_id = proposals.event_id
        AND rr.status = 'active'
      WHERE ra.proposal_id = proposals.id
    )`;
