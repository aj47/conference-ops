import type {
  EventRecord,
  FormDefinition,
  FormField,
  FormVersionSettings,
  MessageTemplateDefinition,
  ProgramSession,
  ReadinessInsight,
  ReminderRule,
  ResourcePage,
  ReviewerGroupConfig,
  Room,
  SpeakerProfile,
  TaskTemplateDefinition,
  Track,
  WorkspaceSnapshot,
} from "../shared/domain";

export function publicEventApiPath(slug: string) {
  return `/api/v1/public/events/${encodeURIComponent(slug)}`;
}

export interface PublicEventData {
  demoMode?: boolean;
  event: EventRecord;
  form: FormDefinition | null;
  sessions: Array<Partial<ProgramSession> & {
    id: string;
    title: string;
    description: string;
    status: ProgramSession["status"];
    trackName?: string;
    trackColor?: string;
    roomName?: string;
  }>;
  speakers: Array<Omit<SpeakerProfile, "email"> & { email?: string }>;
  resources: ResourcePage[];
}

type ApiEnvelope<T> = { data: T };
type EventRole = WorkspaceSnapshot["actor"]["role"];

const activeEventRoles = new Map<string, EventRole>();
let bootstrapActivationSequence = 0;
const latestBootstrapRequests = new Map<string, number>();
const latestBootstrapActivations = new Map<string, number>();

function eventRoleKey(actorId: string, eventId: string | undefined) {
  return JSON.stringify([actorId, eventId ?? null]);
}

function eventIdFromClientApiPath(path: string) {
  const encoded = path.match(/^\/api\/v1\/events\/([^/?]+)(?:[/?]|$)/)?.[1];
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return undefined;
  }
}

function activeEventRoleHeader(path: string, actorId: string): Record<string, string> {
  const eventId = eventIdFromClientApiPath(path);
  const role = eventId ? activeEventRoles.get(eventRoleKey(actorId, eventId)) : undefined;
  return role ? { "x-event-role": role } : {};
}

export type CommunicationKind = "reminder" | "acceptance" | "calendar";
export type ConferenceExportKind = "speakers.csv" | "sessions.csv" | "program.json";

export interface CreateEventPayload {
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

export interface SubmissionMutationPayload {
  title: string;
  summary: string;
  category: string;
  format: "talk" | "workshop" | "panel" | "lightning";
  durationMinutes: number;
  level: "introductory" | "intermediate" | "advanced";
  responses: Record<string, unknown>;
  speakers: Array<{ name: string; email: string; title: string; company: string; bio: string }>;
  submit: boolean;
}

export interface SubmissionMutationResult {
  id: string;
  status: string;
  version?: number;
  submittedAt?: string | null;
  updatedAt?: string;
}

export class ApiClientError extends Error {
  code: string;
  requestId?: string;
  status: number;

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function request<T>(path: string, actorId: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-demo-actor": actorId,
      ...activeEventRoleHeader(path, actorId),
      ...init?.headers,
    },
  });
  const payload = (await response.json()) as ApiEnvelope<T> & {
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!response.ok || payload.error) {
    throw new ApiClientError(
      response.status,
      payload.error?.code ?? "REQUEST_FAILED",
      payload.error?.message ?? "The request could not be completed.",
      payload.error?.requestId,
    );
  }
  return payload.data;
}

async function uploadRequest<T>(
  path: string,
  actorId: string,
  file: File,
): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-demo-actor": actorId,
      ...activeEventRoleHeader(path, actorId),
    },
    body: file,
  });
  const payload = (await response.json()) as ApiEnvelope<T> & {
    error?: { code?: string; message?: string; requestId?: string };
  };
  if (!response.ok || payload.error) {
    throw new ApiClientError(
      response.status,
      payload.error?.code ?? "UPLOAD_FAILED",
      payload.error?.message ?? "The file could not be uploaded.",
      payload.error?.requestId,
    );
  }
  return payload.data;
}

