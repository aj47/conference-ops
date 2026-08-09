export type SpeakerWorkflowStatus = "invited" | "confirmed" | "onboarding" | "ready" | "declined";
export type SessionContentStatus = "draft" | "in_review" | "approved";

export interface SpeakerSocialLinks {
  linkedin?: string;
  x?: string;
  website?: string;
}

export interface SpeakerContentSpeaker {
  id: string;
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
  profileComplete: boolean;
  published: boolean;
  headshot?: {
    uploadId: string;
    fileName: string;
    contentType: string;
    uploadedAt: string;
    downloadUrl: string;
  };
  sessions: Array<{ id: string; title: string; startsAt?: string; room?: string }>;
}

export interface SpeakerContentTask {
  id: string;
  speakerId: string;
  speakerName: string;
  proposalId?: string;
  sessionId?: string;
  sessionTitle?: string;
  title: string;
  description: string;
  kind: "general" | "file_request";
  dueAt: string;
  status: "not_started" | "in_progress" | "complete" | "overdue" | "waived";
  versions: SpeakerContentFileVersion[];
  comments: Array<{
    id: string;
    authorName: string;
    body: string;
    createdAt: string;
  }>;
}

export interface SpeakerContentFileVersion {
  uploadId: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  uploadedAt: string;
  current: boolean;
  downloadUrl: string;
}

export interface SpeakerContentFile {
  id: string;
  taskId: string;
  speakerId: string;
  speakerName: string;
  sessionId?: string;
  sessionTitle?: string;
  fileName: string;
  uploadedAt: string;
  versionCount: number;
  versions: SpeakerContentFileVersion[];
}

export interface ContentRevision {
  id: string;
  version: number;
  title: string;
  description: string;
  editorName: string;
  createdAt: string;
  restoredFromVersion?: number;
}

export interface SpeakerContentSession {
  id: string;
  title: string;
  description: string;
  format: string;
  scheduleStatus: "unscheduled" | "scheduled" | "published";
  contentStatus: SessionContentStatus;
  speakerIds: string[];
  speakerNames: string[];
  startsAt?: string;
  room?: string;
  history: ContentRevision[];
}

export interface SpeakerCommunicationLog {
  id: string;
  kind: "invitation" | "general" | "task_reminder";
  recipientIds: string[];
  recipientNames: string[];
  subject: string;
  bodyTemplate: string;
  renderedPreviews: Array<{ speakerId: string; speakerName: string; body: string }>;
  status: "queued" | "recorded";
  deliveryMode: "queue" | "sandbox";
  createdAt: string;
  actorName: string;
}

export interface SpeakerContentSnapshot {
  speakers: SpeakerContentSpeaker[];
  tasks: SpeakerContentTask[];
  files: SpeakerContentFile[];
  sessions: SpeakerContentSession[];
  communications: SpeakerCommunicationLog[];
  generatedAt: string;
}

export interface ImportedSpeakerRow {
  name: string;
  email: string;
  title: string;
  company: string;
  bio: string;
}

function splitCsvRows(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      cell = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

const csvAliases = {
  name: ["name", "full name", "speaker", "speaker name"],
  email: ["email", "email address", "speaker email"],
  title: ["title", "job title", "role"],
  company: ["company", "organization", "organisation", "affiliation"],
  bio: ["bio", "biography", "speaker bio"],
} as const;

export function parseSpeakerCsv(csv: string): ImportedSpeakerRow[] {
  const rows = splitCsvRows(csv.replace(/^\uFEFF/, ""));
  if (rows.length < 2) return [];
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const column = (key: keyof typeof csvAliases) => headers.findIndex((header) => csvAliases[key].includes(header as never));
  const columns = {
    name: column("name"),
    email: column("email"),
    title: column("title"),
    company: column("company"),
    bio: column("bio"),
  };
  if (columns.name < 0 || columns.email < 0) {
    throw new Error("The CSV needs Name and Email columns.");
  }
  const deduped = new Map<string, ImportedSpeakerRow>();
  for (const row of rows.slice(1)) {
    const email = (row[columns.email] ?? "").trim().toLowerCase();
    const name = (row[columns.name] ?? "").trim();
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) continue;
    deduped.set(email, {
      name,
      email,
      title: columns.title >= 0 ? (row[columns.title] ?? "").trim() : "",
      company: columns.company >= 0 ? (row[columns.company] ?? "").trim() : "",
      bio: columns.bio >= 0 ? (row[columns.bio] ?? "").trim() : "",
    });
  }
  return [...deduped.values()];
}

export function renderSpeakerTemplate(
  template: string,
  speaker: Pick<SpeakerContentSpeaker, "name" | "sessions">,
  portalUrl: string,
) {
  const firstName = speaker.name.trim().split(/\s+/, 1)[0] ?? speaker.name;
  const variables: Record<string, string> = {
    "speaker.name": speaker.name,
    "speaker.first_name": firstName,
    "speaker.portal_url": portalUrl,
    "session.title": speaker.sessions[0]?.title ?? "your session",
  };
  return Object.entries(variables).reduce(
    (rendered, [key, value]) => rendered.replaceAll(`{{${key}}}`, value),
    template,
  );
}

export function outstandingTask(task: Pick<SpeakerContentTask, "status">) {
  return ["not_started", "in_progress", "overdue"].includes(task.status);
}
