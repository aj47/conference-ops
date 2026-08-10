export type Role = "organizer" | "reviewer" | "applicant" | "speaker";

export type ProposalStatus =
  | "draft"
  | "changes_requested"
  | "revision_open"
  | "submitted"
  | "under_review"
  | "accept_queue"
  | "waitlisted"
  | "accepted"
  | "decline_queue"
  | "rejected"
  | "withdrawn"
  | "session";

export type ReviewStatus = "pending" | "in_progress" | "submitted";
export type TaskStatus = "not_started" | "in_progress" | "complete" | "overdue" | "waived";
export type SessionStatus = "unscheduled" | "scheduled" | "published";

export interface Actor {
  id: string;
  name: string;
  email: string;
  role: Role;
  avatarUrl?: string;
}

export interface EventRecord {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  description: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  websiteUrl: string;
  status: "draft" | "cfp_open" | "review" | "agenda_published" | "archived";
  cfpClosesAt: string;
  accent: string;
  logoUrl?: string;
  backgroundUrl?: string;
}

export type PublicEventLoadState =
  | { status: "idle" }
  | { status: "loading"; slug: string }
  | { status: "ready"; slug: string; cfp: "published" | "unavailable" }
  | { status: "error"; slug: string; message: string };

export type FormFieldType =
  | "short_text"
  | "long_text"
  | "email"
  | "url"
  | "select"
  | "multi_select"
  | "checkbox"
  | "file";

export type FormFieldSection = "proposal" | "participant";

export interface FormCondition {
  sourceFieldId: string;
  operator: "equals" | "contains";
  value: string;
}

export interface FormField {
  id: string;
  label: string;
  description?: string;
  type: FormFieldType;
  required: boolean;
  /** Optional only for backwards compatibility with form versions created before sections were persisted. */
  section?: FormFieldSection;
  options?: string[];
  condition?: FormCondition;
}

export interface FormVersionSettings {
  proposalSectionTitle: string;
  proposalPageHeading: string;
  proposalInstructions: string;
  participantSectionTitle: string;
  participantPageHeading: string;
  participantInstructions: string;
  participantMin: number;
  combinedCharacterLimit: number;
}

export interface FormDefinition {
  id: string;
  eventId: string;
  name: string;
  slug?: string;
  publicTitle?: string;
  pageHeading?: string;
  version: number;
  publishedVersion?: number;
  status: "draft" | "published" | "closed";
  kind?: "cfp" | "portal";
  targetType?: "contact" | "group" | "submission";
  submissionType?: "abstract" | "session";
  collectsParticipants?: boolean;
  welcomeTitle: string;
  welcomeCopy: string;
  confirmationCopy: string;
  maxSpeakers: number;
  maxSubmissionsPerUser?: number;
  closesAt?: string;
  redirectToPortal?: boolean;
  confirmationEmailEnabled?: boolean;
  allowMultipleDrafts: boolean;
  settings?: FormVersionSettings;
  fields: FormField[];
  submissions: number;
  updatedAt: string;
}

export interface SpeakerProfile {
  id: string;
  name: string;
  email: string;
  title: string;
  company: string;
  bio: string;
  pronouns?: string;
  city?: string;
  headshotUrl?: string;
  profileComplete: boolean;
  /** Submission-specific label; populated when this profile is projected as a proposal participant. */
  participantRole?: string;
}

export interface Proposal {
  id: string;
  eventId: string;
  /** Optimistic concurrency token for applicant-owned draft and requested-revision updates. */
  version?: number;
  /** Increments only when a controlled applicant revision starts. */
  reviewCycle?: number;
  title: string;
  summary: string;
  category: string;
  format: "talk" | "workshop" | "panel" | "lightning";
  durationMinutes: number;
  level: "introductory" | "intermediate" | "advanced";
  status: ProposalStatus;
  /** Latest controlled revision opening. Earlier openings remain in the audit log. */
  revisionRequest?: {
    note: string;
    requestedAt: string;
    requestedBy?: "organizer" | "applicant";
  };
  speakers: SpeakerProfile[];
  submittedAt: string;
  score?: number;
  reviewCount: number;
  /** Internal routing label; omitted from applicant and speaker snapshots. */
  reviewerGroup?: string;
  tags: string[];
  /** Original versioned form answers, exposed only through the role-scoped workspace. */
  responses?: Record<string, unknown>;
  customResponses?: FormResponseItem[];
  /** Immutable form contract used to create an applicant-owned draft. */
  form?: FormDefinition;
}

