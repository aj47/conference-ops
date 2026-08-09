/* eslint-disable react-refresh/only-export-components -- The provider and its typed hook are intentionally colocated. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { useInRouterContext, useLocation } from "react-router-dom";
import { createDemoWorkspace } from "../shared/demo-data";
import type {
  EventRecord,
  FormDefinition,
  FormField,
  FormVersionSettings,
  OnboardingTask,
  ProgramSession,
  Proposal,
  ProposalStatus,
  PublicEventLoadState,
  ReviewAssignment,
  ReviewResponseValue,
  Role,
  Room,
  ScheduleConflict,
  SpeakerProfile,
  TaskComment,
  Track,
  WorkspaceSnapshot,
} from "../shared/domain";
import { sectionedFormFields, splitFormFields } from "../shared/form-fields";
import { defaultFormVersionSettings, normalizeFormVersionSettings } from "../shared/form-settings";
import { evaluateReviewScores } from "../shared/review-rubric";
import { ApiClientError, conferenceApi, safeDownloadFileName, type CreateEventPayload } from "./api";
import { activateDemoAcceptance } from "./demo-acceptance";
import { dateTimeLocalToInstant, instantToDateTimeLocal } from "./event-time";
import { isPrivateWorkspaceRole } from "./private-routes";
import { actorWithRole } from "./role-selection";
import { privateDraftPreviewEventId, publicEventRouteFromPath, publicSubmissionFormKey } from "./public-routes";
import type { ApplicantSpeaker } from "./submission-speakers";
import { taskUploadPurpose } from "./upload-purpose";
import {
  isAuthenticatedWorkspacePath,
  preserveUnsavedBuilder,
  useVisibleWorkspaceRefresh,
} from "./workspace-refresh";

export type { ApplicantSpeaker } from "./submission-speakers";

export interface BuilderConfig {
  formId: string;
  version: number;
  publishedVersion: number;
  status: "draft" | "published" | "closed";
  submissionKind: "abstracts" | "sessions";
  collectParticipants: boolean;
  internalName: string;
  externalTitle: string;
  pageHeading: string;
  welcomeMessage: string;
  proposalSectionTitle: string;
  proposalPageHeading: string;
  proposalInstructions: string;
  participantSectionTitle: string;
  participantPageHeading: string;
  participantInstructions: string;
  participantMin: number;
  participantMax: number;
  proposalFields: FormField[];
  participantFields: FormField[];
  closeDate: string;
  submissionLimit: number;
  allowMultipleDrafts: boolean;
  autoRedirect: boolean;
  successMessage: string;
  combinedCharacterLimit: number;
  confirmationEnabled: boolean;
  dirty: boolean;
  lastSavedAt: string;
}

export interface ApplicantSubmission {
  title: string;
  summary: string;
  category: string;
  /** Supports forms that route one talk to more than one program track. */
  categories?: string[];
  format: Proposal["format"];
  level: Proposal["level"];
  repoUrl: string;
  workshopNeeds: string;
  responses: Record<string, unknown>;
  speakers: ApplicantSpeaker[];
}

interface ReviewPayload {
  scores: Record<string, ReviewResponseValue>;
  recommendation: "strong_yes" | "yes" | "maybe" | "no";
  notes: string;
  submit: boolean;
}

interface SchedulePayload {
  roomId: string;
  trackId: string;
  startsAt: string;
  endsAt: string;
  overrideReason?: string;
}

interface DirectSessionPayload {
  title: string;
  description: string;
  speakerIds: string[];
  kind: "guaranteed" | "sponsor" | "program";
  format: NonNullable<ProgramSession["format"]>;
  capacity?: number;
  ceuCredits?: string;
  clientId?: string;
}

interface WorkspaceContextValue {
  workspace: WorkspaceSnapshot;
  loading: boolean;
  source: "api" | "demo";
  authRequired: boolean;
  noEvent: boolean;
  notice: string | null;
  builder: BuilderConfig;
  publicBuilder: BuilderConfig | null;
  publicEventState: PublicEventLoadState;
  privateWorkspaceEventId: string | null;
  publicSpeakers: Array<Omit<SpeakerProfile, "email">>;
  updateProgramConfiguration: (patch: Partial<Pick<WorkspaceSnapshot, "reviewerGroups" | "taskTemplates" | "messageTemplates" | "reminderRules" | "resources">>) => void;
  setNotice: (notice: string | null) => void;
  switchActor: (actorId: string, role?: Role) => void;
  createEvent: (payload: CreateEventPayload) => Promise<void>;
  updateEvent: (patch: Partial<WorkspaceSnapshot["event"]>) => Promise<void>;
  createRoom: (payload: Pick<Room, "name" | "capacity">) => Promise<Room>;
  updateRoom: (roomId: string, payload: Pick<Room, "name" | "capacity">) => Promise<Room>;
  deleteRoom: (roomId: string) => Promise<void>;
  createTrack: (payload: Pick<Track, "name" | "color">) => Promise<Track>;
  updateTrack: (trackId: string, payload: Pick<Track, "name" | "color">) => Promise<Track>;
  deleteTrack: (trackId: string) => Promise<void>;
  selectBuilderForm: (formId: string) => void;
  createBuilderForm: (name: string) => Promise<FormDefinition>;
  closeBuilderForm: () => Promise<void>;
  updateBuilder: (patch: Partial<BuilderConfig>) => void;
  replaceBuilderFields: (kind: "proposal" | "participant", fields: FormField[]) => void;
  saveBuilder: () => Promise<void>;
  publishBuilder: () => Promise<void>;
  saveProposalDraft: (payload: ApplicantSubmission, activeBuilder: BuilderConfig, draft?: Proposal) => Promise<Proposal>;
  submitProposal: (payload: ApplicantSubmission, activeBuilder: BuilderConfig, draft?: Proposal) => Promise<Proposal>;
  withdrawProposal: (proposalId: string) => Promise<void>;
  reopenProposal: (proposalId: string) => ReturnType<typeof conferenceApi.reopenSubmission>;
  requestProposalChanges: (proposalId: string, note: string) => Promise<void>;
  decideProposal: (
    proposalId: string,
    status: Extract<
      ProposalStatus,
      "accept_queue" | "accepted" | "decline_queue" | "rejected" | "waitlisted"
    >,
    note?: string,
  ) => Promise<void>;
  saveReview: (proposalId: string, payload: ReviewPayload) => Promise<void>;
  toggleTask: (taskId: string, complete: boolean) => Promise<void>;
  addTask: (task: Pick<OnboardingTask, "speakerId" | "title" | "description" | "dueAt" | "type">) => void;
  updateProfile: (profileId: string, patch: Partial<SpeakerProfile>) => Promise<void>;
  uploadHeadshot: (
    profileId: string,
    file: File,
  ) => Promise<Pick<SpeakerProfile, "headshotUrl" | "profileComplete">>;
  scheduleSession: (sessionId: string, payload: SchedulePayload) => Promise<void>;
  detectConflicts: (sessionId: string, payload: SchedulePayload) => ScheduleConflict[];
  publishAgenda: () => Promise<void>;
  convertProposalToSession: (proposalId: string) => Promise<void>;
  addDirectSession: (payload: DirectSessionPayload) => Promise<void>;
  uploadTaskArtifact: (taskId: string, file: File) => Promise<void>;
  downloadTaskArtifact: (taskId: string, uploadId?: string) => Promise<void>;
  addTaskComment: (taskId: string, body: string) => Promise<void>;
  submitTaskForm: (taskId: string, responses: Record<string, unknown>) => Promise<void>;
}

function storedActorId(fallback = "user-organizer") {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage?.getItem("conference-ops-actor") ?? fallback;
  } catch {
    return fallback;
  }
}

function storeActorId(actorId: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem("conference-ops-actor", actorId);
  } catch {
    // Persona switching still works in-memory when storage is blocked or unavailable.
  }
}

const initialActorId = storedActorId();

const initialWorkspace = createDemoWorkspace(initialActorId);

