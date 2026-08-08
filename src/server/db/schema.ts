import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { FormField } from "../../shared/domain";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
};

export const users = sqliteTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
    image: text("image"),
    ...timestamps,
  },
  (table) => [uniqueIndex("user_email_unique").on(table.email)],
);

export const authSessions = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    token: text("token").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("session_token_unique").on(table.token), index("session_user_idx").on(table.userId)],
);

export const authAccounts = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", { mode: "timestamp" }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", { mode: "timestamp" }),
    scope: text("scope"),
    password: text("password"),
    ...timestamps,
  },
  (table) => [index("account_user_idx").on(table.userId), uniqueIndex("account_provider_unique").on(table.providerId, table.accountId)],
);

export const authVerifications = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const organizations = sqliteTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  ...timestamps,
});

export const organizationMembers = sqliteTable(
  "organization_members",
  {
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.organizationId, table.userId] }), index("organization_member_user_idx").on(table.userId)],
);

export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    description: text("description").notNull().default(""),
    timezone: text("timezone").notNull(),
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp" }).notNull(),
    cfpClosesAt: integer("cfp_closes_at", { mode: "timestamp" }),
    venue: text("venue").notNull().default(""),
    websiteUrl: text("website_url"),
    accent: text("accent").notNull().default("#e05b3f"),
    logoUploadId: text("logo_upload_id"),
    backgroundUploadId: text("background_upload_id"),
    status: text("status", { enum: ["draft", "cfp_open", "review", "agenda_published", "archived"] }).notNull().default("draft"),
    publicAgendaRevision: integer("public_agenda_revision").notNull().default(0),
    allowedEmbedOrigins: text("allowed_embed_origins", { mode: "json" }).$type<string[]>().notNull().default([]),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("event_slug_unique").on(table.slug), index("event_org_idx").on(table.organizationId)],
);

export const eventMemberships = sqliteTable(
  "event_memberships",
  {
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["organizer", "reviewer", "applicant", "speaker"] }).notNull(),
    invitedBy: text("invited_by").references(() => users.id),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.eventId, table.userId, table.role] }), index("event_membership_user_idx").on(table.userId)],
);

export const eventInvitations = sqliteTable(
  "event_invitations",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["organizer", "reviewer"] }).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").notNull().references(() => users.id),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    acceptedAt: integer("accepted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("event_invitation_email_idx").on(table.email, table.expiresAt)],
);

