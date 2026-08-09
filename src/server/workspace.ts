import type { AuthActor, Bindings } from "./env";
import type {
  Actor,
  EmbedDefinition,
  FormDefinition,
  FormField,
  MessageTemplateDefinition,
  OnboardingTask,
  ProgramSession,
  Proposal,
  ReminderRule,
  ResourcePage,
  ReviewAssignment,
  ReviewerGroupConfig,
  Room,
  SpeakerProfile,
  TaskTemplateDefinition,
  Track,
  WorkspaceSnapshot,
} from "../shared/domain";
import { formFieldSection, projectCustomFormResponses } from "../shared/form-fields";
import { normalizeFormVersionSettings } from "../shared/form-settings";
import { formVersionControlsFromSettings } from "../shared/form-version-controls";
import { parseReviewRubric } from "../shared/review-rubric";
import { workspaceFormRowsSql } from "./workspace-forms";

function json<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function jsonRecord(value: unknown) {
  const parsed = json<unknown>(value, {});
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : {};
}

function safeArtifactFileName(value: unknown) {
  if (typeof value !== "string") return undefined;
  const leaf = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const safe = [...leaf]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 31 && code !== 127 && !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069);
    })
    .join("")
    .trim()
    .slice(0, 255);
  return safe && safe !== "." && safe !== ".." ? safe : "Submitted file";
}

function safeArtifactContentType(value: unknown) {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(normalized)
    ? normalized
    : "application/octet-stream";
}

function safeExternalHttpsUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function workspaceTaskFromRow(row: Record<string, unknown>, eventId: string): OnboardingTask {
  const linkedFormId = row.linked_form_id ? String(row.linked_form_id) : undefined;
  const linkedFormVersionId = row.linked_form_version_id ? String(row.linked_form_version_id) : undefined;
  const linkedFormBelongsToEvent = String(row.linked_form_event_id ?? "") === eventId;
  const artifactUploadId = row.authorized_artifact_upload_id
    ? String(row.authorized_artifact_upload_id)
    : undefined;
  const artifactVersions = json<Array<Record<string, unknown>>>(row.artifact_versions, [])
    .map((version) => ({
      position: Number(version.position),
      uploadId: String(version.uploadId ?? ""),
      fileName: safeArtifactFileName(version.fileName) ?? "Submitted file",
      contentType: safeArtifactContentType(version.contentType) ?? "application/octet-stream",
      uploadedAt: iso(version.uploadedAt),
    }))
    .filter((version) => version.uploadId && Number.isInteger(version.position) && version.position >= 0)
    .sort((left, right) => right.position - left.position)
    .map((version) => ({
      uploadId: version.uploadId,
      fileName: version.fileName,
      contentType: version.contentType,
      uploadedAt: version.uploadedAt,
    }));
  if (artifactUploadId && !artifactVersions.some((version) => version.uploadId === artifactUploadId)) {
    artifactVersions.unshift({
      uploadId: artifactUploadId,
      fileName: safeArtifactFileName(row.artifact_file_name) ?? "Submitted file",
      contentType: safeArtifactContentType(row.artifact_content_type) ?? "application/octet-stream",
      uploadedAt: iso(row.artifact_created_at),
    });
  }
  const comments = json<Array<Record<string, unknown>>>(row.task_comments, [])
    .map((comment) => ({
      id: String(comment.id ?? ""),
      authorId: String(comment.authorId ?? ""),
      authorName: String(comment.authorName ?? "Conference participant"),
      body: String(comment.body ?? ""),
      createdAt: iso(comment.createdAt),
    }))
    .filter((comment) => comment.id && comment.authorId && comment.body.trim());
  const responseStatus = row.form_response_status === "draft" || row.form_response_status === "submitted"
    ? row.form_response_status
    : undefined;
  const dueAt = iso(row.due_at);
  const storedStatus = String(row.status) as OnboardingTask["status"];
  const status = ["not_started", "in_progress"].includes(storedStatus) && new Date(dueAt).getTime() < Date.now()
    ? "overdue" as const
    : storedStatus;
  return {
    id: String(row.id),
    eventId,
    speakerId: String(row.speaker_profile_id),
    title: String(row.title),
    description: String(row.description),
    dueAt,
    status,
    type: String(row.type) as OnboardingTask["type"],
    targetType: row.target_type ? String(row.target_type) as OnboardingTask["targetType"] : undefined,
    proposalId: row.authorized_proposal_id ? String(row.authorized_proposal_id) : undefined,
    targetTitle: row.authorized_proposal_id && row.target_title ? String(row.target_title) : undefined,
    completionMode: row.completion_mode ? String(row.completion_mode) as OnboardingTask["completionMode"] : undefined,
    externalUrl: safeExternalHttpsUrl(row.external_url),
    formId: linkedFormBelongsToEvent ? linkedFormId : undefined,
    fileRequestId: row.file_request_id ? String(row.file_request_id) : undefined,
    artifactUploadId,
    artifactFileName: artifactUploadId ? safeArtifactFileName(row.artifact_file_name) : undefined,
    artifactContentType: artifactUploadId ? safeArtifactContentType(row.artifact_content_type) : undefined,
    artifactVersions,
    comments,
    form: linkedFormBelongsToEvent && linkedFormId && linkedFormVersionId
      ? {
          id: linkedFormVersionId,
          formId: linkedFormId,
          version: Number(row.linked_form_version),
          title: String(row.linked_form_title ?? row.title),
          description: String(row.linked_form_description ?? row.description),
          fields: json<FormField[]>(row.linked_form_fields, []),
          response: jsonRecord(row.form_responses),
          responseStatus,
        }
      : undefined,
  };
}

