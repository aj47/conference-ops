import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { createDemoWorkspace } from "../shared/demo-data";
import {
  parseSpeakerCsv,
  renderSpeakerTemplate,
  type ContentRevision,
  type SpeakerCommunicationLog,
  type SpeakerContentFile,
  type SpeakerContentFileVersion,
  type SpeakerContentSession,
  type SpeakerContentSnapshot,
  type SpeakerContentSpeaker,
  type SpeakerContentTask,
} from "../shared/speaker-content";
import type { AppEnv, AuthActor } from "./env";
import { jsonError, requireRole } from "./http";
import { dispatchPersistedJobs, persistOutboxJobs, type OutboxJob } from "./outbox-producer";
import { createStoredZip } from "./store-zip";

const routes = new Hono<AppEnv>();

function iso(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  const numeric = Number(value);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (value && typeof value === "object") return value as T;
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function safeZipSegment(value: string, fallback: string) {
  const normalized = [...value.normalize("NFKC")]
    .map((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 || '\\/:*?"<>|'.includes(character) ? "-" : character;
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 100);
  return normalized || fallback;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

function demoSnapshot(actorId: string, eventId: string): SpeakerContentSnapshot {
  const workspace = createDemoWorkspace(actorId);
  const allSpeakers = new Map(workspace.proposals.flatMap((proposal) => proposal.speakers).map((speaker) => [speaker.id, speaker]));
  const sessionByProposal = new Map(workspace.sessions.filter((session) => session.proposalId).map((session) => [session.proposalId!, session]));
  const sessions: SpeakerContentSession[] = workspace.sessions.map((session) => ({
    id: session.id,
    title: session.title,
    description: session.description,
    format: session.format ?? "talk",
    scheduleStatus: session.status,
    contentStatus: session.status === "published" ? "approved" : "in_review",
    speakerIds: session.speakerIds,
    speakerNames: session.speakerNames,
    startsAt: session.startsAt,
    room: workspace.rooms.find((room) => room.id === session.roomId)?.name,
    history: [],
  }));
  const speakers: SpeakerContentSpeaker[] = [...allSpeakers.values()].map((speaker) => ({
    ...speaker,
    workflowStatus: speaker.profileComplete ? "ready" : "onboarding",
    socialLinks: {},
    travelDetails: "",
    published: speaker.profileComplete,
    sessions: sessions
      .filter((session) => session.speakerIds.includes(speaker.id))
      .map((session) => ({ id: session.id, title: session.title, startsAt: session.startsAt, room: session.room })),
  }));
  const speakerMap = new Map(speakers.map((speaker) => [speaker.id, speaker]));
  const tasks: SpeakerContentTask[] = workspace.tasks.map((task) => {
    const session = task.proposalId ? sessionByProposal.get(task.proposalId) : undefined;
    const versions = (task.artifactVersions ?? []).map((version, index) => ({
      ...version,
      byteSize: 0,
      current: index === 0,
      downloadUrl: `/api/v1/events/${encodeURIComponent(eventId)}/tasks/${encodeURIComponent(task.id)}/artifacts/${encodeURIComponent(version.uploadId)}`,
    }));
    return {
      id: task.id,
      speakerId: task.speakerId,
      speakerName: speakerMap.get(task.speakerId)?.name ?? "Speaker",
      proposalId: task.proposalId,
      sessionId: session?.id,
      sessionTitle: session?.title ?? task.targetTitle,
      title: task.title,
      description: task.description,
      kind: task.type === "upload" || task.completionMode === "file_request" ? "file_request" : "general",
      dueAt: task.dueAt,
      status: task.status,
      versions,
      comments: (task.comments ?? []).map((comment) => ({
        id: comment.id,
        authorName: comment.authorName,
        body: comment.body,
        createdAt: comment.createdAt,
      })),
    };
  });
  const files = tasks.filter((task) => task.versions.length).map((task) => ({
    id: task.id,
    taskId: task.id,
    speakerId: task.speakerId,
    speakerName: task.speakerName,
    sessionId: task.sessionId,
    sessionTitle: task.sessionTitle,
    fileName: task.versions[0].fileName,
    uploadedAt: task.versions[0].uploadedAt,
    versionCount: task.versions.length,
    versions: task.versions,
  }));
  return { speakers, tasks, files, sessions, communications: [], generatedAt: new Date().toISOString() };
}

interface SpeakerRow {
  id: string;
  name: string;
  email: string;
  title: string;
  company: string;
  bio: string;
  pronouns: string | null;
  city: string | null;
  profileComplete: number;
  published: number;
  workflowStatus: SpeakerContentSpeaker["workflowStatus"];
  socialLinks: string;
  travelDetails: string;
  headshotUploadId: string | null;
  headshotFileName: string | null;
  headshotContentType: string | null;
  headshotCreatedAt: number | null;
}

interface SessionRow {
  id: string;
  title: string;
  description: string;
  format: string;
  scheduleStatus: SpeakerContentSession["scheduleStatus"];
  contentStatus: SpeakerContentSession["contentStatus"];
  startsAt: number | null;
  room: string | null;
}

interface TaskRow {
  id: string;
  speakerId: string;
  speakerName: string;
  proposalId: string | null;
  sessionId: string | null;
  sessionTitle: string | null;
  title: string;
  description: string;
  type: string;
  completionMode: string | null;
  dueAt: number;
  status: SpeakerContentTask["status"];
  currentUploadId: string | null;
}

async function loadPersistedSnapshot(db: D1Database, eventId: string, actor: AuthActor) {
  const speakerScope = actor.role === "organizer" ? "" : " AND sp.user_id = ?";
  const scopedBindings = actor.role === "organizer" ? [actor.role, eventId] : [actor.role, eventId, actor.id];
  const [speakerRows, sessionRows, sessionSpeakerRows, taskRows, versionRows, commentRows, revisionRows, communicationRows] = await Promise.all([
    db.prepare(`SELECT sp.id, sp.name, sp.email, sp.title, sp.company, sp.bio, sp.pronouns, sp.city,
        sp.profile_complete AS profileComplete, sp.published,
        COALESCE(ops.workflow_status, 'invited') AS workflowStatus,
        COALESCE(ops.social_links, '{}') AS socialLinks,
        CASE WHEN ? = 'organizer' THEN COALESCE(ops.travel_details, '') ELSE '' END AS travelDetails,
        headshot.id AS headshotUploadId, headshot.file_name AS headshotFileName,
        headshot.content_type AS headshotContentType, headshot.created_at AS headshotCreatedAt
      FROM speaker_profiles sp
      LEFT JOIN speaker_operations ops ON ops.speaker_profile_id = sp.id AND ops.event_id = sp.event_id
      LEFT JOIN uploads headshot ON headshot.id = sp.headshot_upload_id AND headshot.event_id = sp.event_id AND headshot.deleted_at IS NULL
      WHERE sp.event_id = ?${speakerScope}
      ORDER BY lower(sp.name), lower(sp.email)`)
      .bind(...scopedBindings).all<SpeakerRow>(),
    db.prepare(`SELECT ps.id, ps.title, ps.description, ps.format, ps.status AS scheduleStatus,
        COALESCE(scs.status, 'draft') AS contentStatus, ps.starts_at AS startsAt, room.name AS room
      FROM program_sessions ps
      LEFT JOIN session_content_status scs ON scs.session_id = ps.id AND scs.event_id = ps.event_id
      LEFT JOIN rooms room ON room.id = ps.room_id
      WHERE ps.event_id = ?
        AND (? = 'organizer' OR EXISTS (
          SELECT 1 FROM session_speakers own_ss
          JOIN speaker_profiles own_sp ON own_sp.id = own_ss.speaker_profile_id
          WHERE own_ss.session_id = ps.id AND own_sp.user_id = ? AND own_sp.event_id = ps.event_id
        ))
      ORDER BY ps.starts_at IS NULL, ps.starts_at, lower(ps.title)`)
      .bind(eventId, actor.role, actor.id).all<SessionRow>(),
    db.prepare(`SELECT ss.session_id AS sessionId, sp.id AS speakerId, sp.name AS speakerName
      FROM session_speakers ss
      JOIN program_sessions ps ON ps.id = ss.session_id AND ps.event_id = ?
      JOIN speaker_profiles sp ON sp.id = ss.speaker_profile_id AND sp.event_id = ps.event_id
      WHERE (? = 'organizer' OR sp.user_id = ?)
      ORDER BY lower(sp.name)`)
      .bind(eventId, actor.role, actor.id).all<{ sessionId: string; speakerId: string; speakerName: string }>(),
    db.prepare(`SELECT st.id, st.speaker_profile_id AS speakerId, sp.name AS speakerName,
        st.proposal_id AS proposalId, ps.id AS sessionId,
        COALESCE(ps.title, proposal.title) AS sessionTitle,
        st.title, st.description, st.type, tt.completion_mode AS completionMode,
        st.due_at AS dueAt, st.status, st.artifact_upload_id AS currentUploadId
      FROM speaker_tasks st
      JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id AND sp.event_id = st.event_id
      LEFT JOIN task_templates tt ON tt.id = st.template_id AND tt.event_id = st.event_id
      LEFT JOIN proposals proposal ON proposal.id = st.proposal_id AND proposal.event_id = st.event_id
      LEFT JOIN program_sessions ps ON ps.proposal_id = st.proposal_id AND ps.event_id = st.event_id
      WHERE st.event_id = ? AND (? = 'organizer' OR sp.user_id = ?)
      ORDER BY st.due_at, lower(sp.name), lower(st.title)`)
      .bind(eventId, actor.role, actor.id).all<TaskRow>(),
    db.prepare(`SELECT st.id AS taskId, uploaded.id AS uploadId, uploaded.file_name AS fileName,
        uploaded.content_type AS contentType, uploaded.byte_size AS byteSize, uploaded.created_at AS uploadedAt,
        CASE WHEN st.artifact_upload_id = uploaded.id THEN 1 ELSE 0 END AS isCurrent
      FROM speaker_tasks st
      JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id AND sp.event_id = st.event_id
      LEFT JOIN task_templates tt ON tt.id = st.template_id AND tt.event_id = st.event_id
      LEFT JOIN file_request_responses response ON response.file_request_id = tt.file_request_id AND response.target_id = st.id
      JOIN uploads uploaded ON uploaded.event_id = st.event_id AND uploaded.deleted_at IS NULL
        AND (uploaded.id = st.artifact_upload_id OR EXISTS (
          SELECT 1 FROM json_each(COALESCE(response.upload_ids, '[]')) WHERE json_each.value = uploaded.id
        ))
      WHERE st.event_id = ? AND (? = 'organizer' OR sp.user_id = ?)
      ORDER BY uploaded.created_at DESC, uploaded.id DESC`)
      .bind(eventId, actor.role, actor.id).all<{ taskId: string; uploadId: string; fileName: string; contentType: string; byteSize: number; uploadedAt: number; isCurrent: number }>(),
    db.prepare(`SELECT tc.id, tc.task_id AS taskId, user.name AS authorName, tc.body, tc.created_at AS createdAt
      FROM task_comments tc
      JOIN speaker_tasks st ON st.id = tc.task_id AND st.event_id = tc.event_id
      JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id AND sp.event_id = st.event_id
      JOIN user ON user.id = tc.author_user_id
      WHERE tc.event_id = ? AND (? = 'organizer' OR sp.user_id = ?)
      ORDER BY tc.created_at, tc.id`)
      .bind(eventId, actor.role, actor.id).all<{ id: string; taskId: string; authorName: string; body: string; createdAt: number }>(),
    db.prepare(`SELECT cr.id, cr.entity_id AS entityId, cr.version, cr.snapshot, cr.editor_name AS editorName,
        cr.restored_from_version AS restoredFromVersion, cr.created_at AS createdAt
      FROM content_revisions cr
      WHERE cr.event_id = ? AND cr.entity_type = 'session'
        AND (? = 'organizer' OR EXISTS (
          SELECT 1 FROM session_speakers ss
          JOIN speaker_profiles sp ON sp.id = ss.speaker_profile_id
          WHERE ss.session_id = cr.entity_id AND sp.event_id = cr.event_id AND sp.user_id = ?
        ))
      ORDER BY cr.entity_id, cr.version DESC`)
      .bind(eventId, actor.role, actor.id).all<{ id: string; entityId: string; version: number; snapshot: string; editorName: string; restoredFromVersion: number | null; createdAt: number }>(),
    actor.role === "organizer"
      ? db.prepare(`SELECT scl.id, scl.kind, scl.recipient_ids AS recipientIds, scl.recipient_names AS recipientNames,
          scl.subject, scl.body_template AS bodyTemplate, scl.rendered_previews AS renderedPreviews,
          scl.status, scl.delivery_mode AS deliveryMode, scl.actor_name AS actorName, scl.created_at AS createdAt
        FROM speaker_communication_logs scl WHERE scl.event_id = ? ORDER BY scl.created_at DESC, scl.id DESC`)
        .bind(eventId).all<Record<string, unknown>>()
      : Promise.resolve({ results: [] as Record<string, unknown>[] }),
  ]);

  const sessionSpeakers = new Map<string, Array<{ id: string; name: string }>>();
  for (const row of sessionSpeakerRows.results) {
    sessionSpeakers.set(row.sessionId, [...(sessionSpeakers.get(row.sessionId) ?? []), { id: row.speakerId, name: row.speakerName }]);
  }
  const revisions = new Map<string, ContentRevision[]>();
  for (const row of revisionRows.results) {
    const snapshot = parseJson<{ title?: string; description?: string }>(row.snapshot, {});
    revisions.set(row.entityId, [...(revisions.get(row.entityId) ?? []), {
      id: row.id,
      version: Number(row.version),
      title: String(snapshot.title ?? ""),
      description: String(snapshot.description ?? ""),
      editorName: row.editorName,
      createdAt: iso(row.createdAt),
      ...(row.restoredFromVersion ? { restoredFromVersion: Number(row.restoredFromVersion) } : {}),
    }]);
  }
  const sessions: SpeakerContentSession[] = sessionRows.results.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    format: row.format,
    scheduleStatus: row.scheduleStatus,
    contentStatus: row.contentStatus,
    speakerIds: (sessionSpeakers.get(row.id) ?? []).map((speaker) => speaker.id),
    speakerNames: (sessionSpeakers.get(row.id) ?? []).map((speaker) => speaker.name),
    ...(row.startsAt ? { startsAt: iso(row.startsAt) } : {}),
    ...(row.room ? { room: row.room } : {}),
    history: revisions.get(row.id) ?? [],
  }));
  const sessionMap = new Map(sessions.map((session) => [session.id, session]));
  const versions = new Map<string, SpeakerContentFileVersion[]>();
  for (const row of versionRows.results) {
    versions.set(row.taskId, [...(versions.get(row.taskId) ?? []), {
      uploadId: row.uploadId,
      fileName: row.fileName,
      contentType: row.contentType,
      byteSize: Number(row.byteSize),
      uploadedAt: iso(row.uploadedAt),
      current: Boolean(row.isCurrent),
      downloadUrl: `/api/v1/events/${encodeURIComponent(eventId)}/tasks/${encodeURIComponent(row.taskId)}/artifacts/${encodeURIComponent(row.uploadId)}`,
    }]);
  }
  const comments = new Map<string, SpeakerContentTask["comments"]>();
  for (const row of commentRows.results) {
    comments.set(row.taskId, [...(comments.get(row.taskId) ?? []), {
      id: row.id,
      authorName: row.authorName,
      body: row.body,
      createdAt: iso(row.createdAt),
    }]);
  }
  const tasks: SpeakerContentTask[] = taskRows.results.map((row) => ({
    id: row.id,
    speakerId: row.speakerId,
    speakerName: row.speakerName,
    ...(row.proposalId ? { proposalId: row.proposalId } : {}),
    ...(row.sessionId ? { sessionId: row.sessionId } : {}),
    ...(row.sessionTitle ? { sessionTitle: row.sessionTitle } : {}),
    title: row.title,
    description: row.description,
    kind: row.type === "upload" || row.completionMode === "file_request" ? "file_request" : "general",
    dueAt: iso(row.dueAt),
    status: ["not_started", "in_progress"].includes(row.status) && Number(row.dueAt) < Date.now() ? "overdue" : row.status,
    versions: versions.get(row.id) ?? [],
    comments: comments.get(row.id) ?? [],
  }));
  const tasksBySpeaker = new Map<string, SpeakerContentTask[]>();
  for (const task of tasks) tasksBySpeaker.set(task.speakerId, [...(tasksBySpeaker.get(task.speakerId) ?? []), task]);
  const speakers: SpeakerContentSpeaker[] = speakerRows.results.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    title: row.title,
    company: row.company,
    bio: row.bio,
    ...(row.pronouns ? { pronouns: row.pronouns } : {}),
    ...(row.city ? { city: row.city } : {}),
    workflowStatus: row.workflowStatus,
    socialLinks: parseJson(row.socialLinks, {}),
    travelDetails: row.travelDetails,
    profileComplete: Boolean(row.profileComplete),
    published: Boolean(row.published),
    ...(row.headshotUploadId ? { headshot: {
      uploadId: row.headshotUploadId,
      fileName: row.headshotFileName ?? "Headshot",
      contentType: row.headshotContentType ?? "application/octet-stream",
      uploadedAt: iso(row.headshotCreatedAt),
      downloadUrl: `/api/v1/events/${encodeURIComponent(eventId)}/uploads/${encodeURIComponent(row.headshotUploadId)}`,
    } } : {}),
    sessions: sessions
      .filter((session) => session.speakerIds.includes(row.id))
      .map((session) => ({ id: session.id, title: session.title, startsAt: session.startsAt, room: session.room })),
  }));
  const files: SpeakerContentFile[] = tasks.filter((task) => task.versions.length).map((task) => ({
    id: task.id,
    taskId: task.id,
    speakerId: task.speakerId,
    speakerName: task.speakerName,
    sessionId: task.sessionId,
    sessionTitle: task.sessionId ? sessionMap.get(task.sessionId)?.title ?? task.sessionTitle : task.sessionTitle,
    fileName: task.versions.find((version) => version.current)?.fileName ?? task.versions[0].fileName,
    uploadedAt: task.versions.find((version) => version.current)?.uploadedAt ?? task.versions[0].uploadedAt,
    versionCount: task.versions.length,
    versions: task.versions,
  }));
  const communications: SpeakerCommunicationLog[] = communicationRows.results.map((row) => ({
    id: String(row.id),
    kind: String(row.kind) as SpeakerCommunicationLog["kind"],
    recipientIds: parseJson(row.recipientIds, []),
    recipientNames: parseJson(row.recipientNames, []),
    subject: String(row.subject),
    bodyTemplate: String(row.bodyTemplate),
    renderedPreviews: parseJson(row.renderedPreviews, []),
    status: String(row.status) === "queued" ? "queued" : "recorded",
    deliveryMode: String(row.deliveryMode) === "queue" ? "queue" : "sandbox",
    createdAt: iso(row.createdAt),
    actorName: String(row.actorName),
  }));
  return { speakers, tasks, files, sessions, communications, generatedAt: new Date().toISOString() };
}

