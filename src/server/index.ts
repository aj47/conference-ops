import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createAuth } from "./auth";
import type { AppEnv } from "./env";
import { jsonError, requestContext, requireActor, requireRole } from "./http";
import { createDemoWorkspace } from "../shared/demo-data";
import { projectConferenceExport } from "../shared/conference-export";
import { promoteAssignedBacklogSql } from "./reviewer-backfill";
import { formFieldSection, submissionCategoryField, submissionCategoryFields } from "../shared/form-fields";
import { defaultFormVersionSettings, normalizeFormVersionSettings } from "../shared/form-settings";
import {
  formVersionControlsFromSettings,
  formVersionSettingsWithControls,
  type FormVersionControls,
} from "../shared/form-version-controls";
import { auditScheduleConflictOverrideSql, detectScheduleConflicts, scheduleConflictOverrideAuditBindings, scheduleWindowError, sessionPlacementUpdateBindings, updateSessionPlacementSql } from "./schedule";
import {
  configuredSubmissionCategories,
  formAvailability,
  requiredFileField,
  submissionCombinedCharacterCount,
  validateFormResponses,
} from "./forms";
import type { EventRecord, FormField, ProposalStatus, ResourcePage } from "../shared/domain";
import { loadWorkspace } from "./workspace";
import { verifiedPrimarySpeakerMatches } from "./submissions";
import { hasReadinessAuthorization, probeReadiness } from "./readiness";
import { eventAcceptsSelfEnrollment, selfEnrollmentEventSql } from "./enrollment";
import { applicantMayEditProposal, applicantMayOpenProposalRevision, applicantMayWithdrawProposal } from "./proposal-lifecycle";
import { instantiateAcceptedSpeakerTasksSql } from "./speaker-task-instantiation";
import {
  databaseTimestampToIso,
  isPublicEventStatus,
  publicEventFromRow,
  publicResourceFromRow,
  publicSessionsFromRows,
  publicSpeakerFromProfile,
  publicSpeakerFromRow,
  type PublicSessionSpeakerRow,
} from "./public-program";
import {
  filterPublicWidgetExport,
  isPublicWidgetExportFormat,
  publicWidgetIcal,
  publicWidgetXml,
  type PublicWidgetExportPayload,
} from "./public-widget-export";
import {
  auditProposalDecisionBindings,
  auditProposalDecisionSql,
  isProfileComplete,
  publishFormEventSql,
  publishFormVersionSql,
  publishSubmissionFormSql,
  reopenSpeakerTaskSql,
  reopenTaskResponseSql,
  updateProposalDecisionBindings,
  updateProposalDecisionSql,
  type ProposalDecisionStatus,
} from "./mutations";
import { AgendaPublishError, publishAgendaAtomically, validateAgendaPublishSelection } from "./agenda-publish";
import { putR2ObjectWithMetadata } from "./r2-persistence";
import { ineligibleCommunicationRecipientIds, type CommunicationRecipientEvidence } from "./communications";
import { demoCommunicationDeliveries, projectCommunicationDelivery, type CommunicationOutboxRow } from "./communication-history";
import { dispatchPersistedJobs, persistOutboxJobs, prepareOutboxJob, type OutboxJob } from "./outbox-producer";
import { evaluateReviewScores, ReviewRubricError } from "../shared/review-rubric";
import { createInitialEvent, EventSlugConflictError, isEventSlugConstraintError } from "./event-setup";
import { uploadContentTypeAllowed } from "./upload-policy";
import { agendaEmbedAssetRequest, agendaEmbedContentSecurityPolicyForEnvironment, withAgendaEmbedFramingPolicy } from "./embed-assets";
import { bumpEventCalendarRevisionsSql, bumpRoomCalendarRevisionsSql, eventInviteFieldsChanged } from "./calendar-revisions";
import {
  activateAcceptedSpeakersSql,
  createAcceptedProposalSessionSql,
  grantClaimedSpeakerMembershipsSql,
  linkAcceptedProposalSpeakersSql,
} from "./acceptance-activation";
import { readinessAnswer, readinessInsights } from "./readiness-agent";
import { dispatchAirtableAfterMutation } from "./airtable-dispatch";
import speakerContentRoutes from "./speaker-content-routes";
import { handleAirtableWebhook } from "./airtable-webhook";
import { loadAirtableOperatorStatus, projectAirtableOperatorStatus } from "./airtable-status";
import {
  auditApplicantRevisionOpenSql,
  auditProposalRevisionRequestBindings,
  auditProposalRevisionRequestSql,
  proposalMayRequestRevision,
  revokeOpenReviewsForRevisionSql,
  updateProposalForRevisionBindings,
  updateProposalForApplicantRevisionSql,
  updateProposalForRevisionSql,
} from "./proposal-revision";
import { boundedProposalEvaluation, reviewResultsCsv } from "./abstract-review";
import { spreadsheetSafeCsvCell } from "../shared/csv";

const app = new Hono<AppEnv>();

app.use("*", requestContext);

app.on(["GET", "HEAD"], "/events/:slug/embed/:widget", async (c) => {
  if (!["sessions", "speakers", "agenda", "itinerary", "gallery"].includes(c.req.param("widget"))) {
    return jsonError(c, 404, "WIDGET_NOT_FOUND", "This public widget is not available.");
  }
  if (!c.env.ASSETS) return jsonError(c, 503, "ASSETS_UNAVAILABLE", "The embedded public program is temporarily unavailable.");
  const contentSecurityPolicy = agendaEmbedContentSecurityPolicyForEnvironment(c.env.ENVIRONMENT);
  const response = withAgendaEmbedFramingPolicy(await c.env.ASSETS.fetch(agendaEmbedAssetRequest(c.req.raw)), contentSecurityPolicy);
  c.header("content-security-policy", contentSecurityPolicy);
  c.header("x-frame-options", undefined);
  return response;
});

app.get("/api/health", (c) => c.json({ status: "ok", service: "conference-ops", environment: c.env.ENVIRONMENT }));

app.get("/api/ready", async (c) => {
  if (!hasReadinessAuthorization(c.req.header("authorization"), c.env.REALTIME_TOKEN)) {
    return jsonError(c, 401, "READINESS_AUTH_REQUIRED", "Readiness credentials are required.");
  }
  const result = await probeReadiness(c.env);
  if (!result.ready) {
    console.error(JSON.stringify({ event: "readiness.failed", requestId: c.get("requestId"), check: result.failedCheck, detail: result.detail }));
    return c.json({ status: "not_ready", service: "conference-ops", environment: c.env.ENVIRONMENT, checks: result.checks, requestId: c.get("requestId") }, 503);
  }
  return c.json({ status: "ready", service: "conference-ops", environment: c.env.ENVIRONMENT, checks: result.checks });
});

app.on(["GET", "POST"], "/api/auth/*", (c) => createAuth(c.env).handler(c.req.raw));

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function eventPortalUrl(publicAppUrl: string, eventId: string) {
  const portalUrl = new URL("/portal/home", publicAppUrl);
  portalUrl.searchParams.set("eventId", eventId);
  portalUrl.searchParams.set("role", "applicant");
  return portalUrl.toString();
}

function versionControlsFromRow(row: Record<string, unknown>): FormVersionControls {
  return formVersionControlsFromSettings(parseJson<unknown>(row.settings, {}), {
    submissionType: row.submissionType === "session" ? "session" : "abstract",
    collectsParticipants: Boolean(row.collectsParticipants),
    ...(row.maxSubmissionsPerUser === null || row.maxSubmissionsPerUser === undefined
      ? {}
      : { maxSubmissionsPerUser: Number(row.maxSubmissionsPerUser) }),
    redirectToPortal: Boolean(row.redirectToPortal),
    confirmationEmailEnabled: Boolean(row.confirmationEmailEnabled),
    ...(databaseTimestampToIso(row.closesAt) ? { closesAt: databaseTimestampToIso(row.closesAt) } : {}),
  });
}

function submissionValidationFields(fields: FormField[], collectsParticipants: boolean) {
  return collectsParticipants
    ? fields
    : fields.filter((field) => formFieldSection(field) !== "participant");
}

function formCategoryOptions(fields: FormField[]) {
  const categoryField = submissionCategoryField(fields);
  return [...new Set((categoryField?.options ?? []).map((option) => option.trim()).filter(Boolean))];
}

function categoryContractError(fields: FormField[]) {
  const candidates = submissionCategoryFields(fields);
  if (candidates.length !== 1) return "Add exactly one proposal field named Category or Program lane.";
  const [field] = candidates;
  if (field.type !== "select" && field.type !== "multi_select") return `${field.label} must be a dropdown or multi-select.`;
  if (!field.required) return `${field.label} must require an answer.`;
  if (field.condition) return `${field.label} must be visible to every applicant.`;
  const options = (field.options ?? []).map((option) => option.trim()).filter(Boolean);
  if (!options.length) return `${field.label} needs at least one program lane.`;
  if (options.some((option) => option.includes(","))) return `${field.label} choices cannot contain commas.`;
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return `${field.label} choices must be unique.`;
  return undefined;
}

async function reviewerRoutingForCategories(db: D1Database, eventId: string, categories: string[]) {
  if (!categories.length) return { groups: [] as { id: string; category: string }[], reviewers: [] as { id: string }[] };
  const groups = await db.prepare(`SELECT id, category FROM reviewer_groups
    WHERE event_id = ? AND lower(category) IN (${categories.map(() => "lower(?)").join(",")})
    ORDER BY created_at, id`)
    .bind(eventId, ...categories)
    .all<{ id: string; category: string }>();
  if (!groups.results.length) return { groups: [], reviewers: [] };
  const members = await db.prepare(`SELECT DISTINCT user_id AS id FROM reviewer_group_members
    WHERE reviewer_group_id IN (${groups.results.map(() => "?").join(",")})`)
    .bind(...groups.results.map((group) => group.id))
    .all<{ id: string }>();
  return { groups: groups.results, reviewers: members.results };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

function renderMessageTemplate(value: string, variables: Record<string, string>) {
  return Object.entries(variables).reduce(
    (rendered, [key, replacement]) => rendered.replaceAll(`{{${key}}}`, replacement),
    value,
  );
}

async function submissionConfirmationJob(input: {
  db: D1Database;
  publicAppUrl: string;
  eventId: string;
  proposalId: string;
  proposalTitle: string;
  recipientName: string;
  recipientEmail: string;
  fallbackCopy: string;
}) {
  const [event, template] = await Promise.all([
    input.db.prepare("SELECT name FROM events WHERE id = ?").bind(input.eventId).first<{ name: string }>(),
    input.db.prepare("SELECT subject, text, html FROM message_templates WHERE event_id = ? AND kind = 'submission_confirmation' ORDER BY updated_at DESC LIMIT 1")
      .bind(input.eventId).first<{ subject: string; text: string; html: string }>(),
  ]);
  const variables = {
    "event.name": event?.name ?? "Conference Ops",
    "speaker.name": input.recipientName,
    "proposal.title": input.proposalTitle,
    "speaker.portal_url": eventPortalUrl(input.publicAppUrl, input.eventId),
  };
  const fallbackText = `Hi {{speaker.name}},\n\n${input.fallbackCopy}\n\nOpen your portal: {{speaker.portal_url}}`;
  const fallbackHtml = `<p>Hi {{speaker.name}},</p><p>${escapeHtml(input.fallbackCopy)}</p><p><a href="{{speaker.portal_url}}">Open your portal</a></p>`;
  const htmlVariables = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, escapeHtml(value)]));
  return {
    kind: "email" as const,
    idempotencyKey: `submission-confirmation:${input.proposalId}`,
    payload: {
      kind: "communication",
      eventId: input.eventId,
      recipient: input.recipientEmail.toLowerCase(),
      recipientName: input.recipientName,
      subject: renderMessageTemplate(template?.subject ?? "We received your {{event.name}} proposal", variables),
      text: renderMessageTemplate(template?.text ?? fallbackText, variables),
      html: renderMessageTemplate(template?.html ?? fallbackHtml, htmlVariables),
    },
  };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

app.get("/api/v1/public/events/:slug", async (c) => {
  const requestedForm = c.req.query("form")?.trim() || undefined;
  if (c.env.DEMO_MODE === "true") {
    const workspace = createDemoWorkspace("user-applicant");
    if (workspace.event.slug !== c.req.param("slug") || !isPublicEventStatus(workspace.event.status)) return jsonError(c, 404, "EVENT_NOT_FOUND", "This public event is not available.");
    const sessions = workspace.sessions
      .filter((session) => session.status === "published")
      .map((session) => {
        const track = workspace.tracks.find((candidate) => candidate.id === session.trackId);
        const room = workspace.rooms.find((candidate) => candidate.id === session.roomId);
        return {
          ...session,
          trackName: track?.name,
          trackColor: track?.color,
          roomName: room?.name,
        };
      });
    const publishedSpeakerIds = new Set(sessions.flatMap((session) => session.speakerIds));
    const speakers = [...new Map(workspace.proposals.flatMap((proposal) => proposal.speakers).filter((speaker) => publishedSpeakerIds.has(speaker.id)).map((speaker) => [speaker.id, speaker])).values()]
      .map(publicSpeakerFromProfile);
    const form = workspace.forms.find((candidate) => candidate.status === "published"
      && (!requestedForm || candidate.slug === requestedForm || candidate.id === requestedForm));
    return c.json({ data: { demoMode: true, event: workspace.event, form, sessions, speakers, resources: workspace.resources.filter((resource) => resource.status === "published") } });
  }
  const eventRow = await c.env.DB.prepare("SELECT id, slug, name, short_name AS shortName, description, timezone, starts_at AS startsAt, ends_at AS endsAt, cfp_closes_at AS cfpClosesAt, venue, website_url AS websiteUrl, accent, logo_upload_id AS logoUploadId, status FROM events WHERE slug = ? AND deleted_at IS NULL AND status IN ('cfp_open', 'review', 'agenda_published', 'archived')")
    .bind(c.req.param("slug"))
    .first<Record<string, unknown>>();
  if (!eventRow) return jsonError(c, 404, "EVENT_NOT_FOUND", "This public event is not available.");
  const event = publicEventFromRow(eventRow);
  const [form, sessionResult, sessionSpeakerResult, speakerResult, resourceResult] = await Promise.all([
    c.env.DB.prepare("SELECT sf.id, sf.slug, sf.name, sf.status, sf.published_version AS version, sf.submission_type AS submissionType, sf.collects_participants AS collectsParticipants, sf.max_submissions_per_user AS maxSubmissionsPerUser, sf.redirect_to_portal AS redirectToPortal, sf.confirmation_email_enabled AS confirmationEmailEnabled, sf.closes_at AS closesAt, sf.updated_at AS updatedAt, fv.public_title AS publicTitle, fv.page_heading AS pageHeading, fv.welcome_title AS welcomeTitle, fv.welcome_copy AS welcomeCopy, fv.confirmation_copy AS confirmationCopy, fv.max_speakers AS maxSpeakers, fv.allow_multiple_drafts AS allowMultipleDrafts, fv.settings, fv.fields FROM submission_forms sf JOIN form_versions fv ON fv.form_id = sf.id AND fv.version = sf.published_version WHERE sf.event_id = ? AND sf.kind = 'cfp' AND sf.status = 'published' AND (? IS NULL OR sf.slug = ? OR sf.id = ?) ORDER BY CASE WHEN sf.slug = ? OR sf.id = ? THEN 0 ELSE 1 END, sf.created_at LIMIT 1")
      .bind(event.id, requestedForm ?? null, requestedForm ?? null, requestedForm ?? null, requestedForm ?? null, requestedForm ?? null).first<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT ps.id, ps.event_id AS eventId, ps.proposal_id AS proposalId, ps.title, ps.description, ps.format, ps.starts_at AS startsAt, ps.ends_at AS endsAt, t.id AS trackId, t.name AS trackName, t.color AS trackColor, r.id AS roomId, r.name AS roomName FROM program_sessions ps LEFT JOIN tracks t ON t.id = ps.track_id AND t.event_id = ps.event_id LEFT JOIN rooms r ON r.id = ps.room_id AND r.event_id = ps.event_id WHERE ps.event_id = ? AND ps.status = 'published' AND EXISTS (SELECT 1 FROM session_content_status scs WHERE scs.session_id = ps.id AND scs.event_id = ps.event_id AND scs.status = 'approved') ORDER BY ps.starts_at")
      .bind(event.id).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT ss.session_id AS sessionId, sp.id AS speakerId, sp.name AS speakerName FROM session_speakers ss JOIN program_sessions ps ON ps.id = ss.session_id JOIN speaker_profiles sp ON sp.id = ss.speaker_profile_id AND sp.event_id = ps.event_id WHERE ps.event_id = ? AND ps.status = 'published' AND EXISTS (SELECT 1 FROM session_content_status scs WHERE scs.session_id = ps.id AND scs.event_id = ps.event_id AND scs.status = 'approved') ORDER BY ps.starts_at, sp.name")
      .bind(event.id).all<PublicSessionSpeakerRow>(),
    c.env.DB.prepare("SELECT DISTINCT sp.id, sp.name, sp.title, sp.company, sp.bio, sp.pronouns, sp.city, sp.profile_complete AS profileComplete, CASE WHEN up.id IS NULL THEN 0 ELSE 1 END AS hasHeadshot FROM speaker_profiles sp JOIN session_speakers ss ON ss.speaker_profile_id = sp.id JOIN program_sessions ps ON ps.id = ss.session_id AND ps.event_id = sp.event_id LEFT JOIN uploads up ON up.id = sp.headshot_upload_id AND up.event_id = sp.event_id AND up.purpose = 'headshot' AND up.deleted_at IS NULL WHERE sp.event_id = ? AND sp.published = 1 AND ps.status = 'published' AND EXISTS (SELECT 1 FROM session_content_status scs WHERE scs.session_id = ps.id AND scs.event_id = ps.event_id AND scs.status = 'approved') ORDER BY sp.name")
      .bind(event.id).all<Record<string, unknown>>(),
    c.env.DB.prepare("SELECT id, title, slug, summary, sanitized_html AS body, embed_url AS linkUrl, updated_at AS updatedAt FROM resource_pages WHERE event_id = ? AND status = 'published' ORDER BY title")
      .bind(event.id).all<Record<string, unknown>>(),
  ]);
  const formControls = form ? versionControlsFromRow(form) : null;
  const formPayload = form && formControls ? {
    id: String(form.id),
    eventId: event.id,
    name: String(form.name),
    slug: form.slug ? String(form.slug) : undefined,
    status: "published" as const,
    kind: "cfp" as const,
    version: Number(form.version),
    publishedVersion: Number(form.version),
    submissionType: formControls.submissionType,
    collectsParticipants: formControls.collectsParticipants,
    maxSubmissionsPerUser: formControls.maxSubmissionsPerUser,
    redirectToPortal: formControls.redirectToPortal,
    confirmationEmailEnabled: formControls.confirmationEmailEnabled,
    ...(formControls.closesAt ? { closesAt: formControls.closesAt } : {}),
    publicTitle: String(form.publicTitle),
    pageHeading: String(form.pageHeading),
    welcomeTitle: String(form.welcomeTitle),
    welcomeCopy: String(form.welcomeCopy),
    confirmationCopy: String(form.confirmationCopy),
    maxSpeakers: Number(form.maxSpeakers),
    allowMultipleDrafts: Boolean(form.allowMultipleDrafts),
    settings: normalizeFormVersionSettings(parseJson<unknown>(form.settings, {})),
    fields: parseJson<FormField[]>(form.fields, []),
    submissions: 0,
    updatedAt: databaseTimestampToIso(form.updatedAt) ?? new Date(0).toISOString(),
  } : null;
  return c.json({ data: {
    event,
    form: formPayload,
    sessions: publicSessionsFromRows(sessionResult.results, sessionSpeakerResult.results),
    speakers: speakerResult.results.map((speaker) => publicSpeakerFromRow(speaker, event.slug)),
    resources: resourceResult.results.map(publicResourceFromRow),
  } });
});

app.get("/api/v1/public/events/:slug/widgets/:widget/:format", async (c) => {
  const widget = c.req.param("widget");
  const format = c.req.param("format");
  if (!["sessions", "speakers", "agenda", "itinerary", "gallery"].includes(widget)) {
    return jsonError(c, 404, "WIDGET_NOT_FOUND", "This public widget is not available.");
  }
  if (!isPublicWidgetExportFormat(format)) {
    return jsonError(c, 404, "WIDGET_FORMAT_NOT_FOUND", "Choose JSON, XML, or iCal for a public widget feed.");
  }

  let payload: PublicWidgetExportPayload;
  if (c.env.DEMO_MODE === "true") {
    const workspace = createDemoWorkspace("user-applicant");
    if (workspace.event.slug !== c.req.param("slug") || !isPublicEventStatus(workspace.event.status)) {
      return jsonError(c, 404, "EVENT_NOT_FOUND", "This public event is not available.");
    }
    const sessions = workspace.sessions.filter((session) => session.status === "published").map((session) => ({
      ...session,
      trackName: workspace.tracks.find((track) => track.id === session.trackId)?.name,
      roomName: workspace.rooms.find((room) => room.id === session.roomId)?.name,
    }));
    const publishedSpeakerIds = new Set(sessions.flatMap((session) => session.speakerIds));
    payload = {
      event: workspace.event,
      sessions,
      speakers: [...new Map(workspace.proposals.flatMap((proposal) => proposal.speakers).filter((speaker) => publishedSpeakerIds.has(speaker.id)).map((speaker) => [speaker.id, speaker])).values()].map(publicSpeakerFromProfile),
    };
  } else {
    const eventRow = await c.env.DB.prepare("SELECT id, slug, name, short_name AS shortName, description, timezone, starts_at AS startsAt, ends_at AS endsAt, cfp_closes_at AS cfpClosesAt, venue, website_url AS websiteUrl, accent, logo_upload_id AS logoUploadId, status FROM events WHERE slug = ? AND deleted_at IS NULL AND status IN ('cfp_open', 'review', 'agenda_published', 'archived')")
      .bind(c.req.param("slug")).first<Record<string, unknown>>();
    if (!eventRow) return jsonError(c, 404, "EVENT_NOT_FOUND", "This public event is not available.");
    const event = publicEventFromRow(eventRow);
    const [sessionResult, sessionSpeakerResult, speakerResult] = await Promise.all([
      c.env.DB.prepare("SELECT ps.id, ps.event_id AS eventId, ps.proposal_id AS proposalId, ps.title, ps.description, ps.format, ps.starts_at AS startsAt, ps.ends_at AS endsAt, t.id AS trackId, t.name AS trackName, t.color AS trackColor, r.id AS roomId, r.name AS roomName FROM program_sessions ps LEFT JOIN tracks t ON t.id = ps.track_id AND t.event_id = ps.event_id LEFT JOIN rooms r ON r.id = ps.room_id AND r.event_id = ps.event_id WHERE ps.event_id = ? AND ps.status = 'published' AND EXISTS (SELECT 1 FROM session_content_status scs WHERE scs.session_id = ps.id AND scs.event_id = ps.event_id AND scs.status = 'approved') ORDER BY ps.starts_at")
        .bind(event.id).all<Record<string, unknown>>(),
      c.env.DB.prepare("SELECT ss.session_id AS sessionId, sp.id AS speakerId, sp.name AS speakerName FROM session_speakers ss JOIN program_sessions ps ON ps.id = ss.session_id JOIN speaker_profiles sp ON sp.id = ss.speaker_profile_id AND sp.event_id = ps.event_id WHERE ps.event_id = ? AND ps.status = 'published' AND EXISTS (SELECT 1 FROM session_content_status scs WHERE scs.session_id = ps.id AND scs.event_id = ps.event_id AND scs.status = 'approved') ORDER BY ps.starts_at, sp.name")
        .bind(event.id).all<PublicSessionSpeakerRow>(),
      c.env.DB.prepare("SELECT DISTINCT sp.id, sp.name, sp.title, sp.company, sp.bio, sp.pronouns, sp.city, sp.profile_complete AS profileComplete, CASE WHEN up.id IS NULL THEN 0 ELSE 1 END AS hasHeadshot FROM speaker_profiles sp JOIN session_speakers ss ON ss.speaker_profile_id = sp.id JOIN program_sessions ps ON ps.id = ss.session_id AND ps.event_id = sp.event_id LEFT JOIN uploads up ON up.id = sp.headshot_upload_id AND up.event_id = sp.event_id AND up.purpose = 'headshot' AND up.deleted_at IS NULL WHERE sp.event_id = ? AND sp.published = 1 AND ps.status = 'published' AND EXISTS (SELECT 1 FROM session_content_status scs WHERE scs.session_id = ps.id AND scs.event_id = ps.event_id AND scs.status = 'approved') ORDER BY sp.name")
        .bind(event.id).all<Record<string, unknown>>(),
    ]);
    payload = {
      event,
      sessions: publicSessionsFromRows(sessionResult.results, sessionSpeakerResult.results),
      speakers: speakerResult.results.map((speaker) => publicSpeakerFromRow(speaker, event.slug)),
    };
  }

  const filtered = filterPublicWidgetExport(payload, {
    trackId: c.req.query("track"),
    sessionFormat: c.req.query("sessionFormat"),
    roomId: c.req.query("room"),
  });
  c.header("access-control-allow-origin", "*");
  c.header("cache-control", "public, max-age=60, stale-while-revalidate=300");
  if (format === "json") return c.json({ data: { widget, ...filtered } });
  if (format === "xml") {
    c.header("content-type", "application/xml; charset=utf-8");
    return c.body(publicWidgetXml(filtered));
  }
  c.header("content-type", "text/calendar; charset=utf-8");
  c.header("content-disposition", `inline; filename="${filtered.event.slug}-${widget}.ics"`);
  return c.body(publicWidgetIcal(filtered));
});

app.get("/api/v1/public/events/:slug/speakers/:speakerId/headshot", async (c) => {
  if (c.env.DEMO_MODE === "true") return jsonError(c, 404, "HEADSHOT_NOT_FOUND", "This public headshot is not available.");
  const upload = await c.env.DB.prepare(`SELECT up.object_key AS objectKey, up.content_type AS contentType
    FROM events e
    JOIN speaker_profiles sp ON sp.event_id = e.id AND sp.id = ? AND sp.published = 1
    JOIN uploads up ON up.id = sp.headshot_upload_id AND up.event_id = e.id AND up.purpose = 'headshot' AND up.deleted_at IS NULL
    WHERE e.slug = ? AND e.deleted_at IS NULL AND e.status IN ('cfp_open', 'review', 'agenda_published', 'archived')
      AND EXISTS (SELECT 1 FROM session_speakers ss JOIN program_sessions ps ON ps.id = ss.session_id WHERE ss.speaker_profile_id = sp.id AND ps.event_id = e.id AND ps.status = 'published'
        AND EXISTS (SELECT 1 FROM session_content_status scs WHERE scs.session_id = ps.id AND scs.event_id = ps.event_id AND scs.status = 'approved'))`)
    .bind(c.req.param("speakerId"), c.req.param("slug"))
    .first<{ objectKey: string; contentType: string }>();
  if (!upload || !["image/jpeg", "image/png", "image/webp"].includes(upload.contentType.toLowerCase())) {
    return jsonError(c, 404, "HEADSHOT_NOT_FOUND", "This public headshot is not available.");
  }
  const object = await c.env.UPLOADS.get(upload.objectKey);
  if (!object) return jsonError(c, 404, "HEADSHOT_NOT_FOUND", "This public headshot is not available.");
  c.header("content-type", upload.contentType.toLowerCase());
  c.header("content-length", String(object.size));
  c.header("etag", object.httpEtag);
  c.header("cache-control", "public, max-age=300, stale-while-revalidate=86400");
  c.header("cross-origin-resource-policy", "cross-origin");
  if (c.req.header("if-none-match")?.split(",").map((etag) => etag.trim()).includes(object.httpEtag)) {
    return c.body(null, 304);
  }
  return c.body(object.body);
});

app.get("/api/v1/public/events/:slug/brand/logo", async (c) => {
  if (c.env.DEMO_MODE === "true") return jsonError(c, 404, "EVENT_LOGO_NOT_FOUND", "This event logo is not available.");
  const upload = await c.env.DB.prepare(`SELECT up.object_key AS objectKey, up.content_type AS contentType
    FROM events e JOIN uploads up ON up.id = e.logo_upload_id AND up.event_id = e.id AND up.purpose = 'event_logo' AND up.deleted_at IS NULL
    WHERE e.slug = ? AND e.deleted_at IS NULL AND e.status IN ('cfp_open', 'review', 'agenda_published', 'archived')`)
    .bind(c.req.param("slug")).first<{ objectKey: string; contentType: string }>();
  if (!upload || !["image/jpeg", "image/png", "image/webp"].includes(upload.contentType.toLowerCase())) return jsonError(c, 404, "EVENT_LOGO_NOT_FOUND", "This event logo is not available.");
  const object = await c.env.UPLOADS.get(upload.objectKey);
  if (!object) return jsonError(c, 404, "EVENT_LOGO_NOT_FOUND", "This event logo is not available.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=3600, stale-while-revalidate=86400");
  return new Response(object.body, { headers });
});

app.post("/api/v1/integrations/airtable/webhook", handleAirtableWebhook);

app.use("/api/v1/*", requireActor);
app.use("/api/v1/*", dispatchAirtableAfterMutation);

// Speaker roster, deliverables, content-versioning, and latest-file exports live
// in an isolated router so their extensive workflow does not widen this module.
app.route("/", speakerContentRoutes);

