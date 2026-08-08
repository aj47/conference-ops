/* eslint-disable react-refresh/only-export-components -- The provider and its typed hook are intentionally colocated. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { createDemoWorkspace } from "../shared/demo-data";
import type {
  FormField,
  OnboardingTask,
  ProgramSession,
  Proposal,
  ProposalStatus,
  ReviewAssignment,
  ScheduleConflict,
  SpeakerProfile,
  WorkspaceSnapshot,
} from "../shared/domain";
import { ApiClientError, conferenceApi } from "./api";

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
  adminAlertsEnabled: boolean;
  adminRecipients: string[];
  dirty: boolean;
  lastSavedAt: string;
}

export interface ApplicantSubmission {
  title: string;
  summary: string;
  category: string;
  format: Proposal["format"];
  level: Proposal["level"];
  repoUrl: string;
  workshopNeeds: string;
  responses: Record<string, unknown>;
  speaker: {
    firstName: string;
    lastName: string;
    email: string;
    title: string;
    company: string;
    bio: string;
  };
}

interface ReviewPayload {
  score: number;
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
  notice: string | null;
  builder: BuilderConfig;
  publicBuilder: BuilderConfig;
  publicSpeakers: Array<Omit<SpeakerProfile, "email">>;
  setNotice: (notice: string | null) => void;
  switchActor: (actorId: string) => void;
  updateEvent: (patch: Partial<WorkspaceSnapshot["event"]>) => Promise<void>;
  updateBuilder: (patch: Partial<BuilderConfig>) => void;
  replaceBuilderFields: (kind: "proposal" | "participant", fields: FormField[]) => void;
  saveBuilder: () => Promise<void>;
  publishBuilder: () => Promise<void>;
  submitProposal: (payload: ApplicantSubmission) => Promise<Proposal>;
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
  submitTaskForm: (taskId: string, responses: Record<string, unknown>) => Promise<void>;
}

const initialActorId = (() => {
  if (typeof window === "undefined") return "user-organizer";
  try {
    return window.localStorage?.getItem("conference-ops-actor") ?? "user-organizer";
  } catch {
    return "user-organizer";
  }
})();

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
  proposalSectionTitle: "Tell us about the work",
  proposalPageHeading: "Proposal",
  proposalInstructions:
    "Describe the practical problem, the approach you tried, and the evidence attendees will leave with.",
  participantSectionTitle: "Who will be on stage?",
  participantPageHeading: "Speakers",
  participantInstructions:
    "Add every presenter and a reachable primary contact. You can update public profile details later.",
  participantMin: 1,
  participantMax: 4,
  proposalFields: initialWorkspace.forms[0].fields,
  participantFields: [
    { id: "speaker-first", label: "First name", type: "short_text", required: true },
    { id: "speaker-last", label: "Last name", type: "short_text", required: true },
    { id: "speaker-email", label: "Email", type: "email", required: true },
    { id: "speaker-phone", label: "Mobile phone", type: "short_text", required: false },
    { id: "speaker-bio", label: "Biography", type: "long_text", required: false },
  ],
  closeDate: initialWorkspace.event.cfpClosesAt.slice(0, 16),
  submissionLimit: 3,
  allowMultipleDrafts: true,
  autoRedirect: true,
  successMessage:
    "Your proposal is in. A confirmation email is on its way, and your speaker portal is ready for updates and follow-up tasks.",
  combinedCharacterLimit: 6200,
  confirmationEnabled: true,
  adminAlertsEnabled: false,
  adminRecipients: ["Maya Chen"],
  dirty: false,
  lastSavedAt: "2026-08-08T07:30:00.000Z",
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function rangesOverlap(startA?: string, endA?: string, startB?: string, endB?: string) {
  if (!startA || !endA || !startB || !endB) return false;
  return new Date(startA) < new Date(endB) && new Date(startB) < new Date(endA);
}

function dateTimeInput(value: string | number) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 16);
}

function formDraftPayload(config: BuilderConfig) {
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
    closesAt: config.closeDate ? new Date(config.closeDate).toISOString() : undefined,
    allowMultipleDrafts: config.allowMultipleDrafts,
    redirectToPortal: config.autoRedirect,
    confirmationEmailEnabled: config.confirmationEnabled,
    fields: [
      ...config.proposalFields,
      ...(config.collectParticipants ? config.participantFields : []),
    ],
  };
}

function responseForField(
  field: FormField,
  payload: ApplicantSubmission,
  section: "proposal" | "participant",
): unknown {
  const label = field.label.trim().toLowerCase();
  if (section === "proposal" && (field.id === "field-title" || ["title", "session title", "proposal title"].includes(label))) return payload.title;
  if (section === "proposal" && (field.id === "field-summary" || ["abstract", "proposal summary", "session summary"].includes(label))) return payload.summary;
  if (section === "proposal" && (field.id === "field-category" || ["category", "program category", "program lane"].includes(label))) return payload.category;
  if (section === "proposal" && (field.id === "field-format" || ["format", "preferred format", "session format"].includes(label))) {
    const label = payload.format === "lightning" ? "Lightning talk" : `${payload.format[0].toUpperCase()}${payload.format.slice(1)}`;
    return field.options?.find((option) => option.toLowerCase() === label.toLowerCase()) ?? label;
  }
  if (section === "proposal" && (field.id === "field-repo" || ["project or repository", "relevant project or repository", "project url", "repository url"].includes(label))) return payload.repoUrl;
  if (section === "proposal" && (field.id === "field-workshop-needs" || ["workshop needs", "workshop requirements", "workshop setup requirements"].includes(label))) return payload.workshopNeeds;
  if (section === "participant" && (field.id === "speaker-first" || label === "first name")) return payload.speaker.firstName;
  if (section === "participant" && (field.id === "speaker-last" || label === "last name")) return payload.speaker.lastName;
  if (section === "participant" && (field.id === "speaker-email" || ["email", "email address", "contact email", "speaker email"].includes(label))) return payload.speaker.email;
  if (section === "participant" && (field.id === "speaker-bio" || ["biography", "bio", "speaker bio"].includes(label))) return payload.speaker.bio;
  if (section === "participant" && (field.id === "speaker-company" || ["company", "company / affiliation", "affiliation", "organization"].includes(label))) return payload.speaker.company;
  if (section === "participant" && (field.id === "speaker-title" || ["role", "role or title", "job title", "speaker title"].includes(label))) return payload.speaker.title;
  return payload.responses[field.id];
}

function submissionResponses(config: BuilderConfig, payload: ApplicantSubmission) {
  const responses = { ...payload.responses };
  for (const field of config.proposalFields) {
    if (responses[field.id] !== undefined) continue;
    const value = responseForField(field, payload, "proposal");
    if (value !== undefined) responses[field.id] = value;
  }
  for (const field of config.collectParticipants ? config.participantFields : []) {
    if (responses[field.id] !== undefined) continue;
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

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<"api" | "demo">("demo");
  const [authRequired, setAuthRequired] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [builder, setBuilder] = useState(initialBuilder);
  const [publicBuilder, setPublicBuilder] = useState(initialBuilder);
  const [publicSpeakers, setPublicSpeakers] = useState<Array<Omit<SpeakerProfile, "email">>>(
    initialWorkspace.proposals
      .filter((proposal) => proposal.status === "accepted")
      .flatMap((proposal) => proposal.speakers)
      .map(toPublicSpeaker),
  );

  useEffect(() => {
    let active = true;
    const publicMatch = window.location.pathname.match(/^\/submit\/([^/]+)/);
    const isPublicProgram = ["/agenda", "/speakers", "/embed/agenda"].includes(window.location.pathname);
    const publicSlug = publicMatch?.[1] ?? (isPublicProgram ? initialWorkspace.event.slug : null);
    const demoFallbackEnabled = import.meta.env.VITE_DEMO_MODE === "true";

    if (publicSlug) {
      conferenceApi.publicEvent(publicSlug)
        .then((data) => {
          if (!active) return;
          const publicIsDemo = demoFallbackEnabled || data.speakers.some((speaker) => Boolean(speaker.email));
          const tracks = [...new Map(data.sessions.filter((session) => session.trackId).map((session) => [session.trackId!, { id: session.trackId!, name: session.trackName ?? "Program", color: session.trackColor ?? data.event.accent }])).values()];
          const rooms = [...new Map(data.sessions.filter((session) => session.roomId).map((session) => [session.roomId!, { id: session.roomId!, name: session.roomName ?? "Room", capacity: 0 }])).values()];
          const sessions: ProgramSession[] = data.sessions.map((session) => ({
            id: session.id,
            eventId: data.event.id,
            title: session.title,
            description: session.description,
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
            forms: data.form ? [data.form] : [],
            proposals: publicIsDemo ? current.proposals : [],
            reviews: publicIsDemo ? current.reviews : [],
            tasks: publicIsDemo ? current.tasks : [],
            tracks,
            rooms,
            sessions,
            resources: [],
            activity: [],
          }));
          setPublicSpeakers(data.speakers.map((speaker) => toPublicSpeaker({ ...speaker, email: speaker.email ?? "" })));
          if (data.form) {
            const published: BuilderConfig = {
              ...initialBuilder,
              formId: data.form.id,
              version: data.form.version,
              publishedVersion: data.form.version,
              status: data.form.status,
              internalName: data.form.name,
              externalTitle: data.form.publicTitle ?? data.form.welcomeTitle,
              pageHeading: data.form.pageHeading ?? initialBuilder.pageHeading,
              welcomeMessage: data.form.welcomeCopy,
              successMessage: data.form.confirmationCopy,
              participantMax: data.form.maxSpeakers,
              submissionLimit: data.form.maxSubmissionsPerUser ?? initialBuilder.submissionLimit,
              closeDate: dateTimeInput(data.form.closesAt ?? data.event.cfpClosesAt),
              collectParticipants: data.form.collectsParticipants ?? true,
              allowMultipleDrafts: data.form.allowMultipleDrafts,
              autoRedirect: data.form.redirectToPortal ?? true,
              confirmationEnabled: data.form.confirmationEmailEnabled ?? true,
              proposalFields: data.form.fields,
              dirty: false,
              lastSavedAt: data.form.updatedAt ?? new Date().toISOString(),
            };
            setBuilder(published);
            setPublicBuilder(published);
          }
          setSource(publicIsDemo ? "demo" : "api");
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (demoFallbackEnabled) {
            setSource("demo");
          } else {
            setSource("api");
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
            setNotice(error instanceof Error ? error.message : "This public event could not be loaded.");
          }
        })
        .finally(() => active && setLoading(false));
    } else {
      conferenceApi.bootstrap(initialActorId)
        .then((next) => {
          if (!active) return;
          setWorkspace(next);
          setSource(next.demoMode ? "demo" : "api");
          setAuthRequired(false);
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (demoFallbackEnabled) {
            setSource("demo");
          } else {
            setSource("api");
            setAuthRequired(error instanceof ApiClientError && error.status === 401);
            setNotice(error instanceof Error ? error.message : "Sign in to open this workspace.");
          }
        })
        .finally(() => active && setLoading(false));
    }
    return () => {
      active = false;
    };
  }, []);

  const switchActor = useCallback((actorId: string) => {
    window.localStorage.setItem("conference-ops-actor", actorId);
    setWorkspace((current) => {
      const actor = current.actors.find((candidate) => candidate.id === actorId);
      return actor ? { ...current, actor } : createDemoWorkspace(actorId);
    });
    setNotice(null);
  }, []);

  const updateBuilder = useCallback((patch: Partial<BuilderConfig>) => {
    setBuilder((current) => ({ ...current, ...patch, dirty: true }));
  }, []);

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

  const replaceBuilderFields = useCallback(
    (kind: "proposal" | "participant", fields: FormField[]) => {
      updateBuilder(kind === "proposal" ? { proposalFields: fields } : { participantFields: fields });
    },
    [updateBuilder],
  );

  const saveBuilder = useCallback(async () => {
    let savedVersion = builder.version;
    try {
      const saved = await conferenceApi.saveForm(
        workspace.actor.id,
        workspace.event.id,
        builder.formId,
        formDraftPayload(builder),
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
          ? { ...form, version: savedVersion, status: "draft", updatedAt: savedAt }
          : form,
      ),
    }));
    setNotice(
      `Draft version ${savedVersion} saved. Private preview uses it; the public link remains on published version ${builder.publishedVersion}.`,
    );
  }, [builder, source, workspace.actor.id, workspace.event.id]);

  const publishBuilder = useCallback(async () => {
    let nextVersion = builder.version;
    try {
      if (builder.dirty) {
        const saved = await conferenceApi.saveForm(
          workspace.actor.id,
          workspace.event.id,
          builder.formId,
          formDraftPayload(builder),
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
          ? { ...form, version: nextVersion, status: "published", updatedAt: publishedAt }
          : form,
      ),
    }));
    setNotice(`Version ${nextVersion} published. The public call for speakers is live.`);
  }, [builder, source, workspace.actor.id, workspace.event.id]);

  const submitProposal = useCallback(
    async (payload: ApplicantSubmission) => {
      const durationMinutes = payload.format === "workshop" ? 60 : payload.format === "lightning" ? 10 : payload.format === "panel" ? 45 : 30;
      let response: { id: string; submittedAt?: string } = {
        id: `proposal-${crypto.randomUUID()}`,
        submittedAt: new Date().toISOString(),
      };
      try {
        await conferenceApi.enroll(workspace.actor.id, workspace.event.id);
        response = await conferenceApi.submitProposal(workspace.actor.id, workspace.event.id, {
          formId: builder.formId,
          title: payload.title,
          summary: payload.summary,
          category: payload.category,
          format: payload.format,
          durationMinutes,
          level: payload.level,
          responses: submissionResponses(builder, payload),
          speakers: [{
            name: `${payload.speaker.firstName} ${payload.speaker.lastName}`,
            email: payload.speaker.email,
            title: payload.speaker.title,
            company: payload.speaker.company,
            bio: payload.speaker.bio,
          }],
          submit: true,
        });
      } catch (error) {
        if (!mayUseDemoFallback(error, source)) {
          setNotice(error instanceof Error ? error.message : "The proposal could not be submitted.");
          throw error;
        }
      }
      const existingProfile = workspace.proposals
        .flatMap((proposal) => proposal.speakers)
        .find((speaker) =>
          speaker.email.toLowerCase() === payload.speaker.email.toLowerCase()
          || (workspace.actor.role === "applicant" && speaker.email === workspace.actor.email),
        );
      const profile: SpeakerProfile = {
        id: existingProfile?.id ?? `speaker-${crypto.randomUUID()}`,
        name: `${payload.speaker.firstName} ${payload.speaker.lastName}`,
        email: payload.speaker.email,
        title: payload.speaker.title,
        company: payload.speaker.company,
        bio: payload.speaker.bio,
        profileComplete: Boolean(payload.speaker.bio && payload.speaker.title && payload.speaker.company),
      };
      const proposal: Proposal = {
        id: response.id,
        eventId: workspace.event.id,
        title: payload.title,
        summary: payload.summary,
        category: payload.category,
        format: payload.format,
        durationMinutes,
        level: payload.level,
        status: "submitted",
        speakers: [profile],
        submittedAt: response.submittedAt ?? new Date().toISOString(),
        reviewCount: 0,
        reviewerGroup:
          payload.category === "Evaluation & safety" ? "Evaluation committee" : "Agent systems committee",
        tags: payload.format === "workshop" ? ["workshop", "new"] : ["new"],
      };
      setWorkspace((current) => ({
        ...current,
        proposals: [
          proposal,
          ...current.proposals.map((item) => ({
            ...item,
            speakers: item.speakers.map((speaker) => speaker.id === profile.id ? profile : speaker),
          })),
        ],
      }));
      setNotice("Proposal submitted. Confirmation queued and speaker portal opened.");
      return proposal;
    },
    [builder, source, workspace.actor, workspace.event.id, workspace.proposals],
  );

  const decideProposal = useCallback(
    async (
      proposalId: string,
      status: Extract<ProposalStatus, "accept_queue" | "accepted" | "decline_queue" | "rejected" | "waitlisted">,
      note?: string,
    ) => {
      try {
        await conferenceApi.decide(workspace.actor.id, workspace.event.id, proposalId, status, note);
      } catch (error) {
        if (!mayUseDemoFallback(error, source)) {
          setNotice(error instanceof Error ? error.message : "The proposal decision could not be saved.");
          throw error;
        }
      }
      setWorkspace((current) => ({
        ...current,
        proposals: current.proposals.map((proposal) =>
          proposal.id === proposalId ? { ...proposal, status } : proposal,
        ),
      }));
      setNotice(`Decision recorded: ${status.replace("_", " ")}.`);
    },
    [source, workspace.actor.id, workspace.event.id],
  );

  const saveReview = useCallback(
    async (proposalId: string, payload: ReviewPayload) => {
      try {
        await conferenceApi.review(workspace.actor.id, workspace.event.id, proposalId, payload);
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
        const review: ReviewAssignment = {
          id: existing?.id ?? `review-${crypto.randomUUID()}`,
          proposalId,
          reviewerId: current.actor.id,
          round: existing?.round ?? 1,
          status: payload.submit ? "submitted" : "in_progress",
          score: payload.score,
          recommendation: payload.recommendation,
          notes: payload.notes,
        };
        return {
          ...current,
          reviews: existing
            ? current.reviews.map((item) => (item.id === existing.id ? review : item))
            : [review, ...current.reviews],
          proposals: current.proposals.map((proposal) =>
            proposal.id === proposalId
              ? {
                  ...proposal,
                  status: proposal.status === "submitted" ? "under_review" : proposal.status,
                  score: payload.score,
                  reviewCount: existing ? proposal.reviewCount : proposal.reviewCount + 1,
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
          publish: true,
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
          publish: true,
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
      try {
        await conferenceApi.schedule(
          workspace.actor.id,
          workspace.event.id,
          sessionId,
          payload,
        );
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
            ? { ...session, ...payload, status: "scheduled" }
            : session,
        ),
      }));
      setNotice(payload.overrideReason ? "Session scheduled with an audited override." : "Session scheduled.");
    },
    [source, workspace.actor.id, workspace.event.id],
  );

  const publishAgenda = useCallback(async () => {
    const scheduledIds = workspace.sessions
      .filter((session) => session.status === "scheduled" || session.status === "published")
      .map((session) => session.id);
    if (!scheduledIds.length) throw new Error("Schedule at least one session before publishing.");
    try {
      await conferenceApi.publishAgenda(
        workspace.actor.id,
        workspace.event.id,
        scheduledIds,
      );
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
    setNotice(`Agenda published with ${scheduledIds.length} sessions.`);
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
    try {
      const uploaded = await conferenceApi.upload(
        workspace.actor.id,
        workspace.event.id,
        file,
        file.type.includes("presentation") || file.type === "application/pdf" ? "slides" : "supporting_document",
      );
      await conferenceApi.attachTaskArtifact(
        workspace.actor.id,
        workspace.event.id,
        taskId,
        uploaded.id,
      );
    } catch (error) {
      if (!mayUseDemoFallback(error, source)) {
        setNotice(error instanceof Error ? error.message : "The required file could not be stored.");
        throw error;
      }
    }
    setWorkspace((current) => ({
      ...current,
      tasks: current.tasks.map((task): OnboardingTask =>
        task.id === taskId ? { ...task, status: "complete" } : task,
      ),
    }));
    setNotice(`${file.name} stored privately; the file task is complete.`);
  }, [source, workspace.actor.id, workspace.event.id]);

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
        task.id === taskId ? { ...task, status: "complete" } : task,
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
      notice,
      builder,
      publicBuilder,
      publicSpeakers,
      setNotice,
      switchActor,
      updateEvent,
      updateBuilder,
      replaceBuilderFields,
      saveBuilder,
      publishBuilder,
      submitProposal,
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
      submitTaskForm,
    }),
    [
      workspace,
      loading,
      source,
      authRequired,
      notice,
      builder,
      publicBuilder,
      publicSpeakers,
      switchActor,
      updateEvent,
      updateBuilder,
      replaceBuilderFields,
      saveBuilder,
      publishBuilder,
      submitProposal,
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
      submitTaskForm,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}
