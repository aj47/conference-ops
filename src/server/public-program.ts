import type { EventRecord, ProgramSession, ResourcePage, SpeakerProfile } from "../shared/domain";

export const PUBLIC_EVENT_STATUSES = ["cfp_open", "review", "agenda_published", "archived"] as const;

type PublicEventStatus = (typeof PUBLIC_EVENT_STATUSES)[number];

export function isPublicEventStatus(value: unknown): value is PublicEventStatus {
  return typeof value === "string" && PUBLIC_EVENT_STATUSES.includes(value as PublicEventStatus);
}

export function databaseTimestampToIso(value: unknown): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const timestamp = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp as string | number);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid database timestamp");
  return date.toISOString();
}

export function publicEventFromRow(row: Record<string, unknown>): EventRecord {
  const startsAt = databaseTimestampToIso(row.startsAt);
  const endsAt = databaseTimestampToIso(row.endsAt);
  if (!startsAt || !endsAt || !isPublicEventStatus(row.status)) {
    throw new Error("Invalid public event record");
  }
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    shortName: String(row.shortName),
    description: String(row.description ?? ""),
    timezone: String(row.timezone),
    startsAt,
    endsAt,
    cfpClosesAt: databaseTimestampToIso(row.cfpClosesAt) ?? startsAt,
    venue: String(row.venue ?? ""),
    websiteUrl: String(row.websiteUrl ?? ""),
    accent: String(row.accent),
    ...(row.logoUploadId ? { logoUrl: `/api/v1/public/events/${encodeURIComponent(String(row.slug))}/brand/logo` } : {}),
    status: row.status,
  };
}

export interface PublicSessionSpeakerRow {
  sessionId: string;
  speakerId: string;
  speakerName: string;
}

const publicSessionFormats = ["keynote", "talk", "workshop", "panel", "lightning", "break", "networking"] as const;

function publicSessionFormat(value: unknown): ProgramSession["format"] {
  return typeof value === "string" && publicSessionFormats.includes(value as (typeof publicSessionFormats)[number])
    ? value as ProgramSession["format"]
    : "talk";
}

export function publicSessionsFromRows(
  rows: Array<Record<string, unknown>>,
  speakerRows: PublicSessionSpeakerRow[],
): Array<ProgramSession & { trackName?: string; trackColor?: string; roomName?: string }> {
  const speakers = new Map<string, { ids: string[]; names: string[] }>();
  for (const row of speakerRows) {
    const session = speakers.get(row.sessionId) ?? { ids: [], names: [] };
    if (!session.ids.includes(row.speakerId)) {
      session.ids.push(row.speakerId);
      session.names.push(row.speakerName);
    }
    speakers.set(row.sessionId, session);
  }

  return rows.map((row) => {
    const sessionSpeakers = speakers.get(String(row.id)) ?? { ids: [], names: [] };
    const startsAt = databaseTimestampToIso(row.startsAt);
    const endsAt = databaseTimestampToIso(row.endsAt);
    return {
      id: String(row.id),
      eventId: String(row.eventId),
      ...(row.proposalId ? { proposalId: String(row.proposalId) } : {}),
      title: String(row.title),
      description: String(row.description ?? ""),
      format: publicSessionFormat(row.format),
      speakerIds: sessionSpeakers.ids,
      speakerNames: sessionSpeakers.names,
      ...(row.trackId ? { trackId: String(row.trackId) } : {}),
      ...(row.roomId ? { roomId: String(row.roomId) } : {}),
      ...(startsAt ? { startsAt } : {}),
      ...(endsAt ? { endsAt } : {}),
      status: "published",
      ...(row.trackName ? { trackName: String(row.trackName) } : {}),
      ...(row.trackColor ? { trackColor: String(row.trackColor) } : {}),
      ...(row.roomName ? { roomName: String(row.roomName) } : {}),
    };
  });
}

export function publicSpeakerFromRow(
  row: Record<string, unknown>,
  eventSlug: string,
): Omit<SpeakerProfile, "email"> {
  return {
    id: String(row.id),
    name: String(row.name),
    title: String(row.title ?? ""),
    company: String(row.company ?? ""),
    bio: String(row.bio ?? ""),
    ...(row.pronouns ? { pronouns: String(row.pronouns) } : {}),
    ...(row.city ? { city: String(row.city) } : {}),
    ...(row.hasHeadshot === true || Number(row.hasHeadshot) === 1
      ? { headshotUrl: `/api/v1/public/events/${encodeURIComponent(eventSlug)}/speakers/${encodeURIComponent(String(row.id))}/headshot` }
      : {}),
    profileComplete: row.profileComplete === true || Number(row.profileComplete) === 1,
  };
}

export function publicSpeakerFromProfile(
  speaker: SpeakerProfile,
): Omit<SpeakerProfile, "email"> {
  return {
    id: speaker.id,
    name: speaker.name,
    title: speaker.title,
    company: speaker.company,
    bio: speaker.bio,
    ...(speaker.pronouns ? { pronouns: speaker.pronouns } : {}),
    ...(speaker.city ? { city: speaker.city } : {}),
    ...(speaker.headshotUrl ? { headshotUrl: speaker.headshotUrl } : {}),
    profileComplete: speaker.profileComplete,
  };
}

export function publicResourceFromRow(row: Record<string, unknown>): ResourcePage {
  return {
    id: String(row.id),
    title: String(row.title),
    slug: String(row.slug),
    status: "published",
    summary: String(row.summary ?? ""),
    body: String(row.body ?? ""),
    ...(row.linkUrl ? { linkUrl: String(row.linkUrl) } : {}),
    updatedAt: databaseTimestampToIso(row.updatedAt) ?? new Date(0).toISOString(),
  };
}