export function safeDownloadFileName(value: string | undefined, fallback: string) {
  const leaf = (value ?? "").replaceAll("\\", "/").split("/").at(-1) ?? "";
  const safe = [...leaf]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code > 31 && code !== 127 && !(code >= 0x202a && code <= 0x202e) && !(code >= 0x2066 && code <= 0x2069);
    })
    .join("")
    .trim()
    .slice(0, 255);
  return safe && safe !== "." && safe !== ".." ? safe : fallback;
}

function contentDispositionFileName(disposition: string) {
  const encoded = disposition.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1]?.trim().replace(/^"|"$/g, "");
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Fall back to a plain filename or caller-provided metadata.
    }
  }
  return disposition.match(/filename\s*=\s*"([^"]+)"/i)?.[1]
    ?? disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]?.trim();
}

async function downloadRequest(
  path: string,
  actorId: string,
  fallbackFileName = "conference-export",
): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(path, {
    headers: { "x-demo-actor": actorId, ...activeEventRoleHeader(path, actorId) },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string; requestId?: string };
    } | null;
    throw new ApiClientError(
      response.status,
      payload?.error?.code ?? "EXPORT_FAILED",
      payload?.error?.message ?? "The export could not be downloaded.",
      payload?.error?.requestId,
    );
  }
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName = safeDownloadFileName(contentDispositionFileName(disposition), fallbackFileName);
  return { blob: await response.blob(), fileName };
}