routes.get("/api/v1/events/:eventId/speaker-content", async (c) => {
  const actor = c.get("actor")!;
  if (!["organizer", "speaker"].includes(actor.role)) return jsonError(c, 403, "ROLE_REQUIRED", "Speaker or organizer access is required.");
  const snapshot = actor.demo
    ? demoSnapshot(actor.id, c.req.param("eventId"))
    : await loadPersistedSnapshot(c.env.DB, c.req.param("eventId"), actor);
  return c.json({ data: snapshot });
});

const safeSocialUrlSchema = z.string().trim().max(1000).refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}, "Use a complete HTTPS URL without embedded credentials.").optional().or(z.literal(""));

const socialLinksSchema = z.object({
  linkedin: safeSocialUrlSchema,
  x: safeSocialUrlSchema,
  website: safeSocialUrlSchema,
});

const managedSpeakerSchema = z.object({
  name: z.string().trim().min(2).max(255),
  email: z.string().trim().email().max(320),
  title: z.string().trim().max(255).default(""),
  company: z.string().trim().max(255).default(""),
  bio: z.string().trim().max(5000).default(""),
  pronouns: z.string().trim().max(100).optional(),
  city: z.string().trim().max(255).optional(),
  workflowStatus: z.enum(["invited", "confirmed", "onboarding", "ready", "declined"]).default("invited"),
  socialLinks: socialLinksSchema.default({}),
  travelDetails: z.string().trim().max(5000).default(""),
  headshotUploadId: z.string().min(1).optional(),
  published: z.boolean().default(false),
});

