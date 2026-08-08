import type {
  EventRecord,
  FormDefinition,
  FormField,
  ProgramSession,
  SpeakerProfile,
  WorkspaceSnapshot,
} from "../shared/domain";

export interface PublicEventData {
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
}

type ApiEnvelope<T> = { data: T };

export type CommunicationKind = "reminder" | "acceptance" | "calendar";
export type ConferenceExportKind = "speakers.csv" | "sessions.csv" | "program.json";

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

async function downloadRequest(path: string, actorId: string): Promise<{ blob: Blob; fileName: string }> {
  const response = await fetch(path, {
    headers: { "x-demo-actor": actorId },
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
  const fileName = disposition.match(/filename="([^"]+)"/)?.[1] ?? "conference-export";
  return { blob: await response.blob(), fileName };
}

export const conferenceApi = {
  publicEvent(slug: string) {
    return request<PublicEventData>(`/api/v1/public/events/${encodeURIComponent(slug)}`, "", { cache: "no-store" });
  },

  bootstrap(actorId: string) {
    return request<WorkspaceSnapshot>("/api/v1/bootstrap", actorId);
  },

  enroll(actorId: string, eventId: string) {
    return request<{ eventId: string; role: "applicant"; enrolled: boolean }>(
      "/api/v1/enroll",
      actorId,
      { method: "POST", body: JSON.stringify({ eventId }) },
    );
  },

  decide(
    actorId: string,
    eventId: string,
    proposalId: string,
    status: "accept_queue" | "accepted" | "decline_queue" | "rejected" | "waitlisted",
    note?: string,
  ) {
    return request<{ proposalId: string; status: string }>(
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
      score: number;
      recommendation: "strong_yes" | "yes" | "maybe" | "no";
      notes: string;
      submit: boolean;
    },
  ) {
    return request<{ proposalId: string; status: string }>(
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
    return request<{ sessionId: string; status: string; conflictsOverridden?: number }>(
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

  saveForm(
    actorId: string,
    eventId: string,
    formId: string,
    payload: {
      expectedVersion?: number;
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
    payload: {
      formId: string;
      title: string;
      summary: string;
      category: string;
      format: "talk" | "workshop" | "panel" | "lightning";
      durationMinutes: number;
      level: "introductory" | "intermediate" | "advanced";
      responses: Record<string, unknown>;
      speakers: Array<{ name: string; email: string; title: string; company: string; bio: string }>;
      submit: boolean;
    },
  ) {
    return request<{ id: string; status: string; submittedAt?: string }>(
      `/api/v1/events/${eventId}/submissions`,
      actorId,
      { method: "POST", body: JSON.stringify(payload) },
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
