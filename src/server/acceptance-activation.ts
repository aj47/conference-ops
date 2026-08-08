export const createAcceptedProposalSessionSql = `INSERT OR IGNORE INTO program_sessions
  (id, event_id, proposal_id, origin, title, description, format, status, calendar_uid, calendar_sequence, version, created_at, updated_at)
  SELECT ?, p.event_id, p.id, 'proposal', p.title, p.summary, p.format, 'unscheduled', ?, 0, 1, ?, ?
  FROM proposals p
  WHERE p.id = ? AND p.event_id = ? AND p.status = 'accepted'
    AND NOT EXISTS (SELECT 1 FROM program_sessions existing WHERE existing.proposal_id = p.id)`;

export const linkAcceptedProposalSpeakersSql = `INSERT OR IGNORE INTO session_speakers (session_id, speaker_profile_id)
  SELECT session.id, proposal_speaker.speaker_profile_id
  FROM program_sessions session
  JOIN proposal_speakers proposal_speaker ON proposal_speaker.proposal_id = session.proposal_id
  WHERE session.id = ? AND session.event_id = ? AND session.proposal_id = ?`;

export const activateAcceptedSpeakersSql = `UPDATE speaker_profiles
  SET published = 1, updated_at = ?
  WHERE event_id = ?
    AND id IN (SELECT speaker_profile_id FROM proposal_speakers WHERE proposal_id = ?)`;

export const grantClaimedSpeakerMembershipsSql = `INSERT OR IGNORE INTO event_memberships
  (event_id, user_id, role, accepted_at, created_at)
  SELECT p.event_id, sp.user_id, 'speaker', ?, ?
  FROM proposals p
  JOIN proposal_speakers ps ON ps.proposal_id = p.id
  JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id AND sp.event_id = p.event_id
  WHERE p.id = ? AND p.event_id = ? AND p.status = 'accepted' AND sp.user_id IS NOT NULL`;