export function workspaceReviewFromRow(row: Record<string, unknown>): ReviewAssignment {
  let rubric: ReviewAssignment["rubric"] = [];
  try {
    rubric = parseReviewRubric(row.rubric);
  } catch {
    // Keep the workspace available so reviewers can see that the round needs organizer repair.
  }
  const storedScores = jsonRecord(row.scores);
  const criterionById = new Map(rubric.map((criterion) => [criterion.id, criterion]));
  const scores = Object.fromEntries(Object.entries(storedScores).filter((entry): entry is [string, number | string] => {
    const criterion = criterionById.get(entry[0]);
    if (!criterion) return false;
    return (criterion.type ?? "numeric") === "numeric"
      ? typeof entry[1] === "number" && Number.isFinite(entry[1])
      : typeof entry[1] === "string";
  }));
  return {
    id: String(row.id),
    proposalId: String(row.proposal_id),
    reviewerId: String(row.reviewer_user_id),
    round: Number(row.round),
    roundName: String(row.round_name ?? `Round ${Number(row.round)}`),
    status: String(row.status) as ReviewAssignment["status"],
    reviewCycle: row.review_cycle === null || row.review_cycle === undefined ? undefined : Number(row.review_cycle),
    rubric,
    scores,
    score: row.total_score === null || row.total_score === undefined ? undefined : Number(row.total_score),
    recommendation: row.recommendation ? String(row.recommendation) as ReviewAssignment["recommendation"] : undefined,
    notes: row.notes ? String(row.notes) : undefined,
    ...(row.anonymized ? { anonymized: true } : {}),
    ...(row.recused_at ? { recusedAt: iso(row.recused_at) } : {}),
    ...(row.recusal_reason ? { recusalReason: String(row.recusal_reason) } : {}),
    submittedAt: row.submitted_at ? iso(row.submitted_at) : undefined,
  };
}

export function workspaceResourceFromRow(row: Record<string, unknown>): ResourcePage {
  return {
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    status: String(row.status) as ResourcePage["status"],
    summary: String(row.summary ?? ""),
    body: String(row.sanitized_html ?? ""),
    ...(row.embed_url ? { linkUrl: String(row.embed_url) } : {}),
    updatedAt: iso(row.updated_at),
  };
}

export function workspaceProposalForRole(proposal: Proposal, role: Actor["role"], anonymizedReview = false): Proposal {
  const projected = { ...proposal };
  if (role === "organizer") return projected;
  if (role === "reviewer") {
    delete projected.revisionRequest;
    if (anonymizedReview) {
      projected.speakers = [];
      // Raw submission payloads may contain canonical and custom participant
      // answers (email, phone, biography, and other identifying details). Blind
      // reviewers only receive proposal-section projections; the organizer keeps
      // the complete immutable submission.
      delete projected.responses;
      projected.customResponses = projected.customResponses?.filter((response) => response.section === "proposal");
      if (projected.form) {
        projected.form = {
          ...projected.form,
          fields: projected.form.fields.filter((field) => formFieldSection(field) === "proposal"),
        };
      }
    }
    return projected;
  }
  delete projected.score;
  delete projected.reviewerGroup;
  return projected;
}