routes.post("/api/v1/events/:eventId/speakers/manage", zValidator("json", managedSpeakerSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const id = crypto.randomUUID();
  if (c.get("actor")!.demo) return c.json({ data: { id, ...body, email: body.email.toLowerCase(), created: true } }, 201);
  if (body.headshotUploadId) {
    const upload = await c.env.DB.prepare(`SELECT id FROM uploads
      WHERE id = ? AND event_id = ? AND owner_user_id = ? AND purpose = 'headshot' AND deleted_at IS NULL`)
      .bind(body.headshotUploadId, c.req.param("eventId"), c.get("actor")!.id).first();
    if (!upload) return jsonError(c, 422, "HEADSHOT_NOT_FOUND", "Upload a valid event-scoped headshot before creating this speaker.");
  }
  const now = Date.now();
  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`INSERT INTO speaker_profiles
        (id, user_id, event_id, name, email, title, company, bio, pronouns, city, headshot_upload_id, profile_complete, published, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, c.req.param("eventId"), body.name, body.email.toLowerCase(), body.title, body.company, body.bio,
          body.pronouns ?? null, body.city ?? null, body.headshotUploadId ?? null,
          body.bio && body.headshotUploadId ? 1 : 0, body.published ? 1 : 0, now, now),
      c.env.DB.prepare(`INSERT INTO speaker_operations
        (speaker_profile_id, event_id, workflow_status, social_links, travel_details, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, c.req.param("eventId"), body.workflowStatus, JSON.stringify(body.socialLinks), body.travelDetails, now, now),
    ]);
  } catch (error) {
    if (/speaker_email_event_unique|UNIQUE.*speaker_profiles.*email/i.test(error instanceof Error ? error.message : String(error))) {
      return jsonError(c, 409, "SPEAKER_EMAIL_EXISTS", "A speaker with this email already exists in the event.", { email: "Use a unique speaker email or edit the existing record." });
    }
    throw error;
  }
  return c.json({ data: { id, ...body, email: body.email.toLowerCase(), created: true } }, 201);
});