const initialBuilder: BuilderConfig = {
  formId: initialWorkspace.forms[0].id,
  version: initialWorkspace.forms[0].version,
  publishedVersion: initialWorkspace.forms[0].status === "published" ? initialWorkspace.forms[0].version : 0,
  status: initialWorkspace.forms[0].status,
  submissionKind: "abstracts",
  collectParticipants: true,
  internalName: initialWorkspace.forms[0].name,
  externalTitle: "Bring the work behind the breakthrough",
  pageHeading: "Welcome",
  welcomeMessage: initialWorkspace.forms[0].welcomeCopy,
  proposalSectionTitle: defaultFormVersionSettings.proposalSectionTitle,
  proposalPageHeading: defaultFormVersionSettings.proposalPageHeading,
  proposalInstructions: defaultFormVersionSettings.proposalInstructions,
  participantSectionTitle: defaultFormVersionSettings.participantSectionTitle,
  participantPageHeading: defaultFormVersionSettings.participantPageHeading,
  participantInstructions: defaultFormVersionSettings.participantInstructions,
  participantMin: defaultFormVersionSettings.participantMin,
  participantMax: 4,
  proposalFields: initialWorkspace.forms[0].fields,
  participantFields: [
    { id: "speaker-first", label: "First name", type: "short_text", required: true },
    { id: "speaker-last", label: "Last name", type: "short_text", required: true },
    { id: "speaker-email", label: "Email", type: "email", required: true },
    { id: "speaker-phone", label: "Mobile phone", type: "short_text", required: false },
    { id: "speaker-bio", label: "Biography", type: "long_text", required: false },
  ],
  closeDate: instantToDateTimeLocal(initialWorkspace.event.cfpClosesAt, initialWorkspace.event.timezone),
  submissionLimit: 3,
  allowMultipleDrafts: true,
  autoRedirect: true,
  successMessage:
    "Your proposal is in. A confirmation email is on its way, and your speaker portal is ready for updates and follow-up tasks.",
  combinedCharacterLimit: defaultFormVersionSettings.combinedCharacterLimit,
  confirmationEnabled: true,
  dirty: false,
  lastSavedAt: "2026-08-08T07:30:00.000Z",
};

export function builderConfigFromForm(
  form: FormDefinition,
  event: EventRecord,
): BuilderConfig {
  const split = splitFormFields(form.fields);
  const hasSectionMetadata = form.fields.some((field) => Boolean(field.section));
  const participantFields = split.participantFields.length || hasSectionMetadata
    ? split.participantFields
    : initialBuilder.participantFields;
  const publishedVersion = form.publishedVersion
    ?? (form.status === "published" || form.status === "closed" ? form.version : 0);
  const settings = normalizeFormVersionSettings(form.settings);
  return {
    ...initialBuilder,
    formId: form.id,
    version: form.version,
    publishedVersion,
    status: form.status,
    submissionKind: form.submissionType === "session" ? "sessions" : "abstracts",
    collectParticipants: form.collectsParticipants ?? true,
    internalName: form.name,
    externalTitle: form.publicTitle ?? form.welcomeTitle,
    pageHeading: form.pageHeading ?? initialBuilder.pageHeading,
    welcomeMessage: form.welcomeCopy,
    proposalSectionTitle: settings.proposalSectionTitle,
    proposalPageHeading: settings.proposalPageHeading,
    proposalInstructions: settings.proposalInstructions,
    participantSectionTitle: settings.participantSectionTitle,
    participantPageHeading: settings.participantPageHeading,
    participantInstructions: settings.participantInstructions,
    participantMin: Math.min(settings.participantMin, form.maxSpeakers),
    participantMax: form.maxSpeakers,
    proposalFields: split.proposalFields,
    participantFields,
    closeDate: instantToDateTimeLocal(form.closesAt ?? event.cfpClosesAt, event.timezone),
    submissionLimit: form.maxSubmissionsPerUser ?? initialBuilder.submissionLimit,
    allowMultipleDrafts: form.allowMultipleDrafts,
    autoRedirect: form.redirectToPortal ?? true,
    successMessage: form.confirmationCopy,
    combinedCharacterLimit: settings.combinedCharacterLimit,
    confirmationEnabled: form.confirmationEmailEnabled ?? true,
    dirty: false,
    lastSavedAt: form.updatedAt ?? new Date().toISOString(),
  };
}

