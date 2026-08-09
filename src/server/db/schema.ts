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

export const proposalReviewerGroups = sqliteTable(
  "proposal_reviewer_groups",
  {
    proposalId: text("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    reviewerGroupId: text("reviewer_group_id").notNull().references(() => reviewerGroups.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.proposalId, table.reviewerGroupId] }),
    index("proposal_reviewer_group_idx").on(table.reviewerGroupId),
  ],
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
    status: text("status", { enum: ["draft", "changes_requested", "revision_open", "submitted", "under_review", "accept_queue", "waitlisted", "accepted", "decline_queue", "rejected", "withdrawn", "session"] }).notNull().default("draft"),
    revisionNote: text("revision_note"),
    revisionRequestedAt: integer("revision_requested_at", { mode: "timestamp" }),
    revisionRequestedBy: text("revision_requested_by", { enum: ["organizer", "applicant"] }),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    reviewCycle: integer("review_cycle").notNull().default(1),
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
    participantRole: text("participant_role").notNull().default("Presenter"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.proposalId, table.speakerProfileId] })],
);

export const reviewRounds = sqliteTable("review_rounds", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  round: integer("round").notNull(),
  rubric: text("rubric", { mode: "json" }).$type<Array<{ id: string; label: string; type?: "numeric" | "dropdown" | "text"; weight: number; maxScore?: number; options?: string[]; required?: boolean }>>().notNull(),
  opensAt: integer("opens_at", { mode: "timestamp" }),
  closesAt: integer("closes_at", { mode: "timestamp" }),
  anonymized: integer("anonymized", { mode: "boolean" }).notNull().default(false),
  status: text("status", { enum: ["draft", "active", "closed"] }).notNull().default("draft"),
  ...timestamps,
});

export const reviewRoundReviewers = sqliteTable(
  "review_round_reviewers",
  {
    roundId: text("round_id").notNull().references(() => reviewRounds.id, { onDelete: "cascade" }),
    reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    assignmentCap: integer("assignment_cap").notNull().default(25),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.roundId, table.reviewerUserId] }), index("review_round_reviewer_user_idx").on(table.reviewerUserId)],
);