export const submissionForms = sqliteTable(
  "submission_forms",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    kind: text("kind", { enum: ["cfp", "portal"] }).notNull().default("cfp"),
    targetType: text("target_type", { enum: ["contact", "group", "submission"] }).notNull().default("submission"),
    submissionType: text("submission_type", { enum: ["abstract", "session"] }).notNull().default("abstract"),
    collectsParticipants: integer("collects_participants", { mode: "boolean" }).notNull().default(true),
    status: text("status", { enum: ["draft", "published", "closed"] }).notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    publishedVersion: integer("published_version"),
    maxSubmissionsPerUser: integer("max_submissions_per_user"),
    redirectToPortal: integer("redirect_to_portal", { mode: "boolean" }).notNull().default(true),
    confirmationEmailEnabled: integer("confirmation_email_enabled", { mode: "boolean" }).notNull().default(true),
    opensAt: integer("opens_at", { mode: "timestamp" }),
    closesAt: integer("closes_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("submission_form_event_slug_unique").on(table.eventId, table.slug), index("submission_form_event_idx").on(table.eventId)],
);

export const formVersions = sqliteTable(
  "form_versions",
  {
    id: text("id").primaryKey(),
    formId: text("form_id").notNull().references(() => submissionForms.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    publicTitle: text("public_title").notNull(),
    pageHeading: text("page_heading").notNull().default("Apply"),
    welcomeTitle: text("welcome_title").notNull(),
    welcomeCopy: text("welcome_copy").notNull(),
    confirmationCopy: text("confirmation_copy").notNull(),
    maxSpeakers: integer("max_speakers").notNull().default(1),
    allowMultipleDrafts: integer("allow_multiple_drafts", { mode: "boolean" }).notNull().default(true),
    fields: text("fields", { mode: "json" }).$type<FormField[]>().notNull(),
    settings: text("settings", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    createdBy: text("created_by").notNull().references(() => users.id),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [uniqueIndex("form_version_unique").on(table.formId, table.version)],
);

export const reviewerGroups = sqliteTable("reviewer_groups", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  ...timestamps,
});

export const reviewerGroupMembers = sqliteTable(
  "reviewer_group_members",
  {
    reviewerGroupId: text("reviewer_group_id").notNull().references(() => reviewerGroups.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.reviewerGroupId, table.userId] }), index("reviewer_group_user_idx").on(table.userId)],
);

export const speakerProfiles = sqliteTable(
  "speaker_profiles",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    title: text("title").notNull().default(""),
    company: text("company").notNull().default(""),
    bio: text("bio").notNull().default(""),
    pronouns: text("pronouns"),
    city: text("city"),
    headshotUploadId: text("headshot_upload_id"),
    profileComplete: integer("profile_complete", { mode: "boolean" }).notNull().default(false),
    published: integer("published", { mode: "boolean" }).notNull().default(false),
    ...timestamps,
  },
  (table) => [uniqueIndex("speaker_user_event_unique").on(table.userId, table.eventId), uniqueIndex("speaker_email_event_unique").on(table.email, table.eventId), index("speaker_event_idx").on(table.eventId)],
);

export const proposals = sqliteTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    formVersionId: text("form_version_id").notNull().references(() => formVersions.id),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id),
    reviewerGroupId: text("reviewer_group_id").references(() => reviewerGroups.id),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    category: text("category").notNull(),
    format: text("format", { enum: ["talk", "workshop", "panel", "lightning"] }).notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    level: text("level", { enum: ["introductory", "intermediate", "advanced"] }).notNull(),
    responses: text("responses", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["draft", "submitted", "under_review", "accept_queue", "waitlisted", "accepted", "decline_queue", "rejected", "withdrawn", "session"] }).notNull().default("draft"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [index("proposal_event_status_idx").on(table.eventId, table.status), index("proposal_owner_idx").on(table.ownerUserId)],
);

export const proposalSpeakers = sqliteTable(
  "proposal_speakers",
  {
    proposalId: text("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    speakerProfileId: text("speaker_profile_id").notNull().references(() => speakerProfiles.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.proposalId, table.speakerProfileId] })],
);

export const reviewRounds = sqliteTable("review_rounds", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  round: integer("round").notNull(),
  rubric: text("rubric", { mode: "json" }).$type<Array<{ id: string; label: string; weight: number; maxScore: number }>>().notNull(),
  status: text("status", { enum: ["draft", "active", "closed"] }).notNull().default("draft"),
  ...timestamps,
});

export const reviewAssignments = sqliteTable(
  "review_assignments",
  {
    id: text("id").primaryKey(),
    proposalId: text("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    roundId: text("round_id").notNull().references(() => reviewRounds.id, { onDelete: "cascade" }),
    reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "in_progress", "submitted"] }).notNull().default("pending"),
    scores: text("scores", { mode: "json" }).$type<Record<string, number>>().notNull().default({}),
    totalScore: integer("total_score"),
    recommendation: text("recommendation", { enum: ["strong_yes", "yes", "maybe", "no"] }),
    notes: text("notes"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("review_assignment_unique").on(table.proposalId, table.roundId, table.reviewerUserId), index("reviewer_queue_idx").on(table.reviewerUserId, table.status)],
);

export const tracks = sqliteTable("tracks", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").notNull(),
  ...timestamps,
});

export const rooms = sqliteTable("rooms", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  capacity: integer("capacity").notNull().default(0),
  ...timestamps,
});

