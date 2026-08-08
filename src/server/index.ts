import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { createAuth } from "./auth";
import type { AppEnv } from "./env";
import { jsonError, requestContext, requireActor, requireRole } from "./http";
import { createDemoWorkspace } from "../shared/demo-data";
import { detectScheduleConflicts } from "./schedule";
import { formAvailability, validateFormResponses } from "./forms";
import type { FormField } from "../shared/domain";
import { loadWorkspace } from "./workspace";
import {
  auditProposalDecisionSql,
  isProfileComplete,
  publishFormEventSql,
  publishFormVersionSql,
  publishSubmissionFormSql,
  reopenSpeakerTaskSql,
  reopenTaskResponseSql,
  updateProposalDecisionSql,
} from "./mutations";

const app = new Hono<AppEnv>();

app.use("*", requestContext);

app.get("/api/health", (c) => c.json({ status: "ok", service: "conference-ops", environment: c.env.ENVIRONMENT }));

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

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character]!);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

app.get("/api/v1/public/events/:slug", async (c) => {
  if (c.env.DEMO_MODE === "true") {
    const workspace = createDemoWorkspace("user-applicant");
    if (workspace.event.slug !== c.req.param("slug")) return jsonError(c, 404, "EVENT_NOT_FOUND", "This public event is not available.");
    const sessions = workspace.sessions
      .filter((session) => session.status === "published" || session.status === "scheduled")
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
    return c.json({ data: { event: workspace.event, form: workspace.forms.find((form) => form.status === "published"), sessions, speakers: workspace.proposals.filter((proposal) => proposal.status === "accepted").flatMap((proposal) => proposal.speakers), resources: workspace.resources.filter((resource) => resource.status === "published") } });
  }
  const event = await c.env.DB.prepare("SELECT id, slug, name, short_name AS shortName, description, timezone, starts_at AS startsAt, ends_at AS endsAt, cfp_closes_at AS cfpClosesAt, venue, website_url AS websiteUrl, accent, status FROM events WHERE slug = ? AND deleted_at IS NULL")
    .bind(c.req.param("slug"))
    .first<Record<string, unknown>>();
  if (!event) return jsonError(c, 404, "EVENT_NOT_FOUND", "This public event is not available.");
  const form = await c.env.DB.prepare("SELECT sf.id, sf.name, sf.slug, sf.status, sf.published_version AS version, sf.submission_type AS submissionType, sf.collects_participants AS collectsParticipants, sf.max_submissions_per_user AS maxSubmissionsPerUser, sf.redirect_to_portal AS redirectToPortal, sf.confirmation_email_enabled AS confirmationEmailEnabled, sf.closes_at AS closesAt, fv.public_title AS publicTitle, fv.page_heading AS pageHeading, fv.welcome_title AS welcomeTitle, fv.welcome_copy AS welcomeCopy, fv.confirmation_copy AS confirmationCopy, fv.max_speakers AS maxSpeakers, fv.allow_multiple_drafts AS allowMultipleDrafts, fv.fields FROM submission_forms sf JOIN form_versions fv ON fv.form_id = sf.id AND fv.version = sf.published_version WHERE sf.event_id = ? AND sf.status = 'published' ORDER BY sf.created_at LIMIT 1")
    .bind(event.id)
    .first<Record<string, unknown>>();
  const sessions = await c.env.DB.prepare("SELECT ps.id, ps.title, ps.description, ps.starts_at AS startsAt, ps.ends_at AS endsAt, ps.status, t.id AS trackId, t.name AS trackName, t.color AS trackColor, r.id AS roomId, r.name AS roomName FROM program_sessions ps LEFT JOIN tracks t ON t.id = ps.track_id LEFT JOIN rooms r ON r.id = ps.room_id WHERE ps.event_id = ? AND ps.status = 'published' ORDER BY ps.starts_at")
    .bind(event.id)
    .all<Record<string, unknown>>();
  const speakers = await c.env.DB.prepare("SELECT DISTINCT sp.id, sp.name, sp.title, sp.company, sp.bio, sp.pronouns, sp.city, up.object_key AS headshotKey FROM speaker_profiles sp LEFT JOIN uploads up ON up.id = sp.headshot_upload_id JOIN session_speakers ss ON ss.speaker_profile_id = sp.id JOIN program_sessions ps ON ps.id = ss.session_id WHERE sp.event_id = ? AND sp.published = 1 AND ps.status = 'published' ORDER BY sp.name")
    .bind(event.id)
    .all<Record<string, unknown>>();
  return c.json({ data: { event, form: form ? { ...form, fields: parseJson<FormField[]>(form.fields, []) } : null, sessions: sessions.results, speakers: speakers.results } });
});

app.use("/api/v1/*", requireActor);

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
  description: z.string().max(1000),
  timezone: z.string().min(1).max(100),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  venue: z.string().trim().max(500),
  websiteUrl: z.union([z.url(), z.literal("")]),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/),
});
app.put("/api/v1/events/:eventId", zValidator("json", eventDetailsSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  if (new Date(body.startsAt) >= new Date(body.endsAt)) return jsonError(c, 422, "INVALID_EVENT_INTERVAL", "Event end time must be after its start time.", { endsAt: "Choose a later end time." });
  try {
    Intl.DateTimeFormat("en-US", { timeZone: body.timezone }).format(new Date());
  } catch {
    return jsonError(c, 422, "INVALID_TIMEZONE", "Choose a valid IANA timezone.", { timezone: "Use a timezone such as America/Los_Angeles." });
  }
  if (c.get("actor")?.demo) return c.json({ data: { id: c.req.param("eventId"), ...body, updatedAt: new Date().toISOString() } });
  const result = await c.env.DB.prepare("UPDATE events SET name = ?, short_name = ?, description = ?, timezone = ?, starts_at = ?, ends_at = ?, venue = ?, website_url = ?, accent = ?, updated_at = ? WHERE id = ?")
    .bind(body.name, body.shortName, body.description, body.timezone, new Date(body.startsAt).getTime(), new Date(body.endsAt).getTime(), body.venue, body.websiteUrl || null, body.accent, Date.now(), c.req.param("eventId")).run();
  if (!result.meta.changes) return jsonError(c, 404, "EVENT_NOT_FOUND", "Event not found.");
  return c.json({ data: { id: c.req.param("eventId"), ...body, updatedAt: new Date().toISOString() } });
});

const enrollSchema = z.object({ eventId: z.string().min(1) });
app.post("/api/v1/enroll", zValidator("json", enrollSchema), async (c) => {
  const actor = c.get("actor")!;
  const { eventId } = c.req.valid("json");
  if (actor.demo) return c.json({ data: { eventId, role: "applicant", enrolled: true } }, 201);
  const event = await c.env.DB.prepare("SELECT id FROM events WHERE id = ? AND deleted_at IS NULL").bind(eventId).first();
  if (!event) return jsonError(c, 404, "EVENT_NOT_FOUND", "This event is not available.");
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
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT OR IGNORE INTO event_memberships (event_id, user_id, role, invited_by, accepted_at, created_at) SELECT event_id, ?, role, invited_by, ?, ? FROM event_invitations WHERE id = ?").bind(actor.id, now, now, invitation.id),
    c.env.DB.prepare("UPDATE event_invitations SET accepted_at = ? WHERE id = ? AND accepted_at IS NULL").bind(now, invitation.id),
  ]);
  return c.json({ data: { accepted: true, eventId: invitation.eventId, role: invitation.role } });
});