export const workspaceReviewRowsSql = `SELECT ra.*, rr.round, rr.name AS round_name, rr.rubric, rr.anonymized
  FROM review_assignments ra
  JOIN review_rounds rr ON rr.id = ra.round_id
  JOIN proposals p ON p.id = ra.proposal_id AND p.event_id = rr.event_id
  WHERE rr.event_id = ? AND rr.status = 'active'
    AND (
      ? = 'organizer' OR (
        ra.reviewer_user_id = ?
        AND EXISTS (
          SELECT 1 FROM review_round_reviewers active_pool
          WHERE active_pool.round_id = ra.round_id
            AND active_pool.reviewer_user_id = ra.reviewer_user_id
        )
        AND ra.recused_at IS NULL
        AND ra.review_cycle = p.review_cycle
        AND p.status IN ('submitted', 'under_review')
        AND NOT (
          ra.status = 'submitted'
          AND p.revision_requested_at IS NOT NULL
          AND (ra.submitted_at IS NULL OR ra.submitted_at <= p.revision_requested_at)
        )
        AND p.owner_user_id <> ?
        AND NOT EXISTS (
          SELECT 1 FROM proposal_speakers conflict_speaker
          JOIN speaker_profiles conflict_profile
            ON conflict_profile.id = conflict_speaker.speaker_profile_id
            AND conflict_profile.event_id = p.event_id
          WHERE conflict_speaker.proposal_id = p.id
            AND conflict_profile.user_id = ?
        )
      )
    )
  ORDER BY rr.round, ra.created_at, ra.id`;

