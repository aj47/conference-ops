import type { AuthActor } from "./env";

export function workspaceFormRowsSql(role: AuthActor["role"]) {
  const visibleVersion = role === "organizer" ? "sf.current_version" : "sf.published_version";
  return `SELECT sf.id, sf.event_id, sf.name, sf.kind, sf.target_type, sf.status, sf.current_version, sf.published_version, sf.updated_at,
    sf.submission_type AS legacy_submission_type, sf.collects_participants AS legacy_collects_participants,
    sf.max_submissions_per_user AS legacy_max_submissions_per_user, sf.redirect_to_portal AS legacy_redirect_to_portal,
    sf.confirmation_email_enabled AS legacy_confirmation_email_enabled, sf.closes_at AS legacy_closes_at,
    fv.public_title, fv.page_heading, fv.welcome_title, fv.welcome_copy, fv.confirmation_copy, fv.max_speakers, fv.allow_multiple_drafts, fv.settings, fv.fields,
    (SELECT COUNT(*) FROM proposals p JOIN form_versions pfv ON pfv.id = p.form_version_id WHERE pfv.form_id = sf.id AND p.status <> 'draft') AS submissions
    FROM submission_forms sf JOIN form_versions fv ON fv.form_id = sf.id AND fv.version = ${visibleVersion}
    WHERE sf.event_id = ? ORDER BY sf.updated_at DESC`;
}