app.get("/api/v1/bootstrap", async (c) => {
  const actor = c.get("actor");
  if (!actor) return jsonError(c, 401, "AUTH_REQUIRED", "Sign in to continue.");
  if (actor.demo) return c.json({ data: createDemoWorkspace(actor.id) });
  const requestedRole = c.req.query("role");
  const workspace = await loadWorkspace(c.env, actor, c.req.query("eventId"), requestedRole && ["organizer", "reviewer", "applicant", "speaker"].includes(requestedRole) ? requestedRole as typeof actor.role : undefined);
  if (!workspace) return jsonError(c, 404, "NO_EVENT", "No event is available for this account yet.");
  return c.json({ data: workspace });
});

app.get("/api/v1/events/:eventId/realtime", async (c) => {
  if (!c.env.REALTIME || !c.env.REALTIME_TOKEN) return jsonError(c, 503, "REALTIME_UNAVAILABLE", "Live updates are not configured; the app will refresh normally.");
  const headers = new Headers(c.req.raw.headers);
  headers.set("authorization", `Bearer ${c.env.REALTIME_TOKEN}`);
  const target = new URL(c.req.raw.url);
  target.pathname = `/events/${encodeURIComponent(c.req.param("eventId"))}`;
  return c.env.REALTIME.fetch(new Request(target, { headers }));
});

const eventDetailsSchema = z.object({
  name: z.string().trim().min(3).max(255),
  shortName: z.string().trim().min(2).max(40),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).optional(),
  description: z.string().max(1000),
  timezone: z.string().min(1).max(100),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  cfpClosesAt: z.iso.datetime().optional(),
  venue: z.string().trim().max(500),
  websiteUrl: z.union([z.url(), z.literal("")]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});

const eventCreateSchema = eventDetailsSchema.extend({
  organizationName: z.string().trim().min(2).max(255),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  cfpClosesAt: z.iso.datetime(),
  launch: z.object({
    templateId: z.enum(["conference", "workshop", "internal_summit", "technical_multitrack"]),
    source: z.enum(["template", "csv", "airtable"]),
    tracks: z.array(z.object({
      name: z.string().trim().min(1).max(100).refine((value) => !value.includes(","), "Track names cannot contain commas."),
      color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    })).min(1).max(12),
    rooms: z.array(z.object({
      name: z.string().trim().min(1).max(100),
      capacity: z.number().int().min(1).max(100_000),
    })).min(1).max(20),
  }).optional(),
});

function eventDateError(body: { startsAt: string; endsAt: string; cfpClosesAt?: string }): { code: string; message: string; fields: Record<string, string> } | null {
  if (new Date(body.startsAt) >= new Date(body.endsAt)) {
    return { code: "INVALID_EVENT_INTERVAL", message: "Event end time must be after its start time.", fields: { endsAt: "Choose a later end time." } };
  }
  if (body.cfpClosesAt && new Date(body.cfpClosesAt) >= new Date(body.startsAt)) {
    return { code: "INVALID_CFP_CLOSE", message: "The call for proposals must close before the event starts.", fields: { cfpClosesAt: "Choose a date before the event starts." } };
  }
  return null;
}

function validTimeZone(timezone: string) {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

app.post("/api/v1/events", zValidator("json", eventCreateSchema), async (c) => {
  const actor = c.get("actor")!;
  const body = c.req.valid("json");
  const dateError = eventDateError(body);
  if (dateError) return jsonError(c, 422, dateError.code, dateError.message, dateError.fields);
  if (!validTimeZone(body.timezone)) return jsonError(c, 422, "INVALID_TIMEZONE", "Choose a valid IANA timezone.", { timezone: "Use a timezone such as America/Los_Angeles." });
  if (actor.demo) {
    return c.json({ data: { id: `event-${crypto.randomUUID()}`, slug: body.slug, organizationId: "org-demo", formId: `form-${crypto.randomUUID()}` } }, 201);
  }
  try {
    const created = await createInitialEvent(c.env, actor, body);
    return c.json({ data: created }, 201);
  } catch (error) {
    if (error instanceof EventSlugConflictError) {
      return jsonError(c, 409, "EVENT_SLUG_TAKEN", error.message, { slug: "Choose a different public slug." });
    }
    throw error;
  }
});

app.put("/api/v1/events/:eventId", zValidator("json", eventDetailsSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const dateError = eventDateError(body);
  if (dateError) return jsonError(c, 422, dateError.code, dateError.message, dateError.fields);
  if (!validTimeZone(body.timezone)) return jsonError(c, 422, "INVALID_TIMEZONE", "Choose a valid IANA timezone.", { timezone: "Use a timezone such as America/Los_Angeles." });
  if (c.get("actor")?.demo) return c.json({ data: { id: c.req.param("eventId"), ...body, updatedAt: new Date().toISOString() } });
  const currentEvent = await c.env.DB.prepare("SELECT name, venue FROM events WHERE id = ? AND deleted_at IS NULL")
    .bind(c.req.param("eventId"))
    .first<{ name: string; venue: string }>();
  if (!currentEvent) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  if (body.slug) {
    const duplicate = await c.env.DB.prepare("SELECT id FROM events WHERE slug = ? AND id <> ? AND deleted_at IS NULL LIMIT 1")
      .bind(body.slug, c.req.param("eventId"))
      .first<{ id: string }>();
    if (duplicate) return jsonError(c, 409, "EVENT_SLUG_TAKEN", "That public event slug is already in use.", { slug: "Choose a different public slug." });
  }
  let result: D1Result;
  const now = Date.now();
  const inviteFieldsChanged = eventInviteFieldsChanged(currentEvent, body);
  try {
    [result] = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE events SET name = ?, short_name = ?, slug = COALESCE(?, slug), description = ?, timezone = ?, starts_at = ?, ends_at = ?, cfp_closes_at = COALESCE(?, cfp_closes_at), venue = ?, website_url = ?, accent = ?, updated_at = ? WHERE id = ?")
        .bind(body.name, body.shortName, body.slug ?? null, body.description, body.timezone, new Date(body.startsAt).getTime(), new Date(body.endsAt).getTime(), body.cfpClosesAt ? new Date(body.cfpClosesAt).getTime() : null, body.venue, body.websiteUrl || null, body.accent, now, c.req.param("eventId")),
      c.env.DB.prepare(bumpEventCalendarRevisionsSql)
        .bind(now, c.req.param("eventId"), inviteFieldsChanged ? 1 : 0),
    ]);
  } catch (error) {
    if (isEventSlugConstraintError(error)) {
      return jsonError(c, 409, "EVENT_SLUG_TAKEN", "That public event slug is already in use.", { slug: "Choose a different public slug." });
    }
    throw error;
  }
  if (!result.meta.changes) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  return c.json({ data: { id: c.req.param("eventId"), ...body, updatedAt: new Date(now).toISOString() } });
});

const eventBrandSchema = z.object({
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((value) => value.toLowerCase()),
  logoUploadId: z.string().uuid().nullable().optional(),
});

app.put("/api/v1/events/:eventId/brand", zValidator("json", eventBrandSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  if (c.get("actor")?.demo) return c.json({ data: { accent: body.accent, ...(body.logoUploadId ? { logoUrl: `/api/v1/events/${eventId}/brand/logo` } : {}) } });
  if (body.logoUploadId) {
    const allowed = await c.env.DB.prepare("SELECT id FROM uploads WHERE id = ? AND event_id = ? AND owner_user_id = ? AND purpose = 'event_logo' AND deleted_at IS NULL")
      .bind(body.logoUploadId, eventId, c.get("actor")!.id).first();
    if (!allowed) return jsonError(c, 422, "EVENT_LOGO_INVALID", "Choose a logo uploaded to this event by your organizer account.");
  }
  const now = Date.now();
  const result = await c.env.DB.prepare("UPDATE events SET accent = ?, logo_upload_id = CASE WHEN ? = 1 THEN ? ELSE logo_upload_id END, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
    .bind(body.accent, body.logoUploadId !== undefined ? 1 : 0, body.logoUploadId ?? null, now, eventId).run();
  if (!result.meta.changes) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  await c.env.DB.prepare(`INSERT INTO audit_logs
    (id, organization_id, event_id, actor_user_id, action, entity_type, entity_id, summary, metadata, request_id, created_at)
    SELECT ?, e.organization_id, e.id, ?, 'event.brand_updated', 'event', e.id, 'Updated event brand kit', '{}', ?, ?
    FROM events e WHERE e.id = ? AND e.deleted_at IS NULL`)
    .bind(crypto.randomUUID(), c.get("actor")!.id, c.get("requestId"), now, eventId).run();
  return c.json({ data: { accent: body.accent, ...(body.logoUploadId ? { logoUrl: `/api/v1/events/${eventId}/brand/logo` } : {}) } });
});

app.get("/api/v1/events/:eventId/brand/logo", async (c) => {
  const upload = await c.env.DB.prepare(`SELECT up.object_key AS objectKey, up.content_type AS contentType
    FROM events e JOIN uploads up ON up.id = e.logo_upload_id AND up.event_id = e.id AND up.purpose = 'event_logo' AND up.deleted_at IS NULL
    WHERE e.id = ? AND e.deleted_at IS NULL`).bind(c.req.param("eventId")).first<{ objectKey: string; contentType: string }>();
  if (!upload) return jsonError(c, 404, "EVENT_LOGO_NOT_FOUND", "This event logo is not available.");
  const object = await c.env.UPLOADS.get(upload.objectKey);
  if (!object) return jsonError(c, 404, "EVENT_LOGO_NOT_FOUND", "This event logo is not available.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, max-age=300");
  return new Response(object.body, { headers });
});

// Venue resources -----------------------------------------------------------
// Rooms and tracks are event-scoped schedule inputs. All mutations keep the
// duplicate-name check inside the write statement so concurrent organizers
// cannot silently overwrite one another's configuration.

const roomResourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  capacity: z.number().int().min(1).max(100_000),
});

const trackResourceSchema = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).transform((color) => color.toLowerCase()),
});

app.post("/api/v1/events/:eventId/rooms", zValidator("json", roomResourceSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const id = crypto.randomUUID();
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    if (workspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    if (workspace.rooms.some((room) => room.name.trim().toLowerCase() === body.name.toLowerCase())) {
      return jsonError(c, 409, "ROOM_NAME_TAKEN", "A room with that name already exists.", { name: "Use a different room name." });
    }
    return c.json({ data: { id, eventId, ...body } }, 201);
  }
  const now = Date.now();
  const result = await c.env.DB.prepare(`INSERT INTO rooms (id, event_id, name, capacity, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM rooms WHERE event_id = ? AND lower(trim(name)) = lower(?))`)
    .bind(id, eventId, body.name, body.capacity, now, now, eventId, eventId, body.name)
    .run();
  if (!result.meta.changes) {
    const duplicate = await c.env.DB.prepare("SELECT id FROM rooms WHERE event_id = ? AND lower(trim(name)) = lower(?) LIMIT 1")
      .bind(eventId, body.name).first();
    if (duplicate) return jsonError(c, 409, "ROOM_NAME_TAKEN", "A room with that name already exists.", { name: "Use a different room name." });
    return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  }
  return c.json({ data: { id, eventId, ...body } }, 201);
});