function workspaceSubmissionForm(forms: FormDefinition[], preferred?: string) {
  return forms.find((form) => form.kind === "cfp" && (form.id === preferred || form.slug === preferred))
    ?? forms.find((form) => form.kind === "cfp")
    ?? forms[0];
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function rangesOverlap(startA?: string, endA?: string, startB?: string, endB?: string) {
  if (!startA || !endA || !startB || !endB) return false;
  return new Date(startA) < new Date(endB) && new Date(startB) < new Date(endA);
}

function formVersionSettingsFromBuilder(config: BuilderConfig): FormVersionSettings {
  return {
    proposalSectionTitle: config.proposalSectionTitle,
    proposalPageHeading: config.proposalPageHeading,
    proposalInstructions: config.proposalInstructions,
    participantSectionTitle: config.participantSectionTitle,
    participantPageHeading: config.participantPageHeading,
    participantInstructions: config.participantInstructions,
    participantMin: config.participantMin,
    combinedCharacterLimit: config.combinedCharacterLimit,
  };
}

export function formDraftPayload(config: BuilderConfig, eventTimezone: string) {
  return {
    expectedVersion: config.version,
    name: config.internalName,
    publicTitle: config.externalTitle,
    pageHeading: config.pageHeading,
    submissionType: config.submissionKind === "abstracts" ? "abstract" as const : "session" as const,
    collectsParticipants: config.collectParticipants,
    welcomeTitle: config.externalTitle,
    welcomeCopy: config.welcomeMessage,
    confirmationCopy: config.successMessage,
    maxSpeakers: config.participantMax,
    maxSubmissionsPerUser: config.submissionLimit,
    closesAt: config.closeDate ? dateTimeLocalToInstant(config.closeDate, eventTimezone) : undefined,
    allowMultipleDrafts: config.allowMultipleDrafts,
    redirectToPortal: config.autoRedirect,
    confirmationEmailEnabled: config.confirmationEnabled,
    settings: formVersionSettingsFromBuilder(config),
    fields: sectionedFormFields(config.proposalFields, config.participantFields),
  };
}

function responseForField(
  field: FormField,
  payload: ApplicantSubmission,
  section: "proposal" | "participant",
): unknown {
  const primarySpeaker = payload.speakers[0];
  const label = field.label.trim().toLowerCase();
  if (section === "proposal" && (field.id === "field-title" || ["title", "session title", "proposal title"].includes(label))) return payload.title;
  if (section === "proposal" && (field.id === "field-summary" || ["abstract", "proposal summary", "session summary"].includes(label))) return payload.summary;
  if (section === "proposal" && (field.id === "field-category" || ["category", "program category", "program lane"].includes(label))) {
    return field.type === "multi_select" ? (payload.categories?.length ? payload.categories : payload.category ? [payload.category] : []) : payload.category;
  }
  if (section === "proposal" && (field.id === "field-format" || ["format", "preferred format", "session format"].includes(label))) {
    const label = payload.format === "lightning" ? "Lightning talk" : `${payload.format[0].toUpperCase()}${payload.format.slice(1)}`;
    return field.options?.find((option) => option.toLowerCase() === label.toLowerCase()) ?? label;
  }
  if (section === "proposal" && field.id === "field-repo") return payload.repoUrl;
  if (section === "proposal" && field.id === "field-workshop-needs") return payload.workshopNeeds;
  if (section === "participant" && (field.id === "speaker-first" || label === "first name")) return primarySpeaker?.firstName;
  if (section === "participant" && (field.id === "speaker-last" || label === "last name")) return primarySpeaker?.lastName;
  if (section === "participant" && (field.id === "speaker-email" || ["email", "email address", "contact email", "speaker email"].includes(label))) return primarySpeaker?.email;
  if (section === "participant" && (field.id === "speaker-bio" || ["biography", "bio", "speaker bio"].includes(label))) return primarySpeaker?.bio;
  if (section === "participant" && (field.id === "speaker-company" || ["company", "company / affiliation", "affiliation", "organization"].includes(label))) return primarySpeaker?.company;
  if (section === "participant" && (field.id === "speaker-title" || ["role", "role or title", "job title", "speaker title"].includes(label))) return primarySpeaker?.title;
  return payload.responses[field.id];
}

function submissionResponses(config: BuilderConfig, payload: ApplicantSubmission) {
  const responses: Record<string, unknown> = {};
  for (const field of config.proposalFields) {
    const value = responseForField(field, payload, "proposal");
    if (value !== undefined) responses[field.id] = value;
  }
  for (const field of config.collectParticipants ? config.participantFields : []) {
    const value = responseForField(field, payload, "participant");
    if (value !== undefined) responses[field.id] = value;
  }
  return responses;
}

function mayUseDemoFallback(error: unknown, source: "api" | "demo") {
  return source === "demo" && error instanceof ApiClientError;
}

const allowedHeadshotTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxHeadshotBytes = 10 * 1024 * 1024;

function validateHeadshot(file: File) {
  if (!allowedHeadshotTypes.has(file.type.toLowerCase())) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  if (file.size === 0) throw new Error("Choose a non-empty image file.");
  if (file.size > maxHeadshotBytes) throw new Error("Headshots must be 10 MB or smaller.");
}

function localHeadshotUrl(file: File, eventId: string, uploadId: string) {
  if (typeof URL.createObjectURL === "function") return URL.createObjectURL(file);
  return `/api/v1/events/${eventId}/uploads/${encodeURIComponent(uploadId)}`;
}

function saveDownloadedFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function toPublicSpeaker(speaker: SpeakerProfile): Omit<SpeakerProfile, "email"> {
  return {
    id: speaker.id,
    name: speaker.name,
    title: speaker.title,
    company: speaker.company,
    bio: speaker.bio,
    pronouns: speaker.pronouns,
    city: speaker.city,
    headshotUrl: speaker.headshotUrl,
    profileComplete: speaker.profileComplete,
  };
}

function WorkspaceProviderCore({ children, pathname, search }: PropsWithChildren<{ pathname: string; search: string }>) {
  const publicRoute = publicEventRouteFromPath(pathname);
  const publicFormKey = publicSubmissionFormKey(publicRoute, search);
  const draftPreviewEventId = privateDraftPreviewEventId(publicRoute, search);
  const publicSlug = draftPreviewEventId ? null : publicRoute?.slug ?? null;
  const requestedEventId = draftPreviewEventId
    ?? (publicSlug ? undefined : new URLSearchParams(search).get("eventId") ?? undefined);
  const requestedRoleValue = publicSlug ? null : new URLSearchParams(search).get("role");
  const requestedRole = isPrivateWorkspaceRole(requestedRoleValue) ? requestedRoleValue : undefined;
  const bootstrapTarget = publicSlug ? `public:${publicSlug}:${publicFormKey ?? "default"}` : `private:${requestedEventId ?? "default"}:${requestedRole ?? "default"}`;
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"api" | "demo">("demo");
  const [authRequired, setAuthRequired] = useState(false);
  const [noEvent, setNoEvent] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const localTaskArtifacts = useRef(new Map<string, File>());
  const [builder, setBuilder] = useState(initialBuilder);
  const [publicBuilder, setPublicBuilder] = useState<BuilderConfig | null>(null);
  const [publicEventState, setPublicEventState] = useState<PublicEventLoadState>(() =>
    publicRoute ? { status: "loading", slug: publicRoute.slug } : { status: "idle" },
  );
  const [privateWorkspaceEventId, setPrivateWorkspaceEventId] = useState<string | null>(null);
  const [publicSpeakers, setPublicSpeakers] = useState<Array<Omit<SpeakerProfile, "email">>>(
    initialWorkspace.proposals
      .filter((proposal) => proposal.status === "accepted")
      .flatMap((proposal) => proposal.speakers)
      .map(toPublicSpeaker),
  );
  const refreshTarget = `${workspace.event.id}:${workspace.actor.id}:${workspace.actor.role}`;
  const refreshTargetRef = useRef(refreshTarget);
  const currentWorkspaceRef = useRef(workspace);

  useEffect(() => {
    refreshTargetRef.current = refreshTarget;
    currentWorkspaceRef.current = workspace;
  }, [refreshTarget, workspace]);

  useEffect(() => {
    let active = true;
    const demoFallbackEnabled = import.meta.env.VITE_DEMO_MODE === "true";

    queueMicrotask(() => {
      if (!active) return;
      setLoading(true);
      setNotice(null);
      if (publicSlug) {
        setPublicBuilder(null);
        setPublicEventState({ status: "loading", slug: publicSlug });
      } else {
        setPublicEventState({ status: "idle" });
      }
    });

    if (publicSlug) {
      const publicRequest = publicFormKey
        ? conferenceApi.publicEvent(publicSlug, publicFormKey)
        : conferenceApi.publicEvent(publicSlug);
      publicRequest
        .then((data) => {
          if (!active) return;
          const publishedForm = data.form?.status === "published" ? data.form : null;
          const publicIsDemo = demoFallbackEnabled || data.demoMode === true;
          const tracks = [...new Map(data.sessions.filter((session) => session.trackId).map((session) => [session.trackId!, { id: session.trackId!, name: session.trackName ?? "Program", color: session.trackColor ?? data.event.accent }])).values()];
          const rooms = [...new Map(data.sessions.filter((session) => session.roomId).map((session) => [session.roomId!, { id: session.roomId!, name: session.roomName ?? "Room", capacity: 0 }])).values()];
          const sessions: ProgramSession[] = data.sessions.map((session) => ({
            id: session.id,
            eventId: data.event.id,
            title: session.title,
            description: session.description,
            format: session.format,
            speakerIds: session.speakerIds ?? [],
            speakerNames: session.speakerNames ?? [],
            trackId: session.trackId,
            roomId: session.roomId,
            startsAt: session.startsAt,
            endsAt: session.endsAt,
            status: session.status,
          }));
          setWorkspace((current) => ({
            ...current,
            event: { ...current.event, ...data.event },
            forms: publishedForm ? [publishedForm] : [],
            proposals: publicIsDemo ? current.proposals : [],
            reviews: publicIsDemo ? current.reviews : [],
            tasks: publicIsDemo ? current.tasks : [],
            tracks,
            rooms,
            sessions,
            resources: data.resources,
            activity: [],
          }));
          setPublicSpeakers(data.speakers.map((speaker) => toPublicSpeaker({ ...speaker, email: speaker.email ?? "" })));
          if (publishedForm) {
            const published = builderConfigFromForm(
              { ...publishedForm, publishedVersion: publishedForm.version },
              { ...initialWorkspace.event, ...data.event },
            );
            setPublicBuilder(published);
          } else {
            setPublicBuilder(null);
          }
          setSource(publicIsDemo ? "demo" : "api");
          setPublicEventState({
            status: "ready",
            slug: publicSlug,
            cfp: publishedForm ? "published" : "unavailable",
          });
        })
        .catch((error: unknown) => {
          if (!active) return;
          const message = error instanceof Error ? error.message : "This public event could not be loaded.";
          setSource(demoFallbackEnabled ? "demo" : "api");
          setPublicBuilder(null);
          setWorkspace((current) => ({
            ...current,
            forms: [],
            proposals: [],
            reviews: [],
            tasks: [],
            tracks: [],
            rooms: [],
            sessions: [],
            resources: [],
            activity: [],
          }));
          setPublicSpeakers([]);
          setPublicEventState({ status: "error", slug: publicSlug, message });
        })
        .finally(() => active && setLoading(false));
    } else {
      const selectedActorId = storedActorId(initialActorId);
      conferenceApi.bootstrap(selectedActorId, requestedEventId, requestedRole)
        .then((next) => {
          if (!active) return;
          setWorkspace(next);
          setPrivateWorkspaceEventId(next.event.id);
          const form = workspaceSubmissionForm(next.forms, draftPreviewEventId ? publicFormKey : undefined);
          if (form) setBuilder(builderConfigFromForm(form, next.event));
          const publishedForm = next.forms.find((candidate) => candidate.kind === "cfp" && candidate.status === "published");
          setPublicBuilder(publishedForm ? builderConfigFromForm(publishedForm, next.event) : null);
          setSource(next.demoMode ? "demo" : "api");
          setAuthRequired(false);
          setNoEvent(false);
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (demoFallbackEnabled) {
            setSource("demo");
            setPrivateWorkspaceEventId(initialWorkspace.event.id);
          } else {
            setSource("api");
            setAuthRequired(error instanceof ApiClientError && error.status === 401);
            const missingEvent = error instanceof ApiClientError && error.code === "NO_EVENT";
            setNoEvent(missingEvent);
            setNotice(missingEvent ? null : error instanceof Error ? error.message : "Sign in to open this workspace.");
          }
        })
        .finally(() => active && setLoading(false));
    }
    return () => {
      active = false;
    };
  }, [bootstrapTarget, draftPreviewEventId, publicFormKey, publicSlug, requestedEventId, requestedRole]);

  const refreshAuthenticatedWorkspace = useCallback(async () => {
    const eventId = workspace.event.id;
    const actorId = workspace.actor.id;
    const role = workspace.actor.role;
    const workspaceAtRequest = workspace;
    const builderAtRequest = builder;
    const requestedTarget = `${eventId}:${actorId}:${role}`;
    const next = await conferenceApi.bootstrap(actorId, eventId, role);

    // Ignore a response if this tab performed a newer local write, or the user
    // changed event/role, while the background read was in flight.
    if (
      refreshTargetRef.current !== requestedTarget
      || currentWorkspaceRef.current !== workspaceAtRequest
      || next.event.id !== eventId
      || next.actor.role !== role
    ) return;

    const nextForm = workspaceSubmissionForm(next.forms, builderAtRequest.formId);
    setWorkspace((current) => current === workspaceAtRequest ? next : current);
    setBuilder((current) => current === builderAtRequest
      ? preserveUnsavedBuilder(
          current,
          nextForm ? builderConfigFromForm(nextForm, next.event) : undefined,
        )
      : current);
  }, [builder, workspace]);

  useVisibleWorkspaceRefresh({
    enabled:
      !loading
      && source === "api"
      && !authRequired
      && !noEvent
      && isAuthenticatedWorkspacePath(window.location.pathname),
    refreshKey: refreshTarget,
    refresh: refreshAuthenticatedWorkspace,
  });

  const switchActor = useCallback((actorId: string, role?: Role) => {
    storeActorId(actorId);
    setWorkspace((current) => {
      const actor = actorWithRole(current.actors, actorId, role);
      return actor ? { ...current, actor } : createDemoWorkspace(actorId);
    });
    setNotice(null);
  }, []);

  const updateProgramConfiguration = useCallback((patch: Partial<Pick<WorkspaceSnapshot, "reviewerGroups" | "taskTemplates" | "messageTemplates" | "reminderRules" | "resources">>) => {
    setWorkspace((current) => ({ ...current, ...patch }));
  }, []);

  const updateBuilder = useCallback((patch: Partial<BuilderConfig>) => {
    setBuilder((current) => ({ ...current, ...patch, dirty: true }));
  }, []);

  const createEvent = useCallback(async (payload: CreateEventPayload) => {
    const created = await conferenceApi.createEvent(workspace.actor.id, payload);
    window.location.replace(`/workspace?eventId=${encodeURIComponent(created.id)}`);
  }, [workspace.actor.id]);

  const updateEvent = useCallback(async (patch: Partial<WorkspaceSnapshot["event"]>) => {
    const next = { ...workspace.event, ...patch };
    try {
      await conferenceApi.updateEvent(workspace.actor.id, workspace.event.id, {
        name: next.name,
        shortName: next.shortName,
        description: next.description,
        timezone: next.timezone,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        slug: next.slug,
        cfpClosesAt: next.cfpClosesAt,
        venue: next.venue,
        websiteUrl: next.websiteUrl,
        accent: next.accent,
      });
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "Event details could not be saved.");
        throw error;
      }
    }
    setWorkspace((current) => ({ ...current, event: { ...current.event, ...patch } }));
    setNotice("Event details saved across the workspace.");
  }, [source, workspace.actor.id, workspace.event]);

  const createRoom = useCallback(async (payload: Pick<Room, "name" | "capacity">) => {
    const normalized = { name: payload.name.trim(), capacity: payload.capacity };
    if (workspace.rooms.some((room) => room.name.trim().toLowerCase() === normalized.name.toLowerCase())) {
      const error = new Error("A room with that name already exists.");
      setNotice(error.message);
      throw error;
    }
    let saved: Room;
    try {
      saved = await conferenceApi.createRoom(workspace.actor.id, workspace.event.id, normalized);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The room could not be created.");
        throw error;
      }
      saved = { id: `room-${crypto.randomUUID()}`, ...normalized };
    }
    setWorkspace((current) => ({ ...current, rooms: [...current.rooms, saved] }));
    setNotice(`${saved.name} added to the room plan.`);
    return saved;
  }, [source, workspace.actor.id, workspace.event.id, workspace.rooms]);

  const updateRoom = useCallback(async (roomId: string, payload: Pick<Room, "name" | "capacity">) => {
    const normalized = { name: payload.name.trim(), capacity: payload.capacity };
    if (workspace.rooms.some((room) => room.id !== roomId && room.name.trim().toLowerCase() === normalized.name.toLowerCase())) {
      const error = new Error("A room with that name already exists.");
      setNotice(error.message);
      throw error;
    }
    let saved: Room;
    try {
      saved = await conferenceApi.updateRoom(workspace.actor.id, workspace.event.id, roomId, normalized);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The room could not be updated.");
        throw error;
      }
      saved = { id: roomId, ...normalized };
    }
    setWorkspace((current) => ({
      ...current,
      rooms: current.rooms.map((room) => room.id === roomId ? saved : room),
    }));
    setNotice(`${saved.name} updated.`);
    return saved;
  }, [source, workspace.actor.id, workspace.event.id, workspace.rooms]);

  const deleteRoom = useCallback(async (roomId: string) => {
    const room = workspace.rooms.find((candidate) => candidate.id === roomId);
    if (!room) throw new Error("Room not found.");
    if (workspace.sessions.some((session) => session.roomId === roomId)) {
      const error = new Error("Move sessions out of this room before deleting it.");
      setNotice(error.message);
      throw error;
    }
    try {
      await conferenceApi.deleteRoom(workspace.actor.id, workspace.event.id, roomId);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The room could not be deleted.");
        throw error;
      }
    }
    setWorkspace((current) => ({ ...current, rooms: current.rooms.filter((candidate) => candidate.id !== roomId) }));
    setNotice(`${room.name} removed from the room plan.`);
  }, [source, workspace.actor.id, workspace.event.id, workspace.rooms, workspace.sessions]);

  const createTrack = useCallback(async (payload: Pick<Track, "name" | "color">) => {
    const normalized = { name: payload.name.trim(), color: payload.color.toLowerCase() };
    if (workspace.tracks.some((track) => track.name.trim().toLowerCase() === normalized.name.toLowerCase())) {
      const error = new Error("A track with that name already exists.");
      setNotice(error.message);
      throw error;
    }
    let saved: Track;
    try {
      saved = await conferenceApi.createTrack(workspace.actor.id, workspace.event.id, normalized);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The track could not be created.");
        throw error;
      }
      saved = { id: `track-${crypto.randomUUID()}`, ...normalized };
    }
    setWorkspace((current) => ({ ...current, tracks: [...current.tracks, saved] }));
    setNotice(`${saved.name} added to the program tracks.`);
    return saved;
  }, [source, workspace.actor.id, workspace.event.id, workspace.tracks]);

  const updateTrack = useCallback(async (trackId: string, payload: Pick<Track, "name" | "color">) => {
    const normalized = { name: payload.name.trim(), color: payload.color.toLowerCase() };
    if (workspace.tracks.some((track) => track.id !== trackId && track.name.trim().toLowerCase() === normalized.name.toLowerCase())) {
      const error = new Error("A track with that name already exists.");
      setNotice(error.message);
      throw error;
    }
    let saved: Track;
    try {
      saved = await conferenceApi.updateTrack(workspace.actor.id, workspace.event.id, trackId, normalized);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The track could not be updated.");
        throw error;
      }
      saved = { id: trackId, ...normalized };
    }
    setWorkspace((current) => ({
      ...current,
      tracks: current.tracks.map((track) => track.id === trackId ? saved : track),
    }));
    setNotice(`${saved.name} updated.`);
    return saved;
  }, [source, workspace.actor.id, workspace.event.id, workspace.tracks]);

  const deleteTrack = useCallback(async (trackId: string) => {
    const track = workspace.tracks.find((candidate) => candidate.id === trackId);
    if (!track) throw new Error("Track not found.");
    if (workspace.sessions.some((session) => session.trackId === trackId)) {
      const error = new Error("Move sessions out of this track before deleting it.");
      setNotice(error.message);
      throw error;
    }
    try {
      await conferenceApi.deleteTrack(workspace.actor.id, workspace.event.id, trackId);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The track could not be deleted.");
        throw error;
      }
    }
    setWorkspace((current) => ({ ...current, tracks: current.tracks.filter((candidate) => candidate.id !== trackId) }));
    setNotice(`${track.name} removed from the program tracks.`);
  }, [source, workspace.actor.id, workspace.event.id, workspace.sessions, workspace.tracks]);

  const replaceBuilderFields = useCallback(
    (kind: "proposal" | "participant", fields: FormField[]) => {
      updateBuilder(kind === "proposal" ? { proposalFields: fields } : { participantFields: fields });
    },
    [updateBuilder],
  );

  const selectBuilderForm = useCallback((formId: string) => {
    const form = workspace.forms.find((candidate) => candidate.id === formId && candidate.kind === "cfp");
    if (!form) throw new Error("Submission form not found.");
    setBuilder(builderConfigFromForm(form, workspace.event));
  }, [workspace.event, workspace.forms]);

  const createBuilderForm = useCallback(async (name: string) => {
    const nextConfig: BuilderConfig = {
      ...builder,
      formId: "",
      version: 1,
      publishedVersion: 0,
      status: "draft",
      internalName: name,
      externalTitle: name,
      dirty: false,
      lastSavedAt: new Date().toISOString(),
    };
    const draftPayload = formDraftPayload(nextConfig, workspace.event.timezone);
    const payload = Object.fromEntries(
      Object.entries(draftPayload).filter(([key]) => key !== "expectedVersion"),
    ) as Omit<typeof draftPayload, "expectedVersion">;
    let created: FormDefinition;
    try {
      created = await conferenceApi.createForm(workspace.actor.id, workspace.event.id, payload);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The submission form could not be created.");
        throw error;
      }
      created = {
        id: `form-${crypto.randomUUID()}`,
        eventId: workspace.event.id,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}-${crypto.randomUUID().slice(0, 6)}`,
        kind: "cfp",
        name,
        publicTitle: name,
        pageHeading: nextConfig.pageHeading,
        version: 1,
        status: "draft",
        submissionType: nextConfig.submissionKind === "abstracts" ? "abstract" : "session",
        collectsParticipants: nextConfig.collectParticipants,
        welcomeTitle: name,
        welcomeCopy: nextConfig.welcomeMessage,
        confirmationCopy: nextConfig.successMessage,
        maxSpeakers: nextConfig.participantMax,
        maxSubmissionsPerUser: nextConfig.submissionLimit,
        closesAt: nextConfig.closeDate ? dateTimeLocalToInstant(nextConfig.closeDate, workspace.event.timezone) : undefined,
        redirectToPortal: nextConfig.autoRedirect,
        confirmationEmailEnabled: nextConfig.confirmationEnabled,
        allowMultipleDrafts: nextConfig.allowMultipleDrafts,
        settings: formVersionSettingsFromBuilder(nextConfig),
        fields: sectionedFormFields(nextConfig.proposalFields, nextConfig.participantFields),
        submissions: 0,
        updatedAt: nextConfig.lastSavedAt,
      };
    }
    setWorkspace((current) => ({ ...current, forms: [created, ...current.forms] }));
    setBuilder(builderConfigFromForm(created, workspace.event));
    setNotice(`${created.name} created as a private draft.`);
    return created;
  }, [builder, source, workspace.actor.id, workspace.event]);

  const closeBuilderForm = useCallback(async () => {
    if (builder.status !== "published") throw new Error("Only a published form can be closed.");
    try {
      await conferenceApi.closeForm(workspace.actor.id, workspace.event.id, builder.formId);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The form could not be closed.");
        throw error;
      }
    }
    const closedAt = new Date().toISOString();
    setBuilder((current) => ({ ...current, status: "closed", lastSavedAt: closedAt }));
    setWorkspace((current) => ({ ...current, forms: current.forms.map((form) => form.id === builder.formId ? { ...form, status: "closed", closesAt: closedAt, updatedAt: closedAt } : form) }));
    setNotice(`${builder.internalName} closed. Existing submissions remain available; new submissions are blocked.`);
  }, [builder.formId, builder.internalName, builder.status, source, workspace.actor.id, workspace.event.id]);

  const saveBuilder = useCallback(async () => {
    let savedVersion = builder.version;
    try {
      const saved = await conferenceApi.saveForm(
        workspace.actor.id,
        workspace.event.id,
        builder.formId,
        formDraftPayload(builder, workspace.event.timezone),
      );
      savedVersion = saved.version;
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The form draft could not be saved.");
        throw error;
      }
      savedVersion = builder.status === "published" && builder.dirty ? builder.version + 1 : builder.version;
    }
    const savedAt = new Date().toISOString();
    setBuilder((current) => ({
      ...current,
      version: savedVersion,
      status: savedVersion === current.publishedVersion ? "published" : "draft",
      dirty: false,
      lastSavedAt: savedAt,
    }));
    setWorkspace((current) => ({
      ...current,
      forms: current.forms.map((form) =>
        form.id === builder.formId
          ? {
              ...form,
              version: savedVersion,
              publishedVersion: builder.publishedVersion || undefined,
              status: "draft",
              submissionType: builder.submissionKind === "abstracts" ? "abstract" : "session",
              collectsParticipants: builder.collectParticipants,
              publicTitle: builder.externalTitle,
              pageHeading: builder.pageHeading,
              welcomeTitle: builder.externalTitle,
              welcomeCopy: builder.welcomeMessage,
              confirmationCopy: builder.successMessage,
              maxSpeakers: builder.participantMax,
              maxSubmissionsPerUser: builder.submissionLimit,
              closesAt: builder.closeDate ? dateTimeLocalToInstant(builder.closeDate, workspace.event.timezone) : undefined,
              redirectToPortal: builder.autoRedirect,
              confirmationEmailEnabled: builder.confirmationEnabled,
              allowMultipleDrafts: builder.allowMultipleDrafts,
              settings: formVersionSettingsFromBuilder(builder),
              fields: sectionedFormFields(builder.proposalFields, builder.participantFields),
              updatedAt: savedAt,
            }
          : form,
      ),
    }));
    setNotice(
      `Draft version ${savedVersion} saved. Private preview uses it; the public link remains on published version ${builder.publishedVersion}.`,
    );
  }, [builder, source, workspace.actor.id, workspace.event.id, workspace.event.timezone]);

  const publishBuilder = useCallback(async () => {
    let nextVersion = builder.version;
    try {
      if (builder.dirty) {
        const saved = await conferenceApi.saveForm(
          workspace.actor.id,
          workspace.event.id,
          builder.formId,
          formDraftPayload(builder, workspace.event.timezone),
        );
        nextVersion = saved.version;
      }
      await conferenceApi.publishForm(
        workspace.actor.id,
        workspace.event.id,
        builder.formId,
        nextVersion,
      );
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The form could not be published.");
        throw error;
      }
      if (builder.dirty && builder.version === builder.publishedVersion) nextVersion += 1;
    }
    const publishedAt = new Date().toISOString();
    const published = {
      ...builder,
      version: nextVersion,
      publishedVersion: nextVersion,
      status: "published" as const,
      dirty: false,
      lastSavedAt: publishedAt,
    };
    setBuilder((current) => ({
      ...current,
      version: nextVersion,
      publishedVersion: nextVersion,
      status: "published",
      dirty: false,
      lastSavedAt: publishedAt,
    }));
    setPublicBuilder(published);
    setWorkspace((current) => ({
      ...current,
      forms: current.forms.map((form) =>
        form.id === builder.formId
          ? {
              ...form,
              version: nextVersion,
              publishedVersion: nextVersion,
              status: "published",
              settings: formVersionSettingsFromBuilder(builder),
              fields: sectionedFormFields(builder.proposalFields, builder.participantFields),
              updatedAt: publishedAt,
            }
          : form,
      ),
    }));
    setNotice(`Version ${nextVersion} published. The public call for speakers is live.`);
  }, [builder, source, workspace.actor.id, workspace.event.id, workspace.event.timezone]);

  const persistProposal = useCallback(
    async (payload: ApplicantSubmission, activeBuilder: BuilderConfig, submit: boolean, draft?: Proposal) => {
      const durationMinutes = payload.format === "workshop" ? 60 : payload.format === "lightning" ? 10 : payload.format === "panel" ? 45 : 30;
      let response: { id: string; status: string; version?: number; submittedAt?: string | null } = {
        id: draft?.id ?? `proposal-${crypto.randomUUID()}`,
        status: submit ? "submitted" : "draft",
        version: draft ? (draft.version ?? 0) + 1 : 1,
        submittedAt: submit ? new Date().toISOString() : null,
      };
      const requestPayload = {
        title: payload.title,
        summary: payload.summary,
        category: payload.categories?.[0] ?? payload.category,
        format: payload.format,
        durationMinutes,
        level: payload.level,
        responses: submissionResponses(activeBuilder, payload),
        speakers: payload.speakers.map((speaker) => ({
          name: `${speaker.firstName} ${speaker.lastName}`.trim(),
          email: speaker.email,
          title: speaker.title,
          company: speaker.company,
          bio: speaker.bio,
        })),
        submit,
      };
      try {
        await conferenceApi.enroll(workspace.actor.id, workspace.event.id);
        response = draft
          ? await conferenceApi.updateSubmission(workspace.actor.id, workspace.event.id, draft.id, {
              ...requestPayload,
              expectedVersion: draft.version ?? 1,
            })
          : await conferenceApi.submitProposal(workspace.actor.id, workspace.event.id, {
              ...requestPayload,
              formId: activeBuilder.formId,
            });
      } catch (error) {
        if (!mayUseDemoFallback(error, source)) {
          setNotice(error instanceof Error ? error.message : `The proposal could not be ${submit ? "submitted" : "saved"}.`);
          throw error;
        }
      }
      const knownProfiles = [...(draft?.speakers ?? []), ...workspace.proposals.flatMap((proposal) => proposal.speakers)];
      const profiles: SpeakerProfile[] = payload.speakers.map((speaker, index) => {
        const existingProfile = knownProfiles.find((candidate) =>
          candidate.email.toLowerCase() === speaker.email.toLowerCase()
          || (index === 0 && workspace.actor.role === "applicant" && candidate.email === workspace.actor.email),
        );
        return {
          id: existingProfile?.id ?? `speaker-${crypto.randomUUID()}`,
          name: `${speaker.firstName} ${speaker.lastName}`.trim(),
          email: speaker.email,
          title: speaker.title,
          company: speaker.company,
          bio: speaker.bio,
          profileComplete: Boolean(speaker.bio && speaker.title && speaker.company),
        };
      });
      const proposal: Proposal = {
        id: response.id,
        eventId: workspace.event.id,
        version: response.version ?? (draft ? (draft.version ?? 0) + 1 : 1),
        title: payload.title,
        summary: payload.summary,
        category: payload.categories?.length ? payload.categories.join(", ") : payload.category,
        format: payload.format,
        durationMinutes,
        level: payload.level,
        status: response.status as ProposalStatus,
        revisionRequest: draft?.revisionRequest,
        speakers: profiles,
        submittedAt: response.submittedAt ?? draft?.submittedAt ?? new Date().toISOString(),
        reviewCount: draft?.reviewCount ?? 0,
        reviewerGroup:
          (payload.categories?.[0] ?? payload.category) === "Evaluation & safety" ? "Evaluation committee" : "Agent systems committee",
        tags: draft?.tags ?? (payload.format === "workshop" ? ["workshop", "new"] : ["new"]),
        responses: requestPayload.responses,
        customResponses: draft?.customResponses,
        ...(draft?.form ? { form: draft.form } : {}),
      };
      setWorkspace((current) => ({
        ...current,
        proposals: draft
          ? current.proposals.map((item) => item.id === draft.id ? proposal : item)
          : [proposal, ...current.proposals.map((item) => ({
            ...item,
            speakers: item.speakers.map((speaker) => profiles.find((profile) => profile.id === speaker.id) ?? speaker),
          }))],
      }));
      setNotice(submit
        ? draft?.status === "changes_requested" || draft?.status === "revision_open"
          ? "Revision resubmitted. Open reviewer assignments were rebuilt and historical final reviews were preserved."
          : "Proposal submitted. Confirmation queued and speaker portal opened."
        : "Draft saved to your verified conference account.");
      return proposal;
    },
    [source, workspace.actor, workspace.event.id, workspace.proposals],
  );

  const saveProposalDraft = useCallback(
    (payload: ApplicantSubmission, activeBuilder: BuilderConfig, draft?: Proposal) => persistProposal(payload, activeBuilder, false, draft),
    [persistProposal],
  );

  const submitProposal = useCallback(
    (payload: ApplicantSubmission, activeBuilder: BuilderConfig, draft?: Proposal) => persistProposal(payload, activeBuilder, true, draft),
    [persistProposal],
  );

  const withdrawProposal = useCallback(async (proposalId: string) => {
    try {
      await conferenceApi.withdrawSubmission(workspace.actor.id, workspace.event.id, proposalId);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The proposal could not be withdrawn.");
        throw error;
      }
    }
    setWorkspace((current) => ({
      ...current,
      proposals: current.proposals.map((proposal) => proposal.id === proposalId
        ? { ...proposal, status: "withdrawn", version: (proposal.version ?? 0) + 1 }
        : proposal),
    }));
    setNotice("Proposal withdrawn. Review activity has stopped.");
  }, [source, workspace.actor.id, workspace.event.id]);

  const reopenProposal = useCallback(async (proposalId: string) => {
    let result: Awaited<ReturnType<typeof conferenceApi.reopenSubmission>> | undefined;
    try {
      result = await conferenceApi.reopenSubmission(workspace.actor.id, workspace.event.id, proposalId);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The submission could not be opened for editing.");
        throw error;
      }
    }
    const fallback = {
      id: proposalId,
      status: "revision_open" as const,
      version: (workspace.proposals.find((proposal) => proposal.id === proposalId)?.version ?? 1) + 1,
      revisionRequestedAt: new Date().toISOString(),
      revokedAssignments: 0,
      submittedReviewsPreserved: 0,
    };
    const reopened = result ?? fallback;
    if (source === "api") {
      const next = await conferenceApi.bootstrap(workspace.actor.id, workspace.event.id, workspace.actor.role);
      setWorkspace(next);
    } else {
      setWorkspace((current) => ({
        ...current,
        proposals: current.proposals.map((proposal) => proposal.id === proposalId ? {
          ...proposal,
          status: "revision_open",
          version: reopened.version,
          revisionRequest: {
            note: "Applicant reopened this proposal for editing before the CFP deadline.",
            requestedAt: reopened.revisionRequestedAt,
            requestedBy: "applicant",
          },
        } : proposal),
        reviews: current.reviews.filter((review) => review.proposalId !== proposalId || review.status === "submitted"),
      }));
    }
    setNotice(`Submission opened for editing. ${reopened.revokedAssignments} open reviewer ${reopened.revokedAssignments === 1 ? "assignment was" : "assignments were"} stopped; ${reopened.submittedReviewsPreserved} final ${reopened.submittedReviewsPreserved === 1 ? "review remains" : "reviews remain"} preserved.`);
    return reopened;
  }, [source, workspace.actor.id, workspace.actor.role, workspace.event.id, workspace.proposals]);

  const requestProposalChanges = useCallback(async (proposalId: string, note: string) => {
    let result: Awaited<ReturnType<typeof conferenceApi.requestProposalChanges>> | undefined;
    try {
      result = await conferenceApi.requestProposalChanges(workspace.actor.id, workspace.event.id, proposalId, note);
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The revision request could not be sent.");
        throw error;
      }
    }
    if (source === "api") {
      const next = await conferenceApi.bootstrap(workspace.actor.id, workspace.event.id, workspace.actor.role);
      setWorkspace(next);
    } else {
      setWorkspace((current) => ({
        ...current,
        proposals: current.proposals.map((proposal) => proposal.id === proposalId
          ? {
              ...proposal,
              status: "changes_requested",
              version: (proposal.version ?? 0) + 1,
              revisionRequest: { note, requestedAt: result?.revisionRequestedAt ?? new Date().toISOString(), requestedBy: "organizer" },
            }
          : proposal),
        reviews: current.reviews.filter((review) => review.proposalId !== proposalId || review.status === "submitted"),
      }));
    }
    setNotice(`Revision requested. ${result?.revokedAssignments ?? "Open"} reviewer assignments stopped, ${result?.submittedReviewsPreserved ?? "submitted"} final reviews preserved, and ${result?.messagesQueued ?? 1} ${result?.messagesQueued === 1 ? "email" : "emails"} queued.`);
  }, [source, workspace.actor.id, workspace.actor.role, workspace.event.id]);

  const decideProposal = useCallback(
    async (
      proposalId: string,
      status: Extract<ProposalStatus, "accept_queue" | "accepted" | "decline_queue" | "rejected" | "waitlisted">,
      note?: string,
    ) => {
      let result: Awaited<ReturnType<typeof conferenceApi.decide>> | undefined;
      try {
        result = await conferenceApi.decide(workspace.actor.id, workspace.event.id, proposalId, status, note);
      } catch (error) {
        if (!mayUseDemoFallback(error, source)) {
          setNotice(error instanceof Error ? error.message : "The proposal decision could not be saved.");
          throw error;
        }
      }
      if (source === "api") {
        const next = await conferenceApi.bootstrap(workspace.actor.id, workspace.event.id, workspace.actor.role);
        setWorkspace(next);
      } else {
        setWorkspace((current) => status === "accepted"
          ? activateDemoAcceptance(current, proposalId, result?.sessionId)
          : {
              ...current,
              proposals: current.proposals.map((proposal) =>
                proposal.id === proposalId ? { ...proposal, status } : proposal,
              ),
            });
      }
      const activation = status === "accepted"
        ? ` Session created, ${result?.speakerTasksCreated ?? "speaker"} onboarding tasks assigned, and ${result?.messagesQueued ?? 1} decision ${result?.messagesQueued === 1 ? "email" : "emails"} queued.`
        : status === "rejected" ? ` ${result?.messagesQueued ?? 1} decision ${result?.messagesQueued === 1 ? "email" : "emails"} queued.` : "";
      setNotice(`Decision recorded: ${status.replace("_", " ")}.${activation}`);
    },
    [source, workspace.actor.id, workspace.actor.role, workspace.event.id],
  );

  const saveReview = useCallback(
    async (proposalId: string, payload: ReviewPayload) => {
      let saved: Awaited<ReturnType<typeof conferenceApi.review>> | undefined;
      try {
        saved = await conferenceApi.review(workspace.actor.id, workspace.event.id, proposalId, payload);
      } catch (error) {
        if (!mayUseDemoFallback(error, source)) {
          setNotice(error instanceof Error ? error.message : "The review could not be saved.");
          throw error;
        }
      }
      setWorkspace((current) => {
        const existing = current.reviews.find(
          (review) => review.proposalId === proposalId && review.reviewerId === current.actor.id,
        );
        if (!existing) return current;
        const evaluation = evaluateReviewScores(existing.rubric, payload.scores, payload.submit);
        const review: ReviewAssignment = {
          ...existing,
          status: payload.submit ? "submitted" : "in_progress",
          scores: saved?.scores ?? evaluation.scores,
          score: saved?.score ?? evaluation.totalScore,
          recommendation: payload.recommendation,
          notes: payload.notes,
        };
        return {
          ...current,
          reviews: current.reviews.map((item) => (item.id === existing.id ? review : item)),
          proposals: current.proposals.map((proposal) =>
            proposal.id === proposalId
              ? {
                  ...proposal,
                  status: proposal.status === "submitted" ? "under_review" : proposal.status,
                }
              : proposal,
          ),
        };
      });
      setNotice(payload.submit ? "Review submitted to the committee." : "Review draft saved.");
    },
    [source, workspace.actor.id, workspace.event.id],
  );

  const toggleTask = useCallback(
    async (taskId: string, complete: boolean) => {
      try {
        await conferenceApi.completeTask(workspace.actor.id, workspace.event.id, taskId, complete);
      } catch (error) {
        if (!mayUseDemoFallback(error, source)) {
          setNotice(error instanceof Error ? error.message : "The task could not be updated.");
          throw error;
        }
      }
      setWorkspace((current) => ({
        ...current,
        tasks: current.tasks.map((task): OnboardingTask =>
          task.id === taskId ? { ...task, status: complete ? "complete" : "in_progress" } : task,
        ),
      }));
      setNotice(complete ? "Task marked complete." : "Task reopened.");
    },
    [source, workspace.actor.id, workspace.event.id],
  );

  const addTask = useCallback((task: Pick<OnboardingTask, "speakerId" | "title" | "description" | "dueAt" | "type">) => {
    setWorkspace((current) => ({
      ...current,
      tasks: [{ id: `task-${crypto.randomUUID()}`, eventId: current.event.id, status: "not_started", ...task }, ...current.tasks],
    }));
    setNotice("Onboarding task assigned.");
  }, []);

  const updateProfile = useCallback(async (profileId: string, patch: Partial<SpeakerProfile>) => {
    const currentProfile = workspace.proposals
      .flatMap((proposal) => proposal.speakers)
      .find((speaker) => speaker.id === profileId);
    if (!currentProfile) throw new Error("Speaker profile not found.");
    const nextProfile = { ...currentProfile, ...patch };
    let profileComplete = nextProfile.profileComplete;
    try {
      const saved = await conferenceApi.updateProfile(
        workspace.actor.id,
        workspace.event.id,
        profileId,
        {
          name: nextProfile.name,
          title: nextProfile.title,
          company: nextProfile.company,
          bio: nextProfile.bio,
          pronouns: nextProfile.pronouns,
          city: nextProfile.city,
        },
      );
      profileComplete = saved.profileComplete
        || (source === "demo" && currentProfile.profileComplete && Boolean(nextProfile.bio.trim()));
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The speaker profile could not be saved.");
        throw error;
      }
    }
    const savedProfile = { ...nextProfile, profileComplete };
    setWorkspace((current) => ({
      ...current,
      proposals: current.proposals.map((proposal) => ({
        ...proposal,
        speakers: proposal.speakers.map((speaker) =>
          speaker.id === profileId ? savedProfile : speaker,
        ),
      })),
    }));
    setPublicSpeakers((current) => current.map((speaker) =>
      speaker.id === profileId ? toPublicSpeaker(savedProfile) : speaker,
    ));
    setNotice("Profile saved. Public speaker details are up to date.");
  }, [source, workspace.actor.id, workspace.event.id, workspace.proposals]);

  const uploadHeadshot = useCallback(async (profileId: string, file: File) => {
    try {
      validateHeadshot(file);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Choose a valid headshot image.");
      throw error;
    }
    const currentProfile = workspace.proposals
      .flatMap((proposal) => proposal.speakers)
      .find((speaker) => speaker.id === profileId);
    if (!currentProfile) {
      const error = new Error("Speaker profile not found.");
      setNotice(error.message);
      throw error;
    }

    let uploadId = `demo-headshot-${crypto.randomUUID()}`;
    let profileComplete = Boolean(currentProfile.bio.trim());
    try {
      const uploaded = await conferenceApi.upload(
        workspace.actor.id,
        workspace.event.id,
        file,
        "headshot",
      );
      uploadId = uploaded.id;
      const saved = await conferenceApi.updateProfile(
        workspace.actor.id,
        workspace.event.id,
        profileId,
        {
          name: currentProfile.name,
          title: currentProfile.title,
          company: currentProfile.company,
          bio: currentProfile.bio,
          pronouns: currentProfile.pronouns,
          city: currentProfile.city,
          headshotUploadId: uploaded.id,
        },
      );
      profileComplete = saved.profileComplete;
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The headshot could not be saved.");
        throw error;
      }
    }

    const headshotUrl = localHeadshotUrl(file, workspace.event.id, uploadId);
    const savedProfile = { ...currentProfile, headshotUrl, profileComplete };
    setWorkspace((current) => ({
      ...current,
      proposals: current.proposals.map((proposal) => ({
        ...proposal,
        speakers: proposal.speakers.map((speaker) =>
          speaker.id === profileId ? savedProfile : speaker,
        ),
      })),
    }));
    setPublicSpeakers((current) => current.map((speaker) =>
      speaker.id === profileId ? toPublicSpeaker(savedProfile) : speaker,
    ));
    if (
      currentProfile.headshotUrl?.startsWith("blob:")
      && typeof URL.revokeObjectURL === "function"
    ) {
      URL.revokeObjectURL(currentProfile.headshotUrl);
    }
    setNotice("Headshot saved to your public speaker profile.");
    return { headshotUrl, profileComplete };
  }, [source, workspace.actor.id, workspace.event.id, workspace.proposals]);

  const detectConflicts = useCallback(
    (sessionId: string, payload: SchedulePayload) => {
      const target = workspace.sessions.find((session) => session.id === sessionId);
      if (!target) return [];
      return workspace.sessions.flatMap((session): ScheduleConflict[] => {
        if (
          session.id === sessionId ||
          !rangesOverlap(payload.startsAt, payload.endsAt, session.startsAt, session.endsAt)
        ) {
          return [];
        }
        const conflicts: ScheduleConflict[] = [];
        if (session.roomId === payload.roomId) {
          conflicts.push({
            type: "room",
            resourceId: payload.roomId,
            resourceName: workspace.rooms.find((room) => room.id === payload.roomId)?.name ?? "Room",
            sessionId: session.id,
            sessionTitle: session.title,
            startsAt: session.startsAt!,
            endsAt: session.endsAt!,
          });
        }
        if (session.trackId === payload.trackId) {
          conflicts.push({
            type: "track",
            resourceId: payload.trackId,
            resourceName: workspace.tracks.find((track) => track.id === payload.trackId)?.name ?? "Track",
            sessionId: session.id,
            sessionTitle: session.title,
            startsAt: session.startsAt!,
            endsAt: session.endsAt!,
          });
        }
        const speakerId = target.speakerIds.find((id) => session.speakerIds.includes(id));
        if (speakerId) {
          conflicts.push({
            type: "speaker",
            resourceId: speakerId,
            resourceName:
              target.speakerNames[target.speakerIds.indexOf(speakerId)] ?? "Speaker",
            sessionId: session.id,
            sessionTitle: session.title,
            startsAt: session.startsAt!,
            endsAt: session.endsAt!,
          });
        }
        return conflicts;
      });
    },
    [workspace.rooms, workspace.sessions, workspace.tracks],
  );

  const scheduleSession = useCallback(
    async (sessionId: string, payload: SchedulePayload) => {
      const previousStatus = workspace.sessions.find((session) => session.id === sessionId)?.status ?? "unscheduled";
      let nextStatus: ProgramSession["status"] = previousStatus === "published" ? "published" : "scheduled";
      try {
        const saved = await conferenceApi.schedule(
          workspace.actor.id,
          workspace.event.id,
          sessionId,
          payload,
        );
        nextStatus = saved.status;
      } catch (error) {
        if (!mayUseDemoFallback(error, source)) {
          setNotice(error instanceof Error ? error.message : "The session could not be scheduled.");
          throw error;
        }
      }
      setWorkspace((current) => ({
        ...current,
        sessions: current.sessions.map((session): ProgramSession =>
          session.id === sessionId
            ? { ...session, ...payload, status: nextStatus }
            : session,
        ),
      }));
      setNotice(
        payload.overrideReason
          ? "Session scheduled with an audited override."
          : nextStatus === "published"
            ? "Published session moved; the live agenda now reflects the new time and room."
            : "Session scheduled.",
      );
    },
    [source, workspace.actor.id, workspace.event.id, workspace.sessions],
  );

  const publishAgenda = useCallback(async () => {
    const scheduledIds = workspace.sessions
      .filter((session) => session.status === "scheduled" || session.status === "published")
      .map((session) => session.id);
    if (!scheduledIds.length) throw new Error("Schedule at least one session before publishing.");
    let approvedSessions = scheduledIds.length;
    try {
      const published = await conferenceApi.publishAgenda(
        workspace.actor.id,
        workspace.event.id,
        scheduledIds,
      );
      approvedSessions = published.approvedSessions;
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The agenda could not be published.");
        throw error;
      }
    }
    setWorkspace((current) => ({
      ...current,
      event: { ...current.event, status: "agenda_published" },
      sessions: current.sessions.map((session): ProgramSession =>
        scheduledIds.includes(session.id) ? { ...session, status: "published" } : session,
      ),
    }));
    setNotice(`Agenda published with ${scheduledIds.length} sessions. ${approvedSessions} approved for public view.`);
  }, [source, workspace.actor.id, workspace.event.id, workspace.sessions]);

  const convertProposalToSession = useCallback(async (proposalId: string) => {
    const proposal = workspace.proposals.find((item) => item.id === proposalId);
    if (!proposal || proposal.status !== "accepted") {
      throw new Error("Only an accepted proposal can become a program session.");
    }
    if (workspace.sessions.some((session) => session.proposalId === proposalId)) {
      setNotice("This accepted proposal already has a program session.");
      return;
    }
    let created: Awaited<ReturnType<typeof conferenceApi.convertProposal>> | undefined;
    try {
      created = await conferenceApi.convertProposal(
        workspace.actor.id,
        workspace.event.id,
        proposalId,
      );
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The session could not be created.");
        throw error;
      }
    }
    const id = created?.id ?? `session-${crypto.randomUUID()}`;
    const session: ProgramSession = {
      id,
      eventId: workspace.event.id,
      proposalId,
      origin: "proposal",
      title: proposal.title,
      description: proposal.summary,
      format: proposal.format,
      speakerIds: proposal.speakers.map((speaker) => speaker.id),
      speakerNames: proposal.speakers.map((speaker) => speaker.name),
      status: "unscheduled",
    };
    setWorkspace((current) => ({
      ...current,
      sessions: [session, ...current.sessions],
      proposals: current.proposals.map((item) =>
        item.id === proposalId ? { ...item, status: "session" } : item,
      ),
    }));
    setNotice("Program session created and added to the ready-to-place queue.");
  }, [source, workspace.actor.id, workspace.event.id, workspace.proposals, workspace.sessions]);

  const addDirectSession = useCallback(async (payload: DirectSessionPayload) => {
    let created: ProgramSession | undefined;
    try {
      created = await conferenceApi.createDirectSession(
        workspace.actor.id,
        workspace.event.id,
        payload,
      );
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The direct session could not be created.");
        throw error;
      }
    }
    const profiles = workspace.proposals.flatMap((proposal) => proposal.speakers);
    const speakerNames = payload.speakerIds.map((id) => profiles.find((speaker) => speaker.id === id)?.name).filter((name): name is string => Boolean(name));
    const session: ProgramSession = {
      id: created?.id ?? `session-${crypto.randomUUID()}`,
      eventId: workspace.event.id,
      origin: `direct_${payload.kind}`,
      title: payload.title,
      description: payload.description,
      format: payload.format,
      capacity: payload.capacity,
      ceuCredits: payload.ceuCredits,
      clientId: payload.clientId,
      speakerIds: payload.speakerIds,
      speakerNames,
      status: "unscheduled",
    };
    setWorkspace((current) => ({ ...current, sessions: [session, ...current.sessions] }));
    setNotice(`${payload.kind === "sponsor" ? "Sponsor" : payload.kind === "guaranteed" ? "Guaranteed" : "Direct"} session added to the ready-to-place queue.`);
  }, [source, workspace.actor.id, workspace.event.id, workspace.proposals]);

  const uploadTaskArtifact = useCallback(async (taskId: string, file: File) => {
    let uploadId: string | undefined;
    let fileName = safeDownloadFileName(file.name, "Submitted file");
    try {
      const uploaded = await conferenceApi.upload(
        workspace.actor.id,
        workspace.event.id,
        file,
        taskUploadPurpose(file),
      );
      await conferenceApi.attachTaskArtifact(
        workspace.actor.id,
        workspace.event.id,
        taskId,
        uploaded.id,
      );
      uploadId = uploaded.id;
      fileName = safeDownloadFileName(uploaded.fileName || file.name, "Submitted file");
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The required file could not be stored.");
        throw error;
      }
      uploadId = `demo-upload-${crypto.randomUUID()}`;
    }
    localTaskArtifacts.current.set(uploadId, file);
    const uploadedAt = new Date().toISOString();
    setWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((task): OnboardingTask =>
        task.id === taskId
          ? {
              ...task,
              status: "complete",
              artifactUploadId: uploadId,
              artifactFileName: fileName,
              artifactContentType: file.type || "application/octet-stream",
              artifactVersions: [
                {
                  uploadId,
                  fileName,
                  contentType: file.type || "application/octet-stream",
                  uploadedAt,
                },
                ...(task.artifactVersions ?? []).filter((version) => version.uploadId !== uploadId),
              ],
            }
          : task,
      ),
    }));
    setNotice(`${file.name} stored privately; the file task is complete.`);
  }, [source, workspace.actor.id, workspace.event.id]);

  const downloadTaskArtifact = useCallback(async (taskId: string, requestedUploadId?: string) => {
    const task = workspace.tasks.find((candidate) => candidate.id === taskId);
    if (!task?.artifactUploadId) throw new Error("No submitted file is attached to this task.");
    const uploadId = requestedUploadId ?? task.artifactUploadId;
    const version = task.artifactVersions?.find((candidate) => candidate.uploadId === uploadId);
    if (requestedUploadId && !version && requestedUploadId !== task.artifactUploadId) {
      throw new Error("This file version is not part of the task history.");
    }
    const localFile = localTaskArtifacts.current.get(uploadId);
    const download = localFile
      ? { blob: localFile as Blob, fileName: version?.fileName || task.artifactFileName || localFile.name }
      : await conferenceApi.downloadTaskArtifact(
          workspace.actor.id,
          workspace.event.id,
          task.id,
          uploadId,
          version?.fileName || task.artifactFileName,
        );
    saveDownloadedFile(download.blob, download.fileName);
    setNotice(`${download.fileName} downloaded from the private task record.`);
  }, [workspace.actor.id, workspace.event.id, workspace.tasks]);

  const addTaskComment = useCallback(async (taskId: string, body: string) => {
    const normalized = body.trim();
    if (!normalized) throw new Error("Write a comment before posting.");
    let comment: TaskComment;
    try {
      comment = await conferenceApi.addTaskComment(
        workspace.actor.id,
        workspace.event.id,
        taskId,
        normalized,
      );
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) throw error;
      comment = {
        id: `demo-comment-${crypto.randomUUID()}`,
        authorId: workspace.actor.id,
        authorName: workspace.actor.name,
        body: normalized,
        createdAt: new Date().toISOString(),
      };
    }
    setWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((task) => task.id === taskId
        ? { ...task, comments: [...(task.comments ?? []), comment] }
        : task),
    }));
    setNotice("Comment added to the shared task record.");
  }, [source, workspace.actor.id, workspace.actor.name, workspace.event.id]);

  const submitTaskForm = useCallback(async (taskId: string, responses: Record<string, unknown>) => {
    try {
      await conferenceApi.submitTaskResponse(
        workspace.actor.id,
        workspace.event.id,
        taskId,
        responses,
      );
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The linked form could not be submitted.");
        throw error;
      }
    }
    setWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((task): OnboardingTask =>
        task.id === taskId
          ? {
              ...task,
              status: "complete",
              form: task.form
                ? { ...task.form, response: responses, responseStatus: "submitted" }
                : undefined,
            }
          : task,
      ),
    }));
    setNotice("Linked form submitted; the task is complete.");
  }, [source, workspace.actor.id, workspace.event.id]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspace,
      loading,
      source,
      authRequired,
      noEvent,
      notice,
      builder,
      publicBuilder,
      publicEventState,
      privateWorkspaceEventId,
      publicSpeakers,
      updateProgramConfiguration,
      setNotice,
      switchActor,
      createEvent,
      updateEvent,
      createRoom,
      updateRoom,
      deleteRoom,
      createTrack,
      updateTrack,
      deleteTrack,
      selectBuilderForm,
      createBuilderForm,
      closeBuilderForm,
      updateBuilder,
      replaceBuilderFields,
      saveBuilder,
      publishBuilder,
      saveProposalDraft,
      submitProposal,
      withdrawProposal,
      reopenProposal,
      requestProposalChanges,
      decideProposal,
      saveReview,
      toggleTask,
      addTask,
      updateProfile,
      uploadHeadshot,
      scheduleSession,
      detectConflicts,
      publishAgenda,
      convertProposalToSession,
      addDirectSession,
      uploadTaskArtifact,
      downloadTaskArtifact,
      addTaskComment,
      submitTaskForm,
    }),
    [
      workspace,
      loading,
      source,
      authRequired,
      noEvent,
      notice,
      builder,
      publicBuilder,
      publicEventState,
      privateWorkspaceEventId,
      publicSpeakers,
      updateProgramConfiguration,
      switchActor,
      createEvent,
      updateEvent,
      createRoom,
      updateRoom,
      deleteRoom,
      createTrack,
      updateTrack,
      deleteTrack,
      selectBuilderForm,
      createBuilderForm,
      closeBuilderForm,
      updateBuilder,
      replaceBuilderFields,
      saveBuilder,
      publishBuilder,
      saveProposalDraft,
      submitProposal,
      withdrawProposal,
      reopenProposal,
      requestProposalChanges,
      decideProposal,
      saveReview,
      toggleTask,
      addTask,
      updateProfile,
      uploadHeadshot,
      scheduleSession,
      detectConflicts,
      publishAgenda,
      convertProposalToSession,
      addDirectSession,
      uploadTaskArtifact,
      downloadTaskArtifact,
      addTaskComment,
      submitTaskForm,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

function RoutedWorkspaceProvider({ children }: PropsWithChildren) {
  const location = useLocation();
  return <WorkspaceProviderCore pathname={location.pathname} search={location.search}>{children}</WorkspaceProviderCore>;
}

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const inRouter = useInRouterContext();
  if (inRouter) return <RoutedWorkspaceProvider>{children}</RoutedWorkspaceProvider>;
  const pathname = typeof window === "undefined" ? "/" : window.location.pathname;
  const search = typeof window === "undefined" ? "" : window.location.search;
  return <WorkspaceProviderCore pathname={pathname} search={search}>{children}</WorkspaceProviderCore>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
