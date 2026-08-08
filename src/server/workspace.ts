import type { AuthActor, Bindings } from "./env";
import type {
  Actor,
  EmbedDefinition,
  FormDefinition,
  FormField,
  OnboardingTask,
  ProgramSession,
  Proposal,
  ResourcePage,
  ReviewAssignment,
  Room,
  SpeakerProfile,
  Track,
  WorkspaceSnapshot,
} from "../shared/domain";
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

export async function loadWorkspace(env: Bindings, authActor: AuthActor, requestedEventId?: string, requestedRole?: AuthActor["role"]): Promise<WorkspaceSnapshot | null> {
  const membership = await env.DB.prepare(
    `SELECT e.*, em.role
     FROM events e JOIN event_memberships em ON em.event_id = e.id
     WHERE em.user_id = ? AND e.deleted_at IS NULL AND (? IS NULL OR e.id = ?) AND (? IS NULL OR em.role = ?)
     ORDER BY CASE e.status WHEN 'agenda_published' THEN 1 WHEN 'review' THEN 2 WHEN 'cfp_open' THEN 3 ELSE 4 END, e.starts_at DESC
     LIMIT 1`,
  ).bind(authActor.id, requestedEventId ?? null, requestedEventId ?? null, requestedRole ?? null, requestedRole ?? null).first<Record<string, unknown>>();
  if (!membership) return null;

  const eventId = String(membership.id);
  const role = String(membership.role) as Actor["role"];
  const [formRows, speakerRows, proposalRows, proposalSpeakerRows, reviewRows, taskRows, trackRows, roomRows, sessionRows, sessionSpeakerRows, resourceRows, embedRows, activityRows, actorRows] = await Promise.all([
    env.DB.prepare(workspaceFormRowsSql(role)).bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT sp.*, up.object_key AS headshot_key FROM speaker_profiles sp LEFT JOIN uploads up ON up.id = sp.headshot_upload_id WHERE sp.event_id = ?").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT p.*, rg.name AS reviewer_group,
      (SELECT AVG(ra.total_score) FROM review_assignments ra WHERE ra.proposal_id = p.id AND ra.status = 'submitted') AS score,
      (SELECT COUNT(*) FROM review_assignments ra WHERE ra.proposal_id = p.id AND ra.status = 'submitted') AS review_count
      FROM proposals p LEFT JOIN reviewer_groups rg ON rg.id = p.reviewer_group_id WHERE p.event_id = ? ORDER BY p.submitted_at DESC, p.updated_at DESC`).bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT ps.proposal_id, ps.speaker_profile_id FROM proposal_speakers ps JOIN proposals p ON p.id = ps.proposal_id WHERE p.event_id = ? ORDER BY ps.sort_order").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT ra.*, rr.round FROM review_assignments ra JOIN review_rounds rr ON rr.id = ra.round_id WHERE rr.event_id = ?").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM speaker_tasks WHERE event_id = ? ORDER BY due_at").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM tracks WHERE event_id = ? ORDER BY name").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM rooms WHERE event_id = ? ORDER BY name").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM program_sessions WHERE event_id = ? ORDER BY starts_at, title").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT ss.session_id, ss.speaker_profile_id FROM session_speakers ss JOIN program_sessions ps ON ps.id = ss.session_id WHERE ps.event_id = ?").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM resource_pages WHERE event_id = ? ORDER BY updated_at DESC").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT * FROM embeds WHERE event_id = ? ORDER BY name").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT al.*, COALESCE(u.name, 'Conference Ops') AS actor_name FROM audit_logs al LEFT JOIN user u ON u.id = al.actor_user_id WHERE al.event_id = ? ORDER BY al.created_at DESC LIMIT 20").bind(eventId).all<Record<string, unknown>>(),
    env.DB.prepare("SELECT u.id, u.name, u.email, em.role FROM event_memberships em JOIN user u ON u.id = em.user_id WHERE em.event_id = ? ORDER BY u.name").bind(eventId).all<Record<string, unknown>>(),
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
    if (speaker) proposalSpeakers.set(String(row.proposal_id), [...(proposalSpeakers.get(String(row.proposal_id)) ?? []), speaker]);
  }
  const sessionSpeakerIds = new Map<string, string[]>();
  for (const row of sessionSpeakerRows.results) sessionSpeakerIds.set(String(row.session_id), [...(sessionSpeakerIds.get(String(row.session_id)) ?? []), String(row.speaker_profile_id)]);

  const forms: FormDefinition[] = formRows.results.map((row) => ({
    id: String(row.id), eventId, name: String(row.name), publicTitle: String(row.public_title), pageHeading: String(row.page_heading), version: Number(row.current_version), status: String(row.status) as FormDefinition["status"],
    submissionType: String(row.submission_type) as FormDefinition["submissionType"], collectsParticipants: Boolean(row.collects_participants),
    welcomeTitle: String(row.welcome_title), welcomeCopy: String(row.welcome_copy), confirmationCopy: String(row.confirmation_copy), maxSpeakers: Number(row.max_speakers),
    maxSubmissionsPerUser: row.max_submissions_per_user ? Number(row.max_submissions_per_user) : undefined, closesAt: row.closes_at ? iso(row.closes_at) : undefined,
    redirectToPortal: Boolean(row.redirect_to_portal), confirmationEmailEnabled: Boolean(row.confirmation_email_enabled), allowMultipleDrafts: Boolean(row.allow_multiple_drafts),
    fields: json<FormField[]>(row.fields, []), submissions: Number(row.submissions ?? 0), updatedAt: iso(row.updated_at),
  }));

  const proposals: Proposal[] = proposalRows.results.map((row) => ({
    id: String(row.id), eventId, title: String(row.title), summary: String(row.summary), category: String(row.category), format: String(row.format) as Proposal["format"],
    durationMinutes: Number(row.duration_minutes), level: String(row.level) as Proposal["level"], status: String(row.status) as Proposal["status"], speakers: proposalSpeakers.get(String(row.id)) ?? [],
    submittedAt: row.submitted_at ? iso(row.submitted_at) : iso(row.updated_at), score: row.score === null || row.score === undefined ? undefined : Number(row.score), reviewCount: Number(row.review_count ?? 0),
    reviewerGroup: String(row.reviewer_group ?? "Unassigned"), tags: json<string[]>(json<Record<string, unknown>>(row.responses, {}).tags, []),
  }));

  const reviews: ReviewAssignment[] = reviewRows.results.map((row) => ({ id: String(row.id), proposalId: String(row.proposal_id), reviewerId: String(row.reviewer_user_id), round: Number(row.round), status: String(row.status) as ReviewAssignment["status"], score: row.total_score === null ? undefined : Number(row.total_score), recommendation: row.recommendation ? String(row.recommendation) as ReviewAssignment["recommendation"] : undefined, notes: row.notes ? String(row.notes) : undefined }));
  const tasks: OnboardingTask[] = taskRows.results.map((row) => ({ id: String(row.id), eventId, speakerId: String(row.speaker_profile_id), title: String(row.title), description: String(row.description), dueAt: iso(row.due_at), status: String(row.status) as OnboardingTask["status"], type: String(row.type) as OnboardingTask["type"] }));
  const tracks: Track[] = trackRows.results.map((row) => ({ id: String(row.id), name: String(row.name), color: String(row.color) }));
  const rooms: Room[] = roomRows.results.map((row) => ({ id: String(row.id), name: String(row.name), capacity: Number(row.capacity) }));
  const sessions: ProgramSession[] = sessionRows.results.map((row) => {
    const ids = sessionSpeakerIds.get(String(row.id)) ?? [];
    return { id: String(row.id), eventId, proposalId: row.proposal_id ? String(row.proposal_id) : undefined, origin: String(row.origin) as ProgramSession["origin"], title: String(row.title), description: String(row.description ?? ""), format: String(row.format) as ProgramSession["format"], capacity: row.capacity === null || row.capacity === undefined ? undefined : Number(row.capacity), ceuCredits: row.ceu_credits ? String(row.ceu_credits) : undefined, clientId: row.client_id ? String(row.client_id) : undefined, speakerIds: ids, speakerNames: ids.map((id) => speakerById.get(id)?.name ?? "Invited speaker"), trackId: row.track_id ? String(row.track_id) : undefined, roomId: row.room_id ? String(row.room_id) : undefined, startsAt: row.starts_at ? iso(row.starts_at) : undefined, endsAt: row.ends_at ? iso(row.ends_at) : undefined, status: String(row.status) as ProgramSession["status"], overrideReason: row.override_reason ? String(row.override_reason) : undefined };
  });
  const resources: ResourcePage[] = resourceRows.results.map((row) => ({ id: String(row.id), title: String(row.title), slug: String(row.slug), status: String(row.status) as ResourcePage["status"], summary: String(row.summary), updatedAt: iso(row.updated_at) }));
  const embeds: EmbedDefinition[] = embedRows.results.map((row) => ({ id: String(row.id), name: String(row.name), eventId, format: String(row.format) as EmbedDefinition["format"], enabled: Boolean(row.enabled), theme: String(row.theme) as EmbedDefinition["theme"], updatedAt: iso(row.updated_at) }));
  const actors: Actor[] = actorRows.results.map((row) => ({ id: String(row.id), name: String(row.name), email: String(row.email), role: String(row.role) as Actor["role"] }));
  const actor: Actor = { id: authActor.id, name: authActor.name, email: authActor.email, role };
  const reviewerProposalIds = new Set(reviews.filter((review) => review.reviewerId === authActor.id).map((review) => review.proposalId));
  const ownedProposalIds = new Set(proposalRows.results.filter((row) => String(row.owner_user_id) === authActor.id).map((row) => String(row.id)));
  for (const [proposalId, speakers] of proposalSpeakers) if (speakers.some((speaker) => actorSpeakerIds.has(speaker.id))) ownedProposalIds.add(proposalId);
  const visibleProposals = role === "organizer" ? proposals : role === "reviewer" ? proposals.filter((proposal) => reviewerProposalIds.has(proposal.id)) : proposals.filter((proposal) => ownedProposalIds.has(proposal.id));
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
    activity: role === "organizer" ? activityRows.results.map((row) => ({ id: String(row.id), actor: String(row.actor_name), action: String(row.action), target: String(row.summary), at: iso(row.created_at), tone: String(row.action).includes("failed") || String(row.action).includes("override") ? "warning" : String(row.action).includes("accepted") || String(row.action).includes("published") ? "positive" : "neutral" })) : [],
  };
}