app.put("/api/v1/events/:eventId/rooms/:roomId", zValidator("json", roomResourceSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const roomId = c.req.param("roomId");
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    if (workspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    const room = workspace.rooms.find((candidate) => candidate.id === roomId);
    if (!room) return jsonError(c, 404, "ROOM_NOT_FOUND", "Room not found.");
    if (workspace.rooms.some((candidate) => candidate.id !== roomId && candidate.name.trim().toLowerCase() === body.name.toLowerCase())) {
      return jsonError(c, 409, "ROOM_NAME_TAKEN", "A room with that name already exists.", { name: "Use a different room name." });
    }
    return c.json({ data: { id: roomId, eventId, ...body } });
  }
  const currentRoom = await c.env.DB.prepare("SELECT name FROM rooms WHERE id = ? AND event_id = ?")
    .bind(roomId, eventId)
    .first<{ name: string }>();
  if (!currentRoom) return jsonError(c, 404, "ROOM_NOT_FOUND", "Room not found.");
  const now = Date.now();
  const [result] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE rooms SET name = ?, capacity = ?, updated_at = ?
      WHERE id = ? AND event_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM rooms AS collision
          WHERE collision.event_id = ? AND collision.id <> ? AND lower(trim(collision.name)) = lower(?)
        )`)
      .bind(body.name, body.capacity, now, roomId, eventId, eventId, roomId, body.name),
    c.env.DB.prepare(bumpRoomCalendarRevisionsSql)
      .bind(now, eventId, roomId, currentRoom.name !== body.name ? 1 : 0),
  ]);
  if (!result.meta.changes) {
    const room = await c.env.DB.prepare("SELECT id FROM rooms WHERE id = ? AND event_id = ?").bind(roomId, eventId).first();
    if (!room) return jsonError(c, 404, "ROOM_NOT_FOUND", "Room not found.");
    return jsonError(c, 409, "ROOM_NAME_TAKEN", "A room with that name already exists.", { name: "Use a different room name." });
  }
  return c.json({ data: { id: roomId, eventId, ...body } });
});

app.delete("/api/v1/events/:eventId/rooms/:roomId", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  const roomId = c.req.param("roomId");
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    if (workspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    if (!workspace.rooms.some((room) => room.id === roomId)) return jsonError(c, 404, "ROOM_NOT_FOUND", "Room not found.");
    if (workspace.sessions.some((session) => session.roomId === roomId)) {
      return jsonError(c, 409, "ROOM_IN_USE", "Move sessions out of this room before deleting it.");
    }
    return c.json({ data: { id: roomId, deleted: true } });
  }
  const result = await c.env.DB.prepare(`DELETE FROM rooms
    WHERE id = ? AND event_id = ?
      AND NOT EXISTS (SELECT 1 FROM program_sessions WHERE event_id = ? AND room_id = ?)`)
    .bind(roomId, eventId, eventId, roomId).run();
  if (!result.meta.changes) {
    const room = await c.env.DB.prepare("SELECT id FROM rooms WHERE id = ? AND event_id = ?").bind(roomId, eventId).first();
    if (!room) return jsonError(c, 404, "ROOM_NOT_FOUND", "Room not found.");
    return jsonError(c, 409, "ROOM_IN_USE", "Move sessions out of this room before deleting it.");
  }
  return c.json({ data: { id: roomId, deleted: true } });
});

app.post("/api/v1/events/:eventId/tracks", zValidator("json", trackResourceSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const id = crypto.randomUUID();
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    if (workspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    if (workspace.tracks.some((track) => track.name.trim().toLowerCase() === body.name.toLowerCase())) {
      return jsonError(c, 409, "TRACK_NAME_TAKEN", "A track with that name already exists.", { name: "Use a different track name." });
    }
    return c.json({ data: { id, eventId, ...body } }, 201);
  }
  const now = Date.now();
  const result = await c.env.DB.prepare(`INSERT INTO tracks (id, event_id, name, color, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM tracks WHERE event_id = ? AND lower(trim(name)) = lower(?))`)
    .bind(id, eventId, body.name, body.color, now, now, eventId, eventId, body.name)
    .run();
  if (!result.meta.changes) {
    const duplicate = await c.env.DB.prepare("SELECT id FROM tracks WHERE event_id = ? AND lower(trim(name)) = lower(?) LIMIT 1")
      .bind(eventId, body.name).first();
    if (duplicate) return jsonError(c, 409, "TRACK_NAME_TAKEN", "A track with that name already exists.", { name: "Use a different track name." });
    return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  }
  return c.json({ data: { id, eventId, ...body } }, 201);
});

app.put("/api/v1/events/:eventId/tracks/:trackId", zValidator("json", trackResourceSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const trackId = c.req.param("trackId");
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    if (workspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    const track = workspace.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return jsonError(c, 404, "TRACK_NOT_FOUND", "Track not found.");
    if (workspace.tracks.some((candidate) => candidate.id !== trackId && candidate.name.trim().toLowerCase() === body.name.toLowerCase())) {
      return jsonError(c, 409, "TRACK_NAME_TAKEN", "A track with that name already exists.", { name: "Use a different track name." });
    }
    return c.json({ data: { id: trackId, eventId, ...body } });
  }
  const result = await c.env.DB.prepare(`UPDATE tracks SET name = ?, color = ?, updated_at = ?
    WHERE id = ? AND event_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM tracks AS collision
        WHERE collision.event_id = ? AND collision.id <> ? AND lower(trim(collision.name)) = lower(?)
      )`)
    .bind(body.name, body.color, Date.now(), trackId, eventId, eventId, trackId, body.name)
    .run();
  if (!result.meta.changes) {
    const track = await c.env.DB.prepare("SELECT id FROM tracks WHERE id = ? AND event_id = ?").bind(trackId, eventId).first();
    if (!track) return jsonError(c, 404, "TRACK_NOT_FOUND", "Track not found.");
    return jsonError(c, 409, "TRACK_NAME_TAKEN", "A track with that name already exists.", { name: "Use a different track name." });
  }
  return c.json({ data: { id: trackId, eventId, ...body } });
});

app.delete("/api/v1/events/:eventId/tracks/:trackId", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  const trackId = c.req.param("trackId");
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    if (workspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    if (!workspace.tracks.some((track) => track.id === trackId)) return jsonError(c, 404, "TRACK_NOT_FOUND", "Track not found.");
    if (workspace.sessions.some((session) => session.trackId === trackId)) {
      return jsonError(c, 409, "TRACK_IN_USE", "Move sessions out of this track before deleting it.");
    }
    return c.json({ data: { id: trackId, deleted: true } });
  }
  const result = await c.env.DB.prepare(`DELETE FROM tracks
    WHERE id = ? AND event_id = ?
      AND NOT EXISTS (SELECT 1 FROM program_sessions WHERE event_id = ? AND track_id = ?)`)
    .bind(trackId, eventId, eventId, trackId).run();
  if (!result.meta.changes) {
    const track = await c.env.DB.prepare("SELECT id FROM tracks WHERE id = ? AND event_id = ?").bind(trackId, eventId).first();
    if (!track) return jsonError(c, 404, "TRACK_NOT_FOUND", "Track not found.");
    return jsonError(c, 409, "TRACK_IN_USE", "Move sessions out of this track before deleting it.");
  }
  return c.json({ data: { id: trackId, deleted: true } });
});

// Participant resources ----------------------------------------------------
// The legacy sanitized_html column stores organizer-authored plain text. The
// client renders it as text nodes only, so resource copy can never execute as
// markup. A single optional HTTP(S) reference link is validated separately.

const resourceLinkSchema = z.string().trim().max(2048).refine((value) => {
  if (!value) return true;
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}, "Use a complete http:// or https:// URL.");

const resourcePageSchema = z.object({
  title: z.string().trim().min(2).max(160),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  summary: z.string().trim().max(500),
  body: z.string().trim().max(50_000),
  linkUrl: resourceLinkSchema.optional(),
  status: z.enum(["draft", "published"]),
}).superRefine((value, context) => {
  if (value.status === "published" && !value.body) {
    context.addIssue({ code: "custom", path: ["body"], message: "Add page content before publishing." });
  }
});

function resourcePageFromRow(row: Record<string, unknown>): ResourcePage {
  return {
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    summary: String(row.summary ?? ""),
    body: String(row.body ?? row.sanitized_html ?? ""),
    ...(row.linkUrl ?? row.embed_url ? { linkUrl: String(row.linkUrl ?? row.embed_url) } : {}),
    status: String(row.status) as ResourcePage["status"],
    updatedAt: databaseTimestampToIso(row.updatedAt ?? row.updated_at) ?? new Date(0).toISOString(),
  };
}

function isResourceSlugConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /resource_event_slug_unique|UNIQUE constraint failed:\s*resource_pages\.event_id,\s*resource_pages\.slug/i.test(message);
}

app.post("/api/v1/events/:eventId/resources", zValidator("json", resourcePageSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  const body = c.req.valid("json");
  const id = crypto.randomUUID();
  const now = Date.now();
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    if (workspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    if (workspace.resources.some((resource) => resource.slug === body.slug)) {
      return jsonError(c, 409, "RESOURCE_SLUG_TAKEN", "A participant resource already uses that URL slug.", { slug: "Choose a different resource slug." });
    }
    return c.json({ data: resourcePageFromRow({ id, ...body, updatedAt: now }) }, 201);
  }
  let result: D1Result;
  try {
    result = await c.env.DB.prepare(`INSERT INTO resource_pages
        (id, event_id, title, slug, summary, sanitized_html, embed_url, status, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM events WHERE id = ? AND deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM resource_pages WHERE event_id = ? AND slug = ?)`)
      .bind(id, eventId, body.title, body.slug, body.summary, body.body, body.linkUrl || null, body.status, now, now, eventId, eventId, body.slug)
      .run();
  } catch (error) {
    if (isResourceSlugConstraintError(error)) return jsonError(c, 409, "RESOURCE_SLUG_TAKEN", "A participant resource already uses that URL slug.", { slug: "Choose a different resource slug." });
    throw error;
  }
  if (!result.meta.changes) {
    const duplicate = await c.env.DB.prepare("SELECT id FROM resource_pages WHERE event_id = ? AND slug = ? LIMIT 1").bind(eventId, body.slug).first();
    if (duplicate) return jsonError(c, 409, "RESOURCE_SLUG_TAKEN", "A participant resource already uses that URL slug.", { slug: "Choose a different resource slug." });
    return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  }
  return c.json({ data: resourcePageFromRow({ id, ...body, updatedAt: now }) }, 201);
});

app.put("/api/v1/events/:eventId/resources/:resourceId", zValidator("json", resourcePageSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  const resourceId = c.req.param("resourceId");
  const body = c.req.valid("json");
  const now = Date.now();
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    if (workspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    if (!workspace.resources.some((resource) => resource.id === resourceId)) return jsonError(c, 404, "RESOURCE_NOT_FOUND", "Participant resource not found.");
    if (workspace.resources.some((resource) => resource.id !== resourceId && resource.slug === body.slug)) {
      return jsonError(c, 409, "RESOURCE_SLUG_TAKEN", "A participant resource already uses that URL slug.", { slug: "Choose a different resource slug." });
    }
    return c.json({ data: resourcePageFromRow({ id: resourceId, ...body, updatedAt: now }) });
  }
  let result: D1Result;
  try {
    result = await c.env.DB.prepare(`UPDATE resource_pages
      SET title = ?, slug = ?, summary = ?, sanitized_html = ?, embed_url = ?, status = ?, updated_at = ?
      WHERE id = ? AND event_id = ?
        AND NOT EXISTS (
          SELECT 1 FROM resource_pages AS collision
          WHERE collision.event_id = ? AND collision.id <> ? AND collision.slug = ?
        )`)
      .bind(body.title, body.slug, body.summary, body.body, body.linkUrl || null, body.status, now, resourceId, eventId, eventId, resourceId, body.slug)
      .run();
  } catch (error) {
    if (isResourceSlugConstraintError(error)) return jsonError(c, 409, "RESOURCE_SLUG_TAKEN", "A participant resource already uses that URL slug.", { slug: "Choose a different resource slug." });
    throw error;
  }
  if (!result.meta.changes) {
    const resource = await c.env.DB.prepare("SELECT id FROM resource_pages WHERE id = ? AND event_id = ?").bind(resourceId, eventId).first();
    if (!resource) return jsonError(c, 404, "RESOURCE_NOT_FOUND", "Participant resource not found.");
    return jsonError(c, 409, "RESOURCE_SLUG_TAKEN", "A participant resource already uses that URL slug.", { slug: "Choose a different resource slug." });
  }
  return c.json({ data: resourcePageFromRow({ id: resourceId, ...body, updatedAt: now }) });
});

app.delete("/api/v1/events/:eventId/resources/:resourceId", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  const resourceId = c.req.param("resourceId");
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    if (workspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    const resource = workspace.resources.find((candidate) => candidate.id === resourceId);
    if (!resource) return jsonError(c, 404, "RESOURCE_NOT_FOUND", "Participant resource not found.");
    if (resource.status === "published") return jsonError(c, 409, "RESOURCE_PUBLISHED", "Unpublish this resource before deleting it.");
    return c.json({ data: { id: resourceId, deleted: true } });
  }
  const result = await c.env.DB.prepare("DELETE FROM resource_pages WHERE id = ? AND event_id = ? AND status = 'draft'")
    .bind(resourceId, eventId).run();
  if (!result.meta.changes) {
    const resource = await c.env.DB.prepare("SELECT status FROM resource_pages WHERE id = ? AND event_id = ?").bind(resourceId, eventId).first<{ status: ResourcePage["status"] }>();
    if (!resource) return jsonError(c, 404, "RESOURCE_NOT_FOUND", "Participant resource not found.");
    return jsonError(c, 409, "RESOURCE_PUBLISHED", "Unpublish this resource before deleting it.");
  }
  return c.json({ data: { id: resourceId, deleted: true } });
});

const reviewerRoutingSchema = z.object({
  groups: z.array(z.object({
    id: z.string().min(1).optional(),
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().min(1).max(255),
    reviewerIds: z.array(z.string().min(1)).max(100),
  })).min(1).max(100),
}).superRefine((value, context) => {
  const categories = new Set<string>();
  for (const [index, group] of value.groups.entries()) {
    if (group.category.includes(",")) {
      context.addIssue({ code: "custom", path: ["groups", index, "category"], message: "Program lane names cannot contain commas." });
    }
    const key = group.category.toLocaleLowerCase();
    if (categories.has(key)) {
      context.addIssue({ code: "custom", path: ["groups", index, "category"], message: "Each program lane can have only one reviewer group." });
    }
    categories.add(key);
  }
});

app.put("/api/v1/events/:eventId/reviewer-routing", zValidator("json", reviewerRoutingSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  const body = c.req.valid("json");
  const normalized = body.groups.map((group) => ({
    ...group,
    id: group.id ?? crypto.randomUUID(),
    reviewerIds: [...new Set(group.reviewerIds)],
  }));
  if (c.get("actor")?.demo) return c.json({ data: { groups: normalized, assignmentsRebuilt: true } });

  const suppliedIds = normalized.flatMap((group) => group.id ? [group.id] : []);
  if (suppliedIds.length) {
    const owned = await c.env.DB.prepare(`SELECT id FROM reviewer_groups WHERE event_id = ? AND id IN (${suppliedIds.map(() => "?").join(",")})`)
      .bind(eventId, ...suppliedIds)
      .all<{ id: string }>();
    const existing = new Set(owned.results.map((row) => row.id));
    const foreignId = body.groups.find((group) => group.id && !existing.has(group.id));
    if (foreignId) return jsonError(c, 404, "REVIEWER_GROUP_NOT_FOUND", "A reviewer group does not belong to this event.");
  }

  const reviewerIds = [...new Set(normalized.flatMap((group) => group.reviewerIds))];
  if (reviewerIds.length) {
    const memberships = await c.env.DB.prepare(`SELECT user_id AS id FROM event_memberships
      WHERE event_id = ? AND role = 'reviewer' AND user_id IN (${reviewerIds.map(() => "?").join(",")})`)
      .bind(eventId, ...reviewerIds)
      .all<{ id: string }>();
    const allowed = new Set(memberships.results.map((row) => row.id));
    const invalid = reviewerIds.find((id) => !allowed.has(id));
    if (invalid) return jsonError(c, 422, "REVIEWER_MEMBERSHIP_REQUIRED", "Invite this person as an event reviewer before routing talks to them.", { reviewerIds: "Every selected reviewer needs an accepted reviewer membership." });
  }

  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const group of normalized) {
    statements.push(
      c.env.DB.prepare(`INSERT INTO reviewer_groups (id, event_id, name, category, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET name = excluded.name, category = excluded.category, updated_at = excluded.updated_at
        WHERE reviewer_groups.event_id = excluded.event_id`)
        .bind(group.id, eventId, group.name, group.category, now, now),
      c.env.DB.prepare("DELETE FROM reviewer_group_members WHERE reviewer_group_id = ? AND EXISTS (SELECT 1 FROM reviewer_groups WHERE id = ? AND event_id = ?)")
        .bind(group.id, group.id, eventId),
      ...group.reviewerIds.map((reviewerId) => c.env.DB.prepare(`INSERT OR IGNORE INTO reviewer_group_members (reviewer_group_id, user_id, created_at)
        SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM reviewer_groups WHERE id = ? AND event_id = ?)`)
        .bind(group.id, reviewerId, now, group.id, eventId)),
      c.env.DB.prepare("DELETE FROM proposal_reviewer_groups WHERE reviewer_group_id = ? AND EXISTS (SELECT 1 FROM reviewer_groups WHERE id = ? AND event_id = ?)")
        .bind(group.id, group.id, eventId),
      c.env.DB.prepare(`INSERT OR IGNORE INTO proposal_reviewer_groups (proposal_id, reviewer_group_id)
        SELECT p.id, ? FROM proposals p
        WHERE p.event_id = ?
          AND instr(',' || lower(replace(p.category, ', ', ',')) || ',', ',' || lower(?) || ',') > 0
          AND EXISTS (SELECT 1 FROM reviewer_groups WHERE id = ? AND event_id = ?)`)
        .bind(group.id, eventId, group.category, group.id, eventId),
    );
  }
  statements.push(
    c.env.DB.prepare(`DELETE FROM review_assignments
      WHERE status IN ('pending', 'in_progress')
        AND proposal_id IN (SELECT id FROM proposals WHERE event_id = ?)`)
      .bind(eventId),
    c.env.DB.prepare(`INSERT OR IGNORE INTO review_assignments
      (id, proposal_id, round_id, reviewer_user_id, review_cycle, status, scores, created_at, updated_at)
      SELECT 'review-' || lower(hex(randomblob(16))), p.id, rr.id, rgm.user_id, p.review_cycle, 'pending', '{}', ?, ?
      FROM proposals p
      JOIN proposal_reviewer_groups prg ON prg.proposal_id = p.id
      JOIN reviewer_groups rg ON rg.id = prg.reviewer_group_id AND rg.event_id = p.event_id
      JOIN reviewer_group_members rgm ON rgm.reviewer_group_id = rg.id
      JOIN review_rounds rr ON rr.id = (
        SELECT active.id FROM review_rounds active
        WHERE active.event_id = p.event_id AND active.status = 'active'
        ORDER BY active.round LIMIT 1
      )
      WHERE p.event_id = ? AND p.status IN ('submitted', 'under_review')
        AND p.owner_user_id <> rgm.user_id
        AND NOT EXISTS (
          SELECT 1 FROM proposal_speakers ps
          JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id AND sp.event_id = p.event_id
          WHERE ps.proposal_id = p.id AND sp.user_id = rgm.user_id
        )`)
      .bind(now, now, eventId),
    c.env.DB.prepare(promoteAssignedBacklogSql).bind(now, eventId),
  );
  await c.env.DB.batch(statements);
  return c.json({ data: { groups: normalized, assignmentsRebuilt: true } });
});

const reviewPlanSchema = z.object({
  name: z.string().trim().min(2).max(120),
  status: z.enum(["draft", "active", "closed"]),
  rubric: z.array(z.object({
    id: z.string().trim().min(1).max(80),
    label: z.string().trim().min(2).max(160),
    type: z.enum(["numeric", "dropdown", "text"]).optional().default("numeric"),
    description: z.string().trim().max(1000).optional(),
    weight: z.number().positive().max(1000),
    maxScore: z.number().int().min(2).max(20).optional().default(5),
    options: z.array(z.string().trim().min(1).max(120)).min(2).max(20).optional(),
    required: z.boolean().optional().default(true),
  })).min(1).max(12),
  opensAt: z.string().trim().nullable().optional(),
  closesAt: z.string().trim().nullable().optional(),
  anonymized: z.boolean().optional().default(false),
  reviewerIds: z.array(z.string().min(1)).max(100).optional(),
  reviewerCaps: z.record(z.string(), z.number().int().min(1).max(500)).optional(),
}).superRefine((value, context) => {
  const ids = new Set<string>();
  for (const [index, criterion] of value.rubric.entries()) {
    if (ids.has(criterion.id)) context.addIssue({ code: "custom", path: ["rubric", index, "id"], message: "Criterion identifiers must be unique." });
    if (criterion.type === "dropdown" && (!criterion.options || criterion.options.length < 2)) context.addIssue({ code: "custom", path: ["rubric", index, "options"], message: "Dropdown criteria need at least two options." });
    ids.add(criterion.id);
  }
  const opensAt = value.opensAt ? Date.parse(value.opensAt) : undefined;
  const closesAt = value.closesAt ? Date.parse(value.closesAt) : undefined;
  if (value.opensAt && !Number.isFinite(opensAt)) context.addIssue({ code: "custom", path: ["opensAt"], message: "Choose a valid opening date." });
  if (value.closesAt && !Number.isFinite(closesAt)) context.addIssue({ code: "custom", path: ["closesAt"], message: "Choose a valid closing date." });
  if (opensAt !== undefined && closesAt !== undefined && opensAt >= closesAt) context.addIssue({ code: "custom", path: ["closesAt"], message: "The closing date must be after the opening date." });
});

function reviewPlanFromRow(row: Record<string, unknown>, eventId: string) {
  const reviewerIds = parseJson<string[]>(row.reviewer_ids, []);
  return {
    id: String(row.id),
    eventId,
    name: String(row.name),
    round: Number(row.round),
    status: String(row.status) as "draft" | "active" | "closed",
    rubric: parseJson<unknown[]>(row.rubric, []),
    opensAt: row.opens_at ? new Date(Number(row.opens_at)).toISOString() : undefined,
    closesAt: row.closes_at ? new Date(Number(row.closes_at)).toISOString() : undefined,
    anonymized: Boolean(row.anonymized),
    reviewerIds,
    reviewerCaps: parseJson<Record<string, number>>(row.reviewer_caps, {}),
    submittedReviews: Number(row.submitted_reviews ?? 0),
    updatedAt: databaseTimestampToIso(row.updated_at) ?? new Date(0).toISOString(),
  };
}

app.get("/api/v1/events/:eventId/review-plans", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  if (c.get("actor")?.demo) {
    const demo = createDemoWorkspace(c.get("actor")!.id);
    const assignment = demo.reviews[0];
    const reviewerId = demo.actors.find((actor) => actor.role === "reviewer")?.id;
    return c.json({ data: { plans: assignment ? [
      { id: "round-1", eventId, name: "Initial Review", round: 1, status: "active", rubric: assignment.rubric, opensAt: "2026-08-01T00:00:00.000Z", closesAt: "2026-10-15T23:59:00.000Z", anonymized: true, reviewerIds: reviewerId ? [reviewerId] : [], reviewerCaps: reviewerId ? { [reviewerId]: 5 } : {}, submittedReviews: demo.reviews.filter((review) => review.status === "submitted").length, updatedAt: new Date().toISOString() },
      { id: "round-2", eventId, name: "Final Review", round: 2, status: "draft", rubric: [{ id: "final-score", label: "Final Score", type: "numeric", weight: 1, maxScore: 10, required: true }, { id: "final-comments", label: "Comments", type: "text", weight: 1, maxScore: 5, required: true }], opensAt: "2026-10-16T00:00:00.000Z", closesAt: "2026-11-30T23:59:00.000Z", anonymized: false, reviewerIds: [], reviewerCaps: {}, submittedReviews: 0, updatedAt: new Date().toISOString() },
    ] : [] } });
  }
  const rows = await c.env.DB.prepare(`SELECT rr.*,
      (SELECT COUNT(*) FROM review_assignments ra WHERE ra.round_id = rr.id AND ra.status = 'submitted') AS submitted_reviews,
      COALESCE((SELECT json_group_array(reviewer_user_id) FROM review_round_reviewers WHERE round_id = rr.id), '[]') AS reviewer_ids,
      COALESCE((SELECT json_group_object(reviewer_user_id, assignment_cap) FROM review_round_reviewers WHERE round_id = rr.id), '{}') AS reviewer_caps
    FROM review_rounds rr WHERE rr.event_id = ? ORDER BY rr.round`)
    .bind(eventId).all<Record<string, unknown>>();
  return c.json({ data: { plans: rows.results.map((row) => reviewPlanFromRow(row, eventId)) } });
});

async function validateRoundReviewerPool(db: D1Database, eventId: string, reviewerIds: string[]) {
  const unique = [...new Set(reviewerIds)];
  if (!unique.length) return true;
  const result = await db.prepare(`SELECT COUNT(DISTINCT em.user_id) AS count FROM event_memberships em
    WHERE em.event_id = ? AND em.role = 'reviewer' AND em.accepted_at IS NOT NULL AND em.user_id IN (${unique.map(() => "?").join(",")})`)
    .bind(eventId, ...unique).first<{ count: number }>();
  return Number(result?.count ?? 0) === unique.length;
}

app.post("/api/v1/events/:eventId/review-plans", zValidator("json", reviewPlanSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  const body = c.req.valid("json");
  const reviewerIds = [...new Set(body.reviewerIds ?? [])];
  if (c.get("actor")?.demo) return c.json({ data: { id: `round-${crypto.randomUUID()}`, eventId, round: 3, submittedReviews: 0, reviewerIds, reviewerCaps: body.reviewerCaps ?? {}, updatedAt: new Date().toISOString(), ...body } }, 201);
  if (!await validateRoundReviewerPool(c.env.DB, eventId, reviewerIds)) return jsonError(c, 422, "REVIEW_POOL_INVALID", "Every round reviewer must be an accepted reviewer for this event.");
  const nextRound = await c.env.DB.prepare("SELECT COALESCE(MAX(round), 0) + 1 AS round FROM review_rounds WHERE event_id = ?").bind(eventId).first<{ round: number }>();
  const id = crypto.randomUUID();
  const now = Date.now();
  const statements = [
    ...(body.status === "active" ? [c.env.DB.prepare("UPDATE review_rounds SET status = 'closed', updated_at = ? WHERE event_id = ? AND status = 'active'").bind(now, eventId)] : []),
    c.env.DB.prepare(`INSERT INTO review_rounds (id, event_id, name, round, rubric, opens_at, closes_at, anonymized, status, created_at, updated_at)
      SELECT ?, e.id, ?, ?, ?, ?, ?, ?, ?, ?, ? FROM events e WHERE e.id = ? AND e.deleted_at IS NULL`)
      .bind(id, body.name, Number(nextRound?.round ?? 1), JSON.stringify(body.rubric), body.opensAt ? Date.parse(body.opensAt) : null, body.closesAt ? Date.parse(body.closesAt) : null, body.anonymized ? 1 : 0, body.status, now, now, eventId),
    ...reviewerIds.map((reviewerId) => c.env.DB.prepare(`INSERT INTO review_round_reviewers (round_id, reviewer_user_id, assignment_cap, created_at)
      SELECT ?, em.user_id, ?, ? FROM event_memberships em WHERE em.event_id = ? AND em.user_id = ? AND em.role = 'reviewer' AND em.accepted_at IS NOT NULL`)
      .bind(id, body.reviewerCaps?.[reviewerId] ?? 25, now, eventId, reviewerId)),
  ];
  const results = await c.env.DB.batch(statements);
  if (!results[body.status === "active" ? 1 : 0]?.meta.changes) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  return c.json({ data: { id, eventId, round: Number(nextRound?.round ?? 1), submittedReviews: 0, reviewerIds, reviewerCaps: body.reviewerCaps ?? {}, updatedAt: new Date(now).toISOString(), ...body } }, 201);
});

app.get("/api/v1/events/:eventId/integrations/airtable/status", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const status = c.get("actor")?.demo
    ? projectAirtableOperatorStatus({ envEnabled: false, authorityDefault: "d1" })
    : await loadAirtableOperatorStatus(c.env, c.req.param("eventId"));
  return c.json({ data: status });
});

app.put("/api/v1/events/:eventId/review-plans/:planId", zValidator("json", reviewPlanSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  const planId = c.req.param("planId");
  const body = c.req.valid("json");
  const reviewerIds = [...new Set(body.reviewerIds ?? [])];
  if (c.get("actor")?.demo) return c.json({ data: { id: planId, eventId, round: Number(planId.replace("round-", "")) || 1, submittedReviews: 0, reviewerIds, reviewerCaps: body.reviewerCaps ?? {}, updatedAt: new Date().toISOString(), ...body } });
  if (!await validateRoundReviewerPool(c.env.DB, eventId, reviewerIds)) return jsonError(c, 422, "REVIEW_POOL_INVALID", "Every round reviewer must be an accepted reviewer for this event.");
  const existing = await c.env.DB.prepare(`SELECT rr.*,
      (SELECT COUNT(*) FROM review_assignments ra WHERE ra.round_id = rr.id AND ra.status = 'submitted') AS submitted_reviews
    FROM review_rounds rr WHERE rr.id = ? AND rr.event_id = ?`)
    .bind(planId, eventId).first<Record<string, unknown>>();
  if (!existing) return jsonError(c, 404, "REVIEW_PLAN_NOT_FOUND", "Review plan not found.");
  const existingRubric = JSON.stringify(parseJson(existing.rubric, []));
  const nextRubric = JSON.stringify(body.rubric);
  if (Number(existing.submitted_reviews) > 0 && existingRubric !== nextRubric) {
    return jsonError(c, 409, "REVIEW_RUBRIC_LOCKED", "This rubric has submitted reviews. Create a future round before changing its scoring contract.");
  }
  const now = Date.now();
  const removedReviewerClause = reviewerIds.length
    ? `AND reviewer_user_id NOT IN (${reviewerIds.map(() => "?").join(",")})`
    : "";
  const statements = [
    ...(body.status === "active" ? [c.env.DB.prepare("UPDATE review_rounds SET status = 'closed', updated_at = ? WHERE event_id = ? AND id <> ? AND status = 'active'").bind(now, eventId, planId)] : []),
    c.env.DB.prepare("UPDATE review_rounds SET name = ?, status = ?, rubric = ?, opens_at = ?, closes_at = ?, anonymized = ?, updated_at = ? WHERE id = ? AND event_id = ?")
      .bind(body.name, body.status, nextRubric, body.opensAt ? Date.parse(body.opensAt) : null, body.closesAt ? Date.parse(body.closesAt) : null, body.anonymized ? 1 : 0, now, planId, eventId),
    c.env.DB.prepare(`DELETE FROM review_assignments
      WHERE round_id = ? AND status IN ('pending', 'in_progress') ${removedReviewerClause}
        AND EXISTS (SELECT 1 FROM review_rounds rr WHERE rr.id = review_assignments.round_id AND rr.event_id = ?)`)
      .bind(planId, ...reviewerIds, eventId),
    c.env.DB.prepare("DELETE FROM review_round_reviewers WHERE round_id = ? AND EXISTS (SELECT 1 FROM review_rounds rr WHERE rr.id = ? AND rr.event_id = ?)").bind(planId, planId, eventId),
    ...reviewerIds.map((reviewerId) => c.env.DB.prepare(`INSERT INTO review_round_reviewers (round_id, reviewer_user_id, assignment_cap, created_at)
      SELECT rr.id, em.user_id, ?, ? FROM review_rounds rr JOIN event_memberships em ON em.event_id = rr.event_id
      WHERE rr.id = ? AND rr.event_id = ? AND em.user_id = ? AND em.role = 'reviewer' AND em.accepted_at IS NOT NULL`)
      .bind(body.reviewerCaps?.[reviewerId] ?? 25, now, planId, eventId, reviewerId)),
  ];
  const result = await c.env.DB.batch(statements);
  const updateIndex = body.status === "active" ? 1 : 0;
  if (!result[updateIndex]?.meta.changes) return jsonError(c, 409, "REVIEW_PLAN_CONFLICT", "The review plan changed before it could be saved.");
  return c.json({ data: { id: planId, eventId, round: Number(existing.round), submittedReviews: Number(existing.submitted_reviews), reviewerIds, reviewerCaps: body.reviewerCaps ?? {}, updatedAt: new Date(now).toISOString(), ...body } });
});

app.delete("/api/v1/events/:eventId/review-plans/:planId", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  if (c.get("actor")?.demo) return c.json({ data: { id: c.req.param("planId"), deleted: true } });
  const result = await c.env.DB.prepare(`DELETE FROM review_rounds WHERE id = ? AND event_id = ?
    AND NOT EXISTS (SELECT 1 FROM review_assignments ra WHERE ra.round_id = review_rounds.id AND ra.status = 'submitted')`)
    .bind(c.req.param("planId"), c.req.param("eventId")).run();
  if (!result.meta.changes) return jsonError(c, 409, "REVIEW_PLAN_DELETE_LOCKED", "Rounds with submitted reviews cannot be deleted.");
  return c.json({ data: { id: c.req.param("planId"), deleted: true } });
});

// Abstract-management depth: targeted assignment, progress, reminders, exports,
// recusal, and bounded AI triage. These routes never mutate submitted reviews.
app.get("/api/v1/events/:eventId/abstract-review", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    const reviewers = workspace.actors.filter((actor) => actor.role === "reviewer");
    return c.json({ data: {
      reviewers,
      assignments: workspace.reviews.map((review) => ({ id: review.id, proposalId: review.proposalId, roundId: `round-${review.round}`, reviewerId: review.reviewerId, reviewerName: reviewers.find((reviewer) => reviewer.id === review.reviewerId)?.name ?? "Reviewer", status: review.status, recusedAt: review.recusedAt, recusalReason: review.recusalReason })),
      aiEvaluations: [{ id: "ai-demo-1", proposalId: "proposal-2", roundId: "round-1", score: 4.1, effectiveScore: 4.1, rationale: "Bounded first-pass for Agents in production: the abstract gives concrete signals around observability, progress, retries, and handoffs. A program chair must review and may override this signal.", modelLabel: "Conference Ops bounded evaluator v1" }],
      results: workspace.reviews.filter((review) => review.status === "submitted" && review.score !== undefined).map((review) => ({ proposalId: review.proposalId, roundId: `round-${review.round}`, aggregateScore: review.score!, reviewCount: 1 })),
    } });
  }
  const [reviewers, assignments, aiEvaluations, results] = await Promise.all([
    c.env.DB.prepare(`SELECT u.id, u.name, u.email FROM event_memberships em JOIN user u ON u.id = em.user_id
      WHERE em.event_id = ? AND em.role = 'reviewer' AND em.accepted_at IS NOT NULL ORDER BY u.name`).bind(eventId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT ra.id, ra.proposal_id, ra.round_id, ra.reviewer_user_id, u.name AS reviewer_name,
        ra.status, ra.recused_at, ra.recusal_reason
      FROM review_assignments ra JOIN review_rounds rr ON rr.id = ra.round_id
      JOIN user u ON u.id = ra.reviewer_user_id
      WHERE rr.event_id = ? ORDER BY rr.round, u.name, ra.created_at`).bind(eventId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT ai.id, ai.proposal_id, ai.round_id, ai.score, ai.rationale, ai.model_label,
        ai.overridden_score, ai.override_reason, ai.overridden_at
      FROM ai_review_evaluations ai WHERE ai.event_id = ? ORDER BY ai.updated_at DESC`).bind(eventId).all<Record<string, unknown>>(),
    c.env.DB.prepare(`SELECT ra.proposal_id, ra.round_id, AVG(ra.total_score) AS aggregate_score, COUNT(*) AS review_count
      FROM review_assignments ra JOIN review_rounds rr ON rr.id = ra.round_id
      JOIN proposals p ON p.id = ra.proposal_id AND p.event_id = rr.event_id
      WHERE rr.event_id = ? AND ra.status = 'submitted' AND ra.total_score IS NOT NULL AND ra.review_cycle = p.review_cycle
      GROUP BY ra.proposal_id, ra.round_id`).bind(eventId).all<Record<string, unknown>>(),
  ]);
  return c.json({ data: {
    reviewers: reviewers.results.map((row) => ({ id: String(row.id), name: String(row.name), email: String(row.email), role: "reviewer" as const })),
    assignments: assignments.results.map((row) => ({ id: String(row.id), proposalId: String(row.proposal_id), roundId: String(row.round_id), reviewerId: String(row.reviewer_user_id), reviewerName: String(row.reviewer_name), status: String(row.status), recusedAt: row.recused_at ? new Date(Number(row.recused_at)).toISOString() : undefined, recusalReason: row.recusal_reason ? String(row.recusal_reason) : undefined })),
    aiEvaluations: aiEvaluations.results.map((row) => ({ id: String(row.id), proposalId: String(row.proposal_id), roundId: String(row.round_id), score: Number(row.score), effectiveScore: row.overridden_score === null || row.overridden_score === undefined ? Number(row.score) : Number(row.overridden_score), rationale: String(row.rationale), modelLabel: String(row.model_label), overriddenScore: row.overridden_score === null || row.overridden_score === undefined ? undefined : Number(row.overridden_score), overrideReason: row.override_reason ? String(row.override_reason) : undefined, overriddenAt: row.overridden_at ? new Date(Number(row.overridden_at)).toISOString() : undefined })),
    results: results.results.map((row) => ({ proposalId: String(row.proposal_id), roundId: String(row.round_id), aggregateScore: Number(row.aggregate_score), reviewCount: Number(row.review_count) })),
  } });
});

const reviewAssignmentSchema = z.object({
  roundId: z.string().min(1),
  reviewerId: z.string().min(1),
  proposalIds: z.array(z.string().min(1)).max(500),
  assignmentCap: z.number().int().min(1).max(500).default(25),
});
app.put("/api/v1/events/:eventId/abstract-review/assignments", zValidator("json", reviewAssignmentSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const proposalIds = [...new Set(body.proposalIds)];
  if (c.get("actor")?.demo) {
    if (proposalIds.length > body.assignmentCap) return jsonError(c, 422, "REVIEW_ASSIGNMENT_CAP", `This reviewer is capped at ${body.assignmentCap} assignments for the round.`);
    return c.json({ data: { roundId: body.roundId, reviewerId: body.reviewerId, assigned: proposalIds.length, assignmentCap: body.assignmentCap } });
  }
  const poolMember = await c.env.DB.prepare(`SELECT pool.assignment_cap AS assignmentCap FROM review_round_reviewers pool JOIN review_rounds rr ON rr.id = pool.round_id
    WHERE pool.round_id = ? AND pool.reviewer_user_id = ? AND rr.event_id = ?`).bind(body.roundId, body.reviewerId, eventId).first<{ assignmentCap: number }>();
  if (!poolMember) return jsonError(c, 422, "REVIEWER_NOT_IN_ROUND", "Add this reviewer to the round pool before assigning submissions.");
  const assignmentCap = Number(poolMember.assignmentCap);
  if (proposalIds.length > assignmentCap) return jsonError(c, 422, "REVIEW_ASSIGNMENT_CAP", `This reviewer is capped at ${assignmentCap} assignments for the round.`);
  const submittedOmissionClause = proposalIds.length
    ? `AND proposal_id NOT IN (${proposalIds.map(() => "?").join(",")})`
    : "";
  const submittedOmission = await c.env.DB.prepare(`SELECT 1 AS immutable FROM review_assignments
    WHERE round_id = ? AND reviewer_user_id = ? AND status = 'submitted' ${submittedOmissionClause} LIMIT 1`)
    .bind(body.roundId, body.reviewerId, ...proposalIds).first();
  if (submittedOmission) return jsonError(c, 409, "REVIEW_ASSIGNMENT_IMMUTABLE", "Submitted reviews are immutable. Keep those submissions selected or create a new review round.");
  if (proposalIds.length) {
    const eligible = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM proposals p WHERE p.event_id = ?
      AND p.id IN (${proposalIds.map(() => "?").join(",")}) AND p.status IN ('submitted', 'under_review') AND p.owner_user_id <> ?
      AND NOT EXISTS (SELECT 1 FROM proposal_speakers ps JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id AND sp.event_id = p.event_id WHERE ps.proposal_id = p.id AND sp.user_id = ?)`)
      .bind(eventId, ...proposalIds, body.reviewerId, body.reviewerId).first<{ count: number }>();
    if (Number(eligible?.count ?? 0) !== proposalIds.length) return jsonError(c, 422, "REVIEW_ASSIGNMENT_INELIGIBLE", "Every selected submission must be reviewable and free of reviewer ownership conflicts.");
  }
  const now = Date.now();
  const keepClause = proposalIds.length ? `AND proposal_id NOT IN (${proposalIds.map(() => "?").join(",")})` : "";
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM review_assignments WHERE round_id = ? AND reviewer_user_id = ? AND status IN ('pending', 'in_progress') ${keepClause}`)
      .bind(body.roundId, body.reviewerId, ...proposalIds),
    ...proposalIds.map((proposalId) => c.env.DB.prepare(`INSERT OR IGNORE INTO review_assignments
      (id, proposal_id, round_id, reviewer_user_id, review_cycle, status, scores, created_at, updated_at)
      SELECT ?, p.id, rr.id, ?, p.review_cycle, 'pending', '{}', ?, ? FROM proposals p JOIN review_rounds rr ON rr.id = ? AND rr.event_id = p.event_id
      WHERE p.id = ? AND p.event_id = ? AND p.status IN ('submitted', 'under_review')
        AND EXISTS (SELECT 1 FROM review_round_reviewers pool WHERE pool.round_id = rr.id AND pool.reviewer_user_id = ?)`)
      .bind(crypto.randomUUID(), body.reviewerId, now, now, body.roundId, proposalId, eventId, body.reviewerId)),
  ]);
  return c.json({ data: { roundId: body.roundId, reviewerId: body.reviewerId, assigned: proposalIds.length, assignmentCap } });
});

const reviewerReminderSchema = z.object({ roundId: z.string().min(1), reviewerIds: z.array(z.string().min(1)).min(1).max(100) });
app.post("/api/v1/events/:eventId/abstract-review/reminders", zValidator("json", reviewerReminderSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const reviewerIds = [...new Set(body.reviewerIds)];
  if (c.get("actor")?.demo) return c.json({ data: { queued: reviewerIds.length, dispatched: reviewerIds.length } }, 202);
  const reviewers = await c.env.DB.prepare(`SELECT u.id, u.name, u.email, e.name AS event_name, rr.name AS round_name,
      COUNT(ra.id) AS outstanding FROM review_round_reviewers pool JOIN review_rounds rr ON rr.id = pool.round_id
      JOIN events e ON e.id = rr.event_id JOIN user u ON u.id = pool.reviewer_user_id
      JOIN review_assignments ra ON ra.round_id = rr.id AND ra.reviewer_user_id = u.id AND ra.status IN ('pending', 'in_progress') AND ra.recused_at IS NULL
      WHERE rr.id = ? AND rr.event_id = ? AND u.id IN (${reviewerIds.map(() => "?").join(",")}) GROUP BY u.id, u.name, u.email, e.name, rr.name`)
    .bind(body.roundId, eventId, ...reviewerIds).all<{ id: string; name: string; email: string; event_name: string; round_name: string; outstanding: number }>();
  if (!reviewers.results.length) return jsonError(c, 422, "NO_OUTSTANDING_REVIEWS", "Select at least one reviewer with outstanding reviews.");
  const day = new Date().toISOString().slice(0, 10);
  const jobs: OutboxJob[] = reviewers.results.map((reviewer) => ({
    kind: "email",
    idempotencyKey: `review-reminder:${body.roundId}:${reviewer.id}:${day}`,
    payload: {
      kind: "communication", communicationKind: "reviewer_reminder", eventId, recipient: reviewer.email, recipientName: reviewer.name,
      subject: `${reviewer.round_name}: ${reviewer.outstanding} review${reviewer.outstanding === 1 ? "" : "s"} awaiting you`,
      text: `Hi ${reviewer.name},\n\n${reviewer.event_name} has ${reviewer.outstanding} outstanding review${reviewer.outstanding === 1 ? "" : "s"} assigned to you in ${reviewer.round_name}. Sign in to Conference Ops to complete them.`,
      html: `<p>Hi ${escapeHtml(reviewer.name)},</p><p><strong>${escapeHtml(reviewer.event_name)}</strong> has ${reviewer.outstanding} outstanding review${reviewer.outstanding === 1 ? "" : "s"} assigned to you in ${escapeHtml(reviewer.round_name)}.</p><p>Sign in to Conference Ops to complete them.</p>`,
    },
  }));
  await persistOutboxJobs(c.env.DB, jobs);
  const dispatched = c.env.JOBS_QUEUE ? await dispatchPersistedJobs(c.env.JOBS_QUEUE, jobs) : 0;
  return c.json({ data: { queued: jobs.length, dispatched } }, 202);
});

const recusalSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
app.post("/api/v1/events/:eventId/proposals/:proposalId/review/recuse", zValidator("json", recusalSchema), async (c) => {
  const denied = requireRole(c, ["reviewer"]);
  if (denied) return denied;
  const actor = c.get("actor")!;
  const body = c.req.valid("json");
  if (actor.demo) return c.json({ data: { proposalId: c.req.param("proposalId"), recused: true, reason: body.reason } });
  const now = Date.now();
  const result = await c.env.DB.prepare(`UPDATE review_assignments SET recused_at = ?, recusal_reason = ?, updated_at = ?
    WHERE proposal_id = ? AND reviewer_user_id = ? AND status IN ('pending', 'in_progress') AND recused_at IS NULL
      AND EXISTS (SELECT 1 FROM review_rounds rr WHERE rr.id = review_assignments.round_id AND rr.event_id = ? AND rr.status = 'active')`)
    .bind(now, body.reason, now, c.req.param("proposalId"), actor.id, c.req.param("eventId")).run();
  if (!result.meta.changes) return jsonError(c, 409, "REVIEW_RECUSAL_INVALID", "This review can no longer be recused.");
  return c.json({ data: { proposalId: c.req.param("proposalId"), recused: true, reason: body.reason } });
});

const aiEvaluationSchema = z.object({ roundId: z.string().min(1) });
app.post("/api/v1/events/:eventId/proposals/:proposalId/ai-evaluation", zValidator("json", aiEvaluationSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const proposalId = c.req.param("proposalId");
  if (c.get("actor")?.demo) {
    const proposal = createDemoWorkspace().proposals.find((candidate) => candidate.id === proposalId);
    if (!proposal) return jsonError(c, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
    const evaluation = boundedProposalEvaluation({ title: proposal.title, summary: proposal.summary, category: proposal.category, rubric: createDemoWorkspace().reviews[0]?.rubric ?? [] });
    return c.json({ data: { id: `ai-${proposalId}`, proposalId, roundId: body.roundId, effectiveScore: evaluation.score, ...evaluation } }, 201);
  }
  const row = await c.env.DB.prepare(`SELECT p.title, p.summary, p.category, rr.rubric FROM proposals p JOIN review_rounds rr ON rr.id = ? AND rr.event_id = p.event_id
    WHERE p.id = ? AND p.event_id = ?`).bind(body.roundId, proposalId, eventId).first<Record<string, unknown>>();
  if (!row) return jsonError(c, 404, "AI_EVALUATION_TARGET_NOT_FOUND", "Choose a proposal and review round from this event.");
  const evaluation = boundedProposalEvaluation({ title: String(row.title), summary: String(row.summary), category: String(row.category), rubric: parseJson(row.rubric, []) });
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.DB.prepare(`INSERT INTO ai_review_evaluations (id, event_id, proposal_id, round_id, score, rationale, model_label, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(proposal_id, round_id) DO UPDATE SET score = excluded.score, rationale = excluded.rationale, model_label = excluded.model_label, updated_at = excluded.updated_at`)
    .bind(id, eventId, proposalId, body.roundId, evaluation.score, evaluation.rationale, evaluation.modelLabel, now, now).run();
  const stored = await c.env.DB.prepare("SELECT id, overridden_score FROM ai_review_evaluations WHERE proposal_id = ? AND round_id = ?").bind(proposalId, body.roundId).first<{ id: string; overridden_score: number | null }>();
  return c.json({ data: { id: stored?.id ?? id, proposalId, roundId: body.roundId, effectiveScore: stored?.overridden_score ?? evaluation.score, ...evaluation } }, 201);
});

const aiOverrideSchema = z.object({ score: z.number().min(1).max(5), reason: z.string().trim().min(3).max(1000) });
app.put("/api/v1/events/:eventId/ai-evaluations/:evaluationId/override", zValidator("json", aiOverrideSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  if (c.get("actor")?.demo) return c.json({ data: { id: c.req.param("evaluationId"), effectiveScore: body.score, overriddenScore: body.score, overrideReason: body.reason } });
  const now = Date.now();
  const result = await c.env.DB.prepare(`UPDATE ai_review_evaluations SET overridden_score = ?, override_reason = ?, overridden_by = ?, overridden_at = ?, updated_at = ?
    WHERE id = ? AND event_id = ?`).bind(body.score, body.reason, c.get("actor")!.id, now, now, c.req.param("evaluationId"), c.req.param("eventId")).run();
  if (!result.meta.changes) return jsonError(c, 404, "AI_EVALUATION_NOT_FOUND", "AI evaluation not found.");
  return c.json({ data: { id: c.req.param("evaluationId"), effectiveScore: body.score, overriddenScore: body.score, overrideReason: body.reason, overriddenAt: new Date(now).toISOString() } });
});

app.get("/api/v1/events/:eventId/exports/reviews.csv", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace();
    const csv = reviewResultsCsv(workspace.reviews.map((review) => ({ proposalId: review.proposalId, title: workspace.proposals.find((proposal) => proposal.id === review.proposalId)?.title ?? review.proposalId, category: workspace.proposals.find((proposal) => proposal.id === review.proposalId)?.category ?? "", round: review.roundName, reviewer: workspace.actors.find((actor) => actor.id === review.reviewerId)?.name ?? "Reviewer", status: review.status, aggregateScore: review.score, responses: review.scores, recommendation: review.recommendation, notes: review.notes })));
    c.header("content-type", "text/csv; charset=utf-8"); c.header("content-disposition", 'attachment; filename="review-results.csv"'); return c.body(csv);
  }
  const rows = await c.env.DB.prepare(`SELECT p.id AS proposal_id, p.title, p.category, rr.name AS round_name, u.name AS reviewer_name,
      ra.status, ra.total_score, ra.scores, ra.recommendation, ra.notes FROM review_assignments ra
      JOIN proposals p ON p.id = ra.proposal_id JOIN review_rounds rr ON rr.id = ra.round_id AND rr.event_id = p.event_id
      JOIN user u ON u.id = ra.reviewer_user_id WHERE p.event_id = ? ORDER BY p.title, rr.round, u.name`).bind(eventId).all<Record<string, unknown>>();
  const csv = reviewResultsCsv(rows.results.map((row) => ({ proposalId: String(row.proposal_id), title: String(row.title), category: String(row.category), round: String(row.round_name), reviewer: String(row.reviewer_name), status: String(row.status), aggregateScore: row.total_score === null || row.total_score === undefined ? undefined : Number(row.total_score), responses: parseJson(row.scores, {}), recommendation: row.recommendation ? String(row.recommendation) : undefined, notes: row.notes ? String(row.notes) : undefined })));
  c.header("content-type", "text/csv; charset=utf-8");
  c.header("content-disposition", 'attachment; filename="review-results.csv"');
  return c.body(csv);
});

const enrollSchema = z.object({ eventId: z.string().min(1) });
app.post("/api/v1/enroll", zValidator("json", enrollSchema), async (c) => {
  const actor = c.get("actor")!;
  const { eventId } = c.req.valid("json");
  if (actor.demo) return c.json({ data: { eventId, role: "applicant", enrolled: true } }, 201);
  const existingMembership = await c.env.DB.prepare("SELECT 1 AS enrolled FROM event_memberships WHERE event_id = ? AND user_id = ? AND role = 'applicant' LIMIT 1")
    .bind(eventId, actor.id)
    .first<{ enrolled: number }>();
  if (existingMembership) return c.json({ data: { eventId, role: "applicant", enrolled: true, existing: true } });
  const now = Date.now();
  const event = await c.env.DB.prepare(selfEnrollmentEventSql)
    .bind(now, now, eventId)
    .first<{ id: string; status: EventRecord["status"]; has_open_published_form: number }>();
  if (!event) return jsonError(c, 404, "EVENT_NOT_FOUND", "This event is not available.");
  if (!eventAcceptsSelfEnrollment(event.status, Boolean(event.has_open_published_form))) {
    return jsonError(c, 409, "ENROLLMENT_CLOSED", "Self-service enrollment is only available while the call for proposals is open.");
  }
  await c.env.DB.prepare("INSERT OR IGNORE INTO event_memberships (event_id, user_id, role, accepted_at, created_at) VALUES (?, ?, 'applicant', ?, ?)")
    .bind(eventId, actor.id, Date.now(), Date.now())
    .run();
  return c.json({ data: { eventId, role: "applicant", enrolled: true } }, 201);
});

app.post("/api/v1/claim-speaker", zValidator("json", enrollSchema), async (c) => {
  const actor = c.get("actor")!;
  const { eventId } = c.req.valid("json");
  if (actor.demo) return c.json({ data: { eventId, role: "speaker", claimed: true } });
  const now = Date.now();
  const profile = await c.env.DB.prepare("SELECT id FROM speaker_profiles WHERE event_id = ? AND lower(email) = lower(?) AND (user_id IS NULL OR user_id = ?)")
    .bind(eventId, actor.email, actor.id).first<{ id: string }>();
  if (!profile) return jsonError(c, 404, "SPEAKER_INVITATION_NOT_FOUND", "No unclaimed speaker invitation matches this verified email address.");
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE speaker_profiles SET user_id = ?, updated_at = ? WHERE id = ? AND user_id IS NULL").bind(actor.id, now, profile.id),
    c.env.DB.prepare("INSERT OR IGNORE INTO event_memberships (event_id, user_id, role, accepted_at, created_at) VALUES (?, ?, 'speaker', ?, ?)").bind(eventId, actor.id, now, now),
  ]);
  return c.json({ data: { eventId, role: "speaker", speakerProfileId: profile.id, claimed: true } });
});

const invitationAcceptSchema = z.object({ token: z.string().min(32).max(512) });
app.post("/api/v1/invitations/accept", zValidator("json", invitationAcceptSchema), async (c) => {
  const actor = c.get("actor")!;
  const tokenHash = await sha256(c.req.valid("json").token);
  if (actor.demo) return c.json({ data: { accepted: true, role: actor.role } });
  const invitation = await c.env.DB.prepare("SELECT id, event_id AS eventId, email, role FROM event_invitations WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?")
    .bind(tokenHash, Date.now()).first<{ id: string; eventId: string; email: string; role: "organizer" | "reviewer" }>();
  if (!invitation || invitation.email.toLowerCase() !== actor.email.toLowerCase()) return jsonError(c, 403, "INVITATION_INVALID", "This invitation is expired or belongs to a different verified email address.");
  const now = Date.now();
  const acceptanceStatements = [
    c.env.DB.prepare("INSERT OR IGNORE INTO event_memberships (event_id, user_id, role, invited_by, accepted_at, created_at) SELECT event_id, ?, role, invited_by, ?, ? FROM event_invitations WHERE id = ?").bind(actor.id, now, now, invitation.id),
  ];
  acceptanceStatements.push(
    c.env.DB.prepare("UPDATE event_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL").bind(now, invitation.id),
  );
  await c.env.DB.batch(acceptanceStatements);
  return c.json({ data: { accepted: true, eventId: invitation.eventId, role: invitation.role } });
});

const invitationCreateSchema = z.object({ email: z.email(), role: z.enum(["organizer", "reviewer"]) });
app.post("/api/v1/events/:eventId/invitations", zValidator("json", invitationCreateSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const queue = c.env.JOBS_QUEUE;
  if (!queue && !c.get("actor")?.demo) return jsonError(c, 503, "QUEUE_UNAVAILABLE", "Email delivery must be configured before inviting staff.");
  const body = c.req.valid("json");
  const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
  const invitationId = crypto.randomUUID();
  const now = Date.now();
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  if (!c.get("actor")?.demo) {
    const event = await c.env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(c.req.param("eventId")).first<{ name: string }>();
    const link = `${c.env.PUBLIC_APP_URL.replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
    const job: OutboxJob = { kind: "email", idempotencyKey: `invitation:${invitationId}`, payload: { kind: "communication", eventId: c.req.param("eventId"), recipient: body.email, subject: `Join ${event?.name ?? "Conference Ops"} as ${body.role}`, text: `You have been invited to help run ${event?.name ?? "this event"}. Accept your invitation: ${link}`, html: `<p>You have been invited to help run ${escapeHtml(event?.name ?? "this event")} as ${body.role}.</p><p><a href="${link}">Accept invitation</a></p>` } };
    await c.env.DB.batch([
      c.env.DB.prepare("INSERT INTO event_invitations (id, event_id, email, role, token_hash, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(invitationId, c.req.param("eventId"), body.email.toLowerCase(), body.role, await sha256(token), c.get("actor")!.id, expiresAt, now),
      prepareOutboxJob(c.env.DB, job, now),
    ]);
    await dispatchPersistedJobs(queue!, [job], (_job, error) => {
      console.error(JSON.stringify({ event: "invitation.queue_failed", invitationId, recovery: "scheduled_outbox", error: error instanceof Error ? error.message : String(error) }));
    });
  }
  return c.json({ data: { id: invitationId, email: body.email, role: body.role, expiresAt: new Date(expiresAt).toISOString(), status: "queued" } }, 201);
});

