import type {
  SpeakerContentSnapshot,
  SpeakerContentSpeaker,
  SpeakerSocialLinks,
  SpeakerWorkflowStatus,
  SessionContentStatus,
} from "../shared/speaker-content";

type Envelope<T> = { data: T; error?: { code?: string; message?: string } };

function roleHeaders(role: string) {
  return { "x-event-role": role };
}

async function speakerContentRequest<T>(path: string, actorId: string, role: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-demo-actor": actorId,
      ...roleHeaders(role),
      ...init?.headers,
    },
  });
  const payload = await response.json() as Envelope<T>;
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? "The request could not be completed.");
  return payload.data;
}

async function speakerContentUpload<T>(path: string, actorId: string, role: string, file: File) {
  const response = await fetch(path, {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-demo-actor": actorId,
      ...roleHeaders(role),
    },
    body: file,
  });
  const payload = await response.json() as Envelope<T>;
  if (!response.ok || payload.error) throw new Error(payload.error?.message ?? "The file could not be uploaded.");
  return payload.data;
}

export interface ManagedSpeakerPayload {
  name: string;
  email: string;
  title: string;
  company: string;
  bio: string;
  pronouns?: string;
  city?: string;
  workflowStatus: SpeakerWorkflowStatus;
  socialLinks: SpeakerSocialLinks;
  travelDetails: string;
  headshotUploadId?: string;
  published: boolean;
}

export const speakerContentApi = {
  snapshot(actorId: string, role: string, eventId: string) {
    return speakerContentRequest<SpeakerContentSnapshot>(
      `/api/v1/events/${encodeURIComponent(eventId)}/speaker-content`,
      actorId,
      role,
      { cache: "no-store" },
    );
  },

  createSpeaker(actorId: string, role: string, eventId: string, payload: ManagedSpeakerPayload) {
    return speakerContentRequest<{ id: string; created: true }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/speakers/manage`,
      actorId,
      role,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  updateSpeaker(actorId: string, role: string, eventId: string, speakerId: string, payload: ManagedSpeakerPayload) {
    return speakerContentRequest<{ id: string; updated: true }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(speakerId)}/manage`,
      actorId,
      role,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },

  deleteSpeaker(actorId: string, role: string, eventId: string, speakerId: string) {
    return speakerContentRequest<{ id: string; deleted: true }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/speakers/${encodeURIComponent(speakerId)}/manage`,
      actorId,
      role,
      { method: "DELETE" },
    );
  },

  importSpeakers(actorId: string, role: string, eventId: string, csv: string) {
    return speakerContentRequest<{ imported: number; created: number; merged: number }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/speakers/import`,
      actorId,
      role,
      { method: "POST", body: JSON.stringify({ csv }) },
    );
  },

  createTasks(actorId: string, role: string, eventId: string, payload: {
    title: string;
    description: string;
    dueAt: string;
    kind: "general" | "file_request";
    speakerIds: string[];
    sessionId?: string;
  }) {
    return speakerContentRequest<{ created: number; taskIds: string[] }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/speaker-tasks/bulk`,
      actorId,
      role,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  updateSession(actorId: string, role: string, eventId: string, sessionId: string, payload: {
    title: string;
    description: string;
    contentStatus: SessionContentStatus;
    speakerIds: string[];
  }) {
    return speakerContentRequest<{ id: string; version: number }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}/content`,
      actorId,
      role,
      { method: "PUT", body: JSON.stringify(payload) },
    );
  },

  restoreSession(actorId: string, role: string, eventId: string, sessionId: string, revisionId: string) {
    return speakerContentRequest<{ id: string; restored: true; version: number }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/sessions/${encodeURIComponent(sessionId)}/content/restore/${encodeURIComponent(revisionId)}`,
      actorId,
      role,
      { method: "POST" },
    );
  },

  recordCommunication(actorId: string, role: string, eventId: string, payload: {
    kind: "invitation" | "general" | "task_reminder";
    recipientIds: string[];
    subject: string;
    bodyTemplate: string;
  }) {
    return speakerContentRequest<{ recorded: number; queued: number; dispatched: number; status: "recorded" | "queued"; deliveryMode: "sandbox" | "queue" }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/speaker-communications/record`,
      actorId,
      role,
      { method: "POST", body: JSON.stringify(payload) },
    );
  },

  addTaskComment(actorId: string, role: string, eventId: string, taskId: string, body: string) {
    return speakerContentRequest<{ id: string; authorName: string; body: string; createdAt: string }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/tasks/${encodeURIComponent(taskId)}/comments`,
      actorId,
      role,
      { method: "POST", body: JSON.stringify({ body }) },
    );
  },

  prepareExport(actorId: string, role: string, eventId: string, taskIds: string[]) {
    return speakerContentRequest<{ status: "ready"; selected: number; grouping: "session"; downloadUrl: string }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/files/export`,
      actorId,
      role,
      { method: "POST", body: JSON.stringify({ taskIds }) },
    );
  },

  uploadHeadshot(actorId: string, role: string, eventId: string, file: File) {
    const query = new URLSearchParams({ purpose: "headshot", filename: file.name });
    return speakerContentUpload<{ id: string; fileName: string; status: string }>(
      `/api/v1/events/${encodeURIComponent(eventId)}/uploads?${query}`,
      actorId,
      role,
      file,
    );
  },
};

export function managedSpeakerPayload(speaker: SpeakerContentSpeaker): ManagedSpeakerPayload {
  return {
    name: speaker.name,
    email: speaker.email,
    title: speaker.title,
    company: speaker.company,
    bio: speaker.bio,
    pronouns: speaker.pronouns,
    city: speaker.city,
    workflowStatus: speaker.workflowStatus,
    socialLinks: speaker.socialLinks,
    travelDetails: speaker.travelDetails,
    published: speaker.published,
  };
}
