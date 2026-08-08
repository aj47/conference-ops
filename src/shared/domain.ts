export type Role = "organizer" | "reviewer" | "applicant" | "speaker";

export type ProposalStatus =
  | "draft"
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

export type FormFieldType =
  | "short_text"
  | "long_text"
  | "email"
  | "url"
  | "select"
  | "multi_select"
  | "checkbox"
  | "file";

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
  options?: string[];
  condition?: FormCondition;
}

export interface FormDefinition {
  id: string;
  eventId: string;
  name: string;
  publicTitle?: string;
  pageHeading?: string;
  version: number;
  status: "draft" | "published" | "closed";
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
}

export interface Proposal {
  id: string;
  eventId: string;
  title: string;
  summary: string;
  category: string;
  format: "talk" | "workshop" | "panel" | "lightning";
  durationMinutes: number;
  level: "introductory" | "intermediate" | "advanced";
  status: ProposalStatus;
  speakers: SpeakerProfile[];
  submittedAt: string;
  score?: number;
  reviewCount: number;
  reviewerGroup: string;
  tags: string[];
}

export interface ReviewAssignment {
  id: string;
  proposalId: string;
  reviewerId: string;
  round: number;
  status: ReviewStatus;
  score?: number;
  recommendation?: "strong_yes" | "yes" | "maybe" | "no";
  notes?: string;
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
  completionMode?: "manual" | "form" | "file_request";
  formId?: string;
  fileRequestId?: string;
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