routes.put("/api/v1/events/:eventId/speakers/:speakerId/manage", zValidator("json", managedSpeakerSchema), async (c) => {
  const actor = c.get("actor")!;
  const submitted = c.req.valid("json");
  let body = submitted;
  if (actor.role !== "organizer") {
    if (actor.role !== "speaker") return jsonError(c, 403, "ROLE_REQUIRED", "Speaker or organizer access is required.");
    const protectedFields = actor.demo
      ? demoSnapshot(actor.id, c.req.param("eventId")).speakers.find((speaker) => speaker.id === c.req.param("speakerId"))
      : await c.env.DB.prepare(`SELECT sp.id, sp.name, sp.email, sp.published,
          COALESCE(ops.workflow_status, 'invited') AS workflowStatus
        FROM speaker_profiles sp
        LEFT JOIN speaker_operations ops ON ops.speaker_profile_id = sp.id AND ops.event_id = sp.event_id
        WHERE sp.id = ? AND sp.event_id = ? AND sp.user_id = ?`)
        .bind(c.req.param("speakerId"), c.req.param("eventId"), actor.id)
        .first<{ id: string; name: string; email: string; published: number; workflowStatus: SpeakerContentSpeaker["workflowStatus"] }>();
    if (!protectedFields) return jsonError(c, 404, "SPEAKER_NOT_FOUND", "This speaker profile is not available to your account.");
    body = {
      ...submitted,
      name: protectedFields.name,
      email: protectedFields.email,
      published: Boolean(protectedFields.published),
      workflowStatus: protectedFields.workflowStatus,
      travelDetails: "",
    };
  }
  if (actor.demo) return c.json({ data: { id: c.req.param("speakerId"), ...body, email: body.email.toLowerCase(), updated: true } });
  if (body.headshotUploadId) {
    const upload = await c.env.DB.prepare("SELECT id FROM uploads WHERE id = ? AND event_id = ? AND purpose = 'headshot' AND deleted_at IS NULL AND (? = 'organizer' OR owner_user_id = ?)")
      .bind(body.headshotUploadId, c.req.param("eventId"), actor.role, actor.id).first();
    if (!upload) return jsonError(c, 422, "HEADSHOT_NOT_FOUND", "Upload a valid headshot before saving this profile.");
  }
  const now = Date.now();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE speaker_profiles SET name = ?, email = ?, title = ?, company = ?, bio = ?, pronouns = ?, city = ?,
        headshot_upload_id = COALESCE(?, headshot_upload_id), profile_complete = CASE WHEN ? <> '' AND COALESCE(?, headshot_upload_id) IS NOT NULL THEN 1 ELSE 0 END,
        published = ?, updated_at = ?
      WHERE id = ? AND event_id = ? AND (? = 'organizer' OR user_id = ?)`)
      .bind(body.name, body.email.toLowerCase(), body.title, body.company, body.bio, body.pronouns ?? null, body.city ?? null,
        body.headshotUploadId ?? null, body.bio, body.headshotUploadId ?? null, body.published ? 1 : 0, now,
        c.req.param("speakerId"), c.req.param("eventId"), actor.role, actor.id),
    c.env.DB.prepare(`INSERT INTO speaker_operations
        (speaker_profile_id, event_id, workflow_status, social_links, travel_details, created_at, updated_at)
      SELECT id, event_id, ?, ?, ?, ?, ? FROM speaker_profiles WHERE id = ? AND event_id = ? AND (? = 'organizer' OR user_id = ?)
      ON CONFLICT(speaker_profile_id) DO UPDATE SET workflow_status = excluded.workflow_status,
        social_links = excluded.social_links,
        travel_details = CASE WHEN ? = 'organizer' THEN excluded.travel_details ELSE speaker_operations.travel_details END,
        updated_at = excluded.updated_at`)
      .bind(body.workflowStatus, JSON.stringify(body.socialLinks), body.travelDetails, now, now,
        c.req.param("speakerId"), c.req.param("eventId"), actor.role, actor.id, actor.role),
  ]);
  if (!result[0].meta.changes) return jsonError(c, 404, "SPEAKER_NOT_FOUND", "Speaker profile not found or not editable by you.");
  return c.json({ data: { id: c.req.param("speakerId"), ...body, email: body.email.toLowerCase(), updated: true } });
});

routes.delete("/api/v1/events/:eventId/speakers/:speakerId/manage", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  if (c.get("actor")!.demo) return c.json({ data: { id: c.req.param("speakerId"), deleted: true } });
  const linked = await c.env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM proposal_speakers WHERE speaker_profile_id = ?) +
      (SELECT COUNT(*) FROM session_speakers WHERE speaker_profile_id = ?) AS links`)
    .bind(c.req.param("speakerId"), c.req.param("speakerId")).first<{ links: number }>();
  if (Number(linked?.links ?? 0) > 0) return jsonError(c, 409, "SPEAKER_IN_USE", "Remove this speaker from their sessions and proposals before deleting the record.");
  const result = await c.env.DB.prepare("DELETE FROM speaker_profiles WHERE id = ? AND event_id = ?")
    .bind(c.req.param("speakerId"), c.req.param("eventId")).run();
  if (!result.meta.changes) return jsonError(c, 404, "SPEAKER_NOT_FOUND", "Speaker profile not found.");
  return c.json({ data: { id: c.req.param("speakerId"), deleted: true } });
});