export type FormResponseValue = string | number | boolean | Array<string | number | boolean> | null;

export interface FormResponseItem {
  fieldId: string;
  label: string;
  type: FormFieldType;
  section: FormFieldSection;
  value: FormResponseValue;
}

export interface ReviewAssignment {
  id: string;
  proposalId: string;
  reviewerId: string;
  round: number;
  roundName: string;
  status: ReviewStatus;
  /** Proposal review cycle this immutable assignment belongs to. */
  reviewCycle?: number;
  /** Present for final evidence so organizers can distinguish pre-revision reviews. */
  submittedAt?: string;
  rubric: ReviewRubricCriterion[];
  scores: Record<string, ReviewResponseValue>;
  score?: number;
  recommendation?: "strong_yes" | "yes" | "maybe" | "no";
  notes?: string;
  anonymized?: boolean;
  recusedAt?: string;
  recusalReason?: string;
}

export type ReviewResponseValue = number | string;

export interface ReviewRubricCriterion {
  id: string;
  label: string;
  /** Omitted on legacy rounds and treated as a numeric rating. */
  type?: "numeric" | "dropdown" | "text";
  weight: number;
  maxScore: number;
  description?: string;
  options?: string[];
  required?: boolean;
}

export interface ReviewPlanDefinition {
  id: string;
  eventId: string;
  name: string;
  round: number;
  status: "draft" | "active" | "closed";
  rubric: ReviewRubricCriterion[];
  opensAt?: string;
  closesAt?: string;
  anonymized?: boolean;
  reviewerIds?: string[];
  reviewerCaps?: Record<string, number>;
  submittedReviews: number;
  updatedAt: string;
}

export interface ReviewerGroupConfig {
  id: string;
  name: string;
  category: string;
  reviewerIds: string[];
}

export interface TaskTemplateDefinition {
  id: string;
  title: string;
  description: string;
  type: "profile" | "upload" | "form" | "calendar";
  targetType: "contact" | "group" | "submission";
  completionMode: "manual" | "form" | "file_request";
  relativeDueDays: number;
  externalUrl?: string;
  formId?: string;
  fileRequestId?: string;
  formFields?: FormField[];
}

export interface TaskArtifactVersion {
  uploadId: string;
  fileName: string;
  contentType: string;
  uploadedAt: string;
}

