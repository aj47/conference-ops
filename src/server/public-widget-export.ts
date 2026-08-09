import type { EventRecord, ProgramSession, SpeakerProfile } from "../shared/domain";

export type PublicWidgetExportFormat = "json" | "xml" | "ical";

export interface PublicWidgetExportSession extends ProgramSession {
  trackName?: string;
  roomName?: string;
}

export interface PublicWidgetExportPayload {
  event: EventRecord;
  sessions: PublicWidgetExportSession[];
  speakers: Array<Omit<SpeakerProfile, "email">>;
}

export function isPublicWidgetExportFormat(value: unknown): value is PublicWidgetExportFormat {
  return value === "json" || value === "xml" || value === "ical";
}

export function filterPublicWidgetExport(
  payload: PublicWidgetExportPayload,
  filters: { trackId?: string; sessionFormat?: string; roomId?: string },
) {
  const sessions = payload.sessions.filter((session) => {
    if (filters.trackId && filters.trackId !== "all" && session.trackId !== filters.trackId) return false;
    if (filters.sessionFormat && filters.sessionFormat !== "all" && (session.format ?? "talk") !== filters.sessionFormat) return false;
    if (filters.roomId && filters.roomId !== "all" && session.roomId !== filters.roomId) return false;
    return true;
  });
  const visibleSpeakerIds = new Set(sessions.flatMap((session) => session.speakerIds));
  return {
    ...payload,
    sessions,
    speakers: payload.speakers.filter((speaker) => visibleSpeakerIds.has(speaker.id)),
  };
}

function xmlEscape(value: unknown) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function publicWidgetXml(payload: PublicWidgetExportPayload) {
  const speakerById = new Map(payload.speakers.map((speaker) => [speaker.id, speaker]));
  const sessions = payload.sessions.map((session) => `<session id="${xmlEscape(session.id)}">
    <title>${xmlEscape(session.title)}</title>
    <description>${xmlEscape(session.description)}</description>
    <format>${xmlEscape(session.format ?? "talk")}</format>
    <track id="${xmlEscape(session.trackId)}">${xmlEscape(session.trackName)}</track>
    <room id="${xmlEscape(session.roomId)}">${xmlEscape(session.roomName)}</room>
    <starts-at>${xmlEscape(session.startsAt)}</starts-at>
    <ends-at>${xmlEscape(session.endsAt)}</ends-at>
    <speakers>${session.speakerIds.map((id) => { const speaker = speakerById.get(id); return `<speaker id="${xmlEscape(id)}"><name>${xmlEscape(speaker?.name)}</name><title>${xmlEscape(speaker?.title)}</title><company>${xmlEscape(speaker?.company)}</company></speaker>`; }).join("")}</speakers>
  </session>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<conference-program event-id="${xmlEscape(payload.event.id)}">
  <event><name>${xmlEscape(payload.event.name)}</name><timezone>${xmlEscape(payload.event.timezone)}</timezone><starts-at>${xmlEscape(payload.event.startsAt)}</starts-at><ends-at>${xmlEscape(payload.event.endsAt)}</ends-at></event>
  <sessions>${sessions}</sessions>
</conference-program>\n`;
}

function icsEscape(value: unknown) {
  return String(value ?? "").replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll(/\r?\n/g, "\\n");
}

function icsTimestamp(value?: string) {
  if (!value) return "";
  return new Date(value).toISOString().replaceAll(/[-:]/g, "").replace(".000", "");
}

export function publicWidgetIcal(payload: PublicWidgetExportPayload) {
  const speakerById = new Map(payload.speakers.map((speaker) => [speaker.id, speaker]));
  const generatedAt = icsTimestamp(new Date().toISOString());
  const sessions = payload.sessions.filter((session) => session.startsAt).map((session) => [
    "BEGIN:VEVENT",
    `UID:${icsEscape(session.id)}@conference-ops`,
    `DTSTAMP:${generatedAt}`,
    `DTSTART:${icsTimestamp(session.startsAt)}`,
    `DTEND:${icsTimestamp(session.endsAt ?? session.startsAt)}`,
    `SUMMARY:${icsEscape(session.title)}`,
    `DESCRIPTION:${icsEscape([session.description, session.speakerIds.map((id) => speakerById.get(id)?.name).filter(Boolean).join(", "), session.trackName].filter(Boolean).join(" — "))}`,
    `LOCATION:${icsEscape(session.roomName)}`,
    "END:VEVENT",
  ].join("\r\n"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "PRODID:-//Conference Ops//Published Program//EN", `X-WR-CALNAME:${icsEscape(payload.event.name)}`, ...sessions, "END:VCALENDAR", ""].join("\r\n");
}