routes.post("/api/v1/events/:eventId/speakers/import", zValidator("json", z.object({ csv: z.string().min(1).max(2_000_000) })), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  let rows;
  try {
    rows = parseSpeakerCsv(c.req.valid("json").csv);
  } catch (error) {
    return jsonError(c, 422, "CSV_INVALID", error instanceof Error ? error.message : "The CSV could not be read.");
  }
  if (!rows.length) return jsonError(c, 422, "CSV_EMPTY", "No valid speaker rows were found in the CSV.");
  if (c.get("actor")!.demo) return c.json({ data: { imported: rows.length, created: rows.length, merged: 0, speakers: rows } });
  const now = Date.now();
  const existing = await c.env.DB.prepare(`SELECT lower(email) AS email FROM speaker_profiles WHERE event_id = ? AND lower(email) IN (${rows.map(() => "lower(?)").join(",")})`)
    .bind(c.req.param("eventId"), ...rows.map((row) => row.email)).all<{ email: string }>();
  const existingEmails = new Set(existing.results.map((row) => row.email));
  const statements = rows.flatMap((row) => {
    const id = crypto.randomUUID();
    return [
      c.env.DB.prepare(`INSERT INTO speaker_profiles
        (id, user_id, event_id, name, email, title, company, bio, profile_complete, published, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
        ON CONFLICT(email, event_id) DO UPDATE SET
          name = excluded.name,
          title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE speaker_profiles.title END,
          company = CASE WHEN excluded.company <> '' THEN excluded.company ELSE speaker_profiles.company END,
          bio = CASE WHEN excluded.bio <> '' THEN excluded.bio ELSE speaker_profiles.bio END,
          updated_at = excluded.updated_at`)
        .bind(id, c.req.param("eventId"), row.name, row.email, row.title, row.company, row.bio, now, now),
      c.env.DB.prepare(`INSERT INTO speaker_operations
        (speaker_profile_id, event_id, workflow_status, social_links, travel_details, created_at, updated_at)
        SELECT id, event_id, 'invited', '{}', '', ?, ? FROM speaker_profiles WHERE event_id = ? AND lower(email) = lower(?)
        ON CONFLICT(speaker_profile_id) DO NOTHING`)
        .bind(now, now, c.req.param("eventId"), row.email),
    ];
  });
  await c.env.DB.batch(statements);
  const merged = rows.filter((row) => existingEmails.has(row.email)).length;
  return c.json({ data: { imported: rows.length, created: rows.length - merged, merged, speakers: rows } });
});

