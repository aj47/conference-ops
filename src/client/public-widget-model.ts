import type { ProgramSession, Room, SpeakerProfile, Track } from "../shared/domain";

export const publicWidgetKinds = ["sessions", "speakers", "agenda", "itinerary", "gallery"] as const;
export type PublicWidgetKind = (typeof publicWidgetKinds)[number];

export const publicWidgetFormats = ["styled_html", "basic_html", "json", "xml", "ical"] as const;
export type PublicWidgetFormat = (typeof publicWidgetFormats)[number];

export const publicWidgetFields = ["description", "time", "room", "speakers", "track", "format"] as const;
export type PublicWidgetField = (typeof publicWidgetFields)[number];

export interface PublicWidgetConfig {
  kind: PublicWidgetKind;
  format: PublicWidgetFormat;
  theme: "light" | "dark";
  accent: string;
  trackId: string;
  sessionFormat: string;
  roomId: string;
  fields: PublicWidgetField[];
  plain: boolean;
}

export interface PublicSessionView {
  session: ProgramSession;
  track?: Track;
  room?: Room;
  speakers: Array<Omit<SpeakerProfile, "email">>;
  formatLabel: string;
}

export const defaultPublicWidgetConfig: PublicWidgetConfig = {
  kind: "sessions",
  format: "styled_html",
  theme: "light",
  accent: "#b44932",
  trackId: "all",
  sessionFormat: "all",
  roomId: "all",
  fields: [...publicWidgetFields],
  plain: false,
};

export function isPublicWidgetKind(value: unknown): value is PublicWidgetKind {
  return typeof value === "string" && publicWidgetKinds.includes(value as PublicWidgetKind);
}

