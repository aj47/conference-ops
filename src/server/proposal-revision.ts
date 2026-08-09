import type { ProposalStatus } from "../shared/domain";

export type ProposalRevisionSource = Extract<
  ProposalStatus,
  "submitted" | "under_review" | "accept_queue" | "decline_queue" | "waitlisted"
>;

const proposalRevisionSources: readonly ProposalStatus[] = [
  "submitted",
  "under_review",
  "accept_queue",
  "decline_queue",
  "waitlisted",
];

export function proposalMayRequestRevision(status: ProposalStatus) {
  return proposalRevisionSources.includes(status);
}

export const auditProposalRevisionRequestSql = `INSERT INTO audit_logs
  (id, organization_id, event_id, actor_user_id, action, entity_type, entity_id, summary, metadata, request_id, created_at)
  SELECT ?, e.organization_id, e.id, ?, 'proposal.changes_requested', 'proposal', p.id, ?, ?, ?, ?
  FROM events e
  JOIN proposals p ON p.event_id = e.id AND p.id = ?
  WHERE e.id = ? AND p.status IN ('submitted', 'under_review', 'accept_queue', 'decline_queue', 'waitlisted')`;

export function auditProposalRevisionRequestBindings(input: {
  auditId: string;
  actorUserId: string;
  proposalId: string;
  eventId: string;
  summary: string;
  metadata: string;
  requestId: string;
  now: number;
}) {
  return [
    input.auditId,
    input.actorUserId,
    input.summary,
    input.metadata,
    input.requestId,
    input.now,
    input.proposalId,
    input.eventId,
  ];
}

export const updateProposalForRevisionSql = `UPDATE proposals
  SET status = 'changes_requested', revision_note = ?, revision_requested_at = ?, decided_at = NULL,
    revision_requested_by = 'organizer', review_cycle = review_cycle + 1,
    updated_at = ?, version = version + 1
  WHERE id = ? AND event_id = ?
    AND status IN ('submitted', 'under_review', 'accept_queue', 'decline_queue', 'waitlisted')
    AND EXISTS (
      SELECT 1 FROM audit_logs revision_audit
      WHERE revision_audit.id = ?
        AND revision_audit.event_id = proposals.event_id
        AND revision_audit.entity_type = 'proposal'
        AND revision_audit.entity_id = proposals.id
        AND revision_audit.action = 'proposal.changes_requested'
    )`;

export function updateProposalForRevisionBindings(input: {
  note: string;
  now: number;
  proposalId: string;
  eventId: string;
  auditId: string;
}) {
  return [input.note, input.now, input.now, input.proposalId, input.eventId, input.auditId];
}

export const auditApplicantRevisionOpenSql = `INSERT INTO audit_logs
  (id, organization_id, event_id, actor_user_id, action, entity_type, entity_id, summary, metadata, request_id, created_at)
  SELECT ?, e.organization_id, e.id, ?, 'proposal.revision_opened', 'proposal', p.id, ?, ?, ?, ?
  FROM events e
  JOIN proposals p ON p.event_id = e.id AND p.id = ? AND p.owner_user_id = ?
  WHERE e.id = ? AND p.status IN ('submitted', 'under_review', 'accept_queue', 'decline_queue', 'waitlisted')`;

export const updateProposalForApplicantRevisionSql = `UPDATE proposals
  SET status = 'revision_open', revision_note = ?, revision_requested_at = ?,
    revision_requested_by = 'applicant', decided_at = NULL,
    review_cycle = review_cycle + 1, updated_at = ?, version = version + 1
  WHERE id = ? AND event_id = ? AND owner_user_id = ?
    AND status IN ('submitted', 'under_review', 'accept_queue', 'decline_queue', 'waitlisted')
    AND EXISTS (
      SELECT 1 FROM audit_logs revision_audit
      WHERE revision_audit.id = ?
        AND revision_audit.event_id = proposals.event_id
        AND revision_audit.actor_user_id = proposals.owner_user_id
        AND revision_audit.entity_type = 'proposal'
        AND revision_audit.entity_id = proposals.id
        AND revision_audit.action = 'proposal.revision_opened'
    )`;

export const revokeOpenReviewsForRevisionSql = `DELETE FROM review_assignments
  WHERE proposal_id = ? AND status IN ('pending', 'in_progress')
    AND EXISTS (
      SELECT 1 FROM proposals p
      JOIN audit_logs revision_audit
        ON revision_audit.id = ?
        AND revision_audit.event_id = p.event_id
        AND revision_audit.entity_type = 'proposal'
        AND revision_audit.entity_id = p.id
        AND revision_audit.action IN ('proposal.changes_requested', 'proposal.revision_opened')
      WHERE p.id = review_assignments.proposal_id
        AND p.event_id = ?
        AND p.status IN ('changes_requested', 'revision_open')
    )`;