export const conferenceApi = {
  publicEvent(slug: string) {
    return request<PublicEventData>(publicEventApiPath(slug), "", { cache: "no-store" });
  },

  async bootstrap(actorId: string, eventId?: string, role?: EventRole) {
    const requestKey = eventRoleKey(actorId, eventId);
    const activationSequence = ++bootstrapActivationSequence;
    latestBootstrapRequests.set(requestKey, activationSequence);
    const query = new URLSearchParams();
    if (eventId) query.set("eventId", eventId);
    if (role) query.set("role", role);
    const workspace = await request<WorkspaceSnapshot>(`/api/v1/bootstrap${query.size ? `?${query}` : ""}`, actorId);
    const resolvedKeys = [
      eventRoleKey(actorId, workspace.event.id),
      eventRoleKey(workspace.actor.id, workspace.event.id),
    ];
    const requestIsCurrent = latestBootstrapRequests.get(requestKey) === activationSequence;
    const newerExplicitRequestExists = eventId === undefined
      && (latestBootstrapRequests.get(resolvedKeys[0]) ?? 0) > activationSequence;
    const newerActivationExists = resolvedKeys.some(
      (key) => (latestBootstrapActivations.get(key) ?? 0) > activationSequence,
    );
    if (requestIsCurrent && !newerExplicitRequestExists && !newerActivationExists) {
      for (const key of resolvedKeys) latestBootstrapActivations.set(key, activationSequence);
      activeEventRoles.set(eventRoleKey(workspace.actor.id, workspace.event.id), workspace.actor.role);
      if (actorId) activeEventRoles.set(eventRoleKey(actorId, workspace.event.id), workspace.actor.role);
    }
    return workspace;
  },

  createEvent(actorId: string, payload: CreateEventPayload) {
    return request<{ id: string; slug: string; organizationId: string; formId: string }>(
      "/api/v1/events",
      actorId,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  enroll(actorId: string, eventId: string) {
    return request<{ eventId: string; role: "applicant"; enrolled: boolean }>(
      "/api/v1/enroll",
      actorId,
      { method: "POST", body: JSON.stringify({ eventId }) },
    );
  },

  claimSpeaker(eventId: string) {
    return request<{
      eventId: string;
      role: "speaker";
      speakerProfileId?: string;
      claimed: true;
    }>(
      "/api/v1/claim-speaker",
      "",
      { method: "POST", body: JSON.stringify({ eventId }) },
    );
  },

  acceptInvitation(token: string) {
    return request<{ accepted: true; eventId?: string; role: "organizer" | "reviewer" }>(
      "/api/v1/invitations/accept",
      "",
      { method: "POST", body: JSON.stringify({ token }) },
    );
  },

  inviteStaff(
    actorId: string,
    eventId: string,
    payload: { email: string; role: "organizer" | "reviewer" },
  ) {
    return request<{ id: string; email: string; role: "organizer" | "reviewer"; expiresAt: string; status: "queued" }>(
      `/api/v1/events/${eventId}/invitations`,
      actorId,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  decide(
    actorId: string,
    eventId: string,
    proposalId: string,
    status: "accept_queue" | "accepted" | "decline_queue" | "rejected" | "waitlisted",
    note?: string,
  ) {
    return request<{ proposalId: string; status: string; sessionId?: string; sessionCreated?: boolean; speakerTasksCreated?: number; messagesQueued?: number; messagesDispatched?: number }>(
      `/api/v1/events/${eventId}/proposals/${proposalId}/decision`,
      actorId,
      { method: "POST", body: JSON.stringify({ status, note }) },
    );
  },

  review(
    actorId: string,
    eventId: string,
    proposalId: string,
    payload: {
      scores: Record<string, number>;
      recommendation: "strong_yes" | "yes" | "maybe" | "no";
      notes: string;
      submit: boolean;
    },
  ) {
    return request<{ proposalId: string; status: string; scores: Record<string, number>; score?: number }>(
      `/api/v1/events/${eventId}/proposals/${proposalId}/review`,
      actorId,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  completeTask(actorId: string, eventId: string, taskId: string, complete: boolean) {
    return request<{ taskId: string; status: string }>(
      `/api/v1/events/${eventId}/tasks/${taskId}/complete`,
      actorId,
      { method: "POST", body: JSON.stringify({ complete }) },
    );
  },

  schedule(
    actorId: string,
    eventId: string,
    sessionId: string,
    payload: {
      roomId: string;
      trackId: string;
      startsAt: string;
      endsAt: string;
      overrideReason?: string;
    },
  ) {
    return request<{ sessionId: string; status: ProgramSession["status"]; conflictsOverridden?: number }>(
      `/api/v1/events/${eventId}/sessions/${sessionId}/schedule`,
      actorId,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  publishForm(actorId: string, eventId: string, formId: string, version: number) {
    return request<{ formId: string; version: number; status: string }>(
      `/api/v1/events/${eventId}/forms/${formId}/publish`,
      actorId,
      { method: "POST", body: JSON.stringify({ version }) },
    );
  },

  updateEvent(
    actorId: string,
    eventId: string,
    payload: {
      name: string;
      shortName: string;
      description: string;
      timezone: string;
      startsAt: string;
      endsAt: string;
      slug?: string;
      cfpClosesAt?: string;
      venue: string;
      websiteUrl: string;
      accent: string;
    },
  ) {
    return request<{ id: string; updatedAt: string }>(`/api/v1/events/${eventId}`, actorId, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },

  createRoom(actorId: string, eventId: string, payload: Pick<Room, "name" | "capacity">) {
    return request<Room>(`/api/v1/events/${encodeURIComponent(eventId)}/rooms`, actorId, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateRoom(actorId: string, eventId: string, roomId: string, payload: Pick<Room, "name" | "capacity">) {
    return request<Room>(
      `/api/v1/events/${encodeURIComponent(eventId)}/rooms/${encodeURIComponent(roomId)}`,
      actorId,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },

  deleteRoom(actorId: string, eventId: string, roomId: string) {
    return request<{ id: string; deleted: true }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/rooms/${encodeURIComponent(roomId)}`,
      actorId,
      { method: "DELETE" },
    );
  },

  createTrack(actorId: string, eventId: string, payload: Pick<Track, "name" | "color">) {
    return request<Track>(`/api/v1/events/${encodeURIComponent(eventId)}/tracks`, actorId, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateTrack(actorId: string, eventId: string, trackId: string, payload: Pick<Track, "name" | "color">) {
    return request<Track>(
      `/api/v1/events/${encodeURIComponent(eventId)}/tracks/${encodeURIComponent(trackId)}`,
      actorId,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },

  deleteTrack(actorId: string, eventId: string, trackId: string) {
    return request<{ id: string; deleted: true }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/tracks/${encodeURIComponent(trackId)}`,
      actorId,
      { method: "DELETE" },
    );
  },

  saveReviewerRouting(
    actorId: string,
    eventId: string,
    groups: Array<Pick<ReviewerGroupConfig, "name" | "category" | "reviewerIds"> & { id?: string }>,
  ) {
    return request<{ groups: ReviewerGroupConfig[]; assignmentsRebuilt: true }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/reviewer-routing`,
      actorId,
      { method: "PUT", body: JSON.stringify({ groups }) },
    );
  },

  createTaskTemplate(
    actorId: string,
    eventId: string,
    payload: Omit<TaskTemplateDefinition, "id" | "completionMode" | "formId" | "fileRequestId" | "formFields"> & { fields?: FormField[] },
  ) {
    return request<TaskTemplateDefinition>(`/api/v1/events/${encodeURIComponent(eventId)}/task-templates`, actorId, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  updateTaskTemplate(
    actorId: string,
    eventId: string,
    templateId: string,
    payload: Omit<TaskTemplateDefinition, "id" | "completionMode" | "formId" | "fileRequestId" | "formFields"> & { fields?: FormField[] },
  ) {
    return request<TaskTemplateDefinition>(
      `/api/v1/events/${encodeURIComponent(eventId)}/task-templates/${encodeURIComponent(templateId)}`,
      actorId,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },

  deleteTaskTemplate(actorId: string, eventId: string, templateId: string) {
    return request<{ id: string; deleted: true }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/task-templates/${encodeURIComponent(templateId)}`,
      actorId,
      { method: "DELETE" },
    );
  },

  saveMessageTemplate(
    actorId: string,
    eventId: string,
    kind: MessageTemplateDefinition["kind"],
    payload: Pick<MessageTemplateDefinition, "name" | "subject" | "text" | "html">,
  ) {
    return request<MessageTemplateDefinition>(
      `/api/v1/events/${encodeURIComponent(eventId)}/message-templates/${encodeURIComponent(kind)}`,
      actorId,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },

  saveReminderRule(
    actorId: string,
    eventId: string,
    kind: ReminderRule["kind"],
    payload: Pick<ReminderRule, "enabled" | "offsetDays">,
  ) {
    return request<ReminderRule>(
      `/api/v1/events/${encodeURIComponent(eventId)}/reminder-rules/${encodeURIComponent(kind)}`,
      actorId,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },

  askReadinessAssistant(actorId: string, eventId: string, question?: string) {
    return request<{ answer: string; insights: ReadinessInsight[]; generatedAt: string; mode: "grounded" }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/assistant`,
      actorId,
      { method: "POST", body: JSON.stringify({ question }) },
    );
  },

  saveForm(
    actorId: string,
    eventId: string,
    formId: string,
    payload: {
      expectedVersion: number;
      name: string;
      publicTitle: string;
      pageHeading: string;
      submissionType: "abstract" | "session";
      collectsParticipants: boolean;
      welcomeTitle: string;
      welcomeCopy: string;
      confirmationCopy: string;
      maxSpeakers: number;
      maxSubmissionsPerUser?: number;
      closesAt?: string;
      allowMultipleDrafts: boolean;
      redirectToPortal: boolean;
      confirmationEmailEnabled: boolean;
      settings: FormVersionSettings;
      fields: FormField[];
    },
  ) {
    return request<{ id: string; version: number; status: "draft" }>(
      `/api/v1/events/${eventId}/forms/${formId}`,
      actorId,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },

  submitProposal(
    actorId: string,
    eventId: string,
    payload: SubmissionMutationPayload & { formId: string },
  ) {
    return request<SubmissionMutationResult>(
      `/api/v1/events/${eventId}/submissions`,
      actorId,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  updateSubmission(
    actorId: string,
    eventId: string,
    proposalId: string,
    payload: SubmissionMutationPayload & { expectedVersion: number },
  ) {
    return request<SubmissionMutationResult>(
      `/api/v1/events/${eventId}/submissions/${encodeURIComponent(proposalId)}`,
      actorId,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },

  withdrawSubmission(actorId: string, eventId: string, proposalId: string) {
    return request<{ id: string; status: "withdrawn"; withdrawnAt: string }>(
      `/api/v1/events/${eventId}/submissions/${encodeURIComponent(proposalId)}/withdraw`,
      actorId,
      { method: "POST" },
    );
  },

  updateProfile(
    actorId: string,
    eventId: string,
    speakerId: string,
    payload: {
      name: string;
      title: string;
      company: string;
      bio: string;
      pronouns?: string;
      city?: string;
      headshotUploadId?: string;
      publish?: boolean;
    },
  ) {
    return request<{ id: string; profileComplete: boolean }>(
      `/api/v1/events/${eventId}/speakers/${speakerId}/profile`,
      actorId,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },

  publishAgenda(actorId: string, eventId: string, sessionIds: string[]) {
    return request<{ eventId: string; status: string; publishedSessions: number; publishedAt: string }>(
      `/api/v1/events/${eventId}/agenda/publish`,
      actorId,
      { method: "POST", body: JSON.stringify({ sessionIds }) },
    );
  },

  sendCommunication(
    actorId: string,
    eventId: string,
    payload: {
      kind: CommunicationKind;
      recipientIds: string[];
      templateId?: string;
      idempotencyKey?: string;
    },
  ) {
    const { idempotencyKey, ...body } = payload;
    return request<{ queued: number; idempotencyKey: string }>(
      `/api/v1/events/${eventId}/communications/send`,
      actorId,
      {
        method: "POST",
        body: JSON.stringify(body),
        ...(idempotencyKey ? { headers: { "idempotency-key": idempotencyKey } } : {}),
      },
    );
  },

  downloadExport(
    actorId: string,
    eventId: string,
    kind: ConferenceExportKind,
  ) {
    return downloadRequest(
      `/api/v1/events/${eventId}/exports/${encodeURIComponent(kind)}`,
      actorId,
    );
  },

  downloadUpload(
    actorId: string,
    eventId: string,
    uploadId: string,
    fallbackFileName = "submitted-file",
  ) {
    return downloadRequest(
      `/api/v1/events/${eventId}/uploads/${encodeURIComponent(uploadId)}`,
      actorId,
      safeDownloadFileName(fallbackFileName, "submitted-file"),
    );
  },

  convertProposal(actorId: string, eventId: string, proposalId: string) {
    return request<{
      id: string;
      proposalId: string;
      title: string;
      description: string;
      status: "unscheduled";
      speakerIds: string[];
    }>(`/api/v1/events/${eventId}/proposals/${proposalId}/convert`, actorId, {
      method: "POST",
    });
  },

  createDirectSession(
    actorId: string,
    eventId: string,
    payload: {
      title: string;
      description: string;
      speakerIds: string[];
      kind: "guaranteed" | "sponsor" | "program";
      format: NonNullable<ProgramSession["format"]>;
      capacity?: number;
      ceuCredits?: string;
      clientId?: string;
    },
  ) {
    return request<ProgramSession>(`/api/v1/events/${eventId}/sessions`, actorId, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },

  upload(
    actorId: string,
    eventId: string,
    file: File,
    purpose: "headshot" | "slides" | "supporting_document",
  ) {
    const query = new URLSearchParams({ purpose, filename: file.name });
    return uploadRequest<{ id: string; fileName: string; status: string }>(
      `/api/v1/events/${eventId}/uploads?${query}`,
      actorId,
      file,
    );
  },

  attachTaskArtifact(actorId: string, eventId: string, taskId: string, uploadId: string) {
    return request<{ taskId: string; uploadId: string; status: string }>(
      `/api/v1/events/${eventId}/tasks/${taskId}/artifact`,
      actorId,
      { method: "POST", body: JSON.stringify({ uploadId }) },
    );
  },

  submitTaskResponse(
    actorId: string,
    eventId: string,
    taskId: string,
    responses: Record<string, unknown>,
  ) {
    return request<{ taskId: string; taskStatus: string }>(
      `/api/v1/events/${eventId}/tasks/${taskId}/response`,
      actorId,
      { method: "POST", body: JSON.stringify({ responses, submit: true }) },
    );
  },
};