export interface TaskComment {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

export type MessageTemplateKind = "submission_confirmation" | "acceptance" | "rejection" | "reminder" | "calendar";

export interface MessageTemplateDefinition {
  id: string;
  kind: MessageTemplateKind;
  name: string;
  subject: string;
  html: string;
  text: string;
  updatedAt: string;
}

export type CommunicationDeliveryKind =
  | "submission_confirmation"
  | "acceptance"
  | "rejection"
  | "revision_request"
  | "reminder"
  | "draft_reminder"
  | "calendar"
  | "staff_invitation"
  | "operational_email";

export type CommunicationDeliveryStatus = "queued" | "processing" | "sent" | "failed" | "dead";

export interface CommunicationDelivery {
  id: string;
  kind: CommunicationDeliveryKind;
  transport: "email" | "calendar";
  recipient: string;
  recipientName?: string;
  subject: string;
  status: CommunicationDeliveryStatus;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  lastError?: string;
}

export interface ReminderRule {
  id: string;
  kind: "task_overdue" | "cfp_draft";
  enabled: boolean;
  offsetDays: number;
  updatedAt: string;
}

export interface ReadinessInsight {
  id: string;
  priority: "now" | "next" | "watch";
  title: string;
  detail: string;
  count: number;
  actionLabel: string;
  actionPath: string;
  effectSummary?: string;
  reversible?: boolean;
  requiresConfirmation?: boolean;
}

export type AirtableOperatorHealth = "healthy" | "degraded" | "disabled";

export interface AirtableOperatorStatus {
  enabled: boolean;
  configured: boolean;
  health: AirtableOperatorHealth;
  authority: "d1" | "airtable";
  connection: {
    scope: "event" | "environment" | "none";
    state: "provisioning" | "syncing" | "healthy" | "degraded" | "blocked" | "disabled" | "not_configured";
    schemaVersion: number | null;
  };
  sync: {
    lastPushAt: string | null;
    lastPullAt: string | null;
    lastReconciledAt: string | null;
    webhook: "active" | "expiring" | "expired" | "not_configured";
    webhookExpiresAt: string | null;
  };
  workload: {
    scope: "event" | "unavailable";
    pending: number | null;
    dead: number | null;
    openConflicts: number | null;
  };
  guidance: {
    mode: "commission" | "validate" | "operate" | "recover";
    title: string;
    detail: string;
    steps: string[];
  };
  generatedAt: string;
}

export interface OnboardingTask {
  id: string;
  eventId: string;
  speakerId: string;
  title: string;
  description: string;
  dueAt: string;
  status: TaskStatus;
  type: "profile" | "upload" | "form" | "calendar";
  targetType?: "contact" | "group" | "submission";
  proposalId?: string;
  targetTitle?: string;
  completionMode?: "manual" | "form" | "file_request";
  externalUrl?: string;
  formId?: string;
  fileRequestId?: string;
  artifactUploadId?: string;
  artifactFileName?: string;
  artifactContentType?: string;
  artifactVersions?: TaskArtifactVersion[];
  comments?: TaskComment[];
  form?: TaskFormDefinition;
}

export interface TaskFormDefinition {
  id: string;
  formId: string;
  version: number;
  title: string;
  description: string;
  fields: FormField[];
  response: Record<string, unknown>;
  responseStatus?: "draft" | "submitted";
}

export interface EmbedDefinition {
  id: string;
  name: string;
  eventId: string;
  format: "agenda" | "speaker_gallery";
  enabled: boolean;
  theme: "light" | "dark";
  updatedAt: string;
}

export interface Track {
  id: string;
  name: string;
  color: string;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
}

export interface ProgramSession {
  id: string;
  eventId: string;
  proposalId?: string;
  origin?: "proposal" | "direct_guaranteed" | "direct_sponsor" | "direct_program";
  title: string;
  description: string;
  format?: "keynote" | "talk" | "workshop" | "panel" | "lightning" | "break" | "networking";
  capacity?: number;
  ceuCredits?: string;
  clientId?: string;
  speakerIds: string[];
  speakerNames: string[];
  trackId?: string;
  roomId?: string;
  startsAt?: string;
  endsAt?: string;
  status: SessionStatus;
  overrideReason?: string;
}

export interface ResourcePage {
  id: string;
  title: string;
  slug: string;
  status: "draft" | "published";
  summary: string;
  /** Plain text authored by an organizer. It is never interpreted as HTML. */
  body: string;
  linkUrl?: string;
  updatedAt: string;
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  target: string;
  at: string;
  tone: "neutral" | "positive" | "warning";
}

export interface WorkspaceSnapshot {
  demoMode?: boolean;
  actor: Actor;
  actors: Actor[];
  event: EventRecord;
  forms: FormDefinition[];
  proposals: Proposal[];
  reviews: ReviewAssignment[];
  tasks: OnboardingTask[];
  tracks: Track[];
  rooms: Room[];
  sessions: ProgramSession[];
  resources: ResourcePage[];
  embeds?: EmbedDefinition[];
  reviewerGroups?: ReviewerGroupConfig[];
  taskTemplates?: TaskTemplateDefinition[];
  messageTemplates?: MessageTemplateDefinition[];
  reminderRules?: ReminderRule[];
  activity: ActivityItem[];
}

export interface ApiErrorShape {
  code: string;
  message: string;
  fieldErrors?: Record<string, string>;
  requestId: string;
}

export interface RealtimeEvent {
  type: "event.updated" | "proposal.updated" | "task.updated" | "schedule.updated";
  eventId: string;
  entity: string;
  entityId: string;
  version: number;
}

export interface ScheduleConflict {
  type: "room" | "track" | "speaker";
  resourceId: string;
  resourceName: string;
  sessionId: string;
  sessionTitle: string;
  startsAt: string;
  endsAt: string;
}