const invitationCreateSchema = z.object({ email: z.email(), role: z.enum(["organizer", "reviewer"]) });
app.post("/api/v1/events/:eventId/invitations", zValidator("json", invitationCreateSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  if (!c.env.JOBS_QUEUE && !c.get("actor")?.demo) return jsonError(c, 503, "QUEUE_UNAVAILABLE", "Email delivery must be configured before inviting staff.");
  const body = c.req.valid("json");
  const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
  const invitationId = crypto.randomUUID();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  if (!c.get("actor")?.demo) {
    await c.env.DB.prepare("INSERT INTO event_invitations (id, event_id, email, role, token_hash, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(invitationId, c.req.param("eventId"), body.email.toLowerCase(), body.role, await sha256(token), c.get("actor")!.id, expiresAt, Date.now()).run();
    const event = await c.env.DB.prepare("SELECT name FROM events WHERE id = ?").bind(c.req.param("eventId")).first<{ name: string }>();
    const link = `${c.env.PUBLIC_APP_URL.replace(/\/$/, "")}/invite/${encodeURIComponent(token)}`;
    await c.env.JOBS_QUEUE!.send({ kind: "email", idempotencyKey: `invitation:${invitationId}`, payload: { kind: "communication", eventId: c.req.param("eventId"), recipient: body.email, subject: `Join ${event?.name ?? "Conference Ops"} as ${body.role}`, text: `You have been invited to help run ${event?.name ?? "this event"}. Accept your invitation: ${link}`, html: `<p>You have been invited to help run ${escapeHtml(event?.name ?? "this event")} as ${body.role}.</p><p><a href="${link}">Accept invitation</a></p>` } });
  }
  return c.json({ data: { id: invitationId, email: body.email, role: body.role, expiresAt: new Date(expiresAt).toISOString(), status: "sent" } }, 201);
});

const submissionSchema = z.object({
  formId: z.string().min(1),
  title: z.string().trim().min(3).max(255),
  summary: z.string().trim().min(20).max(5000),
  category: z.string().trim().min(1).max(255),
  format: z.enum(["talk", "workshop", "panel", "lightning"]),
  durationMinutes: z.number().int().min(5).max(240),
  level: z.enum(["introductory", "intermediate", "advanced"]),
  responses: z.record(z.string(), z.unknown()),
  speakers: z.array(z.object({ name: z.string().trim().min(2).max(255), email: z.email(), title: z.string().max(255).default(""), company: z.string().max(255).default(""), bio: z.string().max(5000).default("") })).min(1).max(12),
  submit: z.boolean().default(false),
});

app.post("/api/v1/events/:eventId/submissions", zValidator("json", submissionSchema), async (c) => {
  const actor = c.get("actor")!;
  const body = c.req.valid("json");
  if (actor.demo) {
    return c.json({ data: { id: `proposal-${crypto.randomUUID()}`, eventId: c.req.param("eventId"), status: body.submit ? "submitted" : "draft", submittedAt: body.submit ? new Date().toISOString() : null, ...body } }, 201);
  }
  const form = await c.env.DB.prepare("SELECT sf.id, sf.status, sf.closes_at AS closesAt, sf.max_submissions_per_user AS maxSubmissionsPerUser, sf.confirmation_email_enabled AS confirmationEmailEnabled, fv.id AS formVersionId, fv.max_speakers AS maxSpeakers, fv.allow_multiple_drafts AS allowMultipleDrafts, fv.confirmation_copy AS confirmationCopy, fv.fields FROM submission_forms sf JOIN form_versions fv ON fv.form_id = sf.id AND fv.version = sf.published_version WHERE sf.id = ? AND sf.event_id = ?")
    .bind(body.formId, c.req.param("eventId"))
    .first<Record<string, unknown>>();
  if (!form) return jsonError(c, 404, "FORM_NOT_FOUND", "The submission form was not found.");
  const normalizedEmails = body.speakers.map((speaker) => speaker.email.trim().toLowerCase());
  if (new Set(normalizedEmails).size !== normalizedEmails.length) return jsonError(c, 422, "DUPLICATE_SPEAKER", "Each speaker must have a different email address.");
  const counts = await c.env.DB.prepare("SELECT SUM(CASE WHEN p.status = 'draft' THEN 1 ELSE 0 END) AS drafts, SUM(CASE WHEN p.status <> 'draft' THEN 1 ELSE 0 END) AS submitted FROM proposals p JOIN form_versions fv ON fv.id = p.form_version_id WHERE fv.form_id = ? AND p.owner_user_id = ?")
    .bind(body.formId, actor.id)
    .first<{ drafts: number | null; submitted: number | null }>();
  const availability = formAvailability(
    { status: String(form.status) as "draft" | "published" | "closed", closesAt: form.closesAt ? new Date(Number(form.closesAt)).toISOString() : undefined, maxSubmissionsPerUser: form.maxSubmissionsPerUser ? Number(form.maxSubmissionsPerUser) : undefined, allowMultipleDrafts: Boolean(form.allowMultipleDrafts) },
    { drafts: Number(counts?.drafts ?? 0), submitted: Number(counts?.submitted ?? 0) },
  );
  if (!availability.available) return jsonError(c, 409, availability.code, "This form is not accepting another submission from this account.");
  if (body.speakers.length > Number(form.maxSpeakers)) return jsonError(c, 422, "SPEAKER_LIMIT", `This form allows up to ${form.maxSpeakers} speakers.`);
  if (body.submit) {
    const fieldErrors = validateFormResponses(parseJson<FormField[]>(form.fields, []), body.responses);
    if (Object.keys(fieldErrors).length) return jsonError(c, 422, "FORM_VALIDATION_FAILED", "Review the highlighted submission fields.", fieldErrors);
  }

  const proposalId = crypto.randomUUID();
  const reviewerGroup = await c.env.DB.prepare("SELECT id FROM reviewer_groups WHERE event_id = ? AND lower(category) = lower(?) ORDER BY created_at LIMIT 1").bind(c.req.param("eventId"), body.category).first<{ id: string }>();
  const activeRound = body.submit ? await c.env.DB.prepare("SELECT id FROM review_rounds WHERE event_id = ? AND status = 'active' ORDER BY round LIMIT 1").bind(c.req.param("eventId")).first<{ id: string }>() : null;
  const reviewerMembers = reviewerGroup && activeRound ? await c.env.DB.prepare("SELECT user_id AS id FROM reviewer_group_members WHERE reviewer_group_id = ?").bind(reviewerGroup.id).all<{ id: string }>() : { results: [] as { id: string }[] };
  const proposalStatus = body.submit ? (reviewerMembers.results.length ? "under_review" : "submitted") : "draft";
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  const speakerIds: string[] = [];
  for (const [index, speaker] of body.speakers.entries()) {
    const existing = await c.env.DB.prepare("SELECT id, user_id AS userId FROM speaker_profiles WHERE event_id = ? AND (lower(email) = lower(?) OR (? = 0 AND user_id = ?)) LIMIT 1")
      .bind(c.req.param("eventId"), speaker.email, index, actor.id)
      .first<{ id: string; userId: string | null }>();
    const speakerId = existing?.id ?? crypto.randomUUID();
    speakerIds.push(speakerId);
    if (!existing) {
      statements.push(c.env.DB.prepare("INSERT INTO speaker_profiles (id, user_id, event_id, name, email, title, company, bio, profile_complete, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)").bind(speakerId, index === 0 ? actor.id : null, c.req.param("eventId"), speaker.name, speaker.email.toLowerCase(), speaker.title, speaker.company, speaker.bio, now, now));
    } else if (index === 0 && !existing.userId) {
      statements.push(c.env.DB.prepare("UPDATE speaker_profiles SET user_id = ?, name = ?, title = ?, company = ?, bio = ?, updated_at = ? WHERE id = ?").bind(actor.id, speaker.name, speaker.title, speaker.company, speaker.bio, now, speakerId));
    }
  }
  statements.push(
    c.env.DB.prepare("INSERT INTO proposals (id, event_id, form_version_id, owner_user_id, reviewer_group_id, title, summary, category, format, duration_minutes, level, responses, status, submitted_at, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
      .bind(proposalId, c.req.param("eventId"), String(form.formVersionId), actor.id, reviewerGroup?.id ?? null, body.title, body.summary, body.category, body.format, body.durationMinutes, body.level, JSON.stringify(body.responses), proposalStatus, body.submit ? now : null, now, now),
  );
  for (const [index, speakerId] of speakerIds.entries()) statements.push(c.env.DB.prepare("INSERT INTO proposal_speakers (proposal_id, speaker_profile_id, sort_order) VALUES (?, ?, ?)").bind(proposalId, speakerId, index));
  if (activeRound) {
    for (const reviewer of reviewerMembers.results) statements.push(c.env.DB.prepare("INSERT INTO review_assignments (id, proposal_id, round_id, reviewer_user_id, status, scores, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', '{}', ?, ?)").bind(crypto.randomUUID(), proposalId, activeRound.id, reviewer.id, now, now));
  }
  let confirmationJob: { kind: "email"; idempotencyKey: string; payload: Record<string, unknown> } | null = null;
  if (body.submit && Boolean(form.confirmationEmailEnabled) && c.env.JOBS_QUEUE) {
    const primarySpeaker = body.speakers[0];
    const event = await c.env.DB.prepare("SELECT name FROM events WHERE id = ?")
      .bind(c.req.param("eventId"))
      .first<{ name: string }>();
    const eventName = event?.name ?? "Conference Ops";
    const portalUrl = `${c.env.PUBLIC_APP_URL.replace(/\/$/, "")}/portal/home`;
    const confirmationCopy = String(form.confirmationCopy ?? "Your proposal is now in the review queue.");
    confirmationJob = {
      kind: "email",
      idempotencyKey: `submission-confirmation:${proposalId}`,
      payload: {
        kind: "communication",
        eventId: c.req.param("eventId"),
        recipient: primarySpeaker.email.toLowerCase(),
        recipientName: primarySpeaker.name,
        subject: `We received your ${eventName} proposal`,
        text: `Hi ${primarySpeaker.name},\n\n${confirmationCopy}\n\nOpen your speaker portal: ${portalUrl}`,
        html: `<p>Hi ${escapeHtml(primarySpeaker.name)},</p><p>${escapeHtml(confirmationCopy)}</p><p><a href="${escapeHtml(portalUrl)}">Open your speaker portal</a></p>`,
      },
    };
    // Persist the notification intent in the same atomic D1 batch as the
    // proposal. The immediate Queue send below is only the fast path; Cron can
    // recover this row if Queue transport is temporarily unavailable.
    statements.push(c.env.DB.prepare("INSERT INTO outbox (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at) VALUES (?, ?, 'email', ?, ?, 'queued', 0, ?, ?, ?)")
      .bind(crypto.randomUUID(), c.req.param("eventId"), confirmationJob.idempotencyKey, JSON.stringify(confirmationJob.payload), now, now, now));
  }
  await c.env.DB.batch(statements);

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
  const proposal = await c.env.DB.prepare(`SELECT p.id, p.status, p.version, fv.fields, fv.confirmation_copy AS confirmationCopy, sf.status AS formStatus, sf.closes_at AS closesAt, sf.confirmation_email_enabled AS confirmationEmailEnabled, fv.max_speakers AS maxSpeakers, e.name AS eventName
    FROM proposals p JOIN form_versions fv ON fv.id = p.form_version_id JOIN submission_forms sf ON sf.id = fv.form_id JOIN events e ON e.id = p.event_id
    WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ?`)
    .bind(c.req.param("proposalId"), c.req.param("eventId"), actor.id).first<Record<string, unknown>>();
  if (!proposal) return jsonError(c, 404, "SUBMISSION_NOT_FOUND", "Submission not found or not editable by you.");
  if (["accepted", "rejected", "session", "withdrawn"].includes(String(proposal.status))) return jsonError(c, 409, "SUBMISSION_LOCKED", "This submission can no longer be edited.");
  if (Number(proposal.version) !== body.expectedVersion) return jsonError(c, 409, "SUBMISSION_VERSION_CONFLICT", "This submission changed in another tab. Refresh before saving.");
  if (body.speakers.length > Number(proposal.maxSpeakers)) return jsonError(c, 422, "SPEAKER_LIMIT", `This form allows up to ${proposal.maxSpeakers} speakers.`);
  if (body.submit && (String(proposal.formStatus) !== "published" || (proposal.closesAt && Date.now() > Number(proposal.closesAt)))) return jsonError(c, 409, "FORM_CLOSED", "The call for proposals closed before this draft could be submitted.");
  if (body.submit) {
    const fieldErrors = validateFormResponses(parseJson<FormField[]>(proposal.fields, []), body.responses);
    if (Object.keys(fieldErrors).length) return jsonError(c, 422, "FORM_VALIDATION_FAILED", "Review the highlighted submission fields.", fieldErrors);
  }
  const now = Date.now();
  const reviewerGroup = await c.env.DB.prepare("SELECT id FROM reviewer_groups WHERE event_id = ? AND lower(category) = lower(?) ORDER BY created_at LIMIT 1").bind(c.req.param("eventId"), body.category).first<{ id: string }>();
  const primary = body.speakers[0];
  let confirmationJob: { kind: "email"; idempotencyKey: string; payload: Record<string, unknown> } | null = null;
  if (body.submit && proposal.status === "draft" && Boolean(proposal.confirmationEmailEnabled) && c.env.JOBS_QUEUE) {
    const portalUrl = `${c.env.PUBLIC_APP_URL.replace(/\/$/, "")}/portal/home`;
    const confirmationCopy = String(proposal.confirmationCopy ?? "Your proposal is now in the review queue.");
    confirmationJob = {
      kind: "email",
      idempotencyKey: `submission-confirmation:${proposal.id}`,
      payload: {
        kind: "communication",
        eventId: c.req.param("eventId"),
        recipient: primary.email.toLowerCase(),
        recipientName: primary.name,
        subject: `We received your ${String(proposal.eventName ?? "Conference Ops")} proposal`,
        text: `Hi ${primary.name},\n\n${confirmationCopy}\n\nOpen your speaker portal: ${portalUrl}`,
        html: `<p>Hi ${escapeHtml(primary.name)},</p><p>${escapeHtml(confirmationCopy)}</p><p><a href="${escapeHtml(portalUrl)}">Open your speaker portal</a></p>`,
      },
    };
  }
  const updateStatements = [
    c.env.DB.prepare("UPDATE proposals SET reviewer_group_id = ?, title = ?, summary = ?, category = ?, format = ?, duration_minutes = ?, level = ?, responses = ?, status = CASE WHEN ? = 1 THEN 'submitted' ELSE status END, submitted_at = CASE WHEN ? = 1 THEN COALESCE(submitted_at, ?) ELSE submitted_at END, version = version + 1, updated_at = ? WHERE id = ? AND event_id = ? AND owner_user_id = ? AND version = ?")
      .bind(reviewerGroup?.id ?? null, body.title, body.summary, body.category, body.format, body.durationMinutes, body.level, JSON.stringify(body.responses), body.submit ? 1 : 0, body.submit ? 1 : 0, now, now, proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion),
  ];
  if (confirmationJob) {
    updateStatements.push(c.env.DB.prepare(`INSERT OR IGNORE INTO outbox (id, event_id, kind, idempotency_key, payload, status, attempts, available_at, created_at, updated_at)
      SELECT ?, p.event_id, 'email', ?, ?, 'queued', 0, ?, ?, ? FROM proposals p
      WHERE p.id = ? AND p.event_id = ? AND p.owner_user_id = ? AND p.version = ? AND p.status = 'submitted'`)
      .bind(crypto.randomUUID(), confirmationJob.idempotencyKey, JSON.stringify(confirmationJob.payload), now, now, now, proposal.id, c.req.param("eventId"), actor.id, body.expectedVersion + 1));
  }
  const [result] = await c.env.DB.batch(updateStatements);
  if (!result.meta.changes) return jsonError(c, 409, "SUBMISSION_VERSION_CONFLICT", "This submission changed before it could be saved.");
  await c.env.DB.prepare("UPDATE speaker_profiles SET name = ?, email = ?, title = ?, company = ?, bio = ?, updated_at = ? WHERE event_id = ? AND user_id = ?")
    .bind(primary.name, primary.email.toLowerCase(), primary.title, primary.company, primary.bio, now, c.req.param("eventId"), actor.id).run();
  let assignments = 0;
  if (body.submit && reviewerGroup) {
    const round = await c.env.DB.prepare("SELECT id FROM review_rounds WHERE event_id = ? AND status = 'active' ORDER BY round LIMIT 1").bind(c.req.param("eventId")).first<{ id: string }>();
    if (round) {
      const reviewers = await c.env.DB.prepare("SELECT user_id AS id FROM reviewer_group_members WHERE reviewer_group_id = ?").bind(reviewerGroup.id).all<{ id: string }>();
      if (reviewers.results.length) {
        await c.env.DB.batch(reviewers.results.map((reviewer) => c.env.DB.prepare("INSERT OR IGNORE INTO review_assignments (id, proposal_id, round_id, reviewer_user_id, status, scores, created_at, updated_at) VALUES (?, ?, ?, ?, 'pending', '{}', ?, ?)").bind(crypto.randomUUID(), proposal.id, round.id, reviewer.id, now, now)));
        assignments = reviewers.results.length;
        await c.env.DB.prepare("UPDATE proposals SET status = 'under_review', updated_at = ? WHERE id = ? AND status = 'submitted'").bind(now, proposal.id).run();
      }
    }
  }
  if (confirmationJob && c.env.JOBS_QUEUE) {
    try {
      await c.env.JOBS_QUEUE.send(confirmationJob);
    } catch (error) {
      console.error(JSON.stringify({ event: "submission.confirmation_queue_failed", eventId: c.req.param("eventId"), proposalId: proposal.id, recovery: "scheduled_outbox", error: error instanceof Error ? error.message : String(error) }));
    }
  }
  return c.json({ data: { id: proposal.id, status: body.submit ? (assignments ? "under_review" : "submitted") : proposal.status, assignments, version: body.expectedVersion + 1, updatedAt: new Date(now).toISOString(), confirmationQueued: Boolean(confirmationJob) } });
});

app.post("/api/v1/events/:eventId/submissions/:proposalId/withdraw", async (c) => {
  const actor = c.get("actor")!;
  if (actor.demo) return c.json({ data: { id: c.req.param("proposalId"), status: "withdrawn", withdrawnAt: new Date().toISOString() } });
  const result = await c.env.DB.prepare("UPDATE proposals SET status = 'withdrawn', version = version + 1, updated_at = ? WHERE id = ? AND event_id = ? AND owner_user_id = ? AND status IN ('submitted', 'under_review', 'waitlisted')")
    .bind(Date.now(), c.req.param("proposalId"), c.req.param("eventId"), actor.id).run();
  if (!result.meta.changes) return jsonError(c, 409, "SUBMISSION_NOT_WITHDRAWABLE", "Only a submitted or waitlisted proposal can be withdrawn.");
  return c.json({ data: { id: c.req.param("proposalId"), status: "withdrawn", withdrawnAt: new Date().toISOString() } });
});

const decisionSchema = z.object({ status: z.enum(["accept_queue", "accepted", "decline_queue", "rejected", "waitlisted"]), note: z.string().max(2000).optional() });
app.post("/api/v1/events/:eventId/proposals/:proposalId/decision", zValidator("json", decisionSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  if (c.get("actor")?.demo) return c.json({ data: { proposalId: c.req.param("proposalId"), ...body, decidedAt: new Date().toISOString() } });
  const finalDecision = ["accepted", "rejected", "waitlisted"].includes(body.status);
  const now = Date.now();
  const auditId = crypto.randomUUID();
  const summary = `Proposal moved to ${body.status.replaceAll("_", " ")}.`;
  const result = await c.env.DB.batch([
    c.env.DB.prepare(updateProposalDecisionSql)
      .bind(body.status, finalDecision ? now : null, now, c.req.param("proposalId"), c.req.param("eventId")),
    c.env.DB.prepare(auditProposalDecisionSql)
      .bind(auditId, c.get("actor")!.id, c.req.param("proposalId"), summary, JSON.stringify({ status: body.status, note: body.note ?? null }), c.get("requestId"), now, c.req.param("eventId"), c.req.param("proposalId"), body.status),
  ]);
  if (!result[0].meta.changes) return jsonError(c, 404, "PROPOSAL_NOT_FOUND", "Proposal not found.");
  return c.json({ data: { proposalId: c.req.param("proposalId"), ...body } });
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
  if (c.get("actor")?.demo) return c.json({ data: { eventId: c.req.param("eventId"), status: "agenda_published", publishedSessions: body.sessionIds?.length ?? createDemoWorkspace().sessions.filter((session) => session.status === "scheduled").length, publishedAt: new Date().toISOString() } });
  const now = Date.now();
  let sessionResult: D1Result;
  if (body.sessionIds?.length) {
    sessionResult = await c.env.DB.prepare(`UPDATE program_sessions SET status = 'published', updated_at = ?, version = version + 1 WHERE event_id = ? AND status IN ('scheduled', 'published') AND id IN (${body.sessionIds.map(() => "?").join(",")})`).bind(now, c.req.param("eventId"), ...body.sessionIds).run();
  } else {
    sessionResult = await c.env.DB.prepare("UPDATE program_sessions SET status = 'published', updated_at = ?, version = version + 1 WHERE event_id = ? AND status = 'scheduled'").bind(now, c.req.param("eventId")).run();
  }
  if (!sessionResult.meta.changes) return jsonError(c, 409, "AGENDA_EMPTY", "Schedule at least one session before publishing the agenda.");
  await c.env.DB.prepare("UPDATE events SET status = 'agenda_published', public_agenda_revision = public_agenda_revision + 1, updated_at = ? WHERE id = ?").bind(now, c.req.param("eventId")).run();
  return c.json({ data: { eventId: c.req.param("eventId"), status: "agenda_published", publishedSessions: sessionResult.meta.changes, publishedAt: new Date(now).toISOString() } });
});

const reviewSchema = z.object({ score: z.number().min(1).max(5), recommendation: z.enum(["strong_yes", "yes", "maybe", "no"]), notes: z.string().min(10).max(5000), submit: z.boolean() });
app.post("/api/v1/events/:eventId/proposals/:proposalId/review", zValidator("json", reviewSchema), async (c) => {
  const denied = requireRole(c, ["reviewer", "organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  if (c.get("actor")?.demo) return c.json({ data: { proposalId: c.req.param("proposalId"), status: body.submit ? "submitted" : "in_progress", ...body } });
  const actor = c.get("actor")!;
  const now = Date.now();
  const result = await c.env.DB.prepare("UPDATE review_assignments SET status = ?, scores = ?, total_score = ?, recommendation = ?, notes = ?, submitted_at = ?, updated_at = ? WHERE proposal_id = ? AND reviewer_user_id = ? AND round_id IN (SELECT id FROM review_rounds WHERE event_id = ? AND status = 'active')")
    .bind(body.submit ? "submitted" : "in_progress", JSON.stringify({ overall: body.score }), body.score, body.recommendation, body.notes, body.submit ? now : null, now, c.req.param("proposalId"), actor.id, c.req.param("eventId"))
    .run();
  if (!result.meta.changes) return jsonError(c, 404, "REVIEW_ASSIGNMENT_NOT_FOUND", "No active review assignment was found for you and this proposal.");
  await c.env.DB.prepare("UPDATE proposals SET status = CASE WHEN status = 'submitted' THEN 'under_review' ELSE status END, updated_at = ?, version = version + 1 WHERE id = ? AND event_id = ?")
    .bind(now, c.req.param("proposalId"), c.req.param("eventId"))
    .run();
  return c.json({ data: { proposalId: c.req.param("proposalId"), status: body.submit ? "submitted" : "in_progress", ...body } });
});

const taskSchema = z.object({ complete: z.boolean() });
app.post("/api/v1/events/:eventId/tasks/:taskId/complete", zValidator("json", taskSchema), async (c) => {
  const body = c.req.valid("json");
  if (c.get("actor")?.demo) return c.json({ data: { taskId: c.req.param("taskId"), status: body.complete ? "complete" : "in_progress", completedAt: body.complete ? new Date().toISOString() : null } });
  const actor = c.get("actor")!;
  const result = await c.env.DB.prepare("UPDATE speaker_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND event_id = ? AND (speaker_profile_id IN (SELECT id FROM speaker_profiles WHERE user_id = ?) OR ? = 'organizer') AND (template_id IS NULL OR template_id IN (SELECT id FROM task_templates WHERE completion_mode = 'manual'))")
    .bind(body.complete ? "complete" : "in_progress", body.complete ? Date.now() : null, Date.now(), c.req.param("taskId"), c.req.param("eventId"), actor.id, actor.role)
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
    .bind(body.name, body.title, body.company, body.bio, body.pronouns ?? null, body.city ?? null, body.headshotUploadId ?? null, profileComplete ? 1 : 0, body.publish ?? null, body.publish ? 1 : 0, Date.now(), c.req.param("speakerId"), c.req.param("eventId"), actor.id, actor.role)
    .run();
  if (!result.meta.changes) return jsonError(c, 404, "SPEAKER_NOT_FOUND", "Speaker profile not found or not editable by you.");
  return c.json({ data: { id: c.req.param("speakerId"), ...body, profileComplete } });
});

const taskArtifactSchema = z.object({ uploadId: z.string().min(1) });
app.post("/api/v1/events/:eventId/tasks/:taskId/artifact", zValidator("json", taskArtifactSchema), async (c) => {
  const actor = c.get("actor")!;
  const { uploadId } = c.req.valid("json");
  if (actor.demo) return c.json({ data: { taskId: c.req.param("taskId"), uploadId, status: "complete", completedAt: new Date().toISOString() } });
  const now = Date.now();
  const result = await c.env.DB.prepare(`UPDATE speaker_tasks SET artifact_upload_id = ?, status = 'complete', completed_at = ?, updated_at = ?
    WHERE id = ? AND event_id = ?
      AND speaker_profile_id IN (SELECT id FROM speaker_profiles WHERE event_id = ? AND user_id = ?)
      AND (type = 'upload' OR template_id IN (SELECT id FROM task_templates WHERE completion_mode = 'file_request'))
      AND ? IN (SELECT id FROM uploads WHERE event_id = ? AND owner_user_id = ? AND deleted_at IS NULL)`)
    .bind(uploadId, now, now, c.req.param("taskId"), c.req.param("eventId"), c.req.param("eventId"), actor.id, uploadId, c.req.param("eventId"), actor.id).run();
  if (!result.meta.changes) return jsonError(c, 422, "TASK_ARTIFACT_INVALID", "The task or uploaded artifact is not available to this account.");
  return c.json({ data: { taskId: c.req.param("taskId"), uploadId, status: "complete", completedAt: new Date(now).toISOString() } });
});

const taskResponseSchema = z.object({ responses: z.record(z.string(), z.unknown()), submit: z.boolean().default(false) });
app.post("/api/v1/events/:eventId/tasks/:taskId/response", zValidator("json", taskResponseSchema), async (c) => {
  const actor = c.get("actor")!;
  const body = c.req.valid("json");
  if (actor.demo) return c.json({ data: { taskId: c.req.param("taskId"), responses: body.responses, status: body.submit ? "submitted" : "draft", taskStatus: body.submit ? "complete" : "in_progress" } });
  const task = await c.env.DB.prepare(`SELECT st.id, fv.fields FROM speaker_tasks st
    JOIN task_templates tt ON tt.id = st.template_id
    JOIN form_versions fv ON fv.id = tt.form_version_id
    JOIN speaker_profiles sp ON sp.id = st.speaker_profile_id
    WHERE st.id = ? AND st.event_id = ? AND sp.user_id = ? AND tt.completion_mode = 'form'`)
    .bind(c.req.param("taskId"), c.req.param("eventId"), actor.id).first<{ id: string; fields: unknown }>();
  if (!task) return jsonError(c, 404, "TASK_FORM_NOT_FOUND", "No linked form task was found for this account.");
  if (body.submit) {
    const fieldErrors = validateFormResponses(parseJson<FormField[]>(task.fields, []), body.responses);
    if (Object.keys(fieldErrors).length) return jsonError(c, 422, "FORM_VALIDATION_FAILED", "Review the highlighted task fields.", fieldErrors);
  }
  const now = Date.now();
  const responseId = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO task_responses (id, task_id, respondent_user_id, responses, status, submitted_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(task_id) DO UPDATE SET responses = excluded.responses, status = excluded.status, submitted_at = excluded.submitted_at, updated_at = excluded.updated_at`)
      .bind(responseId, task.id, actor.id, JSON.stringify(body.responses), body.submit ? "submitted" : "draft", body.submit ? now : null, now, now),
    c.env.DB.prepare("UPDATE speaker_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?").bind(body.submit ? "complete" : "in_progress", body.submit ? now : null, now, task.id),
  ]);
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
    const conflicts = detectScheduleConflicts(
      { id: target.id, title: target.title, roomId: body.roomId, trackId: body.trackId, speakerIds: target.speakerIds, startsAt: body.startsAt, endsAt: body.endsAt },
      workspace.sessions,
      { rooms: Object.fromEntries(workspace.rooms.map((room) => [room.id, room.name])), tracks: Object.fromEntries(workspace.tracks.map((track) => [track.id, track.name])), speakers: Object.fromEntries(workspace.proposals.flatMap((proposal) => proposal.speakers.map((speaker) => [speaker.id, speaker.name]))) },
    );
    if (conflicts.length && !body.overrideReason) return c.json({ error: { code: "SCHEDULE_CONFLICT", message: "Resolve the conflicts or record an override reason.", requestId: c.get("requestId"), conflicts } }, 409);
    return c.json({ data: { sessionId: target.id, ...body, status: "scheduled", conflictsOverridden: conflicts.length } });
  }
  const target = await c.env.DB.prepare("SELECT id, title FROM program_sessions WHERE id = ? AND event_id = ?").bind(c.req.param("sessionId"), c.req.param("eventId")).first<{ id: string; title: string }>();
  if (!target) return jsonError(c, 404, "SESSION_NOT_FOUND", "Session not found.");
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
  const result = await c.env.DB.prepare(`UPDATE program_sessions
    SET room_id = ?, track_id = ?, starts_at = ?, ends_at = ?, status = 'scheduled', override_reason = ?, calendar_sequence = calendar_sequence + 1, version = version + 1, updated_at = ?
    WHERE id = ? AND event_id = ? AND (
      ? IS NOT NULL OR NOT EXISTS (
        SELECT 1 FROM program_sessions other
        WHERE other.event_id = ? AND other.id <> ? AND other.starts_at < ? AND other.ends_at > ? AND (
          other.room_id = ? OR other.track_id = ? OR EXISTS (
            SELECT 1 FROM session_speakers target_speaker JOIN session_speakers other_speaker ON other_speaker.speaker_profile_id = target_speaker.speaker_profile_id
            WHERE target_speaker.session_id = ? AND other_speaker.session_id = other.id
          )
        )
      )
    )`)
    .bind(body.roomId, body.trackId, startsAt, endsAt, body.overrideReason ?? null, now, target.id, c.req.param("eventId"), body.overrideReason ?? null, c.req.param("eventId"), target.id, endsAt, startsAt, body.roomId, body.trackId, target.id).run();
  if (!result.meta.changes) return c.json({ error: { code: "SCHEDULE_CONFLICT", message: "Another schedule update introduced a conflict. Refresh and resolve it.", requestId: c.get("requestId"), conflicts } }, 409);
  if (conflicts.length) {
    await c.env.DB.prepare("INSERT INTO audit_logs (id, organization_id, event_id, actor_user_id, action, entity_type, entity_id, summary, metadata, request_id, created_at) SELECT ?, organization_id, id, ?, 'schedule.conflict_overridden', 'session', ?, ?, ?, ?, ? FROM events WHERE id = ?")
      .bind(crypto.randomUUID(), c.get("actor")!.id, target.id, body.overrideReason!, JSON.stringify({ conflicts }), c.get("requestId"), now, c.req.param("eventId")).run();
  }
  return c.json({ data: { sessionId: target.id, ...body, status: "scheduled", conflictsOverridden: conflicts.length } });
});

const formFieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().trim().min(1).max(255),
  description: z.string().max(1000).optional(),
  type: z.enum(["short_text", "long_text", "email", "url", "select", "multi_select", "checkbox", "file"]),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(255)).max(100).optional(),
  condition: z.object({ sourceFieldId: z.string(), operator: z.enum(["equals", "contains"]), value: z.string().max(255) }).optional(),
});
const formDraftSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
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
  fields: z.array(formFieldSchema).min(2).max(100),
});

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
  if (c.get("actor")?.demo) return c.json({ data: { id, eventId: c.req.param("eventId"), version: 1, status: "draft", ...body } }, 201);
  const now = Date.now();
  const slug = `${body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60)}-${id.slice(0, 6)}`;
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO submission_forms (id, event_id, name, slug, kind, target_type, submission_type, collects_participants, status, current_version, max_submissions_per_user, redirect_to_portal, confirmation_email_enabled, closes_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'cfp', 'submission', ?, ?, 'draft', 1, ?, ?, ?, ?, ?, ?)")
      .bind(id, c.req.param("eventId"), body.name, slug, body.submissionType, body.collectsParticipants ? 1 : 0, body.maxSubmissionsPerUser ?? null, body.redirectToPortal ? 1 : 0, body.confirmationEmailEnabled ? 1 : 0, body.closesAt ? new Date(body.closesAt).getTime() : null, now, now),
    c.env.DB.prepare("INSERT INTO form_versions (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, created_by, created_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)")
      .bind(crypto.randomUUID(), id, body.publicTitle, body.pageHeading, body.welcomeTitle, body.welcomeCopy, body.confirmationCopy, body.maxSpeakers, body.allowMultipleDrafts ? 1 : 0, JSON.stringify(body.fields), c.get("actor")!.id, now),
  ]);
  return c.json({ data: { id, eventId: c.req.param("eventId"), version: 1, status: "draft", ...body } }, 201);
});

app.put("/api/v1/events/:eventId/forms/:formId", zValidator("json", formDraftSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  const fieldErrors = formDefinitionErrors(body.fields);
  if (Object.keys(fieldErrors).length) return jsonError(c, 422, "FORM_DEFINITION_INVALID", "Fix the form definition before saving.", fieldErrors);
  if (c.get("actor")?.demo) return c.json({ data: { id: c.req.param("formId"), eventId: c.req.param("eventId"), version: (body.expectedVersion ?? 0) + 1, status: "draft", ...body } });
  const existing = await c.env.DB.prepare("SELECT current_version AS currentVersion, published_version AS publishedVersion FROM submission_forms WHERE id = ? AND event_id = ?")
    .bind(c.req.param("formId"), c.req.param("eventId")).first<{ currentVersion: number; publishedVersion: number | null }>();
  if (!existing) return jsonError(c, 404, "FORM_NOT_FOUND", "Submission form not found.");
  if (body.expectedVersion && Number(existing.currentVersion) !== body.expectedVersion) return jsonError(c, 409, "FORM_VERSION_CONFLICT", "This form changed in another tab. Refresh before saving again.");
  const currentPublished = Number(existing.currentVersion) === Number(existing.publishedVersion);
  const version = currentPublished ? Number(existing.currentVersion) + 1 : Number(existing.currentVersion);
  const now = Date.now();
  const versionId = crypto.randomUUID();
  const versionStatement = currentPublished
    ? c.env.DB.prepare("INSERT INTO form_versions (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?)").bind(versionId, c.req.param("formId"), version, body.publicTitle, body.pageHeading, body.welcomeTitle, body.welcomeCopy, body.confirmationCopy, body.maxSpeakers, body.allowMultipleDrafts ? 1 : 0, JSON.stringify(body.fields), c.get("actor")!.id, now)
    : c.env.DB.prepare("UPDATE form_versions SET public_title = ?, page_heading = ?, welcome_title = ?, welcome_copy = ?, confirmation_copy = ?, max_speakers = ?, allow_multiple_drafts = ?, fields = ? WHERE form_id = ? AND version = ? AND published_at IS NULL").bind(body.publicTitle, body.pageHeading, body.welcomeTitle, body.welcomeCopy, body.confirmationCopy, body.maxSpeakers, body.allowMultipleDrafts ? 1 : 0, JSON.stringify(body.fields), c.req.param("formId"), version);
  const result = await c.env.DB.batch([
    versionStatement,
    c.env.DB.prepare("UPDATE submission_forms SET name = ?, submission_type = ?, collects_participants = ?, current_version = ?, max_submissions_per_user = ?, redirect_to_portal = ?, confirmation_email_enabled = ?, closes_at = ?, updated_at = ? WHERE id = ? AND event_id = ?")
      .bind(body.name, body.submissionType, body.collectsParticipants ? 1 : 0, version, body.maxSubmissionsPerUser ?? null, body.redirectToPortal ? 1 : 0, body.confirmationEmailEnabled ? 1 : 0, body.closesAt ? new Date(body.closesAt).getTime() : null, now, c.req.param("formId"), c.req.param("eventId")),
  ]);
  if (!result[1].meta.changes) return jsonError(c, 409, "FORM_SAVE_CONFLICT", "The form could not be saved. Refresh and try again.");
  return c.json({ data: { id: c.req.param("formId"), version, status: "draft", ...body } });
});

const formPublishSchema = z.object({ version: z.number().int().positive() });
app.post("/api/v1/events/:eventId/forms/:formId/publish", zValidator("json", formPublishSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  const body = c.req.valid("json");
  if (c.get("actor")?.demo) return c.json({ data: { formId: c.req.param("formId"), version: body.version, status: "published", publishedAt: new Date().toISOString() } });
  const form = await c.env.DB.prepare("SELECT current_version AS currentVersion FROM submission_forms WHERE id = ? AND event_id = ?")
    .bind(c.req.param("formId"), c.req.param("eventId"))
    .first<{ currentVersion: number }>();
  if (!form) return jsonError(c, 404, "FORM_NOT_FOUND", "Submission form not found.");
  if (Number(form.currentVersion) !== body.version) return jsonError(c, 409, "FORM_VERSION_CONFLICT", "Publish the latest saved version of this form.");
  const now = Date.now();
  const result = await c.env.DB.batch([
    c.env.DB.prepare(publishFormVersionSql).bind(now, c.req.param("formId"), body.version, c.req.param("eventId"), body.version),
    c.env.DB.prepare(publishSubmissionFormSql).bind(body.version, body.version, now, c.req.param("formId"), c.req.param("eventId"), body.version, body.version),
    c.env.DB.prepare(publishFormEventSql).bind(now, c.req.param("eventId"), c.req.param("formId"), body.version, body.version),
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

const queueSchema = z.object({ kind: z.enum(["reminder", "acceptance", "calendar"]), recipientIds: z.array(z.string()).min(1).max(50), templateId: z.string().optional() });
app.post("/api/v1/events/:eventId/communications/send", zValidator("json", queueSchema), async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  if (!c.env.JOBS_QUEUE && !c.get("actor")?.demo) return jsonError(c, 503, "QUEUE_UNAVAILABLE", "The communication queue is not configured.");
  const body = c.req.valid("json");
  const idempotencyKey = c.req.header("idempotency-key") ?? crypto.randomUUID();
  if (c.get("actor")?.demo) return c.json({ data: { queued: body.recipientIds.length, idempotencyKey } }, 202);
  const speakers = await c.env.DB.prepare(`SELECT sp.id, sp.name, sp.email FROM speaker_profiles sp WHERE sp.event_id = ? AND sp.id IN (${body.recipientIds.map(() => "?").join(",")})`)
    .bind(c.req.param("eventId"), ...body.recipientIds).all<{ id: string; name: string; email: string }>();
  if (speakers.results.length !== body.recipientIds.length) return jsonError(c, 422, "RECIPIENT_NOT_FOUND", "Every recipient must be a speaker in this event.");
  const event = await c.env.DB.prepare("SELECT name, venue, timezone FROM events WHERE id = ?").bind(c.req.param("eventId")).first<{ name: string; venue: string; timezone: string }>();
  const template = body.templateId ? await c.env.DB.prepare("SELECT subject, html, text FROM message_templates WHERE id = ? AND event_id = ?").bind(body.templateId, c.req.param("eventId")).first<{ subject: string; html: string; text: string }>() : null;
  let queued = 0;
  for (const speaker of speakers.results) {
    if (body.kind === "calendar") {
      const sessions = await c.env.DB.prepare("SELECT ps.id, ps.title, ps.description, ps.starts_at AS startsAt, ps.ends_at AS endsAt, ps.calendar_uid AS uid, ps.calendar_sequence AS sequence, r.name AS room FROM program_sessions ps JOIN session_speakers ss ON ss.session_id = ps.id LEFT JOIN rooms r ON r.id = ps.room_id WHERE ss.speaker_profile_id = ? AND ps.event_id = ? AND ps.status IN ('scheduled', 'published')")
        .bind(speaker.id, c.req.param("eventId")).all<Record<string, unknown>>();
      for (const session of sessions.results) {
        const messageKey = `${idempotencyKey}:${speaker.id}:${session.id}`;
        await c.env.JOBS_QUEUE!.send({ kind: "email", idempotencyKey: messageKey, payload: { kind: "communication", eventId: c.req.param("eventId"), recipient: speaker.email, recipientName: speaker.name, subject: `Your ${event?.name ?? "conference"} session: ${session.title}`, text: template?.text ?? `Your session has been scheduled. Add the attached calendar invitation to your calendar.`, html: template?.html ?? `<p>Your session has been scheduled. The calendar invitation is attached.</p>`, calendar: { method: "REQUEST", uid: session.uid, sequence: session.sequence, title: session.title, description: session.description, location: `${session.room ?? "Room to be confirmed"}, ${event?.venue ?? ""}`, startsAt: new Date(Number(session.startsAt)).toISOString(), endsAt: new Date(Number(session.endsAt)).toISOString(), organizerName: event?.name ?? "Conference Ops" } } });
        queued += 1;
      }
    } else {
      const acceptance = body.kind === "acceptance";
      const subject = template?.subject ?? (acceptance ? `You're speaking at ${event?.name ?? "our conference"}` : `Speaker task reminder · ${event?.name ?? "Conference Ops"}`);
      const text = template?.text ?? (acceptance ? `Hi ${speaker.name}, your proposal has been accepted. Sign in to review your onboarding tasks.` : `Hi ${speaker.name}, you have outstanding speaker tasks. Sign in to complete them.`);
      const html = template?.html ?? `<p>${escapeHtml(text)}</p>`;
      await c.env.JOBS_QUEUE!.send({ kind: "email", idempotencyKey: `${idempotencyKey}:${speaker.id}`, payload: { kind: "communication", eventId: c.req.param("eventId"), recipient: speaker.email, recipientName: speaker.name, subject, text, html } });
      queued += 1;
    }
  }
  return c.json({ data: { queued, idempotencyKey } }, 202);
});

app.post("/api/v1/events/:eventId/integrations/accelevents/publish", async (c) => {
  const denied = requireRole(c, ["organizer"]);
  if (denied) return denied;
  if (c.env.ACCELEVENTS_ENABLED !== "true") {
    return c.json({ data: { status: "manual_action", reason: "API credentials or Enterprise entitlement are not configured.", exportUrls: { speakers: `/api/v1/events/${c.req.param("eventId")}/exports/speakers.csv`, sessions: `/api/v1/events/${c.req.param("eventId")}/exports/sessions.csv` } } });
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
  if (kind === "program.json") {
    c.header("content-disposition", `attachment; filename="${workspace.event.slug}-program.json"`);
    return c.json({ event: workspace.event, speakers: workspace.proposals.flatMap((proposal) => proposal.speakers).filter((speaker, index, all) => all.findIndex((candidate) => candidate.id === speaker.id) === index), sessions: workspace.sessions });
  }
  c.header("content-type", "text/csv; charset=utf-8");
  if (kind === "speakers.csv") {
    const speakers = workspace.proposals.flatMap((proposal) => proposal.speakers).filter((speaker, index, all) => all.findIndex((candidate) => candidate.id === speaker.id) === index);
    c.header("content-disposition", `attachment; filename="${workspace.event.slug}-speakers.csv"`);
    return c.body(["id,name,email,title,company,bio", ...speakers.map((speaker) => [speaker.id, speaker.name, speaker.email, speaker.title, speaker.company, speaker.bio].map(csvCell).join(","))].join("\r\n"));
  }
  c.header("content-disposition", `attachment; filename="${workspace.event.slug}-sessions.csv"`);
  return c.body(["id,title,speakers,track,room,starts_at,ends_at,status", ...workspace.sessions.map((session) => [session.id, session.title, session.speakerNames.join("; "), workspace.tracks.find((track) => track.id === session.trackId)?.name, workspace.rooms.find((room) => room.id === session.roomId)?.name, session.startsAt, session.endsAt, session.status].map(csvCell).join(","))].join("\r\n"));
});

app.post("/api/v1/events/:eventId/uploads", async (c) => {
  const actor = c.get("actor");
  if (!actor) return jsonError(c, 401, "AUTH_REQUIRED", "Sign in to upload files.");
  const purpose = c.req.query("purpose");
  if (!purpose || !["headshot", "slides", "supporting_document"].includes(purpose)) return jsonError(c, 422, "UPLOAD_PURPOSE_REQUIRED", "Choose a supported upload purpose.");
  const contentLength = Number(c.req.header("content-length") ?? 0);
  const maxBytes = purpose === "headshot" ? 10 * 1024 * 1024 : 50 * 1024 * 1024;
  if (!contentLength || contentLength > maxBytes) return jsonError(c, 413, "UPLOAD_TOO_LARGE", `This ${purpose} exceeds the ${maxBytes / 1024 / 1024} MB limit.`);
  const contentType = (c.req.header("content-type") ?? "application/octet-stream").toLowerCase();
  const allowedTypes: Record<string, string[]> = {
    headshot: ["image/jpeg", "image/png", "image/webp"],
    slides: ["application/pdf", "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    supporting_document: ["application/pdf", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  };
  if (!allowedTypes[purpose].includes(contentType)) return jsonError(c, 422, "UPLOAD_TYPE_NOT_ALLOWED", `This file type is not supported for ${purpose.replace("_", " ")}.`);
  if (!c.req.raw.body) return jsonError(c, 422, "UPLOAD_EMPTY", "Choose a file to upload.");
  if (c.get("actor")?.demo) return c.json({ data: { id: crypto.randomUUID(), fileName: c.req.query("filename") ?? "upload", byteSize: contentLength, purpose, status: "stored" } }, 201);
  const uploadId = crypto.randomUUID();
  const objectKey = `${c.req.param("eventId")}/${actor.id}/${uploadId}`;
  await c.env.UPLOADS.put(objectKey, c.req.raw.body, { httpMetadata: { contentType }, customMetadata: { ownerUserId: actor.id, purpose } });
  await c.env.DB.prepare("INSERT INTO uploads (id, event_id, owner_user_id, object_key, file_name, content_type, byte_size, purpose, public, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)")
    .bind(uploadId, c.req.param("eventId"), actor.id, objectKey, c.req.query("filename") ?? "upload", contentType, contentLength, purpose, Date.now())
    .run();
  return c.json({ data: { id: uploadId, fileName: c.req.query("filename") ?? "upload", byteSize: contentLength, purpose, status: "stored" } }, 201);
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