export const reviewAssignments = sqliteTable(
  "review_assignments",
  {
    id: text("id").primaryKey(),
    proposalId: text("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    roundId: text("round_id").notNull().references(() => reviewRounds.id, { onDelete: "cascade" }),
    reviewerUserId: text("reviewer_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reviewCycle: integer("review_cycle").notNull().default(1),
    status: text("status", { enum: ["pending", "in_progress", "submitted"] }).notNull().default("pending"),
    scores: text("scores", { mode: "json" }).$type<Record<string, number>>().notNull().default({}),
    totalScore: integer("total_score"),
    recommendation: text("recommendation", { enum: ["strong_yes", "yes", "maybe", "no"] }),
    notes: text("notes"),
    recusedAt: integer("recused_at", { mode: "timestamp" }),
    recusalReason: text("recusal_reason"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("review_assignment_unique").on(table.proposalId, table.roundId, table.reviewerUserId, table.reviewCycle), index("reviewer_queue_idx").on(table.reviewerUserId, table.status)],
);

export const aiReviewEvaluations = sqliteTable(
  "ai_review_evaluations",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    proposalId: text("proposal_id").notNull().references(() => proposals.id, { onDelete: "cascade" }),
    roundId: text("round_id").notNull().references(() => reviewRounds.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    rationale: text("rationale").notNull(),
    modelLabel: text("model_label").notNull().default("Conference Ops bounded evaluator"),
    overriddenScore: integer("overridden_score"),
    overrideReason: text("override_reason"),
    overriddenBy: text("overridden_by").references(() => users.id, { onDelete: "set null" }),
    overriddenAt: integer("overridden_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("ai_review_evaluation_unique").on(table.proposalId, table.roundId), index("ai_review_event_idx").on(table.eventId)],
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
  externalUrl: text("external_url"),
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
    externalUrl: text("external_url"),
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

export const taskComments = sqliteTable(
  "task_comments",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    taskId: text("task_id").notNull().references(() => speakerTasks.id, { onDelete: "cascade" }),
    authorUserId: text("author_user_id").notNull().references(() => users.id),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    index("task_comment_task_time_idx").on(table.taskId, table.createdAt),
    index("task_comment_event_idx").on(table.eventId),
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
  kind: text("kind", { enum: ["submission_confirmation", "acceptance", "rejection", "reminder", "calendar"] }).notNull().default("reminder"),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  text: text("text").notNull(),
  ...timestamps,
});

export const communicationSchedules = sqliteTable(
  "communication_schedules",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["task_overdue", "cfp_draft"] }).notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    offsetDays: integer("offset_days").notNull().default(2),
    lastRunAt: integer("last_run_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [uniqueIndex("communication_schedule_event_kind_unique").on(table.eventId, table.kind)],
);

export const outbox = sqliteTable(
  "outbox",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").references(() => events.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["email", "calendar", "accelevents", "airtable"] }).notNull(),
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

export const airtableConnections = sqliteTable(
  "airtable_connections",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").references(() => events.id, { onDelete: "cascade" }),
    baseId: text("base_id").notNull(),
    recordsTableId: text("records_table_id").notNull(),
    commandsTableId: text("commands_table_id").notNull(),
    authority: text("authority", { enum: ["d1", "airtable"] }).notNull().default("d1"),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["provisioning", "syncing", "healthy", "degraded", "blocked", "disabled"] }).notNull().default("provisioning"),
    schemaVersion: integer("schema_version").notNull().default(1),
    webhookId: text("webhook_id"),
    webhookCursor: integer("webhook_cursor").notNull().default(0),
    webhookExpiresAt: integer("webhook_expires_at", { mode: "timestamp" }),
    lastPushAt: integer("last_push_at", { mode: "timestamp" }),
    lastPullAt: integer("last_pull_at", { mode: "timestamp" }),
    lastReconciledAt: integer("last_reconciled_at", { mode: "timestamp" }),
    reconciliationStartedAt: integer("reconciliation_started_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("airtable_connection_base_unique").on(table.baseId),
    uniqueIndex("airtable_connection_event_unique").on(table.eventId),
    uniqueIndex("airtable_connection_one_global_enabled").on(table.enabled)
      .where(sql`${table.eventId} IS NULL AND ${table.enabled} = 1`),
    index("airtable_connection_enabled_idx").on(table.enabled, table.status),
  ],
);

export const airtableRecordMaps = sqliteTable(
  "airtable_record_maps",
  {
    connectionId: text("connection_id").notNull().references(() => airtableConnections.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    localKey: text("local_key").notNull(),
    airtableRecordId: text("airtable_record_id").notNull(),
    lastLocalHash: text("last_local_hash"),
    lastRemoteHash: text("last_remote_hash"),
    lastRemoteTransaction: integer("last_remote_transaction"),
    lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.connectionId, table.entityType, table.localKey] }),
    uniqueIndex("airtable_record_remote_unique").on(table.connectionId, table.airtableRecordId),
  ],
);

export const airtableChangeQueue = sqliteTable(
  "airtable_change_queue",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull().references(() => airtableConnections.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    localKey: text("local_key").notNull(),
    operation: text("operation", { enum: ["upsert", "tombstone"] }).notNull(),
    status: text("status", { enum: ["queued", "processing", "failed", "dead"] }).notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    generation: integer("generation").notNull().default(1),
    availableAt: integer("available_at", { mode: "timestamp" }).notNull(),
    leaseExpiresAt: integer("lease_expires_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("airtable_change_entity_unique").on(table.connectionId, table.entityType, table.localKey),
    index("airtable_change_due_idx").on(table.status, table.availableAt),
  ],
);

export const airtableConflicts = sqliteTable(
  "airtable_conflicts",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull().references(() => airtableConnections.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    localKey: text("local_key").notNull(),
    airtableRecordId: text("airtable_record_id"),
    reason: text("reason").notNull(),
    localHash: text("local_hash"),
    remoteHash: text("remote_hash"),
    remotePayload: text("remote_payload", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: ["open", "resolved", "ignored"] }).notNull().default("open"),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [index("airtable_conflict_open_idx").on(table.connectionId, table.status, table.createdAt)],
);

export const airtableCommands = sqliteTable(
  "airtable_commands",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id").notNull().references(() => airtableConnections.id, { onDelete: "cascade" }),
    airtableRecordId: text("airtable_record_id").notNull(),
    commandType: text("command_type").notNull(),
    targetEntity: text("target_entity").notNull(),
    targetKey: text("target_key").notNull(),
    parameters: text("parameters", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status", { enum: ["pending", "processing", "succeeded", "rejected", "failed"] }).notNull().default("pending"),
    result: text("result", { mode: "json" }).$type<Record<string, unknown>>().notNull().default({}),
    lastError: text("last_error"),
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull(),
    processedAt: integer("processed_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("airtable_command_remote_unique").on(table.connectionId, table.airtableRecordId),
    uniqueIndex("airtable_command_idempotency_unique").on(table.connectionId, table.idempotencyKey),
    index("airtable_command_status_idx").on(table.connectionId, table.status, table.requestedAt),
  ],
);

export const speakerOperations = sqliteTable(
  "speaker_operations",
  {
    speakerProfileId: text("speaker_profile_id").primaryKey().references(() => speakerProfiles.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    workflowStatus: text("workflow_status", { enum: ["invited", "confirmed", "onboarding", "ready", "declined"] }).notNull().default("invited"),
    socialLinks: text("social_links", { mode: "json" }).$type<{ linkedin?: string; x?: string; website?: string }>().notNull().default({}),
    travelDetails: text("travel_details").notNull().default(""),
    ...timestamps,
  },
  (table) => [index("speaker_operations_event_status_idx").on(table.eventId, table.workflowStatus)],
);

export const sessionContentStatus = sqliteTable(
  "session_content_status",
  {
    sessionId: text("session_id").primaryKey().references(() => programSessions.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["draft", "in_review", "approved"] }).notNull().default("draft"),
    ...timestamps,
  },
  (table) => [index("session_content_event_status_idx").on(table.eventId, table.status)],
);

export const contentRevisions = sqliteTable(
  "content_revisions",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    entityType: text("entity_type", { enum: ["session", "speaker"] }).notNull(),
    entityId: text("entity_id").notNull(),
    version: integer("version").notNull(),
    snapshot: text("snapshot", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    editorUserId: text("editor_user_id").references(() => users.id, { onDelete: "set null" }),
    editorName: text("editor_name").notNull(),
    restoredFromVersion: integer("restored_from_version"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [
    uniqueIndex("content_revision_entity_version_unique").on(table.eventId, table.entityType, table.entityId, table.version),
    index("content_revision_entity_time_idx").on(table.eventId, table.entityType, table.entityId, table.createdAt),
  ],
);

export const speakerCommunicationLogs = sqliteTable(
  "speaker_communication_logs",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["invitation", "general", "task_reminder"] }).notNull(),
    recipientIds: text("recipient_ids", { mode: "json" }).$type<string[]>().notNull().default([]),
    recipientNames: text("recipient_names", { mode: "json" }).$type<string[]>().notNull().default([]),
    subject: text("subject").notNull(),
    bodyTemplate: text("body_template").notNull(),
    renderedPreviews: text("rendered_previews", { mode: "json" }).$type<Array<{ speakerId: string; speakerName: string; body: string }>>().notNull().default([]),
    deliveryMode: text("delivery_mode", { enum: ["queue", "sandbox"] }).notNull(),
    status: text("status", { enum: ["queued", "recorded"] }).notNull(),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (table) => [index("speaker_communication_event_time_idx").on(table.eventId, table.createdAt)],
);