const formResponseRecordSchema = z.record(z.string().min(1).max(255), z.unknown())
  .refine((responses) => Object.keys(responses).length <= 100, "A form response cannot contain more than 100 fields.");

const submissionSchema = z.object({
  formId: z.string().min(1),
  title: z.string().trim().min(3).max(255),
  summary: z.string().trim().min(20).max(5000),
  category: z.string().trim().min(1).max(255),
  format: z.enum(["talk", "workshop", "panel", "lightning"]),
  durationMinutes: z.number().int().min(5).max(240),
  level: z.enum(["introductory", "intermediate", "advanced"]),
  responses: formResponseRecordSchema,
  speakers: z.array(z.object({ name: z.string().trim().min(2).max(255), email: z.email(), title: z.string().max(255).default(""), company: z.string().max(255).default(""), bio: z.string().max(5000).default("") })).min(1).max(12),
  submit: z.boolean().default(false),
});

app.post("/api/v1/events/:eventId/submissions", zValidator("json", submissionSchema), async (c) => {
  const actor = c.get("actor")!;
  const body = c.req.valid("json");
  if (actor.demo) {
    return c.json({ data: { id: `proposal-${crypto.randomUUID()}`, eventId: c.req.param("eventId"), status: body.submit ? "submitted" : "draft", submittedAt: body.submit ? new Date().toISOString() : null, ...body } }, 201);
  }
  const form = await c.env.DB.prepare("SELECT sf.id, sf.status, sf.collects_participants AS collectsParticipants, sf.closes_at AS closesAt, sf.max_submissions_per_user AS maxSubmissionsPerUser, sf.confirmation_email_enabled AS confirmationEmailEnabled, fv.id AS formVersionId, fv.max_speakers AS maxSpeakers, fv.allow_multiple_drafts AS allowMultipleDrafts, fv.confirmation_copy AS confirmationCopy, fv.fields, fv.settings FROM submission_forms sf JOIN form_versions fv ON fv.form_id = sf.id AND fv.version = sf.published_version WHERE sf.id = ? AND sf.event_id = ?")
    .bind(body.formId, c.req.param("eventId"))
    .first<Record<string, unknown>>();
  if (!form) return jsonError(c, 404, "FORM_NOT_FOUND", "The submission form was not found.");
  const formControls = versionControlsFromRow(form);
  const normalizedEmails = body.speakers.map((speaker) => speaker.email.trim().toLowerCase());
  if (new Set(normalizedEmails).size !== normalizedEmails.length) return jsonError(c, 422, "DUPLICATE_SPEAKER", "Each speaker must have a different email address.");
  if (!verifiedPrimarySpeakerMatches(actor.email, body.speakers[0].email)) {
    return jsonError(c, 422, "PRIMARY_SPEAKER_EMAIL_MISMATCH", "The primary speaker email must match your verified account.", { "speakers.0.email": "Use the email address attached to your signed-in account." });
  }
  const counts = await c.env.DB.prepare("SELECT SUM(CASE WHEN p.status = 'draft' THEN 1 ELSE 0 END) AS drafts, SUM(CASE WHEN p.status <> 'draft' THEN 1 ELSE 0 END) AS submitted FROM proposals p JOIN form_versions fv ON fv.id = p.form_version_id WHERE fv.form_id = ? AND p.owner_user_id = ?")
    .bind(body.formId, actor.id)
    .first<{ drafts: number | null; submitted: number | null }>();
  const availability = formAvailability(
    { status: String(form.status) as "draft" | "published" | "closed", closesAt: formControls.closesAt, maxSubmissionsPerUser: formControls.maxSubmissionsPerUser, allowMultipleDrafts: Boolean(form.allowMultipleDrafts) },
    { drafts: Number(counts?.drafts ?? 0), submitted: Number(counts?.submitted ?? 0) },
  );
  if (!availability.available) return jsonError(c, 409, availability.code, "This form is not accepting another submission from this account.");
  if (body.speakers.length > Number(form.maxSpeakers)) return jsonError(c, 422, "SPEAKER_LIMIT", `This form allows up to ${form.maxSpeakers} speakers.`);
  const settings = normalizeFormVersionSettings(parseJson<unknown>(form.settings, {}));
  if (formControls.collectsParticipants && body.speakers.length < settings.participantMin) {
    return jsonError(c, 422, "SPEAKER_MINIMUM", `This form requires at least ${settings.participantMin} participants.`);
  }
  const fields = submissionValidationFields(parseJson<FormField[]>(form.fields, []), formControls.collectsParticipants);
  const categories = configuredSubmissionCategories(fields, body.responses);
  const category = categories[0];
  const fieldErrors = validateFormResponses(fields, body.responses, {
    requireRequired: body.submit,
    settings,
    combinedCharacterCount: submissionCombinedCharacterCount(
      fields,
      body.responses,
      body.summary,
      body.speakers.map((speaker) => speaker.bio),
    ),
  });
  if (!category) {
    const categoryField = submissionCategoryField(fields);
    fieldErrors[categoryField?.id ?? "responses"] ??= "Choose a configured program category.";
  }
  if (Object.keys(fieldErrors).length) return jsonError(c, 422, "FORM_VALIDATION_FAILED", "Review the highlighted submission fields.", fieldErrors);

  const proposalId = crypto.randomUUID();
  const routing = await reviewerRoutingForCategories(c.env.DB, c.req.param("eventId"), categories);
  const reviewerGroup = routing.groups[0];
  const activeRound = body.submit ? await c.env.DB.prepare("SELECT id FROM review_rounds WHERE event_id = ? AND status = 'active' ORDER BY round LIMIT 1").bind(c.req.param("eventId")).first<{ id: string }>() : null;
  const reviewerCandidates = reviewerGroup && activeRound ? { results: routing.reviewers } : { results: [] as { id: string }[] };
  const now = Date.now();
  const dependentStatements: D1PreparedStatement[] = [];
  const speakerIds: string[] = [];
  // A trusted profile claim establishes a co-speaker conflict. Applicant-entered
  // email alone must not let someone suppress a known reviewer from the queue.
  const claimedSpeakerUserIds = new Set<string>([actor.id]);
  for (const [index, speaker] of body.speakers.entries()) {
    const existing = await c.env.DB.prepare("SELECT id, user_id AS userId FROM speaker_profiles WHERE event_id = ? AND (lower(email) = lower(?) OR (? = 0 AND user_id = ?)) LIMIT 1")
      .bind(c.req.param("eventId"), speaker.email, index, actor.id)
      .first<{ id: string; userId: string | null }>();
    if (existing?.userId) claimedSpeakerUserIds.add(existing.userId);
    if (index === 0 && existing?.userId && existing.userId !== actor.id) {
      return jsonError(c, 409, "SPEAKER_IDENTITY_CONFLICT", "That primary speaker identity belongs to another account.");
    }
    const speakerId = existing?.id ?? crypto.randomUUID();
    speakerIds.push(speakerId);
    if (!existing) {
      dependentStatements.push(c.env.DB.prepare(`INSERT INTO speaker_profiles (id, user_id, event_id, name, email, title, company, bio, profile_complete, published, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?
        WHERE EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ?)`)
        .bind(speakerId, index === 0 ? actor.id : null, c.req.param("eventId"), speaker.name, speaker.email.toLowerCase(), speaker.title, speaker.company, speaker.bio, now, now, proposalId, c.req.param("eventId"), actor.id));
    } else if (index === 0 && !existing.userId) {
      dependentStatements.push(c.env.DB.prepare(`UPDATE speaker_profiles SET user_id = ?, name = ?, title = ?, company = ?, bio = ?, updated_at = ?
        WHERE id = ? AND event_id = ?
          AND EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ?)`)
        .bind(actor.id, speaker.name, speaker.title, speaker.company, speaker.bio, now, speakerId, c.req.param("eventId"), proposalId, c.req.param("eventId"), actor.id));
    }
  }
  const reviewerMembers = {
    results: reviewerCandidates.results.filter((reviewer) => !claimedSpeakerUserIds.has(reviewer.id)),
  };
  const proposalStatus = body.submit ? (reviewerMembers.results.length ? "under_review" : "submitted") : "draft";
  const proposalStatement = c.env.DB.prepare(`INSERT INTO proposals
      (id, event_id, form_version_id, owner_user_id, reviewer_group_id, title, summary, category, format, duration_minutes, level, responses, status, submitted_at, version, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?
    WHERE (? IS NULL OR (
      SELECT COUNT(*) FROM proposals existing_proposal
      JOIN form_versions existing_version ON existing_version.id = existing_proposal.form_version_id
      WHERE existing_version.form_id = ? AND existing_proposal.event_id = ? AND existing_proposal.owner_user_id = ?
    ) < ?)
      AND (? = 1 OR NOT EXISTS (
        SELECT 1 FROM proposals existing_draft
        JOIN form_versions draft_version ON draft_version.id = existing_draft.form_version_id
        WHERE draft_version.form_id = ? AND existing_draft.event_id = ? AND existing_draft.owner_user_id = ? AND existing_draft.status = 'draft'
      ))`)
    .bind(
      proposalId,
      c.req.param("eventId"),
      String(form.formVersionId),
      actor.id,
      reviewerGroup?.id ?? null,
      body.title,
      body.summary,
      categories.join(", "),
      body.format,
      body.durationMinutes,
      body.level,
      JSON.stringify(body.responses),
      proposalStatus,
      body.submit ? now : null,
      now,
      now,
      formControls.maxSubmissionsPerUser ?? null,
      body.formId,
      c.req.param("eventId"),
      actor.id,
      formControls.maxSubmissionsPerUser ?? null,
      form.allowMultipleDrafts ? 1 : 0,
      body.formId,
      c.req.param("eventId"),
      actor.id,
    );
  for (const [index, speakerId] of speakerIds.entries()) dependentStatements.push(c.env.DB.prepare(`INSERT INTO proposal_speakers (proposal_id, speaker_profile_id, participant_role, sort_order)
    SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ?)`)
    .bind(proposalId, speakerId, index === 0 ? "Primary presenter" : "Co-presenter", index, proposalId, c.req.param("eventId"), actor.id));
  for (const group of routing.groups) dependentStatements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO proposal_reviewer_groups (proposal_id, reviewer_group_id)
    SELECT ?, ? WHERE EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ?)`)
    .bind(proposalId, group.id, proposalId, c.req.param("eventId"), actor.id));
  if (activeRound) {
    for (const reviewer of reviewerMembers.results) dependentStatements.push(c.env.DB.prepare(`INSERT INTO review_assignments (id, proposal_id, round_id, reviewer_user_id, review_cycle, status, scores, created_at, updated_at)
      SELECT ?, ?, ?, ?, p.review_cycle, 'pending', '{}', ?, ?
      FROM proposals p
      WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ?
        AND p.owner_user_id <> ?
        AND NOT EXISTS (
          SELECT 1 FROM proposal_speakers ps
          JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id AND sp.event_id = p.event_id
          WHERE ps.proposal_id = p.id AND sp.user_id = ?
        )`)
      .bind(crypto.randomUUID(), proposalId, activeRound.id, reviewer.id, now, now, proposalId, c.req.param("eventId"), actor.id, reviewer.id, reviewer.id));
  }
  let confirmationJob: { kind: "email"; idempotencyKey: string; payload: Record<string, unknown> } | null = null;
  if (body.submit && formControls.confirmationEmailEnabled) {
    const primarySpeaker = body.speakers[0];
    const confirmationCopy = String(form.confirmationCopy ?? "Your proposal is now in the review queue.");
    confirmationJob = await submissionConfirmationJob({ db: c.env.DB, publicAppUrl: c.env.PUBLIC_APP_URL, eventId: c.req.param("eventId"), proposalId, proposalTitle: body.title, recipientName: primarySpeaker.name, recipientEmail: primarySpeaker.email, fallbackCopy: confirmationCopy });
    // Persist the notification intent in the same atomic D1 batch as the
    // proposal. The immediate Queue send below is only the fast path; Cron can
    // recover this row if Queue transport is temporarily unavailable.
    dependentStatements.push(c.env.DB.prepare(`INSERT INTO outbox (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
      SELECT ?, p.event_id, 'email', ?, ?, 'queued', 0, ?, ?, ? FROM proposals p
      WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ?`)
      .bind(crypto.randomUUID(), confirmationJob.idempotencyKey, JSON.stringify(confirmationJob.payload), now, now, now, proposalId, c.req.param("eventId"), actor.id));
  }
  const [proposalResult] = await c.env.DB.batch([proposalStatement, ...dependentStatements]);
  if (!proposalResult.meta.changes) {
    const currentCounts = await c.env.DB.prepare("SELECT SUM(CASE WHEN p.status = 'draft' THEN 1 ELSE 0 END) AS drafts, SUM(CASE WHEN p.status <> 'draft' THEN 1 ELSE 0 END) AS submitted FROM proposals p JOIN form_versions fv ON fv.id = p.form_version_id WHERE fv.form_id = ? AND p.event_id = ? AND p.owner_user_id = ?")
      .bind(body.formId, c.req.param("eventId"), actor.id)
      .first<{ drafts: number | null; submitted: number | null }>();
    const currentAvailability = formAvailability(
      { status: String(form.status) as "draft" | "published" | "closed", closesAt: formControls.closesAt, maxSubmissionsPerUser: formControls.maxSubmissionsPerUser, allowMultipleDrafts: Boolean(form.allowMultipleDrafts) },
      { drafts: Number(currentCounts?.drafts ?? 0), submitted: Number(currentCounts?.submitted ?? 0) },
    );
    const code = currentAvailability.available ? "SUBMISSION_POLICY_CONFLICT" : currentAvailability.code;
    return jsonError(c, 409, code, "This form is not accepting another submission from this account.");
  }

  const confirmationQueued = Boolean(confirmationJob);
  if (confirmationJob && c.env.JOBS_QUEUE) {
    try {
      await c.env.JOBS_QUEUE.send(confirmationJob);
    } catch (error) {
      console.error(JSON.stringify({
        event: "submission.confirmation_queue_failed",
        eventId: c.req.param("eventId"),
        proposalId,
        recovery: "scheduled_outbox",
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  return c.json({ data: { id: proposalId, status: proposalStatus, routedTo: reviewerGroup?.id ?? null, assignments: reviewerMembers.results.length, submittedAt: body.submit ? new Date(now).toISOString() : null, confirmationQueued } }, 201);
});

const submissionUpdateSchema = submissionSchema.omit({ formId: true }).extend({ expectedVersion: z.number().int().positive() });
app.put("/api/v1/events/:eventId/submissions/:proposalId", zValidator("json", submissionUpdateSchema), async (c) => {
  const actor = c.get("actor")!;
  const body = c.req.valid("json");
  if (actor.demo) return c.json({ data: { id: c.req.param("proposalId"), eventId: c.req.param("eventId"), status: body.submit ? "submitted" : "draft", version: body.expectedVersion + 1, ...body } });
  const proposal = await c.env.DB.prepare(`SELECT p.id, p.status, p.version, p.review_cycle AS reviewCycle, fv.fields, fv.settings, fv.confirmation_copy AS confirmationCopy, sf.status AS formStatus, sf.collects_participants AS collectsParticipants, sf.closes_at AS closesAt, sf.confirmation_email_enabled AS confirmationEmailEnabled, fv.max_speakers AS maxSpeakers, e.name AS eventName
    FROM proposals p JOIN form_versions fv ON fv.id = p.form_version_id JOIN submission_forms sf ON sf.id = fv.form_id JOIN events e ON e.id = p.event_id
    WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ?`)
    .bind(c.req.param("proposalId"), c.req.param("eventId"), actor.id).first<Record<string, unknown>>();
  if (!proposal) return jsonError(c, 404, "SUBMISSION_NOT_FOUND", "Submission not found or not editable by you.");
  const proposalControls = versionControlsFromRow(proposal);
  const currentProposalStatus = String(proposal.status) as ProposalStatus;
  const revisionOpen = currentProposalStatus === "changes_requested" || currentProposalStatus === "revision_open";
  if (!applicantMayEditProposal(currentProposalStatus)) return jsonError(c, 409, "SUBMISSION_LOCKED", "Only a draft or an organizer-requested revision can be edited.");
  const normalizedEmails = body.speakers.map((speaker) => speaker.email.trim().toLowerCase());
  if (new Set(normalizedEmails).size !== normalizedEmails.length) return jsonError(c, 422, "DUPLICATE_SPEAKER", "Each speaker must have a different email address.");
  if (!verifiedPrimarySpeakerMatches(actor.email, body.speakers[0].email)) {
    return jsonError(c, 422, "PRIMARY_SPEAKER_EMAIL_MISMATCH", "The primary speaker email must match your verified account.", { "speakers.0.email": "Use the email address attached to your signed-in account." });
  }
  if (Number(proposal.version) !== body.expectedVersion) return jsonError(c, 409, "SUBMISSION_VERSION_CONFLICT", "This submission changed in another tab. Refresh before saving.");
  if (body.speakers.length > Number(proposal.maxSpeakers)) return jsonError(c, 422, "SPEAKER_LIMIT", `This form allows up to ${proposal.maxSpeakers} speakers.`);
  const settings = normalizeFormVersionSettings(parseJson<unknown>(proposal.settings, {}));
  if (proposalControls.collectsParticipants && body.speakers.length < settings.participantMin) {
    return jsonError(c, 422, "SPEAKER_MINIMUM", `This form requires at least ${settings.participantMin} participants.`);
  }
  const proposalFormClosed = String(proposal.formStatus) !== "published"
    || Boolean(proposalControls.closesAt && Date.now() > new Date(proposalControls.closesAt).getTime());
  if ((body.submit || revisionOpen) && proposalFormClosed) {
    return jsonError(c, 409, "FORM_CLOSED", revisionOpen
      ? "The call for proposals closed before these requested changes could be saved."
      : "The call for proposals closed before this draft could be submitted.");
  }
  const fields = submissionValidationFields(parseJson<FormField[]>(proposal.fields, []), proposalControls.collectsParticipants);
  const categories = configuredSubmissionCategories(fields, body.responses);
  const category = categories[0];
  const fieldErrors = validateFormResponses(fields, body.responses, {
    requireRequired: body.submit,
    settings,
    combinedCharacterCount: submissionCombinedCharacterCount(
      fields,
      body.responses,
      body.summary,
      body.speakers.map((speaker) => speaker.bio),
    ),
  });
  if (!category) {
    const categoryField = submissionCategoryField(fields);
    fieldErrors[categoryField?.id ?? "responses"] ??= "Choose a configured program category.";
  }
  if (Object.keys(fieldErrors).length) return jsonError(c, 422, "FORM_VALIDATION_FAILED", "Review the highlighted submission fields.", fieldErrors);
  const now = Date.now();
  const routing = await reviewerRoutingForCategories(c.env.DB, c.req.param("eventId"), categories);
  const reviewerGroup = routing.groups[0];
  const activeRound = body.submit && reviewerGroup
    ? await c.env.DB.prepare("SELECT id FROM review_rounds WHERE event_id = ? AND status = 'active' ORDER BY round LIMIT 1").bind(c.req.param("eventId")).first<{ id: string }>()
    : null;
  const reviewerCandidates = activeRound && reviewerGroup
    ? { results: routing.reviewers }
    : { results: [] as { id: string }[] };
  const primary = body.speakers[0];
  const rosterStatements: D1PreparedStatement[] = [];
  const speakerIds: string[] = [];
  // Keep conflict detection on verified profile ownership rather than an
  // applicant-controlled email string.
  const claimedSpeakerUserIds = new Set<string>([actor.id]);
  for (const [index, speaker] of body.speakers.entries()) {
    const existing = await c.env.DB.prepare(`SELECT sp.id, sp.user_id AS userId,
      EXISTS (SELECT 1 FROM proposal_speakers ps WHERE ps.proposal_id = ? AND ps.speaker_profile_id = sp.id) AS onProposal
      FROM speaker_profiles sp
      WHERE sp.event_id = ? AND (lower(sp.email) = lower(?) OR (? = 0 AND sp.user_id = ?)) LIMIT 1`)
      .bind(proposal.id, c.req.param("eventId"), speaker.email, index, actor.id)
      .first<{ id: string; userId: string | null; onProposal: number }>();
    if (existing?.userId) claimedSpeakerUserIds.add(existing.userId);
    if (index === 0 && existing?.userId && existing.userId !== actor.id) {
      return jsonError(c, 409, "SPEAKER_IDENTITY_CONFLICT", "That primary speaker identity belongs to another account.");
    }
    const speakerId = existing?.id ?? crypto.randomUUID();
    speakerIds.push(speakerId);
    if (!existing) {
      rosterStatements.push(c.env.DB.prepare(`INSERT INTO speaker_profiles (id, user_id, event_id, name, email, title, company, bio, profile_complete, published, created_at, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?
        WHERE EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ? AND p.version = ? AND p.updated_at = ?)`)
        .bind(speakerId, index === 0 ? actor.id : null, c.req.param("eventId"), speaker.name, speaker.email.toLowerCase(), speaker.title, speaker.company, speaker.bio, now, now, proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion + 1, now));
    } else if (index === 0 || (Boolean(existing.onProposal) && !existing.userId)) {
      rosterStatements.push(c.env.DB.prepare(`UPDATE speaker_profiles SET user_id = CASE WHEN ? = 0 THEN ? ELSE user_id END, name = ?, email = ?, title = ?, company = ?, bio = ?, updated_at = ?
        WHERE id = ? AND event_id = ? AND EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ? AND p.version = ? AND p.updated_at = ?)`)
        .bind(index, actor.id, speaker.name, speaker.email.toLowerCase(), speaker.title, speaker.company, speaker.bio, now, speakerId, c.req.param("eventId"), proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion + 1, now));
    }
  }
  const reviewerMembers = {
    results: reviewerCandidates.results.filter((reviewer) => !claimedSpeakerUserIds.has(reviewer.id)),
  };
  const submittedStatus: ProposalStatus = reviewerMembers.results.length ? "under_review" : "submitted";
  let confirmationJob: { kind: "email"; idempotencyKey: string; payload: Record<string, unknown> } | null = null;
  if (body.submit && proposal.status === "draft" && proposalControls.confirmationEmailEnabled) {
    const confirmationCopy = String(proposal.confirmationCopy ?? "Your proposal is now in the review queue.");
    confirmationJob = await submissionConfirmationJob({ db: c.env.DB, publicAppUrl: c.env.PUBLIC_APP_URL, eventId: c.req.param("eventId"), proposalId: String(proposal.id), proposalTitle: body.title, recipientName: primary.name, recipientEmail: primary.email, fallbackCopy: confirmationCopy });
  }
  const updateStatements = [
    c.env.DB.prepare("UPDATE proposals SET reviewer_group_id = ?, title = ?, summary = ?, category = ?, format = ?, duration_minutes = ?, level = ?, responses = ?, status = CASE WHEN ? = 1 THEN ? ELSE status END, submitted_at = CASE WHEN ? = 1 THEN COALESCE(submitted_at, ?) ELSE submitted_at END, version = version + 1, updated_at = ? WHERE id = ? AND event_id = ? AND owner_user_id = ? AND version = ? AND status = ?")
      .bind(reviewerGroup?.id ?? null, body.title, body.summary, categories.join(", "), body.format, body.durationMinutes, body.level, JSON.stringify(body.responses), body.submit ? 1 : 0, submittedStatus, body.submit ? 1 : 0, now, now, proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion, currentProposalStatus),
    ...rosterStatements,
    c.env.DB.prepare(`DELETE FROM proposal_speakers WHERE proposal_id = ?
      AND EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ? AND p.version = ? AND p.updated_at = ?)`)
      .bind(proposal.id, proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion + 1, now),
    ...speakerIds.map((speakerId, index) => c.env.DB.prepare(`INSERT INTO proposal_speakers (proposal_id, speaker_profile_id, participant_role, sort_order)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ? AND p.version = ? AND p.updated_at = ?)`)
      .bind(proposal.id, speakerId, index === 0 ? "Primary presenter" : "Co-presenter", index, proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion + 1, now)),
    c.env.DB.prepare(`DELETE FROM proposal_reviewer_groups WHERE proposal_id = ?
      AND EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ? AND p.version = ? AND p.updated_at = ?)`)
      .bind(proposal.id, proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion + 1, now),
    ...routing.groups.map((group) => c.env.DB.prepare(`INSERT OR IGNORE INTO proposal_reviewer_groups (proposal_id, reviewer_group_id)
      SELECT ?, ? WHERE EXISTS (SELECT 1 FROM proposals p WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ? AND p.version = ? AND p.updated_at = ?)`)
      .bind(proposal.id, group.id, proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion + 1, now)),
    ...(revisionOpen && body.submit ? [c.env.DB.prepare(`DELETE FROM review_assignments
      WHERE proposal_id = ? AND status IN ('pending', 'in_progress')
        AND EXISTS (SELECT 1 FROM proposals p WHERE p.id = review_assignments.proposal_id AND p.event_id = ? AND p.owner_user_id = ? AND p.version = ? AND p.status = ? AND p.updated_at = ?)`)
      .bind(proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion + 1, submittedStatus, now)] : []),
    ...(activeRound ? reviewerMembers.results.map((reviewer) => c.env.DB.prepare(`INSERT OR IGNORE INTO review_assignments (id, proposal_id, round_id, reviewer_user_id, review_cycle, status, scores, created_at, updated_at)
      SELECT ?, ?, ?, ?, p.review_cycle, 'pending', '{}', ?, ?
      FROM proposals p
      WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ? AND p.version = ? AND p.status = ? AND p.updated_at = ?
        AND p.owner_user_id <> ?
        AND NOT EXISTS (
          SELECT 1 FROM proposal_speakers ps
          JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id AND sp.event_id = p.event_id
          WHERE ps.proposal_id = p.id AND sp.user_id = ?
        )`)
      .bind(crypto.randomUUID(), proposal.id, activeRound.id, reviewer.id, now, now, proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion + 1, submittedStatus, now, reviewer.id, reviewer.id)) : []),
  ];
  if (confirmationJob) {
    updateStatements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO outbox (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
      SELECT ?, p.event_id, 'email', ?, ?, 'queued', 0, ?, ?, ? FROM proposals p
      WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ? AND p.version = ? AND p.status = ?`)
      .bind(crypto.randomUUID(), confirmationJob.idempotencyKey, JSON.stringify(confirmationJob.payload), now, now, now, proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion + 1, submittedStatus));
  }
  const [result] = await c.env.DB.batch(updateStatements);
  if (!result.meta.changes) return jsonError(c, 409, "SUBMISSION_VERSION_CONFLICT", "This submission changed before it could be saved.");
  if (confirmationJob && c.env.JOBS_QUEUE) {
    try {
      await c.env.JOBS_QUEUE.send(confirmationJob);
    } catch (error) {
      console.error(JSON.stringify({ event: "submission.confirmation_queue_failed", eventId: c.req.param("eventId"), proposalId: proposal.id, recovery: "scheduled_outbox", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return c.json({ data: { id: proposal.id, status: body.submit ? submittedStatus : currentProposalStatus, assignments: reviewerMembers.results.length, version: body.expectedVersion + 1, updatedAt: new Date(now).toISOString(), confirmationQueued: Boolean(confirmationJob) } });
});

app.post("/api/v1/events/:eventId/submissions/:proposalId/reopen", async (c) => {
  const actor = c.get("actor")!;
  const eventId = c.req.param("eventId");
  const proposalId = c.req.param("proposalId");
  if (actor.demo) {
    const proposal = createDemoWorkspace(actor.id).proposals.find((candidate) => candidate.id === proposalId);
    if (!proposal || !applicantMayOpenProposalRevision(proposal.status)) {
      return jsonError(c, 409, "SUBMISSION_REVISION_INVALID", "Only a submitted proposal without a final decision can be edited.");
    }
    return c.json({ data: {
      id: proposalId,
      status: "revision_open",
      version: (proposal.version ?? 1) + 1,
      revisionRequestedAt: new Date().toISOString(),
      revokedAssignments: createDemoWorkspace(actor.id).reviews.filter((review) => review.proposalId === proposalId && review.status !== "submitted").length,
      submittedReviewsPreserved: createDemoWorkspace(actor.id).reviews.filter((review) => review.proposalId === proposalId && review.status === "submitted").length,
    } });
  }
  const proposal = await c.env.DB.prepare(`SELECT p.id, p.title, p.status, p.version,
      fv.settings, sf.status AS formStatus, sf.submission_type AS submissionType,
      sf.collects_participants AS collectsParticipants, sf.max_submissions_per_user AS maxSubmissionsPerUser,
      sf.redirect_to_portal AS redirectToPortal, sf.confirmation_email_enabled AS confirmationEmailEnabled,
      sf.closes_at AS closesAt
    FROM proposals p
    JOIN form_versions fv ON fv.id = p.form_version_id
    JOIN submission_forms sf ON sf.id = fv.form_id AND sf.event_id = p.event_id
    WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ?`)
    .bind(proposalId, eventId, actor.id)
    .first<Record<string, unknown>>();
  if (!proposal) return jsonError(c, 404, "SUBMISSION_NOT_FOUND", "Submission not found or not editable by you.");
  if (!applicantMayOpenProposalRevision(String(proposal.status) as ProposalStatus)) {
    return jsonError(c, 409, "SUBMISSION_REVISION_INVALID", "Only a submitted proposal without a final decision can be edited.");
  }
  const controls = versionControlsFromRow(proposal);
  if (String(proposal.formStatus) !== "published" || (controls.closesAt && Date.now() > new Date(controls.closesAt).getTime())) {
    return jsonError(c, 409, "FORM_CLOSED", "The call for proposals is closed, so this submission can no longer be edited.");
  }
  const now = Date.now();
  const auditId = crypto.randomUUID();
  const note = "Applicant reopened this proposal for editing before the CFP deadline.";
  const [auditResult, updateResult, revokedResult] = await c.env.DB.batch([
    c.env.DB.prepare(auditApplicantRevisionOpenSql).bind(
      auditId,
      actor.id,
      "Applicant opened a controlled proposal revision before the CFP deadline.",
      JSON.stringify({ previousStatus: proposal.status, previousVersion: proposal.version }),
      c.get("requestId"),
      now,
      proposalId,
      actor.id,
      eventId,
    ),
    c.env.DB.prepare(updateProposalForApplicantRevisionSql).bind(note, now, now, proposalId, eventId, actor.id, auditId),
    c.env.DB.prepare(revokeOpenReviewsForRevisionSql).bind(proposalId, auditId, eventId),
  ]);
  if (!auditResult.meta.changes || !updateResult.meta.changes) {
    return jsonError(c, 409, "SUBMISSION_REVISION_INVALID", "The proposal changed before editing could begin.");
  }
  const submittedReviews = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM review_assignments WHERE proposal_id = ? AND status = 'submitted'")
    .bind(proposalId).first<{ count: number }>();
  return c.json({ data: {
    id: proposalId,
    status: "revision_open",
    version: Number(proposal.version) + 1,
    revisionRequestedAt: new Date(now).toISOString(),
    revokedAssignments: revokedResult.meta.changes,
    submittedReviewsPreserved: Number(submittedReviews?.count ?? 0),
  } });
});

app.post("/api/v1/events/:eventId/submissions/:proposalId/withdraw", async (c) => {
  const actor = c.get("actor")!;
  if (actor.demo) return c.json({ data: { id: c.req.param("proposalId"), status: "withdrawn", withdrawnAt: new Date().toISOString(), revokedAssignments: 0 } });
  const proposal = await c.env.DB.prepare("SELECT status FROM proposals WHERE id = ? AND event_id = ? AND owner_user_id = ?")
    .bind(c.req.param("proposalId"), c.req.param("eventId"), actor.id)
    .first<{ status: ProposalStatus }>();
  if (!proposal || !applicantMayWithdrawProposal(proposal.status)) return jsonError(c, 409, "SUBMISSION_NOT_WITHDRAWABLE", "Only a proposal awaiting a final decision can be withdrawn.");
  const now = Date.now();
  const [result, revoked] = await c.env.DB.batch([
    c.env.DB.prepare("UPDATE proposals SET status = 'withdrawn', version = version + 1, updated_at = ? WHERE id = ? AND event_id = ? AND owner_user_id = ? AND status = ?")
      .bind(now, c.req.param("proposalId"), c.req.param("eventId"), actor.id, proposal.status),
    c.env.DB.prepare(`DELETE FROM review_assignments WHERE proposal_id = ? AND status IN ('pending', 'in_progress')
      AND EXISTS (SELECT 1 FROM proposals p WHERE p.id = review_assignments.proposal_id AND p.event_id = ? AND p.owner_user_id = ? AND p.status = 'withdrawn')`)
      .bind(c.req.param("proposalId"), c.req.param("eventId"), actor.id),
  ]);
  if (!result.meta.changes) return jsonError(c, 409, "SUBMISSION_NOT_WITHDRAWABLE", "The proposal changed before it could be withdrawn.");
  return c.json({ data: { id: c.req.param("proposalId"), status: "withdrawn", withdrawnAt: new Date(now).toISOString(), revokedAssignments: revoked.meta.changes } });
});

const revisionRequestSchema = z.object({ note: z.string().trim().min(3).max(2000) });

function prepareRevisionRequestOutboxJob(
  db: D1Database,
  job: OutboxJob,
  input: { auditId: string; proposalId: string; eventId: string; now: number },
) {
  return db.prepare(`INSERT OR IGNORE INTO outbox
    (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
    SELECT ?, p.event_id, ?, ?, ?, 'queued', 0, ?, ?, ?
    FROM proposals p
    JOIN audit_logs revision_audit
      ON revision_audit.id = ?
      AND revision_audit.event_id = p.event_id
      AND revision_audit.entity_type = 'proposal'
      AND revision_audit.entity_id = p.id
      AND revision_audit.action = 'proposal.changes_requested'
    WHERE p.id = ? AND p.event_id = ? AND p.status = 'changes_requested'`)
    .bind(
      crypto.randomUUID(),
      job.kind,
      job.idempotencyKey,
      JSON.stringify(job.payload),
      input.now,
      input.now,
      input.now,
      input.auditId,
      input.proposalId,
      input.eventId,
    );
}

app.post("/api/v1/events/:eventId/proposals/:proposalId/request-changes", zValidator("json", revisionRequestSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const proposalId = c.req.param("proposalId");
  if (c.get("actor")?.demo) {
    const demoWorkspace = createDemoWorkspace();
    if (demoWorkspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    const proposal = demoWorkspace.proposals.find((candidate) => candidate.id === proposalId);
    if (!proposal || !proposalMayRequestRevision(proposal.status)) return jsonError(c, 409, "PROPOSAL_REVISION_INVALID", "This demo proposal cannot be reopened for changes.");
    const proposalReviews = demoWorkspace.reviews.filter((review) => review.proposalId === proposalId);
    return c.json({ data: {
      proposalId,
      status: "changes_requested",
      note: body.note,
      revisionRequestedAt: new Date().toISOString(),
      revokedAssignments: proposalReviews.filter((review) => review.status !== "submitted").length,
      submittedReviewsPreserved: proposalReviews.filter((review) => review.status === "submitted").length,
      messagesQueued: proposal.speakers.length,
      messagesDispatched: proposal.speakers.length,
    } });
  }

  const proposal = await c.env.DB.prepare(`SELECT p.title, p.status, p.version,
      e.name AS eventName, e.slug AS eventSlug, sf.slug AS formSlug, sf.status AS formStatus,
      sf.submission_type AS submissionType, sf.collects_participants AS collectsParticipants,
      sf.max_submissions_per_user AS maxSubmissionsPerUser, sf.redirect_to_portal AS redirectToPortal,
      sf.confirmation_email_enabled AS confirmationEmailEnabled, sf.closes_at AS closesAt, fv.settings
    FROM proposals p
    JOIN events e ON e.id = p.event_id
    JOIN form_versions fv ON fv.id = p.form_version_id
    JOIN submission_forms sf ON sf.id = fv.form_id AND sf.event_id = p.event_id
    WHERE p.id = ? AND p.event_id = ?`)
    .bind(proposalId, eventId)
    .first<Record<string, unknown>>();
  if (!proposal) return jsonError(c, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
  if (!proposalMayRequestRevision(String(proposal.status) as ProposalStatus)) {
    return jsonError(c, 409, "PROPOSAL_REVISION_INVALID", `A ${String(proposal.status).replaceAll("_", " ")} proposal cannot be reopened for changes.`);
  }
  const controls = versionControlsFromRow(proposal);
  if (String(proposal.formStatus) !== "published" || (controls.closesAt && Date.now() > new Date(controls.closesAt).getTime())) {
    return jsonError(c, 409, "FORM_CLOSED", "The call for proposals is closed, so this proposal can no longer be reopened.");
  }

  const [speakers, submittedReviewCount] = await Promise.all([
    c.env.DB.prepare(`SELECT sp.id, sp.name, sp.email
      FROM proposal_speakers ps
      JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id
      JOIN proposals p ON p.id = ps.proposal_id AND p.event_id = sp.event_id
      WHERE p.id = ? AND p.event_id = ? ORDER BY ps.sort_order`)
      .bind(proposalId, eventId).all<{ id: string; name: string; email: string }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS count FROM review_assignments WHERE proposal_id = ? AND status = 'submitted'")
      .bind(proposalId).first<{ count: number }>(),
  ]);
  const editUrl = new URL(`/submit/${encodeURIComponent(String(proposal.eventSlug))}`, c.env.PUBLIC_APP_URL);
  if (proposal.formSlug) editUrl.searchParams.set("form", String(proposal.formSlug));
  editUrl.searchParams.set("edit", proposalId);
  const variables = {
    "event.name": String(proposal.eventName),
    "proposal.title": String(proposal.title),
    "revision.note": body.note,
    "proposal.edit_url": editUrl.toString(),
  };
  const revisionJobs: OutboxJob[] = speakers.results.map((speaker) => {
    const speakerVariables = { ...variables, "speaker.name": speaker.name };
    const htmlVariables = Object.fromEntries(Object.entries(speakerVariables).map(([key, value]) => [key, escapeHtml(value)]));
    return {
      kind: "email",
      idempotencyKey: `proposal-revision:${proposalId}:${String(proposal.version)}:${speaker.id}`,
      payload: {
        kind: "communication",
        communicationKind: "revision_request",
        eventId,
        recipient: speaker.email.toLowerCase(),
        recipientName: speaker.name,
        subject: renderMessageTemplate("Changes requested for your {{event.name}} proposal", speakerVariables),
        text: renderMessageTemplate("Hi {{speaker.name}},\n\nThe program team requested changes to “{{proposal.title}}”:\n\n{{revision.note}}\n\nRevise and resubmit before the CFP closes: {{proposal.edit_url}}", speakerVariables),
        html: renderMessageTemplate("<p>Hi {{speaker.name}},</p><p>The program team requested changes to <strong>“{{proposal.title}}”</strong>:</p><blockquote>{{revision.note}}</blockquote><p><a href=\"{{proposal.edit_url}}\">Revise and resubmit before the CFP closes</a></p>", htmlVariables),
      },
    };
  });
  const now = Date.now();
  const auditId = crypto.randomUUID();
  const statements = [
    c.env.DB.prepare(auditProposalRevisionRequestSql).bind(...auditProposalRevisionRequestBindings({
      auditId,
      actorUserId: c.get("actor")!.id,
      proposalId,
      eventId,
      summary: "Organizer requested applicant changes before review continues.",
      metadata: JSON.stringify({ previousStatus: proposal.status, previousVersion: proposal.version, note: body.note }),
      requestId: c.get("requestId"),
      now,
    })),
    c.env.DB.prepare(updateProposalForRevisionSql).bind(...updateProposalForRevisionBindings({ note: body.note, now, proposalId, eventId, auditId })),
    c.env.DB.prepare(revokeOpenReviewsForRevisionSql).bind(proposalId, auditId, eventId),
    ...revisionJobs.map((job) => prepareRevisionRequestOutboxJob(c.env.DB, job, { auditId, proposalId, eventId, now })),
  ];
  const results = await c.env.DB.batch(statements);
  if (!results[1].meta.changes) {
    return jsonError(c, 409, "PROPOSAL_REVISION_INVALID", "The proposal changed before the revision request could be saved.");
  }
  let messagesDispatched = 0;
  if (revisionJobs.length && c.env.JOBS_QUEUE) {
    messagesDispatched = await dispatchPersistedJobs(c.env.JOBS_QUEUE, revisionJobs, (job, error) => {
      console.error(JSON.stringify({ event: "proposal.revision_queue_failed", idempotencyKey: job.idempotencyKey, recovery: "scheduled_outbox", error: error instanceof Error ? error.message : String(error) }));
    });
  }
  return c.json({ data: {
    proposalId,
    status: "changes_requested",
    note: body.note,
    revisionRequestedAt: new Date(now).toISOString(),
    revokedAssignments: results[2].meta.changes,
    submittedReviewsPreserved: Number(submittedReviewCount?.count ?? 0),
    messagesQueued: revisionJobs.length,
    messagesDispatched,
  } });
});

const decisionSchema = z.object({ status: z.enum(["accept_queue", "accepted", "decline_queue", "rejected", "waitlisted"]), note: z.string().max(2000).optional() });
const updateAuditedProposalDecisionSql = `${updateProposalDecisionSql}
  AND EXISTS (
    SELECT 1 FROM audit_logs decision_audit
    WHERE decision_audit.id = ?
      AND decision_audit.event_id = proposals.event_id
      AND decision_audit.entity_type = 'proposal'
      AND decision_audit.entity_id = proposals.id
      AND decision_audit.action = 'proposal.decision_changed'
  )`;
const instantiateAcceptedSpeakerTasksAfterDecisionSql = `${instantiateAcceptedSpeakerTasksSql}
  AND EXISTS (
    SELECT 1 FROM audit_logs decision_audit
    WHERE decision_audit.id = ?
      AND decision_audit.event_id = p.event_id
      AND decision_audit.entity_type = 'proposal'
      AND decision_audit.entity_id = p.id
      AND decision_audit.action = 'proposal.decision_changed'
  )`;

function prepareAuditedDecisionOutboxJob(
  db: D1Database,
  job: OutboxJob,
  input: { auditId: string; proposalId: string; eventId: string; target: ProposalDecisionStatus; now: number },
) {
  return db.prepare(`INSERT OR IGNORE INTO outbox
    (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM audit_logs decision_audit
      JOIN proposals proposal ON proposal.id = decision_audit.entity_id AND proposal.event_id = decision_audit.event_id
      WHERE decision_audit.id = ? AND decision_audit.event_id = ? AND decision_audit.entity_type = 'proposal'
        AND proposal.id = ? AND proposal.status = ?
    )`)
    .bind(
      crypto.randomUUID(),
      input.eventId,
      job.kind,
      job.idempotencyKey,
      JSON.stringify(job.payload),
      input.now,
      input.now,
      input.now,
      input.auditId,
      input.eventId,
      input.proposalId,
      input.target,
    );
}

app.post("/api/v1/events/:eventId/proposals/:proposalId/decision", zValidator("json", decisionSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const finalDecision = body.status === "accepted" || body.status === "rejected";
  if (c.get("actor")?.demo) return c.json({ data: { proposalId: c.req.param("proposalId"), ...body, decidedAt: finalDecision ? new Date().toISOString() : null, ...(body.status === "accepted" ? { sessionCreated: true, speakerTasksCreated: 5 } : {}) } });
  const now = Date.now();
  const auditId = crypto.randomUUID();
  const proposalId = c.req.param("proposalId");
  const eventId = c.req.param("eventId");
  const sessionId = crypto.randomUUID();
  const summary = `Proposal moved to ${body.status.replaceAll("_", " ")}.`;
  const decisionJobs: OutboxJob[] = [];
  if (body.status === "accepted" || body.status === "rejected") {
    const [event, speakers, template] = await Promise.all([
      c.env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(eventId).first<{ name: string }>(),
      c.env.DB.prepare(`SELECT sp.id, sp.name, sp.email, p.title
        FROM proposals p
        JOIN proposal_speakers ps ON ps.proposal_id = p.id
        JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id AND sp.event_id = p.event_id
        WHERE p.id = ? AND p.event_id = ? ORDER BY ps.sort_order`)
        .bind(proposalId, eventId).all<{ id: string; name: string; email: string; title: string }>(),
      c.env.DB.prepare("SELECT subject, text, html FROM message_templates WHERE event_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 1")
        .bind(eventId, body.status === "accepted" ? "acceptance" : "rejection")
        .first<{ subject: string; text: string; html: string }>(),
    ]);
    const eventName = event?.name ?? "the event";
    const claimUrl = `${c.env.PUBLIC_APP_URL.replace(/\/$/, "")}/speaker/claim/${encodeURIComponent(eventId)}`;
    for (const speaker of speakers.results) {
      const variables = {
        "event.name": eventName,
        "speaker.name": speaker.name,
        "proposal.title": speaker.title,
        "decision.feedback": body.note?.trim() || "No additional feedback was included.",
        "speaker.portal_url": claimUrl,
      };
      const accepted = body.status === "accepted";
      const defaultText = accepted
        ? `Hi {{speaker.name}},\n\nYour proposal “{{proposal.title}}” has been accepted for {{event.name}}. Claim your profile and complete the onboarding tasks here: {{speaker.portal_url}}\n\nOrganizer note: {{decision.feedback}}`
        : `Hi {{speaker.name}},\n\nThank you for submitting “{{proposal.title}}” to {{event.name}}. We are not able to include it in this program.\n\nOrganizer note: {{decision.feedback}}`;
      const defaultHtml = accepted
        ? `<p>Hi {{speaker.name}},</p><p>Your proposal <strong>“{{proposal.title}}”</strong> has been accepted for {{event.name}}.</p><p><a href="{{speaker.portal_url}}">Claim your profile and open onboarding</a></p><p><strong>Organizer note:</strong> {{decision.feedback}}</p>`
        : `<p>Hi {{speaker.name}},</p><p>Thank you for submitting <strong>“{{proposal.title}}”</strong> to {{event.name}}. We are not able to include it in this program.</p><p><strong>Organizer note:</strong> {{decision.feedback}}</p>`;
      const htmlVariables = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, escapeHtml(value)]));
      decisionJobs.push({
        kind: "email",
        idempotencyKey: `proposal-decision:${proposalId}:${body.status}:${speaker.id}`,
        payload: {
          kind: "communication",
          eventId,
          recipient: speaker.email,
          recipientName: speaker.name,
          subject: renderMessageTemplate(template?.subject ?? (accepted ? `You're speaking at {{event.name}}` : `Your {{event.name}} proposal`), variables),
          text: renderMessageTemplate(template?.text ?? defaultText, variables),
          html: renderMessageTemplate(template?.html ?? defaultHtml, htmlVariables),
        },
      });
    }
  }
  const statements = [
    c.env.DB.prepare(auditProposalDecisionSql)
      .bind(...auditProposalDecisionBindings({ auditId, actorUserId: c.get("actor")!.id, proposalId, eventId, target: body.status, summary, metadata: JSON.stringify({ status: body.status, note: body.note ?? null }), requestId: c.get("requestId"), now })),
    c.env.DB.prepare(updateAuditedProposalDecisionSql)
      .bind(...updateProposalDecisionBindings({ target: body.status, decidedAt: finalDecision ? now : null, now, proposalId, eventId }), auditId),
    ...(body.status === "accepted"
      ? [
          c.env.DB.prepare(createAcceptedProposalSessionSql)
            .bind(sessionId, `${sessionId}@conference-ops`, now, now, proposalId, eventId),
          c.env.DB.prepare(linkAcceptedProposalSpeakersSql)
            .bind(sessionId, eventId, proposalId),
          c.env.DB.prepare(activateAcceptedSpeakersSql)
            .bind(now, eventId, proposalId),
          c.env.DB.prepare(grantClaimedSpeakerMembershipsSql)
            .bind(now, now, proposalId, eventId),
          c.env.DB.prepare(instantiateAcceptedSpeakerTasksAfterDecisionSql)
            .bind(now, now, now, proposalId, eventId, auditId),
        ]
      : []),
    ...decisionJobs.map((job) => prepareAuditedDecisionOutboxJob(c.env.DB, job, {
      auditId,
      proposalId,
      eventId,
      target: body.status,
      now,
    })),
  ];
  const result = await c.env.DB.batch(statements);
  if (!result[1].meta.changes) {
    const proposal = await c.env.DB.prepare("SELECT status FROM proposals WHERE id = ? AND event_id = ?")
      .bind(proposalId, eventId)
      .first<{ status: ProposalStatus }>();
    if (!proposal) return jsonError(c, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
    return jsonError(c, 409, "PROPOSAL_TRANSITION_INVALID", `A ${proposal.status.replaceAll("_", " ")} proposal cannot move directly to ${body.status.replaceAll("_", " ")}.`);
  }
  const sessionCreated = body.status === "accepted" ? Boolean(result[2]?.meta.changes) : false;
  const speakerTasksCreated = body.status === "accepted" ? result[6]?.meta.changes ?? 0 : 0;
  let messagesDispatched = 0;
  if (decisionJobs.length && c.env.JOBS_QUEUE) {
    messagesDispatched = await dispatchPersistedJobs(c.env.JOBS_QUEUE, decisionJobs, (job, error) => {
      console.error(JSON.stringify({ event: "proposal.decision_queue_failed", idempotencyKey: job.idempotencyKey, recovery: "scheduled_outbox", error: error instanceof Error ? error.message : String(error) }));
    });
  }
  return c.json({ data: { proposalId, ...body, sessionId: body.status === "accepted" ? sessionId : undefined, sessionCreated, speakerTasksCreated, messagesQueued: decisionJobs.length, messagesDispatched } });
});

app.post("/api/v1/events/:eventId/proposals/:proposalId/convert", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const sessionId = crypto.randomUUID();
  if (c.get("actor")?.demo) {
    const proposal = createDemoWorkspace().proposals.find((candidate) => candidate.id === c.req.param("proposalId"));
    if (!proposal) return jsonError(c, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
    if (proposal.status !== "accepted") return jsonError(c, 409, "PROPOSAL_NOT_ACCEPTED", "Only an accepted proposal can be converted to a session.");
    return c.json({ data: { id: sessionId, proposalId: proposal.id, title: proposal.title, description: proposal.summary, status: "unscheduled", speakerIds: proposal.speakers.map((speaker) => speaker.id) } }, 201);
  }
  const proposal = await c.env.DB.prepare("SELECT id, title, summary, format, status FROM proposals WHERE id = ? AND event_id = ?")
    .bind(c.req.param("proposalId"), c.req.param("eventId")).first<{ id: string; title: string; summary: string; format: string; status: string }>();
  if (!proposal) return jsonError(c, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
  if (proposal.status !== "accepted") return jsonError(c, 409, "PROPOSAL_NOT_ACCEPTED", "Only an accepted proposal can be converted to a session.");
  const existingSession = await c.env.DB.prepare("SELECT id FROM program_sessions WHERE proposal_id = ?").bind(proposal.id).first<{ id: string }>();
  if (existingSession) return jsonError(c, 409, "PROPOSAL_ALREADY_CONVERTED", "This accepted proposal is already linked to a session.");
  const now = Date.now();
  const speakerRows = await c.env.DB.prepare("SELECT speaker_profile_id AS id FROM proposal_speakers WHERE proposal_id = ? ORDER BY sort_order").bind(proposal.id).all<{ id: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO program_sessions (id, event_id, proposal_id, origin, title, description, format, status, calendar_uid, calendar_sequence, version, created_at, updated_at) VALUES (?, ?, ?, 'proposal', ?, ?, ?, 'unscheduled', ?, 0, 1, ?, ?)")
      .bind(sessionId, c.req.param("eventId"), proposal.id, proposal.title, proposal.summary, proposal.format, `${sessionId}@conference-ops`, now, now),
    ...speakerRows.results.map((speaker) => c.env.DB.prepare("INSERT INTO session_speakers (session_id, speaker_profile_id) VALUES (?, ?)").bind(sessionId, speaker.id)),
    c.env.DB.prepare("UPDATE proposals SET status = 'session', updated_at = ?, version = version + 1 WHERE id = ? AND event_id = ? AND status = 'accepted'").bind(now, proposal.id, c.req.param("eventId")),
  ]);
  return c.json({ data: { id: sessionId, proposalId: proposal.id, title: proposal.title, description: proposal.summary, status: "unscheduled", speakerIds: speakerRows.results.map((speaker) => speaker.id) } }, 201);
});

const directSessionSchema = z.object({ title: z.string().trim().min(3).max(255), description: z.string().trim().max(5000).default(""), speakerIds: z.array(z.string()).max(20).default([]), kind: z.enum(["guaranteed", "sponsor", "program"]).default("program"), format: z.enum(["keynote", "talk", "workshop", "panel", "lightning", "break", "networking"]).default("talk"), capacity: z.number().int().min(0).max(100_000).optional(), ceuCredits: z.string().trim().max(50).optional(), clientId: z.string().trim().max(255).optional() });
app.post("/api/v1/events/:eventId/sessions", zValidator("json", directSessionSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  if (body.format !== "break" && body.format !== "networking" && body.speakerIds.length === 0) {
    return jsonError(c, 422, "SESSION_SPEAKER_REQUIRED", "Choose at least one existing event speaker for this session format.");
  }
  const id = crypto.randomUUID();
  if (c.get("actor")?.demo) return c.json({ data: { id, eventId: c.req.param("eventId"), ...body, status: "unscheduled" } }, 201);
  if (body.speakerIds.length) {
    const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM speaker_profiles WHERE event_id = ? AND id IN (${body.speakerIds.map(() => "?").join(",")})`).bind(c.req.param("eventId"), ...body.speakerIds).first<{ count: number }>();
    if (Number(count?.count ?? 0) !== body.speakerIds.length) return jsonError(c, 422, "SPEAKER_NOT_FOUND", "Every selected speaker must belong to this event.");
  }
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO program_sessions (id, event_id, origin, title, description, format, capacity, ceu_credits, client_id, status, calendar_uid, calendar_sequence, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unscheduled', ?, 0, 1, ?, ?)").bind(id, c.req.param("eventId"), `direct_${body.kind}`, body.title, body.description, body.format, body.capacity ?? null, body.ceuCredits ?? null, body.clientId ?? null, `${id}@conference-ops`, now, now),
    ...body.speakerIds.map((speakerId) => c.env.DB.prepare("INSERT INTO session_speakers (session_id, speaker_profile_id) VALUES (?, ?)").bind(id, speakerId)),
  ]);
  return c.json({ data: { id, eventId: c.req.param("eventId"), ...body, status: "unscheduled" } }, 201);
});

const publishAgendaSchema = z.object({ sessionIds: z.array(z.string()).min(1).optional() });
app.post("/api/v1/events/:eventId/agenda/publish", zValidator("json", publishAgendaSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  try {
    if (c.get("actor")?.demo) {
      const workspace = createDemoWorkspace();
      const sessionIds = validateAgendaPublishSelection(
        c.req.param("eventId"),
        body.sessionIds,
        workspace.sessions.map((session) => ({
          id: session.id,
          eventId: session.eventId,
          status: session.status,
          startsAt: session.startsAt ? new Date(session.startsAt).getTime() : null,
          endsAt: session.endsAt ? new Date(session.endsAt).getTime() : null,
        })),
      );
      return c.json({ data: { eventId: c.req.param("eventId"), status: "agenda_published", publishedSessions: sessionIds.length, newlyPublishedSessions: sessionIds.filter((sessionId) => workspace.sessions.find((session) => session.id === sessionId)?.status === "scheduled").length, approvedSessions: sessionIds.length, publishedAt: new Date().toISOString() } });
    }
    const result = await publishAgendaAtomically(c.env.DB, c.req.param("eventId"), body.sessionIds);
    return c.json({ data: { ...result, status: "agenda_published" } });
  } catch (error) {
    if (error instanceof AgendaPublishError) {
      return jsonError(c, error.status, error.code, error.message, error.sessionIds.length ? { sessionIds: error.sessionIds.join(", ") } : undefined);
    }
    throw error;
  }
});

const reviewSchema = z.object({ scores: z.record(z.string(), z.union([z.number(), z.string()])), recommendation: z.enum(["strong_yes", "yes", "maybe", "no"]), notes: z.string().max(5000), submit: z.boolean() });
app.post("/api/v1/events/:eventId/proposals/:proposalId/review", zValidator("json", reviewSchema), async (c) => {
  const denied = requireRole(c, ["reviewer", "organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const actor = c.get("actor")!;
  const demoWorkspace = actor.demo ? createDemoWorkspace(actor.id) : null;
  const demoProposal = demoWorkspace?.proposals.find((proposal) => proposal.id === c.req.param("proposalId"));
  const demoAssignment = demoWorkspace?.reviews.find((review) => review.proposalId === c.req.param("proposalId") && review.reviewerId === actor.id);
  const assignment = demoWorkspace
    ? demoProposal && demoAssignment
      ? { id: demoAssignment.id, rubric: demoAssignment.rubric, status: demoAssignment.status, proposalStatus: demoProposal.status }
      : undefined
    : await c.env.DB.prepare(`SELECT ra.id, ra.status, rr.rubric, p.status AS proposalStatus FROM review_assignments ra
      JOIN review_rounds rr ON rr.id = ra.round_id
      JOIN proposals p ON p.id = ra.proposal_id AND p.event_id = rr.event_id
      WHERE ra.proposal_id = ? AND ra.reviewer_user_id = ? AND rr.event_id = ? AND rr.status = 'active' AND ra.recused_at IS NULL
        AND EXISTS (SELECT 1 FROM review_round_reviewers pool WHERE pool.round_id = ra.round_id AND pool.reviewer_user_id = ra.reviewer_user_id)
        AND ra.review_cycle = p.review_cycle
        AND p.owner_user_id <> ?
        AND NOT EXISTS (
          SELECT 1 FROM proposal_speakers ps
          JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id AND sp.event_id = p.event_id
          WHERE ps.proposal_id = p.id AND sp.user_id = ?
        )
      ORDER BY rr.round LIMIT 1`)
      .bind(c.req.param("proposalId"), actor.id, c.req.param("eventId"), actor.id, actor.id)
      .first<{ id: string; rubric: unknown; status: "pending" | "in_progress" | "submitted"; proposalStatus: ProposalStatus }>();
  if (!assignment) return jsonError(c, 404, "REVIEW_ASSIGNMENT_NOT_FOUND", "No active review assignment was found for you and this proposal.");
  if (assignment.proposalStatus !== "submitted" && assignment.proposalStatus !== "under_review") {
    return jsonError(c, 409, "REVIEW_PROPOSAL_LOCKED", "This proposal is no longer open for review.");
  }
  if (assignment.status === "submitted") return jsonError(c, 409, "REVIEW_ALREADY_SUBMITTED", "This submitted review is final and can no longer be changed.");

  let evaluated;
  try {
    evaluated = evaluateReviewScores(assignment.rubric, body.scores, body.submit);
  } catch (error) {
    if (error instanceof ReviewRubricError) {
      return jsonError(
        c,
        error.code === "INVALID_RUBRIC" ? 409 : 422,
        error.code === "INVALID_RUBRIC" ? "REVIEW_RUBRIC_INVALID" : "REVIEW_SCORES_INVALID",
        error.message,
        Object.keys(error.fieldErrors).length ? error.fieldErrors : undefined,
      );
    }
    throw error;
  }

  const status = body.submit ? "submitted" : "in_progress";
  if (actor.demo) return c.json({ data: { proposalId: c.req.param("proposalId"), status, ...body, scores: evaluated.scores, score: evaluated.totalScore } });
  const now = Date.now();
  const assignmentStatement = c.env.DB.prepare(`UPDATE review_assignments SET status = ?, scores = ?, total_score = ?, recommendation = ?, notes = ?, submitted_at = ?, updated_at = ?
    WHERE id = ? AND reviewer_user_id = ? AND status IN ('pending', 'in_progress')
      AND EXISTS (
        SELECT 1 FROM proposals p
        JOIN review_rounds rr ON rr.id = review_assignments.round_id AND rr.event_id = p.event_id AND rr.status = 'active'
        WHERE p.id = review_assignments.proposal_id AND p.event_id = ? AND p.status = ?
          AND EXISTS (SELECT 1 FROM review_round_reviewers pool WHERE pool.round_id = review_assignments.round_id AND pool.reviewer_user_id = review_assignments.reviewer_user_id)
          AND review_assignments.review_cycle = p.review_cycle
          AND p.owner_user_id <> ?
          AND NOT EXISTS (
            SELECT 1 FROM proposal_speakers ps
            JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id AND sp.event_id = p.event_id
            WHERE ps.proposal_id = p.id AND sp.user_id = ?
          )
      )`)
    .bind(status, JSON.stringify(evaluated.scores), evaluated.totalScore ?? null, body.recommendation, body.notes, body.submit ? now : null, now, assignment.id, actor.id, c.req.param("eventId"), assignment.proposalStatus, actor.id, actor.id);
  const statements = [assignmentStatement];
  const requiresProposalPromotion = body.submit && assignment.proposalStatus === "submitted";
  if (requiresProposalPromotion) {
    statements.push(c.env.DB.prepare(`UPDATE proposals SET status = 'under_review', updated_at = ?, version = version + 1
      WHERE id = ? AND event_id = ? AND status = 'submitted'
        AND EXISTS (
          SELECT 1 FROM review_assignments
          WHERE id = ? AND reviewer_user_id = ? AND proposal_id = proposals.id
            AND review_cycle = proposals.review_cycle
            AND status = 'submitted' AND updated_at = ?
        )`)
      .bind(now, c.req.param("proposalId"), c.req.param("eventId"), assignment.id, actor.id, now));
    // A submitted proposal must be promoted by the same transaction as the
    // final review. If the guarded promotion unexpectedly changes no row,
    // selecting the existing assignment back into its primary key forces the
    // D1 batch to roll back instead of committing an immutable review alone.
    statements.push(c.env.DB.prepare(`INSERT INTO review_assignments
      SELECT ra.* FROM review_assignments ra
      JOIN proposals p ON p.id = ra.proposal_id AND p.event_id = ?
      WHERE ra.id = ? AND ra.reviewer_user_id = ? AND p.id = ? AND p.status = 'submitted'`)
      .bind(c.req.param("eventId"), assignment.id, actor.id, c.req.param("proposalId")));
  }
  let persistence: D1Result[];
  try {
    persistence = await c.env.DB.batch(statements);
  } catch (error) {
    if (requiresProposalPromotion && /(?:UNIQUE|PRIMARY KEY).*review_assignments/i.test(error instanceof Error ? error.message : String(error))) {
      return jsonError(c, 409, "REVIEW_LOCKED", "This review or proposal changed before it could be saved. Refresh before continuing.");
    }
    throw error;
  }
  const [result, promotionResult] = persistence;
  if (!result.meta.changes) return jsonError(c, 409, "REVIEW_LOCKED", "This review or proposal changed before it could be saved. Refresh before continuing.");
  if (requiresProposalPromotion && !promotionResult?.meta.changes) return jsonError(c, 409, "REVIEW_LOCKED", "This review or proposal changed before it could be saved. Refresh before continuing.");
  return c.json({ data: { proposalId: c.req.param("proposalId"), status, ...body, scores: evaluated.scores, score: evaluated.totalScore } });
});

const taskSchema = z.object({ complete: z.boolean() });
app.post("/api/v1/events/:eventId/tasks/:taskId/complete", zValidator("json", taskSchema), async (c) => {
  const body = c.req.valid("json");
  if (c.get("actor")?.demo) return c.json({ data: { taskId: c.req.param("taskId"), status: body.complete ? "complete" : "in_progress", completedAt: body.complete ? new Date().toISOString() : null } });
  const actor = c.get("actor")!;
  const result = await c.env.DB.prepare("UPDATE speaker_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND event_id = ? AND (speaker_profile_id IN (SELECT id FROM speaker_profiles WHERE event_id = ? AND user_id = ?) OR ? = 'organizer') AND (template_id IS NULL OR template_id IN (SELECT id FROM task_templates WHERE event_id = ? AND completion_mode = 'manual'))")
    .bind(body.complete ? "complete" : "in_progress", body.complete ? Date.now() : null, Date.now(), c.req.param("taskId"), c.req.param("eventId"), c.req.param("eventId"), actor.id, actor.role, c.req.param("eventId"))
    .run();
  if (!result.meta.changes) return jsonError(c, 409, "TASK_NOT_MANUAL", "This task is completed by submitting its linked form or file request.");
  return c.json({ data: { taskId: c.req.param("taskId"), status: body.complete ? "complete" : "in_progress" } });
});

const profileSchema = z.object({
  name: z.string().trim().min(2).max(255),
  title: z.string().trim().max(255),
  company: z.string().trim().max(255),
  bio: z.string().trim().max(5000),
  pronouns: z.string().trim().max(100).optional(),
  city: z.string().trim().max(255).optional(),
  headshotUploadId: z.string().min(1).optional(),
  publish: z.boolean().optional(),
});

app.put("/api/v1/events/:eventId/speakers/:speakerId/profile", zValidator("json", profileSchema), async (c) => {
  const actor = c.get("actor")!;
  const body = c.req.valid("json");
  if (body.publish !== undefined) {
    const denied = requireRole(c, ["organizer"]);
    if (denied) return denied;
  }
  if (actor.demo) return c.json({ data: { id: c.req.param("speakerId"), ...body, profileComplete: Boolean(body.bio && body.headshotUploadId) } });
  const existing = await c.env.DB.prepare("SELECT headshot_upload_id AS headshotUploadId FROM speaker_profiles WHERE id = ? AND event_id = ? AND (user_id = ? OR ? = 'organizer')")
    .bind(c.req.param("speakerId"), c.req.param("eventId"), actor.id, actor.role)
    .first<{ headshotUploadId: string | null }>();
  if (!existing) return jsonError(c, 404, "SPEAKER_NOT_FOUND", "Speaker profile not found or not editable by you.");
  if (body.headshotUploadId) {
    const upload = await c.env.DB.prepare("SELECT id FROM uploads WHERE id = ? AND event_id = ? AND purpose = 'headshot' AND deleted_at IS NULL AND (? = 'organizer' OR owner_user_id = ?)")
      .bind(body.headshotUploadId, c.req.param("eventId"), actor.role, actor.id).first();
    if (!upload) return jsonError(c, 422, "HEADSHOT_NOT_FOUND", "Upload a valid headshot before saving your profile.");
  }
  const profileComplete = isProfileComplete(body.bio, body.headshotUploadId, existing.headshotUploadId);
  const result = await c.env.DB.prepare("UPDATE speaker_profiles SET name = ?, title = ?, company = ?, bio = ?, pronouns = ?, city = ?, headshot_upload_id = COALESCE(?, headshot_upload_id), profile_complete = ?, published = CASE WHEN ? IS NULL THEN published ELSE ? END, updated_at = ? WHERE id = ? AND event_id = ? AND (user_id = ? OR ? = 'organizer')")
    .bind(body.name, body.title, body.company, body.bio, body.pronouns ?? null, body.city ?? null, body.headshotUploadId ?? null, profileComplete ? 1 : 0, body.publish === undefined ? null : body.publish ? 1 : 0, body.publish ? 1 : 0, Date.now(), c.req.param("speakerId"), c.req.param("eventId"), actor.id, actor.role)
    .run();
  if (!result.meta.changes) return jsonError(c, 404, "SPEAKER_NOT_FOUND", "Speaker profile not found or not editable by you.");
  return c.json({ data: { id: c.req.param("speakerId"), ...body, profileComplete } });
});

const taskArtifactSchema = z.object({ uploadId: z.string().min(1) });
app.post("/api/v1/events/:eventId/tasks/:taskId/artifact", zValidator("json", taskArtifactSchema), async (c) => {
  const actor = c.get("actor")!;
  const { uploadId } = c.req.valid("json");
  if (actor.demo) return c.json({ data: { taskId: c.req.param("taskId"), uploadId, status: "complete", completedAt: new Date().toISOString() } });
  const task = await c.env.DB.prepare(`SELECT st.id, tt.file_request_id AS fileRequestId
    FROM speaker_tasks st
    JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id AND sp.event_id = st.event_id
    LEFT JOIN task_templates tt ON tt.id = st.template_id AND tt.event_id = st.event_id
    WHERE st.id = ? AND st.event_id = ? AND sp.user_id = ?
      AND (st.type = 'upload' OR tt.completion_mode = 'file_request')`)
    .bind(c.req.param("taskId"), c.req.param("eventId"), actor.id)
    .first<{ id: string; fileRequestId: string | null }>();
  if (!task) return jsonError(c, 422, "TASK_ARTIFACT_INVALID", "The task or uploaded artifact is not available to this account.");
  const now = Date.now();
  const statements = [
    c.env.DB.prepare(`UPDATE speaker_tasks SET artifact_upload_id = ?, status = 'complete', completed_at = ?, updated_at = ?
      WHERE id = ? AND event_id = ?
        AND speaker_profile_id IN (SELECT id FROM speaker_profiles WHERE event_id = ? AND user_id = ?)
        AND (type = 'upload' OR template_id IN (SELECT id FROM task_templates WHERE event_id = ? AND completion_mode = 'file_request'))
        AND ? IN (SELECT id FROM uploads WHERE event_id = ? AND owner_user_id = ? AND purpose IN ('slides', 'supporting_document') AND deleted_at IS NULL)`)
      .bind(uploadId, now, now, task.id, c.req.param("eventId"), c.req.param("eventId"), actor.id, c.req.param("eventId"), uploadId, c.req.param("eventId"), actor.id),
  ];
  if (task.fileRequestId) {
    statements.push(c.env.DB.prepare(`INSERT INTO file_request_responses
      (id, file_request_id, target_id, uploader_user_id, upload_ids, submitted_at, created_at, updated_at)
      SELECT ?, ?, ?, ?, json_array(?), ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM speaker_tasks st
        JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id AND sp.event_id = st.event_id
        JOIN task_templates tt ON tt.id = st.template_id AND tt.event_id = st.event_id
        JOIN uploads uploaded ON uploaded.id = ? AND uploaded.event_id = st.event_id
          AND uploaded.owner_user_id = ? AND uploaded.purpose IN ('slides', 'supporting_document') AND uploaded.deleted_at IS NULL
        WHERE st.id = ? AND st.event_id = ? AND sp.user_id = ?
          AND tt.file_request_id = ? AND st.artifact_upload_id = ?
      )
      ON CONFLICT(file_request_id, target_id) DO UPDATE SET
        uploader_user_id = excluded.uploader_user_id,
        upload_ids = CASE
          WHEN EXISTS (
            SELECT 1 FROM json_each(file_request_responses.upload_ids)
            WHERE json_each.value = json_extract(excluded.upload_ids, '$[0]')
          ) THEN file_request_responses.upload_ids
          ELSE json_insert(file_request_responses.upload_ids, '$[#]', json_extract(excluded.upload_ids, '$[0]'))
        END,
        submitted_at = excluded.submitted_at,
        updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), task.fileRequestId, task.id, actor.id, uploadId, now, now, now,
        uploadId, actor.id, task.id, c.req.param("eventId"), actor.id, task.fileRequestId, uploadId));
  }
  const results = await c.env.DB.batch(statements);
  if (!results[0].meta.changes || (task.fileRequestId && !results[1]?.meta.changes)) {
    return jsonError(c, 422, "TASK_ARTIFACT_INVALID", "The task or uploaded artifact is not available to this account.");
  }
  return c.json({ data: { taskId: c.req.param("taskId"), uploadId, status: "complete", completedAt: new Date(now).toISOString() } });
});