export function speakerSurnameKey(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts.at(-1) ?? ""}\u0000${parts.slice(0, -1).join(" ")}`.toLocaleLowerCase();
}

export function sortPublicSpeakers<T extends Pick<SpeakerProfile, "name">>(speakers: T[]) {
  return [...speakers].sort((left, right) => speakerSurnameKey(left.name).localeCompare(speakerSurnameKey(right.name)));
}

export function sessionFormatLabel(format: ProgramSession["format"]) {
  if (!format) return "Talk";
  return format === "lightning" ? "Lightning talk" : `${format[0].toUpperCase()}${format.slice(1)}`;
}

export function publicSessionViews(
  sessions: ProgramSession[],
  tracks: Track[],
  rooms: Room[],
  speakers: Array<Omit<SpeakerProfile, "email">>,
) {
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const speakersById = new Map(speakers.map((speaker) => [speaker.id, speaker]));
  return sessions
    .filter((session) => session.status === "published" && session.startsAt && session.roomId)
    .map((session): PublicSessionView => ({
      session,
      track: session.trackId ? tracksById.get(session.trackId) : undefined,
      room: session.roomId ? roomsById.get(session.roomId) : undefined,
      speakers: session.speakerIds.map((id) => speakersById.get(id)).filter((speaker): speaker is Omit<SpeakerProfile, "email"> => Boolean(speaker)),
      formatLabel: sessionFormatLabel(session.format),
    }))
    .sort((left, right) => new Date(left.session.startsAt!).getTime() - new Date(right.session.startsAt!).getTime());
}

export function filterPublicSessions(
  views: PublicSessionView[],
  filters: { query?: string; trackId?: string; sessionFormat?: string; roomId?: string },
) {
  const query = filters.query?.trim().toLocaleLowerCase() ?? "";
  return views.filter((view) => {
    if (filters.trackId && filters.trackId !== "all" && view.session.trackId !== filters.trackId) return false;
    if (filters.sessionFormat && filters.sessionFormat !== "all" && (view.session.format ?? "talk") !== filters.sessionFormat) return false;
    if (filters.roomId && filters.roomId !== "all" && view.session.roomId !== filters.roomId) return false;
    if (!query) return true;
    return [
      view.session.title,
      view.session.description,
      view.track?.name,
      view.room?.name,
      view.formatLabel,
      ...view.speakers.flatMap((speaker) => [speaker.name, speaker.title, speaker.company]),
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

function safeColor(value: string | null) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : defaultPublicWidgetConfig.accent;
}

export function publicWidgetConfigFromSearch(search: string, kind: PublicWidgetKind): PublicWidgetConfig {
  const query = new URLSearchParams(search);
  const requestedFields = (query.get("fields") ?? "").split(",").filter((field): field is PublicWidgetField => publicWidgetFields.includes(field as PublicWidgetField));
  return {
    ...defaultPublicWidgetConfig,
    kind,
    theme: query.get("theme") === "dark" ? "dark" : "light",
    accent: safeColor(query.get("accent")),
    trackId: query.get("track") || "all",
    sessionFormat: query.get("sessionFormat") || "all",
    roomId: query.get("room") || "all",
    fields: requestedFields.length ? [...new Set(requestedFields)] : [...publicWidgetFields],
    plain: query.get("plain") === "1",
  };
}

export function publicWidgetQuery(config: PublicWidgetConfig) {
  const query = new URLSearchParams();
  if (config.theme !== "light") query.set("theme", config.theme);
  if (config.accent !== defaultPublicWidgetConfig.accent) query.set("accent", config.accent);
  if (config.trackId !== "all") query.set("track", config.trackId);
  if (config.sessionFormat !== "all") query.set("sessionFormat", config.sessionFormat);
  if (config.roomId !== "all") query.set("room", config.roomId);
  if (config.fields.length !== publicWidgetFields.length) query.set("fields", config.fields.join(","));
  if (config.plain) query.set("plain", "1");
  return query.toString();
}

export function publicWidgetEmbedPath(slug: string, config: PublicWidgetConfig) {
  const query = publicWidgetQuery(config);
  const path = `/events/${encodeURIComponent(slug)}/embed/${config.kind}`;
  return query ? `${path}?${query}` : path;
}

export function publicWidgetExportPath(slug: string, config: PublicWidgetConfig, format = config.format) {
  const query = publicWidgetQuery(config);
  const path = `/api/v1/public/events/${encodeURIComponent(slug)}/widgets/${config.kind}/${format}`;
  return query ? `${path}?${query}` : path;
}

export function publicWidgetOutput(origin: string, slug: string, eventName: string, config: PublicWidgetConfig) {
  if (["json", "xml", "ical"].includes(config.format)) {
    return `${origin}${publicWidgetExportPath(slug, config)}`;
  }
  const frameConfig = { ...config, plain: config.format === "basic_html" };
  const url = `${origin}${publicWidgetEmbedPath(slug, frameConfig)}`;
  return `<iframe title="${eventName.replaceAll('"', "&quot;")} — ${config.kind}" src="${url.replaceAll("&", "&amp;")}" loading="lazy" style="width:100%;min-height:720px;border:0" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}

function icsEscape(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll(/\r?\n/g, "\\n");
}

function icsTimestamp(value: string) {
  return new Date(value).toISOString().replaceAll(/[-:]/g, "").replace(".000", "");
}

export function personalScheduleIcs(eventName: string, views: PublicSessionView[]) {
  const now = icsTimestamp(new Date().toISOString());
  const events = views.map(({ session, room, speakers, track }) => [
    "BEGIN:VEVENT",
    `UID:${icsEscape(session.id)}@conference-ops`,
    `DTSTAMP:${now}`,
    `DTSTART:${icsTimestamp(session.startsAt!)}`,
    `DTEND:${icsTimestamp(session.endsAt ?? session.startsAt!)}`,
    `SUMMARY:${icsEscape(session.title)}`,
    `DESCRIPTION:${icsEscape([session.description, speakers.map((speaker) => speaker.name).join(", "), track?.name].filter(Boolean).join(" — "))}`,
    `LOCATION:${icsEscape(room?.name ?? "")}`,
    "END:VEVENT",
  ].join("\r\n"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Conference Ops//Personal Schedule//EN", `X-WR-CALNAME:${icsEscape(eventName)} — My schedule`, ...events, "END:VCALENDAR", ""].join("\r\n");
}
