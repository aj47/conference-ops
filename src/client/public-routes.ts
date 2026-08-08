export const DEFAULT_PUBLIC_EVENT_SLUG = "ai-engineer-summit-2026";

export type PublicEventSection = "cfp" | "agenda" | "speakers" | "embed";

export interface PublicEventRoute {
  slug: string;
  section: PublicEventSection;
  legacy: boolean;
}

function decodedSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function publicEventRouteFromPath(pathname: string): PublicEventRoute | null {
  const cfp = pathname.match(/^\/submit\/([^/]+)\/?$/);
  if (cfp) return { slug: decodedSegment(cfp[1]), section: "cfp", legacy: false };

  const program = pathname.match(/^\/events\/([^/]+)\/(agenda|speakers|embed\/agenda)\/?$/);
  if (program) {
    return {
      slug: decodedSegment(program[1]),
      section: program[2] === "agenda" ? "agenda" : program[2] === "speakers" ? "speakers" : "embed",
      legacy: false,
    };
  }

  if (pathname === "/agenda" || pathname === "/agenda/") {
    return { slug: DEFAULT_PUBLIC_EVENT_SLUG, section: "agenda", legacy: true };
  }
  if (pathname === "/speakers" || pathname === "/speakers/") {
    return { slug: DEFAULT_PUBLIC_EVENT_SLUG, section: "speakers", legacy: true };
  }
  if (pathname === "/embed/agenda" || pathname === "/embed/agenda/") {
    return { slug: DEFAULT_PUBLIC_EVENT_SLUG, section: "embed", legacy: true };
  }
  return null;
}

export function publicAgendaPath(slug: string) {
  return `/events/${encodeURIComponent(slug)}/agenda`;
}

export function publicSpeakersPath(slug: string) {
  return `/events/${encodeURIComponent(slug)}/speakers`;
}

export function publicAgendaEmbedPath(slug: string) {
  return `/events/${encodeURIComponent(slug)}/embed/agenda`;
}

export function publicSubmissionPath(slug: string) {
  return `/submit/${encodeURIComponent(slug)}`;
}

export function draftSubmissionPreviewPath(slug: string, eventId: string) {
  const query = new URLSearchParams({ preview: "draft", eventId });
  return `${publicSubmissionPath(slug)}?${query}`;
}

export function privateDraftPreviewEventId(route: PublicEventRoute | null, search: string) {
  if (route?.section !== "cfp") return undefined;
  const query = new URLSearchParams(search);
  if (query.get("preview") !== "draft") return undefined;
  return query.get("eventId") || undefined;
}

export function canonicalPublicPath(route: PublicEventRoute) {
  if (route.section === "cfp") return publicSubmissionPath(route.slug);
  if (route.section === "agenda") return publicAgendaPath(route.slug);
  if (route.section === "speakers") return publicSpeakersPath(route.slug);
  return publicAgendaEmbedPath(route.slug);
}