app.get("/api/v1/events/:eventId/tasks/:taskId/artifacts/:uploadId", async (c) => {
  const actor = c.get("actor")!;
  if (actor.demo) return jsonError(c, 404, "DEMO_UPLOAD_NOT_STORED", "Demo uploads are not persisted between requests.");
  const upload = await c.env.DB.prepare(`SELECT uploaded.object_key AS objectKey, uploaded.file_name AS fileName,
      uploaded.content_type AS contentType
    FROM speaker_tasks st
    JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id AND sp.event_id = st.event_id
    JOIN uploads uploaded ON uploaded.id = ? AND uploaded.event_id = st.event_id AND uploaded.deleted_at IS NULL
    LEFT JOIN task_templates tt ON tt.id = st.template_id AND tt.event_id = st.event_id
    LEFT JOIN file_request_responses response ON response.file_request_id = tt.file_request_id AND response.target_id = st.id
    WHERE st.id = ? AND st.event_id = ? AND (? = 'organizer' OR sp.user_id = ?)
      AND (
        st.artifact_upload_id = uploaded.id
        OR EXISTS (SELECT 1 FROM json_each(COALESCE(response.upload_ids, '[]')) WHERE json_each.value = uploaded.id)
      )`)
    .bind(c.req.param("uploadId"), c.req.param("taskId"), c.req.param("eventId"), actor.role, actor.id)
    .first<{ objectKey: string; fileName: string; contentType: string }>();
  if (!upload) return jsonError(c, 404, "TASK_ARTIFACT_NOT_FOUND", "This file version is not available for this task.");
  const object = await c.env.UPLOADS.get(upload.objectKey);
  if (!object) return jsonError(c, 404, "UPLOAD_OBJECT_NOT_FOUND", "The file record exists, but its object is unavailable.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", upload.contentType);
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(upload.fileName)}`);
  headers.set("cache-control", "private, no-store");
  return new Response(object.body, { headers });
});

const taskCommentSchema = z.object({ body: z.string().trim().min(1).max(5000) });
app.post("/api/v1/events/:eventId/tasks/:taskId/comments", zValidator("json", taskCommentSchema), async (c) => {
  const actor = c.get("actor")!;
  const body = c.req.valid("json");
  const id = crypto.randomUUID();
  const now = Date.now();
  if (actor.demo) return c.json({ data: { id, authorId: actor.id, authorName: actor.name, body: body.body, createdAt: new Date(now).toISOString() } }, 201);
  const result = await c.env.DB.prepare(`INSERT INTO task_comments (id, event_id, task_id, author_user_id, body, created_at)
    SELECT ?, st.event_id, st.id, ?, ?, ?
    FROM speaker_tasks st
    JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id AND sp.event_id = st.event_id
    WHERE st.id = ? AND st.event_id = ? AND (? = 'organizer' OR sp.user_id = ?)`)
    .bind(id, actor.id, body.body, now, c.req.param("taskId"), c.req.param("eventId"), actor.role, actor.id)
    .run();
  if (!result.meta.changes) return jsonError(c, 404, "TASK_NOT_FOUND", "This task is not available to your account.");
  return c.json({ data: { id, authorId: actor.id, authorName: actor.name, body: body.body, createdAt: new Date(now).toISOString() } }, 201);
});

const taskResponseSchema = z.object({ responses: formResponseRecordSchema, submit: z.boolean().default(false) });
app.post("/api/v1/events/:eventId/tasks/:taskId/response", zValidator("json", taskResponseSchema), async (c) => {
  const actor = c.get("actor")!;
  const body = c.req.valid("json");
  if (actor.demo) return c.json({ data: { taskId: c.req.param("taskId"), responses: body.responses, status: body.submit ? "submitted" : "draft", taskStatus: body.submit ? "complete" : "in_progress" } });
  const task = await c.env.DB.prepare(`SELECT st.id, fv.fields, fv.settings FROM speaker_tasks st
    JOIN task_templates tt ON tt.id = st.template_id AND tt.event_id = st.event_id
    JOIN form_versions fv ON fv.id = tt.form_version_id
    JOIN submission_forms sf ON sf.id = fv.form_id AND sf.event_id = st.event_id
    JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id AND sp.event_id = st.event_id
    WHERE st.id = ? AND st.event_id = ? AND sp.user_id = ? AND tt.completion_mode = 'form'`)
    .bind(c.req.param("taskId"), c.req.param("eventId"), actor.id).first<{ id: string; fields: unknown; settings: unknown }>();
  if (!task) return jsonError(c, 404, "TASK_FORM_NOT_FOUND", "No linked form task was found for this account.");
  const fieldErrors = validateFormResponses(parseJson<FormField[]>(task.fields, []), body.responses, {
    requireRequired: body.submit,
    settings: normalizeFormVersionSettings(parseJson<unknown>(task.settings, {})),
  });
  if (Object.keys(fieldErrors).length) return jsonError(c, 422, "FORM_VALIDATION_FAILED", "Review the highlighted task fields.", fieldErrors);
  const now = Date.now();
  const responseId = crypto.randomUUID();
  const persistence = await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO task_responses (id, task_id, respondent_user_id, responses, status, submitted_at, created_at, updated_at)
      SELECT ?, st.id, ?, ?, ?, ?, ?, ?
      FROM speaker_tasks st
      JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id AND sp.event_id = st.event_id
      WHERE st.id = ? AND st.event_id = ? AND sp.user_id = ?
      ON CONFLICT(task_id) DO UPDATE SET respondent_user_id = excluded.respondent_user_id, responses = excluded.responses, status = excluded.status, submitted_at = excluded.submitted_at, updated_at = excluded.updated_at`)
      .bind(responseId, actor.id, JSON.stringify(body.responses), body.submit ? "submitted" : "draft", body.submit ? now : null, now, now, task.id, c.req.param("eventId"), actor.id),
    c.env.DB.prepare(`UPDATE speaker_tasks SET status = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND event_id = ?
        AND speaker_profile_id IN (SELECT id FROM speaker_profiles WHERE event_id = ? AND user_id = ?)`)
      .bind(body.submit ? "complete" : "in_progress", body.submit ? now : null, now, task.id, c.req.param("eventId"), c.req.param("eventId"), actor.id),
  ]);
  if (!persistence[0].meta.changes || !persistence[1].meta.changes) {
    return jsonError(c, 409, "TASK_SCOPE_CHANGED", "This task changed ownership before the response could be saved. Refresh and try again.");
  }
  return c.json({ data: { taskId: task.id, responses: body.responses, status: body.submit ? "submitted" : "draft", taskStatus: body.submit ? "complete" : "in_progress" } });
});