export const programSessions = sqliteTable(
  "program_sessions",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    proposalId: text("proposal_id").references(() => proposals.id),
    origin: text("origin", { enum: ["proposal", "direct_guaranteed", "direct_sponsor", "direct_program"] }).notNull().default("proposal"),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    format: text("format", { enum: ["keynote", "talk", "workshop", "panel", "lightning", "break", "networking"] }).notNull().default("talk"),
    capacity: integer("capacity"),
    ceuCredits: text("ceu_credits"),
    clientId: text("client_id"),
    trackId: text("track_id").references(() => tracks.id),
    roomId: text("room_id").references(() => rooms.id),
    startsAt: integer("starts_at", { mode: "timestamp" }),
    endsAt: integer("ends_at", { mode: "timestamp" }),
    status: text("status", { enum: ["unscheduled", "scheduled", "published"] }).notNull().default("unscheduled"),
    overrideReason: text("override_reason"),
    calendarUid: text("calendar_uid").notNull(),
    calendarSequence: integer("calendar_sequence").notNull().default(0),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (table) => [uniqueIndex("session_proposal_unique").on(table.proposalId), index("session_event_time_idx").on(table.eventId, table.startsAt, table.endsAt), index("session_room_time_idx").on(table.roomId, table.startsAt, table.endsAt), index("session_track_time_idx").on(table.trackId, table.startsAt, table.endsAt)],
);

export const sessionSpeakers = sqliteTable(
  "session_speakers",
  {
    sessionId: text("session_id").notNull().references(() => programSessions.id, { onDelete: "cascade" }),
    speakerProfileId: text("speaker_profile_id").notNull().references(() => speakerProfiles.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.speakerProfileId] }), index("session_speaker_conflict_idx").on(table.speakerProfileId)],
);

export const uploads = sqliteTable(
  "uploads",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id),
    objectKey: text("object_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    purpose: text("purpose", { enum: ["headshot", "slides", "supporting_document"] }).notNull(),
    public: integer("public", { mode: "boolean" }).notNull().default(false),
    deletedAt: integer("deleted_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("upload_event_owner_idx").on(table.eventId, table.ownerUserId)],
);

export const fileRequests = sqliteTable(
  "file_requests",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    instructionsHtml: text("instructions_html").notNull().default(""),
    targetType: text("target_type", { enum: ["contact", "group", "submission"] }).notNull(),
    required: integer("required", { mode: "boolean" }).notNull().default(true),
    status: text("status", { enum: ["draft", "published", "archived"] }).notNull().default("draft"),
    ...timestamps,
  },
  (table) => [index("file_request_event_type_idx").on(table.eventId, table.targetType)],
);