const bulkTaskSchema = z.object({
  title: z.string().trim().min(2).max(255),
  description: z.string().trim().min(2).max(5000),
  dueAt: z.string().datetime(),
  kind: z.enum(["general", "file_request"]),
  speakerIds: z.array(z.string().min(1)).min(1).max(500),
  sessionId: z.string().min(1).optional(),
});

routes.post("/api/v1/events/:eventId/speaker-tasks/bulk", zValidator("json", bulkTaskSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const speakerIds = [...new Set(body.speakerIds)];
  if (c.get("actor")!.demo) return c.json({ data: { created: speakerIds.length, taskIds: speakerIds.map(() => crypto.randomUUID()) } }, 201);
  const speakers = await c.env.DB.prepare(`SELECT id FROM speaker_profiles WHERE event_id = ? AND id IN (${speakerIds.map(() => "?").join(",")})`)
    .bind(c.req.param("eventId"), ...speakerIds).all<{ id: string }>();
  if (speakers.results.length !== speakerIds.length) return jsonError(c, 422, "SPEAKER_NOT_FOUND", "Every task assignee must be a speaker in this event.");
  let proposalId: string | null = null;
  if (body.sessionId) {
    const session = await c.env.DB.prepare("SELECT proposal_id AS proposalId FROM program_sessions WHERE id = ? AND event_id = ?")
      .bind(body.sessionId, c.req.param("eventId")).first<{ proposalId: string | null }>();
    if (!session) return jsonError(c, 422, "SESSION_NOT_FOUND", "The selected session does not belong to this event.");
    proposalId = session.proposalId;
  }
  const now = Date.now();
  const taskIds = speakerIds.map(() => crypto.randomUUID());
  const statements: D1PreparedStatement[] = [];
  let templateId: string | null = null;
  if (body.kind === "file_request") {
    templateId = crypto.randomUUID();
    const fileRequestId = crypto.randomUUID();
    const relativeDueDays = Math.max(0, Math.ceil((new Date(body.dueAt).getTime() - now) / 86_400_000));
    statements.push(
      c.env.DB.prepare(`INSERT INTO file_requests
        (id, event_id, title, instructions_html, target_type, required, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'contact', 1, 'published', ?, ?)`)
        .bind(fileRequestId, c.req.param("eventId"), body.title, body.description, now, now),
      c.env.DB.prepare(`INSERT INTO task_templates
        (id, event_id, title, description, type, target_type, completion_mode, relative_due_days,
         external_url, form_version_id, file_request_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'upload', 'contact', 'file_request', ?, NULL, NULL, ?, ?, ?)`)
        .bind(templateId, c.req.param("eventId"), body.title, body.description, relativeDueDays, fileRequestId, now, now),
    );
  }
  statements.push(...speakerIds.map((speakerId, index) => c.env.DB.prepare(`INSERT INTO speaker_tasks
      (id, event_id, template_id, speaker_profile_id, proposal_id, title, description, type, status, due_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'not_started', ?, ?, ?)`)
    .bind(taskIds[index], c.req.param("eventId"), templateId, speakerId, proposalId, body.title, body.description,
      body.kind === "file_request" ? "upload" : "profile", new Date(body.dueAt).getTime(), now, now)));
  await c.env.DB.batch(statements);
  return c.json({ data: { created: taskIds.length, taskIds } }, 201);
});

const sessionContentSchema = z.object({
  title: z.string().trim().min(2).max(500),
  description: z.string().trim().max(20_000),
  contentStatus: z.enum(["draft", "in_review", "approved"]),
  speakerIds: z.array(z.string().min(1)).max(50),
});

async function nextRevisionVersion(db: D1Database, eventId: string, sessionId: string) {
  const row = await db.prepare("SELECT COALESCE(MAX(version), 0) + 1 AS version FROM content_revisions WHERE event_id = ? AND entity_type = 'session' AND entity_id = ?")
    .bind(eventId, sessionId).first<{ version: number }>();
  return Number(row?.version ?? 1);
}