export async function loadWorkspace(env: Bindings, authActor: AuthActor, requestedEventId?: string, requestedRole?: AuthActor["role"]): Promise<WorkspaceSnapshot | null> {
  const membership = await env.DB.prepare(
    `SELECT e.*, em.role
     FROM events e JOIN event_memberships em ON em.event_id = e.id
     WHERE em.user_id = ? AND e.deleted_at IS NULL AND (? IS NULL OR e.id = ?) AND (? IS NULL OR em.role = ?)
     ORDER BY CASE e.status WHEN 'agenda_published' THEN 1 WHEN 'review' THEN 2 WHEN 'cfp_open' THEN 3 ELSE 4 END,
       CASE em.role WHEN 'organizer' THEN 1 WHEN 'reviewer' THEN 2 WHEN 'speaker' THEN 3 ELSE 4 END,
       e.starts_at DESC
     LIMIT 1`,
  ).bind(authActor.id, requestedEventId ?? null, requestedEventId ?? null, requestedRole ?? null, requestedRole ?? null).first<Record<string, unknown>>();
  if (!membership) return null;

  const eventId = String(membership.id);
  const role = String(membership.role) as Actor["role"];
  const [formRows, speakerRows, proposalRows, proposalSpeakerRows, reviewRows, taskRows, trackRows, roomRows, sessionRows, sessionSpeakerRows, resourceRows, embedRows, activityRows, actorRows, reviewerGroupRows, reviewerGroupMemberRows, taskTemplateRows, messageTemplateRows, reminderRuleRows] = await Promise.all([
    env.DB.prepare(workspaceFormRowsSql(role)).bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT sp.*, up.object_key AS headshot_key FROM speaker_profiles sp LEFT JOIN uploads up ON up.id = sp.headshot_upload_id WHERE sp.event_id = ?").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT p.*, COALESCE((SELECT GROUP_CONCAT(route_group.name, ', ')
        FROM proposal_reviewer_groups route
        JOIN reviewer_groups route_group ON route_group.id = route.reviewer_group_id
        WHERE route.proposal_id = p.id), rg.name) AS reviewer_group, response_version.fields AS response_fields,
      response_version.id AS response_version_id, response_version.form_id AS response_form_id,
      response_version.version AS response_version, response_version.public_title AS response_public_title,
      response_version.page_heading AS response_page_heading, response_version.welcome_title AS response_welcome_title,
      response_version.welcome_copy AS response_welcome_copy, response_version.confirmation_copy AS response_confirmation_copy,
      response_version.max_speakers AS response_max_speakers, response_version.allow_multiple_drafts AS response_allow_multiple_drafts,
      response_version.settings AS response_settings, response_version.published_at AS response_published_at,
      response_version.created_at AS response_version_created_at,
      response_form.name AS response_form_name, response_form.kind AS response_form_kind,
      response_form.target_type AS response_target_type, response_form.status AS response_form_status,
      response_form.submission_type AS response_legacy_submission_type,
      response_form.collects_participants AS response_legacy_collects_participants,
      response_form.max_submissions_per_user AS response_legacy_max_submissions_per_user,
      response_form.redirect_to_portal AS response_legacy_redirect_to_portal,
      response_form.confirmation_email_enabled AS response_legacy_confirmation_email_enabled,
      response_form.closes_at AS response_legacy_closes_at,
      (SELECT AVG(ra.total_score) FROM review_assignments ra JOIN review_rounds score_round ON score_round.id = ra.round_id WHERE ra.proposal_id = p.id AND ra.status = 'submitted' AND score_round.status = 'active'
        AND ra.review_cycle = p.review_cycle
        AND (p.revision_requested_at IS NULL OR (ra.submitted_at IS NOT NULL AND ra.submitted_at > p.revision_requested_at))) AS score,
      (SELECT COUNT(*) FROM review_assignments ra JOIN review_rounds count_round ON count_round.id = ra.round_id WHERE ra.proposal_id = p.id AND ra.status = 'submitted' AND count_round.status = 'active'
        AND ra.review_cycle = p.review_cycle
        AND (p.revision_requested_at IS NULL OR (ra.submitted_at IS NOT NULL AND ra.submitted_at > p.revision_requested_at))) AS review_count
      FROM proposals p JOIN form_versions response_version ON response_version.id = p.form_version_id
      JOIN submission_forms response_form ON response_form.id = response_version.form_id AND response_form.event_id = p.event_id
      LEFT JOIN reviewer_groups rg ON rg.id = p.reviewer_group_id WHERE p.event_id = ? ORDER BY p.submitted_at DESC, p.updated_at DESC`).bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT ps.proposal_id, ps.speaker_profile_id, ps.participant_role FROM proposal_speakers ps JOIN proposals p ON p.id = ps.proposal_id WHERE p.event_id = ? ORDER BY ps.sort_order").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare(workspaceReviewRowsSql).bind(eventId, role, authActor.id, authActor.id, authActor.id).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT st.*, tt.target_type, tt.completion_mode, tt.file_request_id,
      fv.id AS linked_form_version_id, fv.form_id AS linked_form_id, fv.version AS linked_form_version,
      fv.public_title AS linked_form_title, fv.welcome_copy AS linked_form_description, fv.fields AS linked_form_fields,
      sf.event_id AS linked_form_event_id, tr.responses AS form_responses, tr.status AS form_response_status,
      artifact.id AS authorized_artifact_upload_id, artifact.file_name AS artifact_file_name,
      artifact.content_type AS artifact_content_type, artifact.created_at AS artifact_created_at,
      (SELECT json_group_array(json_object(
          'position', artifact_history.key,
          'uploadId', history_upload.id,
          'fileName', history_upload.file_name,
          'contentType', history_upload.content_type,
          'uploadedAt', history_upload.created_at
        ))
        FROM json_each(COALESCE(file_response.upload_ids, '[]')) artifact_history
        JOIN uploads history_upload ON history_upload.id = artifact_history.value
          AND history_upload.event_id = st.event_id AND history_upload.deleted_at IS NULL
      ) AS artifact_versions,
      (SELECT json_group_array(json_object(
          'id', ordered_comment.id,
          'authorId', ordered_comment.author_user_id,
          'authorName', ordered_comment.author_name,
          'body', ordered_comment.body,
          'createdAt', ordered_comment.created_at
        ))
        FROM (
          SELECT task_comment.id, task_comment.author_user_id,
            COALESCE(task_comment_author.name, 'Conference participant') AS author_name,
            task_comment.body, task_comment.created_at
          FROM task_comments task_comment
          LEFT JOIN user task_comment_author ON task_comment_author.id = task_comment.author_user_id
          WHERE task_comment.task_id = st.id AND task_comment.event_id = st.event_id
          ORDER BY task_comment.created_at, task_comment.id
        ) ordered_comment
      ) AS task_comments,
      task_proposal.id AS authorized_proposal_id, task_proposal.title AS target_title
      FROM speaker_tasks st
      LEFT JOIN task_templates tt ON tt.id = st.template_id AND tt.event_id = st.event_id
      LEFT JOIN proposals task_proposal ON task_proposal.id = st.proposal_id AND task_proposal.event_id = st.event_id
      LEFT JOIN form_versions fv ON fv.id = tt.form_version_id
      LEFT JOIN submission_forms sf ON sf.id = fv.form_id AND sf.event_id = st.event_id
      LEFT JOIN task_responses tr ON tr.task_id = st.id
      LEFT JOIN uploads artifact ON artifact.id = st.artifact_upload_id
        AND artifact.event_id = st.event_id AND artifact.deleted_at IS NULL
      LEFT JOIN file_request_responses file_response ON file_response.file_request_id = tt.file_request_id
        AND file_response.target_id = st.id
      WHERE st.event_id = ? ORDER BY st.due_at`).bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM tracks WHERE event_id = ? ORDER BY name").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM rooms WHERE event_id = ? ORDER BY name").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM program_sessions WHERE event_id = ? ORDER BY starts_at, title").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT ss.session_id, ss.speaker_profile_id FROM session_speakers ss JOIN program_sessions ps ON ps.id = ss.session_id WHERE ps.event_id = ?").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM resource_pages WHERE event_id = ? ORDER BY updated_at DESC").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM embeds WHERE event_id = ? ORDER BY name").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT al.*, COALESCE(u.name, 'Conference Ops') AS actor_name FROM audit_logs al LEFT JOIN user u ON u.id = al.actor_user_id WHERE al.event_id = ? ORDER BY al.created_at DESC LIMIT 20").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT u.id, u.name, u.email, em.role FROM event_memberships em JOIN user u ON u.id = em.user_id WHERE em.event_id = ? ORDER BY u.name").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, name, category FROM reviewer_groups WHERE event_id = ? ORDER BY category, name").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT rgm.reviewer_group_id, rgm.user_id FROM reviewer_group_members rgm JOIN reviewer_groups rg ON rg.id = rgm.reviewer_group_id WHERE rg.event_id = ? ORDER BY rgm.user_id").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT tt.*, fv.form_id AS linked_form_id, fv.fields AS linked_form_fields
      FROM task_templates tt
      LEFT JOIN form_versions fv ON fv.id = tt.form_version_id
      WHERE tt.event_id = ? ORDER BY tt.created_at, tt.title`).bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, kind, name, subject, html, text, updated_at FROM message_templates WHERE event_id = ? ORDER BY kind, updated_at DESC").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT id, kind, enabled, offset_days, updated_at FROM communication_schedules WHERE event_id = ? ORDER BY kind").bind(eventId).all<Record<string, unknown>>(),
  ]);

  const speakerById = new Map<string, SpeakerProfile>();
  const actorSpeakerIds = new Set<string>();
  for (const row of speakerRows.results) {
    if (String(row.user_id ?? "") === authActor.id) actorSpeakerIds.add(String(row.id));
    speakerById.set(String(row.id), {
      id: String(row.id),
      name: String(row.name),
      email: String(row.email),
      title: String(row.title ?? ""),
      company: String(row.company ?? ""),
      bio: String(row.bio ?? ""),
      pronouns: row.pronouns ? String(row.pronouns) : undefined,
      city: row.city ? String(row.city) : undefined,
      headshotUrl: row.headshot_key ? `/api/v1/events/${eventId}/uploads/${row.headshot_upload_id}` : undefined,
      profileComplete: Boolean(row.profile_complete),
    });
  }
  const proposalSpeakers = new Map<string, SpeakerProfile[]>();
  for (const row of proposalSpeakerRows.results) {
    const speaker = speakerById.get(String(row.speaker_profile_id));
    if (speaker) proposalSpeakers.set(String(row.proposal_id), [...(proposalSpeakers.get(String(row.proposal_id)) ?? []), { ...speaker, participantRole: String(row.participant_role ?? "Presenter") }]);
  }
  const sessionSpeakerIds = new Map<string, string[]>();
  for (const row of sessionSpeakerRows.results) sessionSpeakerIds.set(String(row.session_id), [...(sessionSpeakerIds.get(String(row.session_id)) ?? []), String(row.speaker_profile_id)]);

  const forms: FormDefinition[] = formRows.results.map((row) => {
    const version = role === "organizer" ? Number(row.current_version) : Number(row.published_version);
    const publishedVersion = row.published_version === null || row.published_version === undefined ? undefined : Number(row.published_version);
    const status = role === "organizer" && version !== publishedVersion
      ? "draft"
      : String(row.status) as FormDefinition["status"];
    const rawSettings = json<unknown>(row.settings, {});
    const controls = formVersionControlsFromSettings(rawSettings, {
      submissionType: row.legacy_submission_type === "session" ? "session" : "abstract",
      collectsParticipants: Boolean(row.legacy_collects_participants),
      ...(row.legacy_max_submissions_per_user === null || row.legacy_max_submissions_per_user === undefined
        ? {}
        : { maxSubmissionsPerUser: Number(row.legacy_max_submissions_per_user) }),
      redirectToPortal: Boolean(row.legacy_redirect_to_portal),
      confirmationEmailEnabled: Boolean(row.legacy_confirmation_email_enabled),
      ...(row.legacy_closes_at ? { closesAt: iso(row.legacy_closes_at) } : {}),
    });
    return {
      id: String(row.id), eventId, name: String(row.name), slug: row.slug ? String(row.slug) : undefined, publicTitle: String(row.public_title), pageHeading: String(row.page_heading), version, publishedVersion, status,
      kind: row.kind ? String(row.kind) as FormDefinition["kind"] : undefined, targetType: row.target_type ? String(row.target_type) as FormDefinition["targetType"] : undefined,
      submissionType: controls.submissionType, collectsParticipants: controls.collectsParticipants,
      welcomeTitle: String(row.welcome_title), welcomeCopy: String(row.welcome_copy), confirmationCopy: String(row.confirmation_copy), maxSpeakers: Number(row.max_speakers),
      maxSubmissionsPerUser: controls.maxSubmissionsPerUser, closesAt: controls.closesAt,
      redirectToPortal: controls.redirectToPortal, confirmationEmailEnabled: controls.confirmationEmailEnabled, allowMultipleDrafts: Boolean(row.allow_multiple_drafts),
      settings: normalizeFormVersionSettings(rawSettings),
      fields: json<FormField[]>(row.fields, []), submissions: Number(row.submissions ?? 0), updatedAt: iso(row.updated_at),
    };
  });

  const proposals: Proposal[] = proposalRows.results.map((row) => {
    const responseSettings = json<unknown>(row.response_settings, {});
    const responseControls = formVersionControlsFromSettings(responseSettings, {
      submissionType: row.response_legacy_submission_type === "session" ? "session" : "abstract",
      collectsParticipants: Boolean(row.response_legacy_collects_participants),
      ...(row.response_legacy_max_submissions_per_user === null || row.response_legacy_max_submissions_per_user === undefined
        ? {}
        : { maxSubmissionsPerUser: Number(row.response_legacy_max_submissions_per_user) }),
      redirectToPortal: Boolean(row.response_legacy_redirect_to_portal),
      confirmationEmailEnabled: Boolean(row.response_legacy_confirmation_email_enabled),
      ...(row.response_legacy_closes_at ? { closesAt: iso(row.response_legacy_closes_at) } : {}),
    });
    const responseFields = json<FormField[]>(row.response_fields, []);
    const pinnedForm: FormDefinition = {
      id: String(row.response_form_id),
      eventId,
      name: String(row.response_form_name),
      publicTitle: String(row.response_public_title),
      pageHeading: String(row.response_page_heading),
      version: Number(row.response_version),
      publishedVersion: Number(row.response_version),
      status: row.response_form_status === "closed" ? "closed" : row.response_published_at ? "published" : "draft",
      kind: row.response_form_kind ? String(row.response_form_kind) as FormDefinition["kind"] : undefined,
      targetType: row.response_target_type ? String(row.response_target_type) as FormDefinition["targetType"] : undefined,
      submissionType: responseControls.submissionType,
      collectsParticipants: responseControls.collectsParticipants,
      welcomeTitle: String(row.response_welcome_title),
      welcomeCopy: String(row.response_welcome_copy),
      confirmationCopy: String(row.response_confirmation_copy),
      maxSpeakers: Number(row.response_max_speakers),
      maxSubmissionsPerUser: responseControls.maxSubmissionsPerUser,
      closesAt: responseControls.closesAt,
      redirectToPortal: responseControls.redirectToPortal,
      confirmationEmailEnabled: responseControls.confirmationEmailEnabled,
      allowMultipleDrafts: Boolean(row.response_allow_multiple_drafts),
      settings: normalizeFormVersionSettings(responseSettings),
      fields: responseFields,
      submissions: 0,
      updatedAt: iso(row.response_version_created_at),
    };
    return {
      id: String(row.id), eventId, version: Number(row.version), reviewCycle: Number(row.review_cycle ?? 1), title: String(row.title), summary: String(row.summary), category: String(row.category), format: String(row.format) as Proposal["format"],
      durationMinutes: Number(row.duration_minutes), level: String(row.level) as Proposal["level"], status: String(row.status) as Proposal["status"], speakers: proposalSpeakers.get(String(row.id)) ?? [],
      revisionRequest: row.revision_note && row.revision_requested_at ? {
        note: String(row.revision_note),
        requestedAt: iso(row.revision_requested_at),
        requestedBy: row.revision_requested_by === "applicant" ? "applicant" : "organizer",
      } : undefined,
      submittedAt: row.submitted_at ? iso(row.submitted_at) : iso(row.updated_at), score: row.score === null || row.score === undefined ? undefined : Number(row.score), reviewCount: Number(row.review_count ?? 0),
      reviewerGroup: String(row.reviewer_group ?? "Unassigned"), tags: json<string[]>(jsonRecord(row.responses).tags, []), responses: jsonRecord(row.responses),
      customResponses: projectCustomFormResponses(responseFields, jsonRecord(row.responses)),
      form: pinnedForm,
    };
  });

  const reviews = reviewRows.results.map(workspaceReviewFromRow);
  const tasks: OnboardingTask[] = taskRows.results.map((row) => workspaceTaskFromRow(row, eventId));
  const tracks: Track[] = trackRows.results.map((row) => ({ id: String(row.id), name: String(row.name), color: String(row.color) }));
  const rooms: Room[] = roomRows.results.map((row) => ({ id: String(row.id), name: String(row.name), capacity: Number(row.capacity) }));
  const sessions: ProgramSession[] = sessionRows.results.map((row) => {
    const ids = sessionSpeakerIds.get(String(row.id)) ?? [];
    return { id: String(row.id), eventId, proposalId: row.proposal_id ? String(row.proposal_id) : undefined, origin: String(row.origin) as ProgramSession["origin"], title: String(row.title), description: String(row.description ?? ""), format: String(row.format) as ProgramSession["format"], capacity: row.capacity === null || row.capacity === undefined ? undefined : Number(row.capacity), ceuCredits: row.ceu_credits ? String(row.ceu_credits) : undefined, clientId: row.client_id ? String(row.client_id) : undefined, speakerIds: ids, speakerNames: ids.map((id) => speakerById.get(id)?.name ?? "Invited speaker"), trackId: row.track_id ? String(row.track_id) : undefined, roomId: row.room_id ? String(row.room_id) : undefined, startsAt: row.starts_at ? iso(row.starts_at) : undefined, endsAt: row.ends_at ? iso(row.ends_at) : undefined, status: String(row.status) as ProgramSession["status"], overrideReason: row.override_reason ? String(row.override_reason) : undefined };
  });
  const resources: ResourcePage[] = resourceRows.results.map(workspaceResourceFromRow);
  const embeds: EmbedDefinition[] = embedRows.results.map((row) => ({ id: String(row.id), name: String(row.name), eventId, format: String(row.format) as EmbedDefinition["format"], enabled: Boolean(row.enabled), theme: String(row.theme) as EmbedDefinition["theme"], updatedAt: iso(row.updated_at) }));
  const actors: Actor[] = actorRows.results.map((row) => ({ id: String(row.id), name: String(row.name), email: String(row.email), role: String(row.role) as Actor["role"] }));
  const reviewerIdsByGroup = new Map<string, string[]>();
  for (const row of reviewerGroupMemberRows.results) {
    const groupId = String(row.reviewer_group_id);
    reviewerIdsByGroup.set(groupId, [...(reviewerIdsByGroup.get(groupId) ?? []), String(row.user_id)]);
  }
  const reviewerGroups: ReviewerGroupConfig[] = reviewerGroupRows.results.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    category: String(row.category),
    reviewerIds: reviewerIdsByGroup.get(String(row.id)) ?? [],
  }));
  const taskTemplates: TaskTemplateDefinition[] = taskTemplateRows.results.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    description: String(row.description),
    type: String(row.type) as TaskTemplateDefinition["type"],
    targetType: String(row.target_type) as TaskTemplateDefinition["targetType"],
    completionMode: String(row.completion_mode) as TaskTemplateDefinition["completionMode"],
    relativeDueDays: Number(row.relative_due_days),
    externalUrl: safeExternalHttpsUrl(row.external_url),
    formId: row.linked_form_id ? String(row.linked_form_id) : undefined,
    fileRequestId: row.file_request_id ? String(row.file_request_id) : undefined,
    formFields: row.linked_form_fields ? json<FormField[]>(row.linked_form_fields, []) : undefined,
  }));
  const messageTemplates: MessageTemplateDefinition[] = messageTemplateRows.results.map((row) => ({
    id: String(row.id),
    kind: String(row.kind) as MessageTemplateDefinition["kind"],
    name: String(row.name),
    subject: String(row.subject),
    html: String(row.html),
    text: String(row.text),
    updatedAt: iso(row.updated_at),
  }));
  const reminderRules: ReminderRule[] = reminderRuleRows.results.map((row) => ({
    id: String(row.id),
    kind: String(row.kind) as ReminderRule["kind"],
    enabled: Boolean(row.enabled),
    offsetDays: Number(row.offset_days),
    updatedAt: iso(row.updated_at),
  }));
  const actor: Actor = { id: authActor.id, name: authActor.name, email: authActor.email, role };
  const reviewerProposalIds = new Set(reviews.filter((review) => review.reviewerId === authActor.id).map((review) => review.proposalId));
  const ownedProposalIds = new Set(proposalRows.results.filter((row) => String(row.owner_user_id) === authActor.id).map((row) => String(row.id)));
  for (const [proposalId, speakers] of proposalSpeakers) if (speakers.some((speaker) => actorSpeakerIds.has(speaker.id))) ownedProposalIds.add(proposalId);
  const anonymizedProposalIds = new Set(reviews.filter((review) => review.reviewerId === authActor.id && review.anonymized).map((review) => review.proposalId));
  const visibleProposals = (role === "organizer" ? proposals : role === "reviewer" ? proposals.filter((proposal) => reviewerProposalIds.has(proposal.id)) : proposals.filter((proposal) => ownedProposalIds.has(proposal.id)))
    .map((proposal) => {
      return workspaceProposalForRole(proposal, role, anonymizedProposalIds.has(proposal.id));
    });
  const visibleReviews = role === "organizer" ? reviews : role === "reviewer" ? reviews.filter((review) => review.reviewerId === authActor.id) : [];
  const visibleTasks = role === "organizer" ? tasks : role === "speaker" || role === "applicant" ? tasks.filter((task) => actorSpeakerIds.has(task.speakerId)) : [];
  const visibleSessions = role === "organizer" ? sessions : role === "reviewer" ? sessions.filter((session) => session.status === "published") : sessions.filter((session) => session.status === "published" || session.speakerIds.some((speakerId) => actorSpeakerIds.has(speakerId)));

  return {
    actor,
    actors: role === "organizer" ? actors : [actor],
    event: {
      id: eventId, slug: String(membership.slug), name: String(membership.name), shortName: String(membership.short_name), description: String(membership.description), timezone: String(membership.timezone),
      startsAt: iso(membership.starts_at), endsAt: iso(membership.ends_at), venue: String(membership.venue), websiteUrl: String(membership.website_url ?? ""), status: String(membership.status) as WorkspaceSnapshot["event"]["status"],
      cfpClosesAt: membership.cfp_closes_at ? iso(membership.cfp_closes_at) : iso(membership.starts_at), accent: String(membership.accent),
    },
    forms: role === "organizer" ? forms : forms.filter((form) => form.status !== "draft"), proposals: visibleProposals, reviews: visibleReviews, tasks: visibleTasks, tracks, rooms, sessions: visibleSessions,
    resources: role === "organizer" ? resources : resources.filter((resource) => resource.status === "published"), embeds: role === "organizer" ? embeds : [],
    reviewerGroups: role === "organizer" ? reviewerGroups : [],
    taskTemplates: role === "organizer" ? taskTemplates : [],
    messageTemplates: role === "organizer" ? messageTemplates : [],
    reminderRules: role === "organizer" ? reminderRules : [],
    activity: role === "organizer" ? activityRows.results.map((row) => ({ id: String(row.id), actor: String(row.actor_name), action: String(row.action), target: String(row.summary), at: iso(row.created_at), tone: String(row.action).includes("failed") || String(row.action).includes("override") ? "warning" : String(row.action).includes("accepted") || String(row.action).includes("published") ? "positive" : "neutral" })) : [],
  };
}
