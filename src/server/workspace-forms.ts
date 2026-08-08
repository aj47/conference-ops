import type { AuthActor } from "./env";

export function workspaceFormRowsSql(role: AuthActor["role"]) {
  const visibleVersion = role === "organizer" ? "sf.current_version" : "sf.published_version";
  return `SELECT sf.*, fv.public_title, fv.page_heading, fv.welcome_title, fv.welcome_copy, fv.confirmation_copy, fv.max_speakers, fv.allow_multiple_drafts, fv.fields,
    (SELECT COUNT(*) FROM proposals p JOIN form_versions pfv ON pfv.id = p.form_version_id WHERE pfv.form_id = sf.id AND p.status <> 'draft') AS submissions
    FROM submission_forms sf JOIN form_versions fv ON fv.form_id = sf.id AND fv.version = ${visibleVersion}
    WHERE sf.event_id = ? ORDER BY sf.updated_at DESC`;
}