routes.put("/api/v1/events/:eventId/sessions/:sessionId/content", zValidator("json", sessionContentSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const actor = c.get("actor")!;
  if (actor.demo) return c.json({ data: { id: c.req.param("sessionId"), ...body, version: 1 } });
  const session = await c.env.DB.prepare("SELECT id, title, description FROM program_sessions WHERE id = ? AND event_id = ?")
    .bind(c.req.param("sessionId"), c.req.param("eventId")).first<{ id: string; title: string; description: string }>();
  if (!session) return jsonError(c, 404, "SESSION_NOT_FOUND", "Session not found.");
  const speakerIds = [...new Set(body.speakerIds)];
  if (speakerIds.length) {
    const matched = await c.env.DB.prepare(`SELECT id FROM speaker_profiles WHERE event_id = ? AND id IN (${speakerIds.map(() => "?").join(",")})`)
      .bind(c.req.param("eventId"), ...speakerIds).all();
    if (matched.results.length !== speakerIds.length) return jsonError(c, 422, "SPEAKER_NOT_FOUND", "Every assigned speaker must belong to this event.");
  }
  const currentMax = await c.env.DB.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM content_revisions WHERE event_id = ? AND entity_type = 'session' AND entity_id = ?")
    .bind(c.req.param("eventId"), session.id).first<{ version: number }>();
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  let nextVersion = Number(currentMax?.version ?? 0) + 1;
  if (nextVersion === 1) {
    statements.push(c.env.DB.prepare(`INSERT INTO content_revisions
      (id, event_id, entity_type, entity_id, version, snapshot, editor_user_id, editor_name, restored_from_version, created_at)
      VALUES (?, ?, 'session', ?, 1, ?, ?, ?, NULL, ?)`)
      .bind(crypto.randomUUID(), c.req.param("eventId"), session.id, JSON.stringify({ title: session.title, description: session.description }), actor.id, actor.name, now));
    nextVersion = 2;
  }
  statements.push(
    c.env.DB.prepare(`UPDATE program_sessions
      SET title = ?, description = ?,
          calendar_sequence = calendar_sequence + CASE WHEN status IN ('scheduled', 'published') THEN 1 ELSE 0 END,
          version = version + 1, updated_at = ?
      WHERE id = ? AND event_id = ?`)
      .bind(body.title, body.description, now, session.id, c.req.param("eventId")),
    c.env.DB.prepare(`INSERT INTO session_content_status (session_id, event_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`)
      .bind(session.id, c.req.param("eventId"), body.contentStatus, now, now),
    c.env.DB.prepare("DELETE FROM session_speakers WHERE session_id = ?").bind(session.id),
    ...speakerIds.map((speakerId) => c.env.DB.prepare("INSERT INTO session_speakers (session_id, speaker_profile_id) VALUES (?, ?)").bind(session.id, speakerId)),
    c.env.DB.prepare(`INSERT INTO content_revisions
      (id, event_id, entity_type, entity_id, version, snapshot, editor_user_id, editor_name, restored_from_version, created_at)
      VALUES (?, ?, 'session', ?, ?, ?, ?, ?, NULL, ?)`)
      .bind(crypto.randomUUID(), c.req.param("eventId"), session.id, nextVersion, JSON.stringify({ title: body.title, description: body.description }), actor.id, actor.name, now + 1),
  );
  await c.env.DB.batch(statements);
  return c.json({ data: { id: session.id, ...body, version: nextVersion } });
});

routes.post("/api/v1/events/:eventId/sessions/:sessionId/content/restore/:revisionId", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const actor = c.get("actor")!;
  if (actor.demo) return c.json({ data: { id: c.req.param("sessionId"), restored: true, restoredFromVersion: 1 } });
  const revision = await c.env.DB.prepare(`SELECT id, version, snapshot FROM content_revisions
    WHERE id = ? AND event_id = ? AND entity_type = 'session' AND entity_id = ?`)
    .bind(c.req.param("revisionId"), c.req.param("eventId"), c.req.param("sessionId"))
    .first<{ id: string; version: number; snapshot: string }>();
  if (!revision) return jsonError(c, 404, "REVISION_NOT_FOUND", "That session revision is not available.");
  const snapshot = parseJson<{ title?: string; description?: string }>(revision.snapshot, {});
  if (!snapshot.title || typeof snapshot.description !== "string") return jsonError(c, 409, "REVISION_INVALID", "That revision cannot be restored safely.");
  const session = await c.env.DB.prepare("SELECT id FROM program_sessions WHERE id = ? AND event_id = ?")
    .bind(c.req.param("sessionId"), c.req.param("eventId")).first();
  if (!session) return jsonError(c, 404, "SESSION_NOT_FOUND", "Session not found.");
  const version = await nextRevisionVersion(c.env.DB, c.req.param("eventId"), c.req.param("sessionId"));
  const now = Date.now();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE program_sessions
      SET title = ?, description = ?,
          calendar_sequence = calendar_sequence + CASE WHEN status IN ('scheduled', 'published') THEN 1 ELSE 0 END,
          version = version + 1, updated_at = ?
      WHERE id = ? AND event_id = ?`)
      .bind(snapshot.title, snapshot.description, now, c.req.param("sessionId"), c.req.param("eventId")),
    c.env.DB.prepare(`INSERT INTO content_revisions
      (id, event_id, entity_type, entity_id, version, snapshot, editor_user_id, editor_name, restored_from_version, created_at)
      VALUES (?, ?, 'session', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), c.req.param("eventId"), c.req.param("sessionId"), version, JSON.stringify(snapshot), actor.id, actor.name, revision.version, now),
  ]);
  return c.json({ data: { id: c.req.param("sessionId"), restored: true, restoredFromVersion: revision.version, version, ...snapshot } });
});

const communicationSchema = z.object({
  kind: z.enum(["invitation", "general", "task_reminder"]),
  recipientIds: z.array(z.string().min(1)).min(1).max(500),
  subject: z.string().trim().min(2).max(500),
  bodyTemplate: z.string().trim().min(2).max(20_000),
});