app.post("/api/v1/events/:eventId/tasks/:taskId/reopen", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  if (c.get("actor")?.demo) return c.json({ data: { taskId: c.req.param("taskId"), status: "in_progress", reopenedAt: new Date().toISOString() } });
  const now = Date.now();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(reopenSpeakerTaskSql).bind(now, c.req.param("taskId"), c.req.param("eventId")),
    c.env.DB.prepare(reopenTaskResponseSql).bind(now, c.req.param("taskId"), c.req.param("eventId")),
  ]);
  if (!result[0].meta.changes) return jsonError(c, 404, "TASK_NOT_FOUND", "Task not found.");
  return c.json({ data: { taskId: c.req.param("taskId"), status: "in_progress", reopenedAt: new Date(now).toISOString() } });
});

const scheduleSchema = z.object({ roomId: z.string(), trackId: z.string(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime(), overrideReason: z.string().min(12).max(500).optional() });
app.post("/api/v1/events/:eventId/sessions/:sessionId/schedule", zValidator("json", scheduleSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  if (new Date(body.startsAt) >= new Date(body.endsAt)) return jsonError(c, 422, "INVALID_INTERVAL", "End time must be after start time.", { endsAt: "Choose a later end time." });

  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace();
    const target = workspace.sessions.find((session) => session.id === c.req.param("sessionId"));
    if (!target) return jsonError(c, 404, "SESSION_NOT_FOUND", "Session not found.");
    const windowError = scheduleWindowError(body.startsAt, body.endsAt, workspace.event.startsAt, workspace.event.endsAt);
    if (windowError === "OUTSIDE_EVENT_WINDOW") return jsonError(c, 422, windowError, "Schedule sessions within the event start and end times.", { startsAt: "Choose a start time during the event.", endsAt: "Finish the session before the event ends." });
    const conflicts = detectScheduleConflicts(
      { id: target.id, title: target.title, roomId: body.roomId, trackId: body.trackId, speakerIds: target.speakerIds, startsAt: body.startsAt, endsAt: body.endsAt },
      workspace.sessions,
      { rooms: Object.fromEntries(workspace.rooms.map((room) => [room.id, room.name])), tracks: Object.fromEntries(workspace.tracks.map((track) => [track.id, track.name])), speakers: Object.fromEntries(workspace.proposals.flatMap((proposal) => proposal.speakers.map((speaker) => [speaker.id, speaker.name]))) },
    );
    if (conflicts.length && !body.overrideReason) return c.json({ error: { code: "SCHEDULE_CONFLICT", message: "Resolve the conflicts or record an override reason.", requestId: c.get("requestId"), conflicts } }, 409);
    return c.json({ data: { sessionId: target.id, ...body, status: target.status === "published" ? "published" : "scheduled", conflictsOverridden: conflicts.length } });
  }
  const target = await c.env.DB.prepare("SELECT ps.id, ps.title, ps.status, e.starts_at AS eventStartsAt, e.ends_at AS eventEndsAt FROM program_sessions ps JOIN events e ON e.id = ps.event_id AND e.deleted_at IS NULL WHERE ps.id = ? AND ps.event_id = ?").bind(c.req.param("sessionId"), c.req.param("eventId")).first<{ id: string; title: string; status: "unscheduled" | "scheduled" | "published"; eventStartsAt: number; eventEndsAt: number }>();
  if (!target) return jsonError(c, 404, "SESSION_NOT_FOUND", "Session not found.");
  const windowError = scheduleWindowError(body.startsAt, body.endsAt, target.eventStartsAt, target.eventEndsAt);
  if (windowError === "OUTSIDE_EVENT_WINDOW") return jsonError(c, 422, windowError, "Schedule sessions within the event start and end times.", { startsAt: "Choose a start time during the event.", endsAt: "Finish the session before the event ends." });
  const targetSpeakers = await c.env.DB.prepare("SELECT speaker_profile_id AS id FROM session_speakers WHERE session_id = ?").bind(target.id).all<{ id: string }>();
  const existing = await c.env.DB.prepare("SELECT id, title, room_id AS roomId, track_id AS trackId, starts_at AS startsAt, ends_at AS endsAt, status FROM program_sessions WHERE event_id = ? AND id <> ? AND starts_at IS NOT NULL AND ends_at IS NOT NULL")
    .bind(c.req.param("eventId"), target.id).all<Record<string, unknown>>();
  const existingSpeakers = await c.env.DB.prepare("SELECT session_id AS sessionId, speaker_profile_id AS speakerId FROM session_speakers WHERE session_id IN (SELECT id FROM program_sessions WHERE event_id = ? AND id <> ?)")
    .bind(c.req.param("eventId"), target.id).all<{ sessionId: string; speakerId: string }>();
  const speakerIdsBySession = new Map<string, string[]>();
  for (const row of existingSpeakers.results) speakerIdsBySession.set(row.sessionId, [...(speakerIdsBySession.get(row.sessionId) ?? []), row.speakerId]);
  const [room, track, speakerNames] = await Promise.all([
    c.env.DB.prepare("SELECT name FROM rooms WHERE id = ? AND event_id = ?").bind(body.roomId, c.req.param("eventId")).first<{ name: string }>(),
    c.env.DB.prepare("SELECT name FROM tracks WHERE id = ? AND event_id = ?").bind(body.trackId, c.req.param("eventId")).first<{ name: string }>(),
    c.env.DB.prepare("SELECT id, name FROM speaker_profiles WHERE event_id = ?").bind(c.req.param("eventId")).all<{ id: string; name: string }>(),
  ]);
  if (!room || !track) return jsonError(c, 422, "SCHEDULE_RESOURCE_NOT_FOUND", "Choose a room and track that belong to this event.");
  const conflicts = detectScheduleConflicts(
    { id: target.id, title: target.title, roomId: body.roomId, trackId: body.trackId, speakerIds: targetSpeakers.results.map((row) => row.id), startsAt: body.startsAt, endsAt: body.endsAt },
    existing.results.map((row) => ({ id: String(row.id), eventId: c.req.param("eventId"), title: String(row.title), description: "", speakerIds: speakerIdsBySession.get(String(row.id)) ?? [], speakerNames: [], roomId: row.roomId ? String(row.roomId) : undefined, trackId: row.trackId ? String(row.trackId) : undefined, startsAt: new Date(Number(row.startsAt)).toISOString(), endsAt: new Date(Number(row.endsAt)).toISOString(), status: String(row.status) as "unscheduled" | "scheduled" | "published" })),
    { rooms: { [body.roomId]: room.name }, tracks: { [body.trackId]: track.name }, speakers: Object.fromEntries(speakerNames.results.map((speaker) => [speaker.id, speaker.name])) },
  );
  if (conflicts.length && !body.overrideReason) return c.json({ error: { code: "SCHEDULE_CONFLICT", message: "Resolve the conflicts or record an override reason.", requestId: c.get("requestId"), conflicts } }, 409);
  const now = Date.now();
  const startsAt = new Date(body.startsAt).getTime();
  const endsAt = new Date(body.endsAt).getTime();
  const statements = [
    c.env.DB.prepare(updateSessionPlacementSql).bind(...sessionPlacementUpdateBindings({
      eventId: c.req.param("eventId"),
      sessionId: target.id,
      roomId: body.roomId,
      trackId: body.trackId,
      startsAt,
      endsAt,
      overrideReason: body.overrideReason,
      now,
    })),
    ...(conflicts.length
      ? [c.env.DB.prepare(auditScheduleConflictOverrideSql).bind(...scheduleConflictOverrideAuditBindings({
          auditId: crypto.randomUUID(),
          actorUserId: c.get("actor")!.id,
          eventId: c.req.param("eventId"),
          sessionId: target.id,
          summary: body.overrideReason!,
          metadata: JSON.stringify({ conflicts }),
          requestId: c.get("requestId"),
          roomId: body.roomId,
          trackId: body.trackId,
          startsAt,
          endsAt,
          overrideReason: body.overrideReason!,
          now,
        }))]
      : []),
  ];
  const [result] = await c.env.DB.batch(statements);
  if (!result.meta.changes) return c.json({ error: { code: "SCHEDULE_CONFLICT", message: "Another schedule update introduced a conflict. Refresh and resolve it.", requestId: c.get("requestId"), conflicts } }, 409);
  return c.json({ data: { sessionId: target.id, ...body, status: target.status === "published" ? "published" : "scheduled", conflictsOverridden: conflicts.length } });
});

