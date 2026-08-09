/**
 * Canonical Airtable replication registry.
 *
 * Table and column identifiers in this file are deliberately static. They are
 * used to construct SQL in the jobs Worker, so accepting user-controlled table
 * names here would turn a synchronization feature into an injection surface.
 */
export interface AirtableEntityDefinition {
  entityType: string;
  tableName: string;
  keyColumns: readonly string[];
  selectColumns?: readonly string[];
  eventIdColumn?: string;
  eventIdSql?: string;
  displayColumns: readonly string[];
  sourceVersionColumn?: string;
  /**
   * Only these descriptive fields may be imported directly from Airtable.
   * Lifecycle transitions and destructive changes use Workflow Commands.
   */
  remoteMutableColumns: readonly string[];
}

const entity = (definition: AirtableEntityDefinition) => definition;

export const AIRTABLE_ENTITY_REGISTRY = [
  entity({ entityType: "person", tableName: "user", keyColumns: ["id"], selectColumns: ["id", "name", "email", "email_verified", "image", "created_at", "updated_at"], displayColumns: ["name", "email"], sourceVersionColumn: "updated_at", remoteMutableColumns: [] }),
  entity({ entityType: "organization", tableName: "organizations", keyColumns: ["id"], displayColumns: ["name"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["name"] }),
  entity({ entityType: "organization_member", tableName: "organization_members", keyColumns: ["organization_id", "user_id"], displayColumns: ["organization_id", "user_id"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
  entity({ entityType: "event", tableName: "events", keyColumns: ["id"], eventIdColumn: "id", displayColumns: ["name", "short_name"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["description", "website_url", "accent"] }),
  entity({ entityType: "event_membership", tableName: "event_memberships", keyColumns: ["event_id", "user_id", "role"], eventIdColumn: "event_id", displayColumns: ["role", "user_id"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
  entity({ entityType: "event_invitation", tableName: "event_invitations", keyColumns: ["id"], selectColumns: ["id", "event_id", "email", "role", "invited_by", "expires_at", "accepted_at", "created_at"], eventIdColumn: "event_id", displayColumns: ["email", "role"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
  entity({ entityType: "submission_form", tableName: "submission_forms", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["name", "slug"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["name"] }),
  entity({ entityType: "form_version", tableName: "form_versions", keyColumns: ["id"], eventIdSql: "SELECT sf.event_id AS event_id FROM form_versions fv JOIN submission_forms sf ON sf.id = fv.form_id WHERE fv.id = ?", displayColumns: ["public_title", "page_heading"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
  entity({ entityType: "reviewer_group", tableName: "reviewer_groups", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["name", "category"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["name"] }),
  entity({ entityType: "reviewer_group_member", tableName: "reviewer_group_members", keyColumns: ["reviewer_group_id", "user_id"], eventIdSql: "SELECT rg.event_id AS event_id FROM reviewer_group_members rgm JOIN reviewer_groups rg ON rg.id = rgm.reviewer_group_id WHERE rgm.reviewer_group_id = ? AND rgm.user_id = ?", displayColumns: ["reviewer_group_id", "user_id"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
  entity({ entityType: "proposal_reviewer_group", tableName: "proposal_reviewer_groups", keyColumns: ["proposal_id", "reviewer_group_id"], eventIdSql: "SELECT p.event_id AS event_id FROM proposal_reviewer_groups prg JOIN proposals p ON p.id = prg.proposal_id WHERE prg.proposal_id = ? AND prg.reviewer_group_id = ?", displayColumns: ["proposal_id", "reviewer_group_id"], remoteMutableColumns: [] }),
  entity({ entityType: "speaker_profile", tableName: "speaker_profiles", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["name", "email"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["name", "title", "company", "bio", "pronouns", "city"] }),
  entity({ entityType: "proposal", tableName: "proposals", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["title", "category"], sourceVersionColumn: "version", remoteMutableColumns: ["title", "summary"] }),
  entity({ entityType: "proposal_speaker", tableName: "proposal_speakers", keyColumns: ["proposal_id", "speaker_profile_id"], eventIdSql: "SELECT p.event_id AS event_id FROM proposal_speakers ps JOIN proposals p ON p.id = ps.proposal_id WHERE ps.proposal_id = ? AND ps.speaker_profile_id = ?", displayColumns: ["proposal_id", "speaker_profile_id"], sourceVersionColumn: "sort_order", remoteMutableColumns: [] }),
  entity({ entityType: "review_round", tableName: "review_rounds", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["name"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["name"] }),
  entity({ entityType: "review_round_reviewer", tableName: "review_round_reviewers", keyColumns: ["round_id", "reviewer_user_id"], eventIdSql: "SELECT rr.event_id AS event_id FROM review_round_reviewers rrr JOIN review_rounds rr ON rr.id = rrr.round_id WHERE rrr.round_id = ? AND rrr.reviewer_user_id = ?", displayColumns: ["round_id", "reviewer_user_id"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
  entity({ entityType: "review_assignment", tableName: "review_assignments", keyColumns: ["id"], eventIdSql: "SELECT p.event_id AS event_id FROM review_assignments ra JOIN proposals p ON p.id = ra.proposal_id WHERE ra.id = ?", displayColumns: ["id", "recommendation"], sourceVersionColumn: "updated_at", remoteMutableColumns: [] }),
  entity({ entityType: "ai_review_evaluation", tableName: "ai_review_evaluations", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["proposal_id", "model_label"], sourceVersionColumn: "updated_at", remoteMutableColumns: [] }),
  entity({ entityType: "track", tableName: "tracks", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["name"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["name", "color"] }),
  entity({ entityType: "room", tableName: "rooms", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["name"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["capacity"] }),
  entity({ entityType: "program_session", tableName: "program_sessions", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["title", "format"], sourceVersionColumn: "version", remoteMutableColumns: ["title", "description", "capacity", "ceu_credits", "client_id"] }),
  entity({ entityType: "session_speaker", tableName: "session_speakers", keyColumns: ["session_id", "speaker_profile_id"], eventIdSql: "SELECT ps.event_id AS event_id FROM session_speakers ss JOIN program_sessions ps ON ps.id = ss.session_id WHERE ss.session_id = ? AND ss.speaker_profile_id = ?", displayColumns: ["session_id", "speaker_profile_id"], remoteMutableColumns: [] }),
  entity({ entityType: "upload", tableName: "uploads", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["file_name", "purpose"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
  entity({ entityType: "file_request", tableName: "file_requests", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["title", "target_type"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["title", "instructions_html", "required"] }),
  entity({ entityType: "file_request_response", tableName: "file_request_responses", keyColumns: ["id"], eventIdSql: "SELECT fr.event_id AS event_id FROM file_request_responses frr JOIN file_requests fr ON fr.id = frr.file_request_id WHERE frr.id = ?", displayColumns: ["target_id", "file_request_id"], sourceVersionColumn: "updated_at", remoteMutableColumns: [] }),
  entity({ entityType: "task_template", tableName: "task_templates", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["title", "type"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["title", "description", "relative_due_days"] }),
  entity({ entityType: "speaker_task", tableName: "speaker_tasks", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["title", "status"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["title", "description", "due_at"] }),
  entity({ entityType: "speaker_operation", tableName: "speaker_operations", keyColumns: ["speaker_profile_id"], eventIdColumn: "event_id", displayColumns: ["speaker_profile_id", "workflow_status"], sourceVersionColumn: "updated_at", remoteMutableColumns: [] }),
  entity({ entityType: "task_response", tableName: "task_responses", keyColumns: ["id"], eventIdSql: "SELECT st.event_id AS event_id FROM task_responses tr JOIN speaker_tasks st ON st.id = tr.task_id WHERE tr.id = ?", displayColumns: ["task_id", "status"], sourceVersionColumn: "updated_at", remoteMutableColumns: [] }),
  entity({ entityType: "task_comment", tableName: "task_comments", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["task_id", "author_user_id"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
  entity({ entityType: "session_content_status", tableName: "session_content_status", keyColumns: ["session_id"], eventIdColumn: "event_id", displayColumns: ["session_id", "status"], sourceVersionColumn: "updated_at", remoteMutableColumns: [] }),
  entity({ entityType: "content_revision", tableName: "content_revisions", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["entity_type", "entity_id", "version"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
  entity({ entityType: "speaker_communication_log", tableName: "speaker_communication_logs", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["subject", "kind"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
  entity({ entityType: "embed", tableName: "embeds", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["name", "format"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["name", "enabled", "theme", "filters"] }),
  entity({ entityType: "resource_page", tableName: "resource_pages", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["title", "slug"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["title", "slug", "summary", "sanitized_html", "embed_url"] }),
  entity({ entityType: "message_template", tableName: "message_templates", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["name", "kind"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["name", "subject", "html", "text"] }),
  entity({ entityType: "communication_schedule", tableName: "communication_schedules", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["kind"], sourceVersionColumn: "updated_at", remoteMutableColumns: ["enabled", "offset_days"] }),
  entity({ entityType: "audit_log", tableName: "audit_logs", keyColumns: ["id"], eventIdColumn: "event_id", displayColumns: ["action", "summary"], sourceVersionColumn: "created_at", remoteMutableColumns: [] }),
] as const satisfies readonly AirtableEntityDefinition[];

export type AirtableEntityType = (typeof AIRTABLE_ENTITY_REGISTRY)[number]["entityType"];

export const AIRTABLE_RECORDS_TABLE_NAME = "Conference Ops Records";
export const AIRTABLE_COMMANDS_TABLE_NAME = "Workflow Commands";
export const AIRTABLE_SCHEMA_VERSION = 1;

export const AIRTABLE_RECORD_FIELDS = {
  externalKey: "External Key",
  entityType: "Entity Type",
  eventId: "Event ID",
  displayName: "Display Name",
  payloadJson: "Payload JSON",
  deleted: "Deleted",
  sourceVersion: "Source Version",
  syncHash: "Sync Hash",
  sourceUpdatedAt: "Source Updated At",
  lastSyncedAt: "Last Synced At",
} as const;

export const AIRTABLE_COMMAND_FIELDS = {
  commandId: "Command ID",
  commandType: "Command Type",
  targetEntity: "Target Entity",
  targetKey: "Target Key",
  parametersJson: "Parameters JSON",
  idempotencyKey: "Idempotency Key",
  status: "Status",
  resultJson: "Result JSON",
  error: "Error",
  requestedAt: "Requested At",
  processedAt: "Processed At",
} as const;

export function airtableEntity(entityType: string) {
  return AIRTABLE_ENTITY_REGISTRY.find((candidate) => candidate.entityType === entityType);
}

export type AirtableRemoteValueResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

type RemoteValueRule = (value: unknown) => AirtableRemoteValueResult;

const valid = (value: unknown): AirtableRemoteValueResult => ({ ok: true, value });
const invalid = (error: string): AirtableRemoteValueResult => ({ ok: false, error });

function textRule(min: number, max: number, options: { nullable?: boolean; trim?: boolean } = {}): RemoteValueRule {
  return (value) => {
    if (value === null && options.nullable) return valid(null);
    if (typeof value !== "string") return invalid("must be text");
    const normalized = options.trim === false ? value : value.trim();
    if (normalized.length < min || normalized.length > max) return invalid(`must contain ${min}-${max} characters`);
    return valid(normalized);
  };
}

function integerRule(min: number, max: number, nullable = false): RemoteValueRule {
  return (value) => {
    if (value === null && nullable) return valid(null);
    const normalized = typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value;
    if (typeof normalized !== "number" || !Number.isSafeInteger(normalized) || normalized < min || normalized > max) {
      return invalid(`must be a whole number from ${min} to ${max}`);
    }
    return valid(normalized);
  };
}

const booleanRule: RemoteValueRule = (value) => {
  if (value === true || value === false) return valid(value);
  if (value === 1 || value === "1" || value === "true") return valid(true);
  if (value === 0 || value === "0" || value === "false") return valid(false);
  return invalid("must be true or false");
};

const colorRule: RemoteValueRule = (value) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)
  ? valid(value.toLowerCase())
  : invalid("must be a six-digit hex color such as #e05b3f");

function urlRule(nullable = false): RemoteValueRule {
  return (value) => {
    if ((value === null || value === "") && nullable) return valid(null);
    if (typeof value !== "string" || value.length > 2_048) return invalid("must be an HTTP(S) URL of at most 2048 characters");
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("unsafe URL");
      return valid(url.toString());
    } catch {
      return invalid("must be a complete HTTP(S) URL without embedded credentials");
    }
  };
}

const slugRule: RemoteValueRule = (value) => {
  if (typeof value !== "string") return invalid("must be a URL slug");
  const normalized = value.trim().toLowerCase();
  return normalized.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)
    ? valid(normalized)
    : invalid("must be a lowercase URL slug of at most 80 characters");
};

const timestampRule: RemoteValueRule = (value) => {
  let normalized: number;
  if (typeof value === "number") normalized = value;
  else if (typeof value === "string" && value.trim()) {
    normalized = /^\d+$/.test(value.trim()) ? Number(value) : new Date(value).getTime();
  } else {
    return invalid("must be a valid timestamp");
  }
  return Number.isSafeInteger(normalized) && normalized >= 0 && normalized <= 8_640_000_000_000_000
    ? valid(normalized)
    : invalid("must be a valid timestamp");
};

const filtersRule: RemoteValueRule = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("must be an object of text lists");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 25) return invalid("cannot contain more than 25 filters");
  const normalized: Record<string, string[]> = {};
  for (const [key, entry] of entries) {
    if (!key.trim() || key.length > 80 || !Array.isArray(entry) || entry.length > 100 || entry.some((item) => typeof item !== "string" || item.length > 255)) {
      return invalid("must contain short filter names and lists of short text values");
    }
    normalized[key.trim()] = entry.map((item) => item.trim());
  }
  return valid(normalized);
};

const enumRule = (...choices: string[]): RemoteValueRule => (value) => typeof value === "string" && choices.includes(value)
  ? valid(value)
  : invalid(`must be one of: ${choices.join(", ")}`);

const remoteValueRules: Readonly<Record<string, RemoteValueRule>> = {
  "organization.name": textRule(2, 255),
  "event.description": textRule(0, 1_000, { trim: false }),
  "event.website_url": urlRule(true),
  "event.accent": colorRule,
  "submission_form.name": textRule(2, 255),
  "reviewer_group.name": textRule(1, 255),
  "speaker_profile.name": textRule(2, 255),
  "speaker_profile.title": textRule(0, 255),
  "speaker_profile.company": textRule(0, 255),
  "speaker_profile.bio": textRule(0, 5_000),
  "speaker_profile.pronouns": textRule(0, 100, { nullable: true }),
  "speaker_profile.city": textRule(0, 255, { nullable: true }),
  "proposal.title": textRule(3, 255),
  "proposal.summary": textRule(20, 5_000),
  "review_round.name": textRule(1, 255),
  "track.name": textRule(1, 120),
  "track.color": colorRule,
  "room.capacity": integerRule(1, 100_000),
  "program_session.title": textRule(3, 255),
  "program_session.description": textRule(0, 5_000),
  "program_session.capacity": integerRule(0, 100_000, true),
  "program_session.ceu_credits": textRule(0, 50, { nullable: true }),
  "program_session.client_id": textRule(0, 255, { nullable: true }),
  "file_request.title": textRule(2, 255),
  "file_request.instructions_html": textRule(0, 20_000, { trim: false }),
  "file_request.required": booleanRule,
  "task_template.title": textRule(2, 255),
  "task_template.description": textRule(2, 5_000),
  "task_template.relative_due_days": integerRule(0, 365),
  "speaker_task.title": textRule(2, 255),
  "speaker_task.description": textRule(0, 5_000),
  "speaker_task.due_at": timestampRule,
  "embed.name": textRule(1, 255),
  "embed.enabled": booleanRule,
  "embed.theme": enumRule("light", "dark"),
  "embed.filters": filtersRule,
  "resource_page.title": textRule(2, 160),
  "resource_page.slug": slugRule,
  "resource_page.summary": textRule(0, 500),
  "resource_page.sanitized_html": textRule(0, 50_000, { trim: false }),
  "resource_page.embed_url": urlRule(true),
  "message_template.name": textRule(2, 120),
  "message_template.subject": textRule(2, 255),
  "message_template.html": textRule(2, 40_000),
  "message_template.text": textRule(2, 20_000),
  "communication_schedule.enabled": booleanRule,
  "communication_schedule.offset_days": integerRule(0, 60),
};

export function validateAirtableRemoteValue(entityType: string, column: string, value: unknown): AirtableRemoteValueResult {
  const entityDefinition = airtableEntity(entityType);
  if (!entityDefinition?.remoteMutableColumns.includes(column)) return invalid("is not directly editable from Airtable");
  const rule = remoteValueRules[`${entityType}.${column}`];
  return rule ? rule(value) : invalid("does not have a domain validation rule");
}
