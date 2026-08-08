import type { AuthActor, Bindings } from "./env";
import { defaultFormVersionSettings } from "../shared/form-settings";
import { formVersionSettingsWithControls } from "../shared/form-version-controls";
import type { FormField } from "../shared/domain";

export interface InitialEventInput {
  organizationName: string;
  name: string;
  shortName: string;
  slug: string;
  description: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  cfpClosesAt: string;
  venue: string;
  websiteUrl: string;
  accent: string;
}

export interface InitialEventResult {
  id: string;
  slug: string;
  organizationId: string;
  formId: string;
}

export class EventSlugConflictError extends Error {
  constructor() {
    super("That public event slug is already in use.");
    this.name = "EventSlugConflictError";
  }
}

export function isEventSlugConstraintError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /UNIQUE constraint failed:\s*events\.slug|event_slug_unique/i.test(message);
}

export function normalizeEventSlug(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function availableEventSlug(db: D1Database, requested: string) {
  const base = normalizeEventSlug(requested) || "conference";
  const existing = await db.prepare("SELECT id FROM events WHERE slug = ? AND deleted_at IS NULL LIMIT 1")
    .bind(base)
    .first<{ id: string }>();
  return existing ? `${base}-${crypto.randomUUID().slice(0, 6)}` : base;
}

const initialFields: FormField[] = [
  { id: "field-title", label: "Session title", description: "Clear, specific, and under 100 characters.", type: "short_text", required: true, section: "proposal" },
  { id: "field-summary", label: "Abstract", description: "What will attendees learn, and what evidence will you share?", type: "long_text", required: true, section: "proposal" },
  { id: "field-category", label: "Program category", type: "select", required: true, section: "proposal", options: ["General"] },
  { id: "field-format", label: "Preferred format", type: "select", required: true, section: "proposal", options: ["Talk", "Workshop", "Panel", "Lightning talk"] },
  { id: "speaker-first", label: "First name", type: "short_text", required: true, section: "participant" },
  { id: "speaker-last", label: "Last name", type: "short_text", required: true, section: "participant" },
  { id: "speaker-email", label: "Email", type: "email", required: true, section: "participant" },
  { id: "speaker-bio", label: "Biography", type: "long_text", required: false, section: "participant" },
];

const initialRubric = [
  { id: "relevance", label: "Audience relevance", weight: 2, maxScore: 5 },
  { id: "evidence", label: "Evidence and specificity", weight: 3, maxScore: 5 },
  { id: "delivery", label: "Likely delivery quality", weight: 1, maxScore: 5 },
];

export const hotelStayFields: FormField[] = [
  { id: "hotel-needed", label: "Do you need an event-provided hotel stay?", type: "checkbox", required: true, section: "proposal" },
  { id: "hotel-arrival", label: "Expected arrival date", type: "short_text", required: false, section: "proposal", condition: { sourceFieldId: "hotel-needed", operator: "equals", value: "true" } },
  { id: "hotel-departure", label: "Expected departure date", type: "short_text", required: false, section: "proposal", condition: { sourceFieldId: "hotel-needed", operator: "equals", value: "true" } },
  { id: "hotel-notes", label: "Accessibility or room notes", type: "long_text", required: false, section: "proposal" },
];

export const flightReimbursementFields: FormField[] = [
  { id: "flight-needed", label: "Will you request flight reimbursement?", type: "checkbox", required: true, section: "proposal" },
  { id: "flight-origin", label: "Departure city or airport", type: "short_text", required: false, section: "proposal", condition: { sourceFieldId: "flight-needed", operator: "equals", value: "true" } },
  { id: "flight-estimate", label: "Estimated round-trip cost", type: "short_text", required: false, section: "proposal", condition: { sourceFieldId: "flight-needed", operator: "equals", value: "true" } },
  { id: "flight-notes", label: "Itinerary or reimbursement notes", type: "long_text", required: false, section: "proposal" },
];

const initialMessages = [
  { kind: "submission_confirmation", name: "Submission confirmation", subject: "We received your {{event.name}} proposal", text: "Hi {{speaker.name}}, your proposal {{proposal.title}} is in the review queue. Open your portal: {{speaker.portal_url}}", html: "<p>Hi {{speaker.name}},</p><p>Your proposal <strong>{{proposal.title}}</strong> is in the review queue.</p><p><a href=\"{{speaker.portal_url}}\">Open your portal</a></p>" },
  { kind: "acceptance", name: "Acceptance", subject: "You're speaking at {{event.name}}", text: "Hi {{speaker.name}}, your proposal {{proposal.title}} has been accepted. Open onboarding: {{speaker.portal_url}}. {{decision.feedback}}", html: "<p>Hi {{speaker.name}},</p><p>Your proposal <strong>{{proposal.title}}</strong> has been accepted.</p><p><a href=\"{{speaker.portal_url}}\">Open onboarding</a></p><p>{{decision.feedback}}</p>" },
  { kind: "rejection", name: "Decision: not selected", subject: "Your {{event.name}} proposal", text: "Hi {{speaker.name}}, thank you for submitting {{proposal.title}}. We are not able to include it in this program. {{decision.feedback}}", html: "<p>Hi {{speaker.name}},</p><p>Thank you for submitting <strong>{{proposal.title}}</strong>. We are not able to include it in this program.</p><p>{{decision.feedback}}</p>" },
  { kind: "reminder", name: "Onboarding reminder", subject: "Speaker tasks for {{event.name}}", text: "Hi {{speaker.name}}, you have {{task.count}} outstanding speaker task(s). Open your portal: {{speaker.portal_url}}", html: "<p>Hi {{speaker.name}},</p><p>You have {{task.count}} outstanding speaker task(s).</p><p><a href=\"{{speaker.portal_url}}\">Open your portal</a></p>" },
  { kind: "calendar", name: "Calendar invitation", subject: "Your {{event.name}} session is scheduled", text: "Hi {{speaker.name}}, your session {{session.title}} is scheduled in {{session.room}}. The calendar invitation is attached.", html: "<p>Hi {{speaker.name}},</p><p>Your session <strong>{{session.title}}</strong> is scheduled in {{session.room}}. The calendar invitation is attached.</p>" },
] as const;

export async function createInitialEvent(
  env: Pick<Bindings, "DB">,
  actor: AuthActor,
  input: InitialEventInput,
  slugAttempt = 0,
): Promise<InitialEventResult> {
  const now = Date.now();
  const eventId = crypto.randomUUID();
  const formId = crypto.randomUUID();
  const formVersionId = crypto.randomUUID();
  const trackId = crypto.randomUUID();
  const roomId = crypto.randomUUID();
  const roundId = crypto.randomUUID();
  const reviewerGroupId = crypto.randomUUID();
  const fileRequestId = crypto.randomUUID();
  const hotelFormId = crypto.randomUUID();
  const hotelFormVersionId = crypto.randomUUID();
  const flightFormId = crypto.randomUUID();
  const flightFormVersionId = crypto.randomUUID();
  const eventSlug = await availableEventSlug(env.DB, input.slug || input.name);
  const existingOrganization = await env.DB.prepare(`SELECT o.id
    FROM organizations o
    JOIN organization_members om ON om.organization_id = o.id
    WHERE om.user_id = ? AND om.role IN ('owner', 'admin')
    ORDER BY o.created_at
    LIMIT 1`)
    .bind(actor.id)
    .first<{ id: string }>();
  const organizationId = existingOrganization?.id ?? crypto.randomUUID();
  const organizationSlug = `${normalizeEventSlug(input.organizationName) || "events"}-${organizationId.slice(0, 6)}`;
  const statements: D1PreparedStatement[] = [];
  const initialFormSettings = formVersionSettingsWithControls(defaultFormVersionSettings, {
    submissionType: "abstract",
    collectsParticipants: true,
    maxSubmissionsPerUser: 3,
    redirectToPortal: true,
    confirmationEmailEnabled: true,
    closesAt: new Date(input.cfpClosesAt).toISOString(),
  });
  const portalFormSettings = JSON.stringify(formVersionSettingsWithControls(defaultFormVersionSettings, {
    submissionType: "session",
    collectsParticipants: false,
    maxSubmissionsPerUser: 1,
    redirectToPortal: true,
    confirmationEmailEnabled: false,
  }));

  if (!existingOrganization) {
    statements.push(
      env.DB.prepare("INSERT INTO organizations (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
        .bind(organizationId, input.organizationName, organizationSlug, now, now),
      env.DB.prepare("INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
        .bind(organizationId, actor.id, now),
    );
  }

  statements.push(
    env.DB.prepare(`INSERT INTO events
      (id, organization_id, slug, name, short_name, description, timezone, starts_at, ends_at, cfp_closes_at, venue, website_url, accent, status, public_agenda_revision, allowed_embed_origins, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, '[]', ?, ?)`)
      .bind(eventId, organizationId, eventSlug, input.name, input.shortName, input.description, input.timezone, new Date(input.startsAt).getTime(), new Date(input.endsAt).getTime(), new Date(input.cfpClosesAt).getTime(), input.venue, input.websiteUrl || null, input.accent, now, now),
    env.DB.prepare("INSERT INTO event_memberships (event_id, user_id, role, invited_by, accepted_at, created_at) VALUES (?, ?, 'organizer', ?, ?, ?)")
      .bind(eventId, actor.id, actor.id, now, now),
    env.DB.prepare(`INSERT INTO submission_forms
      (id, event_id, name, slug, kind, target_type, submission_type, collects_participants, status, current_version, max_submissions_per_user, redirect_to_portal, confirmation_email_enabled, closes_at, created_at, updated_at)
      VALUES (?, ?, ?, 'call-for-speakers', 'cfp', 'submission', 'abstract', 1, 'draft', 1, 3, 1, 1, ?, ?, ?)`)
      .bind(formId, eventId, `${input.shortName} CFP`, new Date(input.cfpClosesAt).getTime(), now, now),
    env.DB.prepare(`INSERT INTO form_versions
      (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, created_by, created_at)
      VALUES (?, ?, 1, ?, 'Apply', ?, ?, ?, 4, 1, ?, ?, ?, ?)`)
      .bind(formVersionId, formId, `Call for Speakers · ${input.name}`, "Share work your peers can use", "Tell the program team what you built, what you learned, and what attendees will take away.", "Your proposal is in. You can revise it until the call closes.", JSON.stringify(initialFields), JSON.stringify(initialFormSettings), actor.id, now),
    env.DB.prepare("INSERT INTO reviewer_groups (id, event_id, name, category, created_at, updated_at) VALUES (?, ?, 'General committee', 'General', ?, ?)")
      .bind(reviewerGroupId, eventId, now, now),
    env.DB.prepare("INSERT INTO review_rounds (id, event_id, name, round, rubric, status, created_at, updated_at) VALUES (?, ?, 'Program review', 1, ?, 'active', ?, ?)")
      .bind(roundId, eventId, JSON.stringify(initialRubric), now, now),
    env.DB.prepare("INSERT INTO tracks (id, event_id, name, color, created_at, updated_at) VALUES (?, ?, 'General', ?, ?, ?)")
      .bind(trackId, eventId, input.accent, now, now),
    env.DB.prepare("INSERT INTO rooms (id, event_id, name, capacity, created_at, updated_at) VALUES (?, ?, 'Main room', 100, ?, ?)")
      .bind(roomId, eventId, now, now),
    env.DB.prepare("INSERT INTO file_requests (id, event_id, title, instructions_html, target_type, required, status, created_at, updated_at) VALUES (?, ?, 'Upload final slides', '<p>Upload a PDF or PPTX file, up to 50 MB.</p>', 'submission', 1, 'published', ?, ?)")
      .bind(fileRequestId, eventId, now, now),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, title, description, type, target_type, completion_mode, relative_due_days, created_at, updated_at) VALUES (?, ?, 'Confirm speaker profile', 'Review your title, company, bio, and public headshot.', 'profile', 'contact', 'manual', 14, ?, ?)")
      .bind(crypto.randomUUID(), eventId, now, now),
    env.DB.prepare(`INSERT INTO submission_forms
      (id, event_id, name, slug, kind, target_type, submission_type, collects_participants, status, current_version, published_version, max_submissions_per_user, redirect_to_portal, confirmation_email_enabled, created_at, updated_at)
      VALUES (?, ?, 'Hotel stay requirements', 'hotel-stay', 'portal', 'contact', 'session', 0, 'published', 1, 1, 1, 1, 0, ?, ?)`)
      .bind(hotelFormId, eventId, now, now),
    env.DB.prepare(`INSERT INTO form_versions
      (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, published_at, created_by, created_at)
      VALUES (?, ?, 1, 'Hotel stay requirements', 'Hotel', 'Plan your stay', 'Tell the event team whether you need an event-provided room and when you expect to arrive.', 'Your hotel requirements are saved.', 1, 0, ?, ?, ?, ?, ?)`)
      .bind(hotelFormVersionId, hotelFormId, JSON.stringify(hotelStayFields), portalFormSettings, now, actor.id, now),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, title, description, type, target_type, completion_mode, relative_due_days, form_version_id, created_at, updated_at) VALUES (?, ?, 'Hotel stay requirements', 'Tell the event team whether you need a hotel stay and share arrival details.', 'form', 'contact', 'form', 21, ?, ?, ?)")
      .bind(crypto.randomUUID(), eventId, hotelFormVersionId, now, now),
    env.DB.prepare(`INSERT INTO submission_forms
      (id, event_id, name, slug, kind, target_type, submission_type, collects_participants, status, current_version, published_version, max_submissions_per_user, redirect_to_portal, confirmation_email_enabled, created_at, updated_at)
      VALUES (?, ?, 'Flight reimbursement', 'flight-reimbursement', 'portal', 'contact', 'session', 0, 'published', 1, 1, 1, 1, 0, ?, ?)`)
      .bind(flightFormId, eventId, now, now),
    env.DB.prepare(`INSERT INTO form_versions
      (id, form_id, version, public_title, page_heading, welcome_title, welcome_copy, confirmation_copy, max_speakers, allow_multiple_drafts, fields, settings, published_at, created_by, created_at)
      VALUES (?, ?, 1, 'Flight reimbursement', 'Travel', 'Plan your travel', 'Share the itinerary and reimbursement details the event team needs.', 'Your travel details are saved.', 1, 0, ?, ?, ?, ?, ?)`)
      .bind(flightFormVersionId, flightFormId, JSON.stringify(flightReimbursementFields), portalFormSettings, now, actor.id, now),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, title, description, type, target_type, completion_mode, relative_due_days, form_version_id, created_at, updated_at) VALUES (?, ?, 'Flight reimbursement', 'Share the itinerary and reimbursement details the event team needs.', 'form', 'contact', 'form', 18, ?, ?, ?)")
      .bind(crypto.randomUUID(), eventId, flightFormVersionId, now, now),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, title, description, type, target_type, completion_mode, relative_due_days, file_request_id, created_at, updated_at) VALUES (?, ?, 'Upload final slides', 'PDF or PPTX, maximum 50 MB.', 'upload', 'submission', 'file_request', 7, ?, ?, ?)")
      .bind(crypto.randomUUID(), eventId, fileRequestId, now, now),
    env.DB.prepare("INSERT INTO task_templates (id, event_id, title, description, type, target_type, completion_mode, relative_due_days, created_at, updated_at) VALUES (?, ?, 'Accept calendar invitation', 'Confirm the scheduled session time.', 'calendar', 'contact', 'manual', 5, ?, ?)")
      .bind(crypto.randomUUID(), eventId, now, now),
    env.DB.prepare("INSERT INTO embeds (id, event_id, name, format, enabled, theme, filters, created_at, updated_at) VALUES (?, ?, 'Public agenda', 'agenda', 1, 'light', '{}', ?, ?)")
      .bind(crypto.randomUUID(), eventId, now, now),
    env.DB.prepare("INSERT INTO embeds (id, event_id, name, format, enabled, theme, filters, created_at, updated_at) VALUES (?, ?, 'Speaker gallery', 'speaker_gallery', 1, 'light', '{}', ?, ?)")
      .bind(crypto.randomUUID(), eventId, now, now),
    ...initialMessages.map((message) => env.DB.prepare("INSERT INTO message_templates (id, event_id, kind, name, subject, html, text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), eventId, message.kind, message.name, message.subject, message.html, message.text, now, now)),
    env.DB.prepare("INSERT INTO communication_schedules (id, event_id, kind, enabled, offset_days, created_at, updated_at) VALUES (?, ?, 'cfp_draft', 1, 2, ?, ?)")
      .bind(crypto.randomUUID(), eventId, now, now),
    env.DB.prepare("INSERT INTO communication_schedules (id, event_id, kind, enabled, offset_days, created_at, updated_at) VALUES (?, ?, 'task_overdue', 1, 2, ?, ?)")
      .bind(crypto.randomUUID(), eventId, now, now),
    env.DB.prepare("INSERT INTO audit_logs (id, organization_id, event_id, actor_user_id, action, entity_type, entity_id, summary, metadata, request_id, created_at) VALUES (?, ?, ?, ?, 'event.created', 'event', ?, ?, '{}', ?, ?)")
      .bind(crypto.randomUUID(), organizationId, eventId, actor.id, eventId, input.name, crypto.randomUUID(), now),
  );

  try {
    await env.DB.batch(statements);
  } catch (error) {
    if (isEventSlugConstraintError(error) && slugAttempt < 2) {
      const base = normalizeEventSlug(input.slug || input.name) || "conference";
      return createInitialEvent(env, actor, { ...input, slug: `${base}-${crypto.randomUUID().slice(0, 6)}` }, slugAttempt + 1);
    }
    if (isEventSlugConstraintError(error)) throw new EventSlugConflictError();
    throw error;
  }
  return { id: eventId, slug: eventSlug, organizationId, formId };
}