routes.post("/api/v1/events/:eventId/speaker-communications/record", zValidator("json", communicationSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const actor = c.get("actor")!;
  const snapshot = actor.demo
    ? demoSnapshot(actor.id, c.req.param("eventId"))
    : await loadPersistedSnapshot(c.env.DB, c.req.param("eventId"), actor);
  const recipients = snapshot.speakers.filter((speaker) => body.recipientIds.includes(speaker.id));
  if (recipients.length !== new Set(body.recipientIds).size) return jsonError(c, 422, "RECIPIENT_NOT_FOUND", "Every recipient must be a speaker in this event.");
  const portalUrl = `${new URL(c.req.url).origin}/portal/home?eventId=${encodeURIComponent(c.req.param("eventId"))}&role=speaker`;
  const renderedPreviews = recipients.map((speaker) => ({
    speakerId: speaker.id,
    speakerName: speaker.name,
    body: renderSpeakerTemplate(body.bodyTemplate, speaker, portalUrl),
  }));
  const id = crypto.randomUUID();
  const now = Date.now();
  let dispatched = 0;
  if (!actor.demo) {
    const jobs: OutboxJob[] = recipients.map((speaker) => {
      const renderedBody = renderSpeakerTemplate(body.bodyTemplate, speaker, portalUrl);
      const renderedSubject = renderSpeakerTemplate(body.subject, speaker, portalUrl);
      return {
        kind: "email",
        idempotencyKey: `speaker-${body.kind}:${c.req.param("eventId")}:${id}:${speaker.id}`,
        payload: {
          kind: "communication",
          communicationKind: body.kind === "task_reminder" ? "reminder" : "operational_email",
          eventId: c.req.param("eventId"),
          recipient: speaker.email,
          recipientName: speaker.name,
          subject: renderedSubject,
          text: renderedBody,
          html: `<p>${escapeHtml(renderedBody).replaceAll("\n", "<br>")}</p>`,
        },
      };
    });
    await persistOutboxJobs(c.env.DB, jobs, now);
    await c.env.DB.prepare(`INSERT INTO speaker_communication_logs
      (id, event_id, kind, recipient_ids, recipient_names, subject, body_template, rendered_previews,
       delivery_mode, status, actor_user_id, actor_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queue', 'queued', ?, ?, ?)`)
      .bind(id, c.req.param("eventId"), body.kind, JSON.stringify(recipients.map((speaker) => speaker.id)),
        JSON.stringify(recipients.map((speaker) => speaker.name)), body.subject, body.bodyTemplate,
        JSON.stringify(renderedPreviews), actor.id, actor.name, now).run();
    if (c.env.JOBS_QUEUE) {
      dispatched = await dispatchPersistedJobs(c.env.JOBS_QUEUE, jobs, (job, error) => {
        console.error(JSON.stringify({ event: "speaker.communication.dispatch_failed", eventId: c.req.param("eventId"), idempotencyKey: job.idempotencyKey, error: error instanceof Error ? error.message : String(error) }));
      });
    }
  }
  return c.json({ data: {
    id,
    recorded: recipients.length,
    queued: actor.demo ? 0 : recipients.length,
    dispatched,
    status: actor.demo ? "recorded" : "queued",
    deliveryMode: actor.demo ? "sandbox" : "queue",
    createdAt: new Date(now).toISOString(),
    renderedPreviews,
  } }, 201);
});

routes.post("/api/v1/events/:eventId/files/export", zValidator("json", z.object({ taskIds: z.array(z.string().min(1)).min(1).max(500) })), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const taskIds = [...new Set(c.req.valid("json").taskIds)];
  const query = new URLSearchParams();
  taskIds.forEach((id) => query.append("taskId", id));
  return c.json({ data: {
    status: "ready",
    selected: taskIds.length,
    grouping: "session",
    downloadUrl: `/api/v1/events/${encodeURIComponent(c.req.param("eventId"))}/files/export.zip?${query}`,
  } }, 202);
});

routes.get("/api/v1/events/:eventId/files/export.zip", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const taskIds = [...new Set(c.req.queries("taskId") ?? [])].filter(Boolean).slice(0, 500);
  if (!taskIds.length) return jsonError(c, 422, "FILES_REQUIRED", "Select at least one file for the export.");
  if (c.get("actor")!.demo) return jsonError(c, 404, "DEMO_UPLOAD_NOT_STORED", "Demo files are not persisted; use a production-backed workspace to verify ZIP contents.");
  const rows = await c.env.DB.prepare(`SELECT st.id AS taskId, uploaded.object_key AS objectKey,
      uploaded.file_name AS fileName, uploaded.created_at AS uploadedAt,
      COALESCE(ps.title, proposal.title, st.title) AS sessionTitle, sp.name AS speakerName
    FROM speaker_tasks st
    JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id AND sp.event_id = st.event_id
    JOIN uploads uploaded ON uploaded.id = st.artifact_upload_id AND uploaded.event_id = st.event_id AND uploaded.deleted_at IS NULL
    LEFT JOIN proposals proposal ON proposal.id = st.proposal_id AND proposal.event_id = st.event_id
    LEFT JOIN program_sessions ps ON ps.proposal_id = st.proposal_id AND ps.event_id = st.event_id
    WHERE st.event_id = ? AND st.id IN (${taskIds.map(() => "?").join(",")})
    ORDER BY lower(COALESCE(ps.title, proposal.title, st.title)), lower(sp.name), uploaded.created_at DESC`)
    .bind(c.req.param("eventId"), ...taskIds)
    .all<{ taskId: string; objectKey: string; fileName: string; uploadedAt: number; sessionTitle: string; speakerName: string }>();
  if (!rows.results.length) return jsonError(c, 404, "FILES_NOT_FOUND", "No current uploaded files were found for the selection.");
  const entries = [];
  for (const row of rows.results) {
    const object = await c.env.UPLOADS.get(row.objectKey);
    if (!object) return jsonError(c, 404, "UPLOAD_OBJECT_NOT_FOUND", `The latest file for ${row.speakerName} is unavailable.`);
    const folder = safeZipSegment(row.sessionTitle, "Unassigned session");
    const speaker = safeZipSegment(row.speakerName, "Speaker");
    const file = safeZipSegment(row.fileName, "deliverable");
    entries.push({ name: `${folder}/${speaker}/${file}`, data: new Uint8Array(await object.arrayBuffer()), modifiedAt: new Date(Number(row.uploadedAt)) });
  }
  const archive = createStoredZip(entries);
  c.header("content-type", "application/zip");
  c.header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`speaker-deliverables-${new Date().toISOString().slice(0, 10)}.zip`)}`);
  c.header("cache-control", "private, no-store");
  return c.body(archive.buffer as ArrayBuffer);
});

export default routes;