app.post("/api/v1/events/:eventId/sessions/:sessionId/unschedule", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  const sessionId = c.req.param("sessionId");
  if (c.get("actor")?.demo) {
    const target = createDemoWorkspace().sessions.find((session) => session.id === sessionId);
    if (!target) return jsonError(c, 404, "SESSION_NOT_FOUND", "Session not found.");
    if (target.status === "published") return jsonError(c, 409, "PUBLISHED_SESSION_LOCKED", "Unpublish the agenda before returning this session to Ready to place.");
    return c.json({ data: { sessionId, status: "unscheduled" } });
  }
  const now = Date.now();
  const [result] = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE program_sessions
      SET room_id = NULL, track_id = NULL, starts_at = NULL, ends_at = NULL, status = 'unscheduled', version = version + 1, calendar_sequence = calendar_sequence + 1, updated_at = ?
      WHERE id = ? AND event_id = ? AND status = 'scheduled'`).bind(now, sessionId, eventId),
    c.env.DB.prepare(`INSERT INTO audit_logs
      (id, organization_id, event_id, actor_user_id, action, entity_type, entity_id, summary, metadata, request_id, created_at)
      SELECT ?, e.organization_id, ps.event_id, ?, 'schedule.session_unscheduled', 'program_session', ps.id, ps.title, '{}', ?, ?
      FROM program_sessions ps JOIN events e ON e.id = ps.event_id
      WHERE ps.id = ? AND ps.event_id = ?`)
      .bind(crypto.randomUUID(), c.get("actor")!.id, c.get("requestId"), now, sessionId, eventId),
  ]);
  if (!result.meta.changes) {
    const current = await c.env.DB.prepare("SELECT status FROM program_sessions WHERE id = ? AND event_id = ?").bind(sessionId, eventId).first<{ status: string }>();
    if (!current) return jsonError(c, 404, "SESSION_NOT_FOUND", "Session not found.");
    if (current.status === "published") return jsonError(c, 409, "PUBLISHED_SESSION_LOCKED", "Unpublish the agenda before returning this session to Ready to place.");
    return jsonError(c, 409, "SESSION_NOT_SCHEDULED", "Only a scheduled draft session can be returned to Ready to place.");
  }
  return c.json({ data: { sessionId, status: "unscheduled" } });
});

const formFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(255),
  description: z.string().max(1000).optional(),
  type: z.enum(["short_text", "long_text", "email", "url", "select", "multi_select", "checkbox", "file"]),
  required: z.boolean(),
  section: z.enum(["proposal", "participant"]).optional(),
  options: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
  condition: z.object({ sourceFieldId: z.string(), operator: z.enum(["equals", "contains"]), value: z.string().max(255) }).optional(),
});
const formVersionSettingsSchema = z.object({
  proposalSectionTitle: z.string().max(255),
  proposalPageHeading: z.string().max(15),
  proposalInstructions: z.string().max(20_000),
  participantSectionTitle: z.string().max(255),
  participantPageHeading: z.string().max(15),
  participantInstructions: z.string().max(20_000),
  participantMin: z.number().int().min(1).max(12),
  combinedCharacterLimit: z.number().int().min(1000).max(100_000),
});
const formDraftShape = {
  name: z.string().trim().min(3).max(255),
  publicTitle: z.string().trim().min(3).max(255),
  pageHeading: z.string().trim().min(2).max(15),
  submissionType: z.enum(["abstract", "session"]),
  collectsParticipants: z.boolean(),
  welcomeTitle: z.string().trim().min(3).max(255),
  welcomeCopy: z.string().max(20_000),
  confirmationCopy: z.string().max(20_000),
  maxSpeakers: z.number().int().min(1).max(12),
  maxSubmissionsPerUser: z.number().int().min(1).max(100).optional(),
  closesAt: z.iso.datetime().optional(),
  allowMultipleDrafts: z.boolean(),
  redirectToPortal: z.boolean(),
  confirmationEmailEnabled: z.boolean(),
  settings: formVersionSettingsSchema.optional().default(defaultFormVersionSettings),
  fields: z.array(formFieldSchema).min(2).max(100),
};
function validateFormDraftSettings(form: { settings: z.infer<typeof formVersionSettingsSchema>; maxSpeakers: number }, context: z.RefinementCtx) {
  if (form.settings.participantMin > form.maxSpeakers) {
    context.addIssue({
      code: "custom",
      message: "The participant minimum cannot exceed the maximum.",
      path: ["settings", "participantMin"],
    });
  }
}
const formDraftSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  ...formDraftShape,
}).superRefine(validateFormDraftSettings);
const formDraftUpdateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  ...formDraftShape,
}).superRefine(validateFormDraftSettings);

function controlsFromFormDraft(form: z.infer<typeof formDraftSchema>): FormVersionControls {
  return {
    submissionType: form.submissionType,
    collectsParticipants: form.collectsParticipants,
    ...(form.maxSubmissionsPerUser === undefined ? {} : { maxSubmissionsPerUser: form.maxSubmissionsPerUser }),
    redirectToPortal: form.redirectToPortal,
    confirmationEmailEnabled: form.confirmationEmailEnabled,
    ...(form.closesAt === undefined ? {} : { closesAt: form.closesAt }),
  };
}

function formDefinitionErrors(fields: FormField[]) {
  const errors: Record<string, string> = {};
  const ids = new Set<string>();
  for (const [index, field] of fields.entries()) {
    if (ids.has(field.id)) errors[`fields.${index}.id`] = "Field identifiers must be unique.";
    ids.add(field.id);
    if (["select", "multi_select"].includes(field.type) && !field.options?.length) errors[`fields.${index}.options`] = "Add at least one option.";
  }
  for (const [index, field] of fields.entries()) {
    if (field.condition && (!ids.has(field.condition.sourceFieldId) || field.condition.sourceFieldId === field.id)) errors[`fields.${index}.condition`] = "Choose a different field as the condition source.";
    if (field.condition && fields.find((candidate) => candidate.id === field.condition!.sourceFieldId)?.condition) errors[`fields.${index}.condition`] = "Conditional rules support one level only.";
  }
  return errors;
}

app.post("/api/v1/events/:eventId/forms", zValidator("json", formDraftSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const fieldErrors = formDefinitionErrors(body.fields);
  if (Object.keys(fieldErrors).length) return jsonError(c, 422, "FORM_DEFINITION_INVALID", "Fix the form definition before saving.", fieldErrors);
  const id = crypto.randomUUID();
  if (c.get("actor")?.demo) return c.json({ data: { id, eventId: c.req.param("eventId"), slug: `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60)}-${id.slice(0, 6)}`, kind: "cfp", version: 1, status: "draft", submissions: 0, updatedAt: new Date().toISOString(), ...body } }, 201);
  const now = Date.now();
  const slug = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60)}-${id.slice(0, 6)}`;
  const versionSettings = JSON.stringify(formVersionSettingsWithControls(body.settings, controlsFromFormDraft(body)));
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO submission_forms (id, event_id, name, slug, kind, target_type, submission_type, collects_participants, status, current_version, max_submissions_per_user, redirect_to_portal, confirmation_email_enabled, closes_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'cfp', 'submission', ?, ?, 'draft', 1, ?, ?, ?, ?, ?, ?)")
      .bind(id, c.req.param("eventId"), body.name, slug, body.submissionType, body.collectsParticipants ? 1 : 0, body.maxSubmissionsPerUser ?? null, body.redirectToPortal ? 1 : 0, body.confirmationEmailEnabled ? 1 : 0, body.closesAt ? new Date(body.closesAt).getTime() : null, now, now),
    c.env.DB.prepare("INSERT INTO form_versions (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, body.publicTitle, body.pageHeading, body.welcomeTitle, body.welcomeCopy, body.confirmationCopy, body.maxSpeakers, body.allowMultipleDrafts ? 1 : 0, JSON.stringify(body.fields), versionSettings, c.get("actor")!.id, now),
  ]);
  return c.json({ data: { id, eventId: c.req.param("eventId"), slug, kind: "cfp", version: 1, status: "draft", submissions: 0, updatedAt: new Date(now).toISOString(), ...body } }, 201);
});

app.put("/api/v1/events/:eventId/forms/:formId", zValidator("json", formDraftUpdateSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const fieldErrors = formDefinitionErrors(body.fields);
  if (Object.keys(fieldErrors).length) return jsonError(c, 422, "FORM_DEFINITION_INVALID", "Fix the form definition before saving.", fieldErrors);
  if (c.get("actor")?.demo) return c.json({ data: { id: c.req.param("formId"), eventId: c.req.param("eventId"), version: body.expectedVersion + 1, status: "draft", ...body } });
  const existing = await c.env.DB.prepare(`SELECT sf.current_version AS currentVersion, sf.published_version AS publishedVersion,
      sf.submission_type AS submissionType, sf.collects_participants AS collectsParticipants,
      sf.max_submissions_per_user AS maxSubmissionsPerUser, sf.redirect_to_portal AS redirectToPortal,
      sf.confirmation_email_enabled AS confirmationEmailEnabled, sf.closes_at AS closesAt, fv.settings,
      (SELECT published_fv.settings FROM form_versions published_fv
        WHERE published_fv.form_id = sf.id AND published_fv.version = sf.published_version) AS publishedSettings
    FROM submission_forms sf JOIN form_versions fv ON fv.form_id = sf.id AND fv.version = sf.current_version
    WHERE sf.id = ? AND sf.event_id = ?`)
    .bind(c.req.param("formId"), c.req.param("eventId")).first<Record<string, unknown>>();
  if (!existing) return jsonError(c, 404, "FORM_NOT_FOUND", "Submission form not found.");
  if (Number(existing.currentVersion) !== body.expectedVersion) return jsonError(c, 409, "FORM_VERSION_CONFLICT", "This form changed in another tab. Refresh before saving again.");
  const version = body.expectedVersion + 1;
  const now = Date.now();
  const versionId = crypto.randomUUID();
  const existingSettings = parseJson<Record<string, unknown>>(existing.settings, {});
  const publishedSettings = parseJson<Record<string, unknown>>(existing.publishedSettings, {});
  const backfilledPublishedSettings = JSON.stringify(formVersionSettingsWithControls(
    publishedSettings,
    versionControlsFromRow({ ...existing, settings: publishedSettings }),
  ));
  const versionSettings = JSON.stringify(formVersionSettingsWithControls({
    ...existingSettings,
    ...body.settings,
  }, controlsFromFormDraft(body)));
  const versionStatement = c.env.DB.prepare(`INSERT INTO form_versions
      (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, created_by, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (
      SELECT 1 FROM submission_forms
      WHERE id = ? AND event_id = ? AND current_version = ?
    )
      AND NOT EXISTS (SELECT 1 FROM form_versions WHERE form_id = ? AND version = ?)`)
    .bind(versionId, c.req.param("formId"), version, body.publicTitle, body.pageHeading, body.welcomeTitle, body.welcomeCopy, body.confirmationCopy, body.maxSpeakers, body.allowMultipleDrafts ? 1 : 0, JSON.stringify(body.fields), versionSettings, c.get("actor")!.id, now, c.req.param("formId"), c.req.param("eventId"), body.expectedVersion, c.req.param("formId"), version);
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE form_versions SET settings = ?
      WHERE form_id = ? AND version = ? AND published_at IS NOT NULL`)
      .bind(backfilledPublishedSettings, c.req.param("formId"), Number(existing.publishedVersion)),
    versionStatement,
    c.env.DB.prepare(`UPDATE submission_forms SET name = ?, current_version = ?, updated_at = ?
      WHERE id = ? AND event_id = ? AND current_version = ?
        AND EXISTS (SELECT 1 FROM form_versions WHERE id = ? AND form_id = submission_forms.id AND version = ? AND published_at IS NULL)`)
      .bind(body.name, version, now, c.req.param("formId"), c.req.param("eventId"), body.expectedVersion, versionId, version),
  ]);
  if (!result[1]?.meta.changes || !result[2]?.meta.changes) return jsonError(c, 409, "FORM_SAVE_CONFLICT", "The form changed before this draft could be saved. Refresh and try again.");
  return c.json({ data: { id: c.req.param("formId"), version, status: "draft", ...body } });
});

const formPublishSchema = z.object({ version: z.number().int().positive() });
app.post("/api/v1/events/:eventId/forms/:formId/publish", zValidator("json", formPublishSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  if (c.get("actor")?.demo) return c.json({ data: { formId: c.req.param("formId"), version: body.version, status: "published", publishedAt: new Date().toISOString() } });
  const form = await c.env.DB.prepare(`SELECT sf.current_version AS currentVersion,
      sf.submission_type AS submissionType, sf.collects_participants AS collectsParticipants,
      sf.max_submissions_per_user AS maxSubmissionsPerUser, sf.redirect_to_portal AS redirectToPortal,
      sf.confirmation_email_enabled AS confirmationEmailEnabled, sf.closes_at AS closesAt,
      fv.fields, fv.settings
    FROM submission_forms sf JOIN form_versions fv ON fv.form_id = sf.id AND fv.version = sf.current_version
    WHERE sf.id = ? AND sf.event_id = ?`)
    .bind(c.req.param("formId"), c.req.param("eventId"))
    .first<Record<string, unknown>>();
  if (!form) return jsonError(c, 404, "FORM_NOT_FOUND", "Submission form not found.");
  if (Number(form.currentVersion) !== body.version) return jsonError(c, 409, "FORM_VERSION_CONFLICT", "Publish the latest saved version of this form.");
  const controls = versionControlsFromRow(form);
  if (!controls.confirmationEmailEnabled) return jsonError(c, 422, "CONFIRMATION_REQUIRED", "Enable durable submission confirmations before publishing this form.");
  const fields = parseJson<FormField[]>(form.fields, []);
  const categoryError = categoryContractError(fields);
  if (categoryError) return jsonError(c, 422, "FORM_CATEGORY_INVALID", categoryError, { category: categoryError });
  const unsupportedFileField = requiredFileField(fields);
  if (unsupportedFileField) {
    return jsonError(c, 422, "UNSUPPORTED_REQUIRED_FILE_FIELD", "Required upload fields cannot be published until CFP uploads are supported.", { [unsupportedFileField.id]: "Make this upload optional or use a separate file-request task." });
  }
  const now = Date.now();
  const categories = formCategoryOptions(fields);
  const result = await c.env.DB.batch([
    c.env.DB.prepare(publishFormVersionSql).bind(now, c.req.param("formId"), body.version, c.req.param("eventId"), body.version),
    c.env.DB.prepare(publishSubmissionFormSql).bind(
      body.version,
      body.version,
      controls.submissionType,
      controls.collectsParticipants ? 1 : 0,
      controls.maxSubmissionsPerUser ?? null,
      controls.redirectToPortal ? 1 : 0,
      controls.confirmationEmailEnabled ? 1 : 0,
      controls.closesAt ? new Date(controls.closesAt).getTime() : null,
      now,
      c.req.param("formId"),
      c.req.param("eventId"),
      body.version,
      body.version,
    ),
    c.env.DB.prepare(publishFormEventSql).bind(now, c.req.param("eventId"), c.req.param("formId"), body.version, body.version),
    ...categories.map((category) => c.env.DB.prepare(`INSERT INTO reviewer_groups (id, event_id, name, category, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?
      WHERE NOT EXISTS (SELECT 1 FROM reviewer_groups WHERE event_id = ? AND lower(category) = lower(?))`)
      .bind(crypto.randomUUID(), c.req.param("eventId"), `${category} committee`, category, now, now, c.req.param("eventId"), category)),
  ]);
  if (!result[0].meta.changes || !result[1].meta.changes) return jsonError(c, 409, "FORM_VERSION_CONFLICT", "Publish the latest saved version of this form.");
  return c.json({ data: { formId: c.req.param("formId"), version: body.version, status: "published", publishedAt: new Date(now).toISOString() } });
});

app.post("/api/v1/events/:eventId/forms/:formId/close", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  if (c.get("actor")?.demo) return c.json({ data: { formId: c.req.param("formId"), status: "closed", closedAt: new Date().toISOString() } });
  const result = await c.env.DB.prepare("UPDATE submission_forms SET status = 'closed', closes_at = COALESCE(closes_at, ?), updated_at = ? WHERE id = ? AND event_id = ? AND status = 'published'")
    .bind(Date.now(), Date.now(), c.req.param("formId"), c.req.param("eventId")).run();
  if (!result.meta.changes) return jsonError(c, 409, "FORM_NOT_OPEN", "Only an open published form can be closed.");
  await c.env.DB.prepare("UPDATE events SET status = CASE WHEN NOT EXISTS (SELECT 1 FROM submission_forms WHERE event_id = ? AND status = 'published') THEN 'review' ELSE status END, updated_at = ? WHERE id = ?")
    .bind(c.req.param("eventId"), Date.now(), c.req.param("eventId")).run();
  return c.json({ data: { formId: c.req.param("formId"), status: "closed", closedAt: new Date().toISOString() } });
});

const externalTaskUrlSchema = z.string().trim().max(2048).refine((value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}, "Use a complete https:// URL.");

const taskTemplateSchema = z.object({
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().min(2).max(5000),
  type: z.enum(["profile", "upload", "form", "calendar"]),
  targetType: z.enum(["contact", "group", "submission"]),
  relativeDueDays: z.number().int().min(0).max(365),
  externalUrl: externalTaskUrlSchema.optional(),
  fields: z.array(formFieldSchema).min(1).max(50).optional(),
}).superRefine((value, context) => {
  if (value.type === "form" && !value.fields?.length) {
    context.addIssue({ code: "custom", path: ["fields"], message: "Add at least one question to a form task." });
  }
  if (value.externalUrl && ["form", "upload"].includes(value.type)) {
    context.addIssue({ code: "custom", path: ["externalUrl"], message: "External action links are available on manual profile or calendar tasks." });
  }
});

function portalTaskFormStatements(
  db: D1Database,
  input: {
    eventId: string;
    actorId: string;
    title: string;
    description: string;
    targetType: "contact" | "group" | "submission";
    fields: FormField[];
    now: number;
    formId?: string;
    currentVersion?: number;
  },
) {
  const formId = input.formId ?? crypto.randomUUID();
  const version = (input.currentVersion ?? 0) + 1;
  const versionId = crypto.randomUUID();
  const slug = `task-${formId.slice(0, 8)}`;
  const settings = JSON.stringify(normalizeFormVersionSettings({ participantMin: 1 }));
  const versionStatement = db.prepare(`INSERT INTO form_versions
    (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, published_at, created_by, created_at)
    VALUES (?, ?, ?, ?, 'Complete', ?, ?, 'Thanks — the event team received this form.', 1, 0, ?, ?, ?, ?, ?)`)
    .bind(versionId, formId, version, input.title, input.title, input.description, JSON.stringify(input.fields), settings, input.now, input.actorId, input.now);
  if (input.formId) {
    return {
      formId,
      versionId,
      statements: [
        versionStatement,
        db.prepare(`UPDATE submission_forms SET name = ?, target_type = ?, status = 'published', current_version = ?, published_version = ?, updated_at = ?
          WHERE id = ? AND event_id = ? AND kind = 'portal'`)
          .bind(input.title, input.targetType, version, version, input.now, formId, input.eventId),
      ],
    };
  }
  return {
    formId,
    versionId,
    statements: [
      db.prepare(`INSERT INTO submission_forms
        (id, event_id, name, slug, kind, target_type, submission_type, collects_participants, status, current_version, published_version, redirect_to_portal, confirmation_email_enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'portal', ?, 'abstract', 0, 'published', 1, 1, 0, 0, ?, ?)`)
        .bind(formId, input.eventId, input.title, slug, input.targetType, input.now, input.now),
      versionStatement,
    ],
  };
}

app.post("/api/v1/events/:eventId/task-templates", zValidator("json", taskTemplateSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const id = crypto.randomUUID();
  if (c.get("actor")?.demo) return c.json({ data: {
    id,
    ...body,
    completionMode: body.type === "form" ? "form" : body.type === "upload" ? "file_request" : "manual",
    ...(body.type === "form" ? { formId: `demo-form-${id}`, formFields: body.fields } : {}),
    ...(body.type === "upload" ? { fileRequestId: `demo-file-request-${id}` } : {}),
  } }, 201);
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  let formVersionId: string | null = null;
  let formId: string | undefined;
  let fileRequestId: string | null = null;
  if (body.type === "form") {
    const form = portalTaskFormStatements(c.env.DB, {
      eventId,
      actorId: c.get("actor")!.id,
      title: body.title,
      description: body.description,
      targetType: body.targetType,
      fields: body.fields ?? [],
      now,
    });
    formId = form.formId;
    formVersionId = form.versionId;
    statements.push(...form.statements);
  } else if (body.type === "upload") {
    fileRequestId = crypto.randomUUID();
    statements.push(c.env.DB.prepare(`INSERT INTO file_requests
      (id, event_id, title, instructions_html, target_type, required, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, 'published', ?, ?)`)
      .bind(fileRequestId, eventId, body.title, body.description, body.targetType, now, now));
  }
  const completionMode = body.type === "form" ? "form" : body.type === "upload" ? "file_request" : "manual";
  statements.push(c.env.DB.prepare(`INSERT INTO task_templates
    (id, event_id, title, description, type, target_type, completion_mode, relative_due_days, external_url, form_version_id, file_request_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, eventId, body.title, body.description, body.type, body.targetType, completionMode, body.relativeDueDays, body.externalUrl ?? null, formVersionId, fileRequestId, now, now));
  await c.env.DB.batch(statements);
  return c.json({ data: { id, ...body, completionMode, formId, formFields: body.type === "form" ? body.fields : undefined, fileRequestId: fileRequestId ?? undefined } }, 201);
});