export const fileRequestResponses = sqliteTable(
  "file_request_responses",
  {
    id: text("id").primaryKey(),
    fileRequestId: text("file_request_id").notNull().references(() => fileRequests.id, { onDelete: "cascade" }),
    targetId: text("target_id").notNull(),
    uploaderUserId: text("uploader_user_id").notNull().references(() => users.id),
    uploadIds: text("upload_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("file_request_target_unique").on(table.fileRequestId, table.targetId), index("file_request_uploader_idx").on(table.uploaderUserId)],
);

export const taskTemplates = sqliteTable("task_templates", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description").notNull(),
  type: text("type", { enum: ["profile", "upload", "form", "calendar"] }).notNull(),
  targetType: text("target_type", { enum: ["contact", "group", "submission"] }).notNull().default("contact"),
  completionMode: text("completion_mode", { enum: ["manual", "form", "file_request"] }).notNull().default("manual"),
  relativeDueDays: integer("relative_due_days").notNull().default(7),
  formVersionId: text("form_version_id").references(() => formVersions.id),
  fileRequestId: text("file_request_id").references(() => fileRequests.id),
  ...timestamps,
});

export const speakerTasks = sqliteTable(
  "speaker_tasks",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    templateId: text("template_id").references(() => taskTemplates.id),
    speakerProfileId: text("speaker_profile_id").notNull().references(() => speakerProfiles.id, { onDelete: "cascade" }),
    proposalId: text("proposal_id").references(() => proposals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    type: text("type", { enum: ["profile", "upload", "form", "calendar"] }).notNull(),
    status: text("status", { enum: ["not_started", "in_progress", "complete", "overdue", "waived"] }).notNull().default("not_started"),
    artifactUploadId: text("artifact_upload_id").references(() => uploads.id),
    dueAt: integer("due_at", { mode: "timestamp" }).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    index("task_event_status_due_idx").on(table.eventId, table.status, table.dueAt),
    index("task_speaker_idx").on(table.speakerProfileId),
    // Legacy databases may already contain duplicate NULL-target rows, so the
    // contact lookup stays non-unique and SQL idempotency preserves the data.
    index("task_contact_template_speaker_idx")
      .on(table.templateId, table.speakerProfileId)
      .where(sql`${table.proposalId} IS NULL`),
    uniqueIndex("task_submission_template_speaker_proposal_unique")
      .on(table.templateId, table.speakerProfileId, table.proposalId)
      .where(sql`${table.proposalId} IS NOT NULL`),
  ],
);

export const taskResponses = sqliteTable(
  "task_responses",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id").notNull().references(() => speakerTasks.id, { onDelete: "cascade" }),
    respondentUserId: text("respondent_user_id").notNull().references(() => users.id),
    responses: text("responses", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: ["draft", "submitted"] }).notNull().default("draft"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("task_response_unique").on(table.taskId), index("task_response_user_idx").on(table.respondentUserId)],
);

export const embeds = sqliteTable(
  "embeds",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    format: text("format", { enum: ["agenda", "speaker_gallery"] }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    theme: text("theme", { enum: ["light", "dark"] }).notNull().default("light"),
    filters: text("filters", { mode: "json" }).$type<Record<string, string[]>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [uniqueIndex("embed_event_name_unique").on(table.eventId, table.name)],
);

export const resourcePages = sqliteTable(
  "resource_pages",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    summary: text("summary").notNull().default(""),
    sanitizedHtml: text("sanitized_html").notNull().default(""),
    embedUrl: text("embed_url"),
    status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
    ...timestamps,
  },
  (table) => [uniqueIndex("resource_event_slug_unique").on(table.eventId, table.slug)],
);

export const messageTemplates = sqliteTable("message_templates", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  text: text("text").notNull(),
  ...timestamps,
});

export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").references(() => events.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["email", "calendar", "accelevents"] }).notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: text("payload", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    status: text("status", { enum: ["queued", "processing", "sent", "failed", "dead"] }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: integer("available_at", { mode: "timestamp" }).notNull(),
    lastError: text("last_error"),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("outbox_idempotency_unique").on(table.idempotencyKey), index("outbox_due_idx").on(table.status, table.availableAt)],
);

export const integrationSyncRecords = sqliteTable(
  "integration_sync_records",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    provider: text("provider", { enum: ["accelevents"] }).notNull(),
    entityType: text("entity_type", { enum: ["speaker", "session"] }).notNull(),
    localId: text("local_id").notNull(),
    remoteId: text("remote_id"),
    payloadHash: text("payload_hash").notNull(),
    status: text("status", { enum: ["pending", "synced", "failed", "manual_action"] }).notNull(),
    lastError: text("last_error"),
    syncedAt: integer("synced_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("sync_entity_unique").on(table.provider, table.eventId, table.entityType, table.localId)],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    eventId: text("event_id").references(() => events.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    summary: text("summary").notNull(),
    metadata: text("metadata", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    requestId: text("request_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("audit_event_time_idx").on(table.eventId, table.createdAt), index("audit_entity_idx").on(table.entityType, table.entityId)],
);