app.put("/api/v1/events/:eventId/task-templates/:templateId", zValidator("json", taskTemplateSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const templateId = c.req.param("templateId");
  if (c.get("actor")?.demo) return c.json({ data: {
    id: templateId,
    ...body,
    completionMode: body.type === "form" ? "form" : body.type === "upload" ? "file_request" : "manual",
    ...(body.type === "form" ? { formId: `demo-form-${templateId}`, formFields: body.fields } : {}),
    ...(body.type === "upload" ? { fileRequestId: `demo-file-request-${templateId}` } : {}),
  } });
  const existing = await c.env.DB.prepare(`SELECT tt.id, tt.form_version_id AS formVersionId, tt.file_request_id AS fileRequestId,
      fv.form_id AS formId, sf.current_version AS currentVersion
    FROM task_templates tt
    LEFT JOIN form_versions fv ON fv.id = tt.form_version_id
    LEFT JOIN submission_forms sf ON sf.id = fv.form_id AND sf.event_id = tt.event_id
    WHERE tt.id = ? AND tt.event_id = ?`)
    .bind(templateId, eventId)
    .first<{ id: string; formVersionId?: string; fileRequestId?: string; formId?: string; currentVersion?: number }>();
  if (!existing) return jsonError(c, 404, "TASK_TEMPLATE_NOT_FOUND", "Task template not found.");
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  let formVersionId: string | null = null;
  let formId: string | undefined;
  let fileRequestId: string | null = null;
  if (body.type === "form") {
    const form = portalTaskFormStatements(c.env.DB, {
      eventId,
      actorId: c.get("actor")!.id,
      title: body.title,
      description: body.description,
      targetType: body.targetType,
      fields: body.fields ?? [],
      now,
      ...(existing.formId ? { formId: existing.formId, currentVersion: Number(existing.currentVersion ?? 0) } : {}),
    });
    formId = form.formId;
    formVersionId = form.versionId;
    statements.push(...form.statements);
  } else if (body.type === "upload") {
    fileRequestId = existing.fileRequestId ?? crypto.randomUUID();
    if (existing.fileRequestId) {
      statements.push(c.env.DB.prepare(`UPDATE file_requests SET title = ?, instructions_html = ?, target_type = ?, required = 1, status = 'published', updated_at = ?
        WHERE id = ? AND event_id = ?`)
        .bind(body.title, body.description, body.targetType, now, fileRequestId, eventId));
    } else {
      statements.push(c.env.DB.prepare(`INSERT INTO file_requests
        (id, event_id, title, instructions_html, target_type, required, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, 'published', ?, ?)`)
        .bind(fileRequestId, eventId, body.title, body.description, body.targetType, now, now));
    }
  }
  const completionMode = body.type === "form" ? "form" : body.type === "upload" ? "file_request" : "manual";
  statements.push(c.env.DB.prepare(`UPDATE task_templates SET title = ?, description = ?, type = ?, target_type = ?, completion_mode = ?, relative_due_days = ?, external_url = ?, form_version_id = ?, file_request_id = ?, updated_at = ?
    WHERE id = ? AND event_id = ?`)
    .bind(body.title, body.description, body.type, body.targetType, completionMode, body.relativeDueDays, body.externalUrl ?? null, formVersionId, fileRequestId, now, templateId, eventId));
  const results = await c.env.DB.batch(statements);
  if (!results.at(-1)?.meta.changes) return jsonError(c, 409, "TASK_TEMPLATE_UPDATE_FAILED", "The task template changed before it could be updated.");
  return c.json({ data: { id: templateId, ...body, completionMode, formId, formFields: body.type === "form" ? body.fields : undefined, fileRequestId: fileRequestId ?? undefined } });
});

app.delete("/api/v1/events/:eventId/task-templates/:templateId", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  if (c.get("actor")?.demo) return c.json({ data: { id: c.req.param("templateId"), deleted: true } });
  const result = await c.env.DB.prepare(`DELETE FROM task_templates
    WHERE id = ? AND event_id = ?
      AND NOT EXISTS (SELECT 1 FROM speaker_tasks WHERE template_id = task_templates.id)`)
    .bind(c.req.param("templateId"), c.req.param("eventId"))
    .run();
  if (!result.meta.changes) {
    const exists = await c.env.DB.prepare("SELECT id FROM task_templates WHERE id = ? AND event_id = ?")
      .bind(c.req.param("templateId"), c.req.param("eventId")).first();
    if (!exists) return jsonError(c, 404, "TASK_TEMPLATE_NOT_FOUND", "Task template not found.");
    return jsonError(c, 409, "TASK_TEMPLATE_IN_USE", "This template has assigned speaker tasks. Keep it for audit history or create a replacement for future acceptances.");
  }
  return c.json({ data: { id: c.req.param("templateId"), deleted: true } });
});

const messageTemplateKindSchema = z.enum(["submission_confirmation", "acceptance", "rejection", "reminder", "calendar"]);
const messageTemplateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  subject: z.string().trim().min(2).max(255),
  text: z.string().trim().min(2).max(20_000),
  html: z.string().trim().min(2).max(40_000),
});

app.put("/api/v1/events/:eventId/message-templates/:kind", zValidator("json", messageTemplateSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const parsedKind = messageTemplateKindSchema.safeParse(c.req.param("kind"));
  if (!parsedKind.success) return jsonError(c, 404, "MESSAGE_TEMPLATE_KIND_NOT_FOUND", "Choose a supported communication template.");
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const existing = c.get("actor")?.demo ? undefined : await c.env.DB.prepare("SELECT id FROM message_templates WHERE event_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 1")
    .bind(eventId, parsedKind.data).first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const now = Date.now();
  if (!c.get("actor")?.demo) {
    if (existing) {
      await c.env.DB.prepare("UPDATE message_templates SET name = ?, subject = ?, text = ?, html = ?, updated_at = ? WHERE id = ? AND event_id = ?")
        .bind(body.name, body.subject, body.text, body.html, now, id, eventId).run();
    } else {
      await c.env.DB.prepare("INSERT INTO message_templates (id, event_id, kind, name, subject, html, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, eventId, parsedKind.data, body.name, body.subject, body.html, body.text, now, now).run();
    }
  }
  return c.json({ data: { id, kind: parsedKind.data, ...body, updatedAt: new Date(now).toISOString() } });
});

const reminderRuleKindSchema = z.enum(["task_overdue", "cfp_draft"]);
const reminderRuleSchema = z.object({ enabled: z.boolean(), offsetDays: z.number().int().min(0).max(60) });
app.put("/api/v1/events/:eventId/reminder-rules/:kind", zValidator("json", reminderRuleSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const parsedKind = reminderRuleKindSchema.safeParse(c.req.param("kind"));
  if (!parsedKind.success) return jsonError(c, 404, "REMINDER_RULE_KIND_NOT_FOUND", "Choose a supported reminder rule.");
  const body = c.req.valid("json");
  const eventId = c.req.param("eventId");
  const existing = c.get("actor")?.demo ? undefined : await c.env.DB.prepare("SELECT id FROM communication_schedules WHERE event_id = ? AND kind = ?")
    .bind(eventId, parsedKind.data).first<{ id: string }>();
  const id = existing?.id ?? crypto.randomUUID();
  const now = Date.now();
  if (!c.get("actor")?.demo) {
    await c.env.DB.prepare(`INSERT INTO communication_schedules (id, event_id, kind, enabled, offset_days, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(event_id, kind) DO UPDATE SET enabled = excluded.enabled, offset_days = excluded.offset_days, updated_at = excluded.updated_at`)
      .bind(id, eventId, parsedKind.data, body.enabled ? 1 : 0, body.offsetDays, now, now).run();
  }
  return c.json({ data: { id, kind: parsedKind.data, ...body, updatedAt: new Date(now).toISOString() } });
});

const readinessAssistantSchema = z.object({ question: z.string().trim().max(500).optional() });
app.post("/api/v1/events/:eventId/assistant", zValidator("json", readinessAssistantSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const workspace = c.get("actor")?.demo
    ? createDemoWorkspace(c.get("actor")!.id)
    : await loadWorkspace(c.env, c.get("actor")!, c.req.param("eventId"), "organizer");
  if (!workspace || workspace.event.id !== c.req.param("eventId")) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  const { question } = c.req.valid("json");
  return c.json({ data: { answer: readinessAnswer(workspace, question), insights: readinessInsights(workspace), generatedAt: new Date().toISOString(), mode: "grounded" } });
});

app.get("/api/v1/events/:eventId/communications/history", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const eventId = c.req.param("eventId");
  if (c.get("actor")?.demo) {
    const workspace = createDemoWorkspace(c.get("actor")!.id);
    if (workspace.event.id !== eventId) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
    return c.json({ data: { deliveries: demoCommunicationDeliveries(eventId), generatedAt: new Date().toISOString() } });
  }
  const rows = await c.env.DB.prepare(`SELECT id, event_id AS eventId, kind AS transport,
      idempotency_key AS idempotencyKey, payload, status, attempts,
      last_error AS lastError, sent_at AS sentAt, created_at AS createdAt, updated_at AS updatedAt
    FROM outbox
    WHERE event_id = ? AND kind IN ('email', 'calendar')
    ORDER BY created_at DESC, id DESC LIMIT 100`)
    .bind(eventId)
    .all<CommunicationOutboxRow>();
  const deliveries = rows.results
    .map((row) => projectCommunicationDelivery(row))
    .filter((delivery) => delivery !== null);
  return c.json({ data: { deliveries, generatedAt: new Date().toISOString() } });
});

const testCommunicationSchema = z.object({
  kind: messageTemplateKindSchema,
  subject: z.string().trim().min(2).max(255),
  text: z.string().trim().min(2).max(20_000),
  html: z.string().trim().min(2).max(40_000),
  sampleSpeakerId: z.string().optional(),
});
app.post("/api/v1/events/:eventId/communications/test-send", zValidator("json", testCommunicationSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const actor = c.get("actor")!;
  const eventId = c.req.param("eventId");
  const event = actor.demo
    ? createDemoWorkspace(actor.id).event
    : await c.env.DB.prepare("SELECT name, venue FROM events WHERE id = ? AND deleted_at IS NULL").bind(eventId).first<{ name: string; venue: string }>();
  if (!event) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  let sample: { id: string; name: string; proposalTitle?: string; taskCount: number; sessionTitle?: string; room?: string } | undefined;
  if (actor.demo) {
    const workspace = createDemoWorkspace(actor.id);
    const speaker = workspace.proposals.flatMap((proposal) => proposal.speakers).find((candidate) => !body.sampleSpeakerId || candidate.id === body.sampleSpeakerId);
    const proposal = workspace.proposals.find((candidate) => candidate.speakers.some((candidateSpeaker) => candidateSpeaker.id === speaker?.id));
    const session = workspace.sessions.find((candidate) => candidate.speakerIds.includes(speaker?.id ?? ""));
    if (speaker) sample = { id: speaker.id, name: speaker.name, proposalTitle: proposal?.title, taskCount: workspace.tasks.filter((task) => task.speakerId === speaker.id && ["not_started", "in_progress", "overdue"].includes(task.status)).length, sessionTitle: session?.title, room: workspace.rooms.find((room) => room.id === session?.roomId)?.name };
  } else if (body.sampleSpeakerId) {
    const foundSample = await c.env.DB.prepare(`SELECT sp.id, sp.name,
      (SELECT p.title FROM proposal_speakers ps JOIN proposals p ON p.id = ps.proposal_id WHERE ps.speaker_profile_id = sp.id AND p.event_id = sp.event_id ORDER BY p.updated_at DESC LIMIT 1) AS proposalTitle,
      (SELECT COUNT(*) FROM speaker_tasks st WHERE st.speaker_profile_id = sp.id AND st.event_id = sp.event_id AND st.status IN ('not_started','in_progress','overdue')) AS taskCount,
      (SELECT prog.title FROM session_speakers ss JOIN program_sessions prog ON prog.id = ss.session_id WHERE ss.speaker_profile_id = sp.id AND prog.event_id = sp.event_id ORDER BY prog.updated_at DESC LIMIT 1) AS sessionTitle,
      (SELECT r.name FROM session_speakers ss JOIN program_sessions prog ON prog.id = ss.session_id LEFT JOIN rooms r ON r.id = prog.room_id WHERE ss.speaker_profile_id = sp.id AND prog.event_id = sp.event_id ORDER BY prog.updated_at DESC LIMIT 1) AS room
      FROM speaker_profiles sp WHERE sp.id = ? AND sp.event_id = ?`).bind(body.sampleSpeakerId, eventId).first<NonNullable<typeof sample>>();
    sample = foundSample ?? undefined;
    if (!sample) return jsonError(c, 422, "SAMPLE_SPEAKER_NOT_FOUND", "Choose a sample speaker from this event.");
  }
  const variables = {
    "event.name": event.name,
    "speaker.name": sample?.name ?? actor.name,
    "proposal.title": sample?.proposalTitle ?? "Example proposal",
    "decision.feedback": "Example decision feedback",
    "speaker.portal_url": `${c.env.PUBLIC_APP_URL.replace(/\/$/, "")}/portal/home?eventId=${encodeURIComponent(eventId)}`,
    "task.count": String(sample?.taskCount ?? 2),
    "session.title": sample?.sessionTitle ?? "Example session",
    "session.room": sample?.room ?? "Room to be confirmed",
  };
  const htmlVariables = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, escapeHtml(value)]));
  const subject = `[TEST] ${renderMessageTemplate(body.subject, variables)}`;
  const job: OutboxJob = { kind: "email", idempotencyKey: `communication-test:${eventId}:${actor.id}:${crypto.randomUUID()}`, payload: { kind: "communication", communicationKind: "test", eventId, recipient: actor.email, recipientName: actor.name, subject, text: renderMessageTemplate(body.text, variables), html: renderMessageTemplate(body.html, htmlVariables) } };
  if (actor.demo) return c.json({ data: { queued: 1, recipient: actor.email, subject } }, 202);
  if (!c.env.JOBS_QUEUE) return jsonError(c, 503, "QUEUE_UNAVAILABLE", "The communication queue is not configured.");
  await persistOutboxJobs(c.env.DB, [job]);
  await dispatchPersistedJobs(c.env.JOBS_QUEUE, [job]);
  return c.json({ data: { queued: 1, recipient: actor.email, subject } }, 202);
});

const queueSchema = z.object({ kind: z.enum(["reminder", "acceptance", "calendar"]), recipientIds: z.array(z.string()).min(1).max(50), templateId: z.string().optional() });
app.post("/api/v1/events/:eventId/communications/send", zValidator("json", queueSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const queue = c.env.JOBS_QUEUE;
  if (!queue && !c.get("actor")?.demo) return jsonError(c, 503, "QUEUE_UNAVAILABLE", "The communication queue is not configured.");
  const body = c.req.valid("json");
  const idempotencyKey = c.req.header("idempotency-key") ?? crypto.randomUUID();
  const recipientIds = [...new Set(body.recipientIds)];
  if (c.get("actor")?.demo) return c.json({ data: { queued: recipientIds.length, dispatched: recipientIds.length, idempotencyKey } }, 202);
  const speakers = await c.env.DB.prepare(`SELECT sp.id, sp.name, sp.email,
      EXISTS (
        SELECT 1 FROM proposal_speakers proposal_speaker
        JOIN proposals proposal ON proposal.id = proposal_speaker.proposal_id
        WHERE proposal_speaker.speaker_profile_id = sp.id
          AND proposal.event_id = sp.event_id
          AND proposal.status IN ('accepted', 'session')
      ) AS acceptedProposal,
      EXISTS (
        SELECT 1 FROM speaker_tasks task
        WHERE task.speaker_profile_id = sp.id
          AND task.event_id = sp.event_id
          AND task.status IN ('not_started', 'in_progress', 'overdue')
      ) AS openTask,
      (SELECT COUNT(*) FROM speaker_tasks task
        WHERE task.speaker_profile_id = sp.id
          AND task.event_id = sp.event_id
          AND task.status IN ('not_started', 'in_progress', 'overdue')) AS taskCount,
      (SELECT proposal.title FROM proposal_speakers proposal_speaker
        JOIN proposals proposal ON proposal.id = proposal_speaker.proposal_id
        WHERE proposal_speaker.speaker_profile_id = sp.id
          AND proposal.event_id = sp.event_id
          AND proposal.status IN ('accepted', 'session')
        ORDER BY proposal.updated_at DESC LIMIT 1) AS proposalTitle,
      EXISTS (
        SELECT 1 FROM session_speakers session_speaker
        JOIN program_sessions session ON session.id = session_speaker.session_id
        WHERE session_speaker.speaker_profile_id = sp.id
          AND session.event_id = sp.event_id
          AND session.status IN ('scheduled', 'published')
          AND session.starts_at IS NOT NULL
          AND session.ends_at IS NOT NULL
      ) AS scheduledSession
    FROM speaker_profiles sp
    WHERE sp.event_id = ? AND sp.id IN (${recipientIds.map(() => "?").join(",")})`)
    .bind(c.req.param("eventId"), ...recipientIds).all<CommunicationRecipientEvidence & { name: string; email: string; taskCount: number; proposalTitle?: string }>();
  if (speakers.results.length !== recipientIds.length) return jsonError(c, 422, "RECIPIENT_NOT_FOUND", "Every recipient must be a speaker in this event.");
  const ineligibleRecipientIds = ineligibleCommunicationRecipientIds(body.kind, speakers.results);
  if (ineligibleRecipientIds.length) return jsonError(c, 422, "RECIPIENT_INELIGIBLE", `Every ${body.kind} recipient must match the operational audience.`, { recipientIds: ineligibleRecipientIds.join(", ") });
  const event = await c.env.DB.prepare("SELECT name, venue, timezone FROM events WHERE id = ?").bind(c.req.param("eventId")).first<{ name: string; venue: string; timezone: string }>();
  if (!event) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  const template = body.templateId
    ? await c.env.DB.prepare("SELECT subject, html, text FROM message_templates WHERE id = ? AND event_id = ?").bind(body.templateId, c.req.param("eventId")).first<{ subject: string; html: string; text: string }>()
    : await c.env.DB.prepare("SELECT subject, html, text FROM message_templates WHERE event_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 1")
      .bind(c.req.param("eventId"), body.kind).first<{ subject: string; html: string; text: string }>();
  if (body.templateId && !template) return jsonError(c, 422, "TEMPLATE_NOT_FOUND", "Choose a communication template that belongs to this event.");
  const jobs: OutboxJob[] = [];
  const speakerClaimUrl = `${c.env.PUBLIC_APP_URL.replace(/\/$/, "")}/speaker/claim/${encodeURIComponent(c.req.param("eventId"))}`;
  for (const speaker of speakers.results) {
    if (body.kind === "calendar") {
      const sessions = await c.env.DB.prepare("SELECT ps.id, ps.title, ps.description, ps.starts_at AS startsAt, ps.ends_at AS endsAt, ps.calendar_uid AS uid, ps.calendar_sequence AS sequence, r.name AS room FROM program_sessions ps JOIN session_speakers ss ON ss.session_id = ps.id LEFT JOIN rooms r ON r.id = ps.room_id WHERE ss.speaker_profile_id = ? AND ps.event_id = ? AND ps.status IN ('scheduled', 'published') AND ps.starts_at IS NOT NULL AND ps.ends_at IS NOT NULL")
        .bind(speaker.id, c.req.param("eventId")).all<{ id: string; title: string; description: string; startsAt: number; endsAt: number; uid: string; sequence: number; room?: string }>();
      for (const session of sessions.results) {
        const messageKey = `${idempotencyKey}:${speaker.id}:${session.id}`;
        const variables = {
          "event.name": event.name,
          "speaker.name": speaker.name,
          "proposal.title": speaker.proposalTitle ?? session.title,
          "speaker.portal_url": speakerClaimUrl,
          "task.count": String(speaker.taskCount),
          "session.title": session.title,
          "session.room": session.room ?? "Room to be confirmed",
        };
        const htmlVariables = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, escapeHtml(value)]));
        jobs.push({ kind: "calendar", idempotencyKey: messageKey, payload: { kind: "communication", communicationKind: body.kind, eventId: c.req.param("eventId"), recipient: speaker.email, recipientName: speaker.name, subject: renderMessageTemplate(template?.subject ?? "Your {{event.name}} session: {{session.title}}", variables), text: renderMessageTemplate(template?.text ?? "Hi {{speaker.name}}, your session “{{session.title}}” is scheduled in {{session.room}}. Add the attached calendar invitation to your calendar.", variables), html: renderMessageTemplate(template?.html ?? "<p>Hi {{speaker.name}},</p><p>Your session <strong>“{{session.title}}”</strong> is scheduled in {{session.room}}. The calendar invitation is attached.</p>", htmlVariables), calendar: { method: "REQUEST", uid: session.uid, sequence: session.sequence, title: session.title, description: session.description, location: `${session.room ?? "Room to be confirmed"}, ${event.venue ?? ""}`, startsAt: new Date(Number(session.startsAt)).toISOString(), endsAt: new Date(Number(session.endsAt)).toISOString(), organizerName: event.name } } });
      }
    } else {
      const acceptance = body.kind === "acceptance";
      const variables = {
        "event.name": event.name,
        "speaker.name": speaker.name,
        "proposal.title": speaker.proposalTitle ?? "your proposal",
        "decision.feedback": "No additional feedback was included.",
        "speaker.portal_url": speakerClaimUrl,
        "task.count": String(speaker.taskCount),
        "session.title": speaker.proposalTitle ?? "your session",
        "session.room": "Room to be confirmed",
      };
      const htmlVariables = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, escapeHtml(value)]));
      const subject = renderMessageTemplate(template?.subject ?? (acceptance ? "You're speaking at {{event.name}}" : "Speaker task reminder · {{event.name}}"), variables);
      const text = renderMessageTemplate(template?.text ?? (acceptance ? "Hi {{speaker.name}}, your proposal “{{proposal.title}}” has been accepted. Claim your speaker profile and review your onboarding tasks: {{speaker.portal_url}}" : "Hi {{speaker.name}}, you have {{task.count}} outstanding speaker task(s). Open your speaker portal: {{speaker.portal_url}}"), variables);
      const html = renderMessageTemplate(template?.html ?? (acceptance ? "<p>Hi {{speaker.name}},</p><p>Your proposal <strong>“{{proposal.title}}”</strong> has been accepted.</p><p><a href=\"{{speaker.portal_url}}\">Open speaker portal</a></p>" : "<p>Hi {{speaker.name}},</p><p>You have {{task.count}} outstanding speaker task(s).</p><p><a href=\"{{speaker.portal_url}}\">Open speaker portal</a></p>"), htmlVariables);
      jobs.push({ kind: "email", idempotencyKey: `${idempotencyKey}:${speaker.id}`, payload: { kind: "communication", communicationKind: body.kind, eventId: c.req.param("eventId"), recipient: speaker.email, recipientName: speaker.name, subject, text, html } });
    }
  }
  await persistOutboxJobs(c.env.DB, jobs);
  const dispatched = await dispatchPersistedJobs(queue!, jobs, (job, error) => {
    console.error(JSON.stringify({ event: "communication.queue_failed", idempotencyKey: job.idempotencyKey, recovery: "scheduled_outbox", error: error instanceof Error ? error.message : String(error) }));
  });
  return c.json({ data: { queued: jobs.length, dispatched, idempotencyKey } }, 202);
});

app.post("/api/v1/events/:eventId/integrations/accelevents/publish", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  if (c.env.ACCELEVENTS_ENABLED !== "true") {
    return c.json({ data: { status: "manual_action", reason: "API credentials or Enterprise entitlement are not configured. Safe approved-speaker and scheduled-session exports remain available.", exportUrls: { speakers: `/api/v1/events/${c.req.param("eventId")}/exports/speakers.csv`, sessions: `/api/v1/events/${c.req.param("eventId")}/exports/sessions.csv` } } });
  }
  const idempotencyKey = c.req.header("idempotency-key") ?? `accelevents:${c.req.param("eventId")}:${Date.now()}`;
  await c.env.JOBS_QUEUE?.send({ kind: "accelevents", idempotencyKey, payload: { eventId: c.req.param("eventId") } });
  return c.json({ data: { status: "queued", idempotencyKey } }, 202);
});

app.get("/api/v1/events/:eventId/exports/:kind", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const kind = c.req.param("kind");
  if (!['speakers.csv', 'sessions.csv', 'program.json'].includes(kind)) return jsonError(c, 404, "EXPORT_NOT_FOUND", "Choose the speaker CSV, session CSV, or program JSON export.");
  const workspace = c.get("actor")?.demo ? createDemoWorkspace(c.get("actor")!.id) : await loadWorkspace(c.env, c.get("actor")!, c.req.param("eventId"), c.get("actor")!.role);
  if (!workspace || workspace.event.id !== c.req.param("eventId")) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  const projection = projectConferenceExport(workspace);
  if (kind === "program.json") {
    c.header("content-disposition", `attachment; filename="${workspace.event.slug}-program.json"`);
    return c.json({ event: workspace.event, speakers: projection.speakers, sessions: projection.sessions });
  }
  c.header("content-type", "text/csv; charset=utf-8");
  if (kind === "speakers.csv") {
    c.header("content-disposition", `attachment; filename="${workspace.event.slug}-speakers.csv"`);
    return c.body(["id,name,email,title,company,bio", ...projection.speakers.map((speaker) => [speaker.id, speaker.name, speaker.email, speaker.title, speaker.company, speaker.bio].map(spreadsheetSafeCsvCell).join(","))].join("\r\n"));
  }
  c.header("content-disposition", `attachment; filename="${workspace.event.slug}-sessions.csv"`);
  return c.body(["id,title,speakers,track,room,starts_at,ends_at,status", ...projection.sessions.map((session) => [session.id, session.title, session.speakerNames.join("; "), workspace.tracks.find((track) => track.id === session.trackId)?.name, workspace.rooms.find((room) => room.id === session.roomId)?.name, session.startsAt, session.endsAt, session.status].map(spreadsheetSafeCsvCell).join(","))].join("\r\n"));
});

app.post("/api/v1/events/:eventId/uploads", async (c) => {
  const actor = c.get("actor");
  if (!actor) return jsonError(c, 401, "AUTH_REQUIRED", "Sign in to upload files.");
  const purpose = c.req.query("purpose");
  if (purpose !== "headshot" && purpose !== "event_logo" && purpose !== "slides" && purpose !== "supporting_document") return jsonError(c, 422, "UPLOAD_PURPOSE_REQUIRED", "Choose a supported upload purpose.");
  const fileName = c.req.query("filename") ?? "upload";
  const contentLength = Number(c.req.header("content-length") ?? 0);
  const maxBytes = purpose === "event_logo" ? 5 * 1024 * 1024 : purpose === "headshot" ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
  if (!contentLength || contentLength > maxBytes) return jsonError(c, 413, "UPLOAD_TOO_LARGE", `This ${purpose} exceeds the ${maxBytes / 1024 / 1024} MB limit.`);
  const contentType = (c.req.header("content-type") ?? "application/octet-stream").toLowerCase();
  if (!uploadContentTypeAllowed(purpose, contentType, fileName)) return jsonError(c, 422, "UPLOAD_TYPE_NOT_ALLOWED", `This file type is not supported for ${purpose.replace("_", " ")}.`);
  if (!c.req.raw.body) return jsonError(c, 422, "UPLOAD_EMPTY", "Choose a file to upload.");
  if (c.get("actor")?.demo) return c.json({ data: { id: crypto.randomUUID(), fileName, byteSize: contentLength, purpose, status: "stored" } }, 201);
  const uploadId = crypto.randomUUID();
  const objectKey = `${c.req.param("eventId")}/${actor.id}/${uploadId}`;
  await putR2ObjectWithMetadata({
    bucket: c.env.UPLOADS,
    objectKey,
    value: c.req.raw.body,
    options: { httpMetadata: { contentType }, customMetadata: { ownerUserId: actor.id, purpose } },
    persistMetadata: () => c.env.DB.prepare("INSERT INTO uploads (id, event_id, owner_user_id, object_key, file_name, content_type, byte_size, purpose, public, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)")
      .bind(uploadId, c.req.param("eventId"), actor.id, objectKey, fileName, contentType, contentLength, purpose, Date.now())
      .run(),
  });
  return c.json({ data: { id: uploadId, fileName, byteSize: contentLength, purpose, status: "stored" } }, 201);
});

app.get("/api/v1/events/:eventId/uploads/:uploadId", async (c) => {
  const actor = c.get("actor")!;
  if (actor.demo) return jsonError(c, 404, "DEMO_UPLOAD_NOT_STORED", "Demo uploads are not persisted between requests.");
  const upload = await c.env.DB.prepare("SELECT object_key AS objectKey, file_name AS fileName, content_type AS contentType, owner_user_id AS ownerUserId FROM uploads WHERE id = ? AND event_id = ? AND deleted_at IS NULL")
    .bind(c.req.param("uploadId"), c.req.param("eventId")).first<{ objectKey: string; fileName: string; contentType: string; ownerUserId: string }>();
  if (!upload) return jsonError(c, 404, "UPLOAD_NOT_FOUND", "File not found.");
  if (actor.role !== "organizer" && upload.ownerUserId !== actor.id) return jsonError(c, 403, "UPLOAD_ACCESS_DENIED", "You do not have access to this file.");
  const object = await c.env.UPLOADS.get(upload.objectKey);
  if (!object) return jsonError(c, 404, "UPLOAD_OBJECT_NOT_FOUND", "The file record exists, but its object is unavailable.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(upload.fileName)}`);
  headers.set("cache-control", "private, no-store");
  return new Response(object.body, { headers });
});

app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "The requested route does not exist."));
app.onError((error, c) => {
  console.error(JSON.stringify({ event: "request.error", requestId: c.get("requestId"), message: error.message, stack: error.stack }));
  return jsonError(c, 500, "INTERNAL_ERROR", "Something went wrong. Try again with the request ID shown.");
});

export default app;
