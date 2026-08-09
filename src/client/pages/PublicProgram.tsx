import {
  ArrowRight,
  BookOpen,
  Clock3,
  Code2,
  ExternalLink,
  Heart,
  MapPin,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { loadAgendaFavorites, saveAgendaFavorites } from "../agenda-favorites";
import { Avatar, EmptyState, LogoMark, NoticeRegion } from "../components";
import {
  eventDateKey,
  eventDayOptions,
  formatEventDateRange,
  formatEventDay,
  formatEventTime,
  formatEventYear,
  timeZoneAbbreviation,
} from "../event-time";
import { PublicHeader } from "../Shell";
import { publicAgendaEmbedPath, publicAgendaPath } from "../public-routes";
import { publishedResources } from "../resource-pages";
import { ResourceContent } from "../ResourceContent";
import { useWorkspace } from "../workspace";

function PublicEventHero({ section }: { section: "agenda" | "speakers" | "resources" }) {
  const { workspace } = useWorkspace();
  const timezone = timeZoneAbbreviation(workspace.event.startsAt, workspace.event.timezone);
  const title = section === "agenda"
    ? "A program for people who operate the systems."
    : section === "speakers"
      ? "Meet the people behind the field notes."
      : "Everything you need before you arrive.";
  const indexLabel = section === "agenda" ? "PUBLISHED FIELD PROGRAM" : section === "speakers" ? `SPEAKER INDEX / ${formatEventYear(workspace.event.startsAt, workspace.event.timezone)}` : "PARTICIPANT FIELD GUIDE";
  return (
    <section className="public-event-hero">
      <div><p className="eyebrow">{formatEventDateRange(workspace.event)} · {workspace.event.venue}</p><h1>{title}</h1><p>{workspace.event.description}</p></div>
      <aside><span>{workspace.event.shortName}</span><strong>{indexLabel}</strong><small>{section === "resources" ? "Published by the event team" : `Times shown in ${timezone}`}</small></aside>
    </section>
  );
}

export function PublicAgenda() {
  const { workspace, setNotice } = useWorkspace();
  const [track, setTrack] = useState("all");
  const storedFavorites = useMemo(() => loadAgendaFavorites(workspace.event.slug), [workspace.event.slug]);
  const [favoritesByEvent, setFavoritesByEvent] = useState<Map<string, Set<string>>>(() => new Map());
  const favorites = favoritesByEvent.get(workspace.event.slug) ?? storedFavorites;
  const [selectedDay, setSelectedDay] = useState(() => eventDateKey(workspace.event.startsAt, workspace.event.timezone));
  const scheduledSessions = workspace.sessions.filter((session) => session.startsAt && session.roomId);
  const days = eventDayOptions(workspace.event, scheduledSessions);
  const activeDay = days.some((day) => day.key === selectedDay) ? selectedDay : days[0]?.key;
  const sessions = scheduledSessions
    .filter((session) => eventDateKey(session.startsAt!, workspace.event.timezone) === activeDay && (track === "all" || session.trackId === track))
    .sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime());
  const toggleFavorite = (id: string) => setFavoritesByEvent((current) => {
    const nextFavorites = new Set(current.get(workspace.event.slug) ?? storedFavorites);
    if (nextFavorites.has(id)) nextFavorites.delete(id);
    else nextFavorites.add(id);
    saveAgendaFavorites(workspace.event.slug, nextFavorites);
    const next = new Map(current);
    next.set(workspace.event.slug, nextFavorites);
    return next;
  });
  const activeDayLabel = days.find((day) => day.key === activeDay)?.label ?? formatEventDay(workspace.event.startsAt, workspace.event.timezone);
  const copyEmbedUrl = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${publicAgendaEmbedPath(workspace.event.slug)}`);
      setNotice("Embed URL copied.");
    } catch {
      setNotice("Could not copy the embed URL. Open the embed page and copy the address from your browser.");
    }
  };
  return (
    <div className="public-page program-page">
      <PublicHeader active="agenda" />
      <main>
        <PublicEventHero section="agenda" />
        <div className="agenda-controls"><div className="day-tabs">{days.map((day, index) => <button type="button" key={day.key} className={day.key === activeDay ? "active" : ""} aria-pressed={day.key === activeDay} onClick={() => setSelectedDay(day.key)}><span>{day.weekday}</span><strong>{day.day}</strong><small>Day {index + 1}</small></button>)}</div><label className="select-control"><span className="sr-only">Filter by track</span><select value={track} onChange={(event) => setTrack(event.target.value)}><option value="all">All program lanes</option>{workspace.tracks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="button button--quiet" onClick={() => void copyEmbedUrl()}><Code2 size={15} /> Embed agenda</button></div>
        <section className="public-agenda" aria-label={`${activeDayLabel} agenda`}>
          {sessions.map((session) => { const room = workspace.rooms.find((item) => item.id === session.roomId); const lane = workspace.tracks.find((item) => item.id === session.trackId); return <article className="public-session" id={`session-${session.id}`} key={session.id}><div className="public-session__time"><strong>{formatEventTime(session.startsAt, workspace.event.timezone)}</strong><span>{formatEventTime(session.endsAt, workspace.event.timezone)}</span></div><div className="public-session__rail"><i style={{ background: lane?.color }} /></div><div className="public-session__body"><div className="public-session__meta"><span>{lane?.name ?? "Program"}</span><span><MapPin size={12} /> {room?.name}</span></div><h2>{session.title}</h2><p>{session.description}</p>{session.speakerNames.length > 0 && <div className="public-session__speakers"><span className="avatar-stack">{session.speakerNames.map((name) => <Avatar name={name} size="sm" key={name} />)}</span><strong>{session.speakerNames.join(" · ")}</strong></div>}</div><button type="button" className={favorites.has(session.id) ? "favorite-button selected" : "favorite-button"} onClick={() => toggleFavorite(session.id)} aria-pressed={favorites.has(session.id)} aria-label={`${favorites.has(session.id) ? "Remove" : "Add"} ${session.title} ${favorites.has(session.id) ? "from" : "to"} favorites`}><Heart size={18} fill={favorites.has(session.id) ? "currentColor" : "none"} /></button></article>; })}
          {!sessions.length && <EmptyState title="No sessions in this view" detail={track === "all" ? `No sessions are published for ${activeDayLabel} yet.` : "Choose All program lanes to return to the complete day."} />}
        </section>
        <section className="program-cta"><div><p className="eyebrow">Bring a field note</p><h2>The next program starts with a specific story.</h2></div><Link to={`/submit/${encodeURIComponent(workspace.event.slug)}`} className="button button--primary button--large">Submit a session <ArrowRight size={16} /></Link></section>
      </main>
      <NoticeRegion />
    </div>
  );
}

export function SpeakerGallery() {
  const { workspace, publicSpeakers } = useWorkspace();
  const [query, setQuery] = useState("");
  const [failedHeadshots, setFailedHeadshots] = useState<Set<string>>(new Set());
  const speakers = publicSpeakers.map((speaker) => ({
    speaker,
    session: workspace.sessions.find((session) => session.speakerIds.includes(speaker.id)),
  }));
  const filtered = speakers.filter(({ speaker, session }) => `${speaker.name} ${speaker.company} ${speaker.title} ${session?.title ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  return (
    <div className="public-page program-page">
      <PublicHeader active="speakers" />
      <main>
        <PublicEventHero section="speakers" />
        <div className="gallery-toolbar"><label className="search-control"><Search size={16} /><input aria-label="Search speakers" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a speaker, company, or subject…" /></label><span><Users size={15} /> {filtered.length} confirmed speakers</span></div>
        <section className="speaker-gallery">
          {filtered.map(({ speaker, session }, index) => {
            const showHeadshot = Boolean(speaker.headshotUrl) && !failedHeadshots.has(speaker.id);
            return <article className="speaker-card" key={speaker.id}><div className="speaker-card__portrait"><span className="speaker-card__number">{String(index + 1).padStart(2, "0")}</span>{showHeadshot ? <img className="speaker-portrait" src={speaker.headshotUrl} alt={`Portrait of ${speaker.name}`} loading="lazy" decoding="async" onError={() => setFailedHeadshots((current) => new Set(current).add(speaker.id))} style={{ width: "min(96px, calc(100% - 18px))", aspectRatio: "1", zIndex: 1, border: "2px solid var(--ink)" }} /> : <Avatar name={speaker.name} size="lg" />}<i /></div><div className="speaker-card__copy"><p className="eyebrow">{speaker.title} · {speaker.company}</p><h2>{speaker.name}</h2><p>{speaker.bio}</p><div><Sparkles size={14} /><span>{session?.title ?? "Confirmed program speaker"}</span></div>{session ? <Link to={`${publicAgendaPath(workspace.event.slug)}#session-${session.id}`}>View on agenda <ArrowRight size={13} /></Link> : <span className="muted">Public profile</span>}</div></article>;
          })}
          {!filtered.length && <EmptyState title="No speaker matches" detail="Try a broader company, title, or topic search." />}
        </section>
      </main>
    </div>
  );
}

export function PublicResources() {
  const { workspace } = useWorkspace();
  const resources = publishedResources(workspace.resources);
  return (
    <div className="public-page program-page">
      <PublicHeader active="resources" />
      <main>
        <PublicEventHero section="resources" />
        <section className="public-resources" aria-labelledby="public-resources-title">
          <header><div><p className="eyebrow">Organizer-published references</p><h2 id="public-resources-title">Event guides & policies</h2></div><span><BookOpen size={15} /> {resources.length} published {resources.length === 1 ? "page" : "pages"}</span></header>
          <div>
            {resources.map((resource, index) => (
              <article key={resource.id} id={`resource-${resource.slug}`}>
                <aside><span>{String(index + 1).padStart(2, "0")}</span><BookOpen size={20} /></aside>
                <div><p className="eyebrow">/{resource.slug}</p><h3>{resource.title}</h3><p className="public-resource__summary">{resource.summary}</p><ResourceContent resource={resource} /></div>
              </article>
            ))}
            {!resources.length && <EmptyState title="No resources published yet" detail="The event team is still preparing participant guidance. Check back before the event." />}
          </div>
        </section>
      </main>
    </div>
  );
}

export function AgendaEmbed() {
  const { workspace } = useWorkspace();
  const sessions = workspace.sessions.filter((session) => session.startsAt && session.roomId).sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime());
  const timezone = timeZoneAbbreviation(workspace.event.startsAt, workspace.event.timezone);
  return (
    <div className="embed-page">
      <header><LogoMark compact /><div><strong>{workspace.event.shortName}</strong><span>{formatEventDateRange(workspace.event)} · {timezone}</span></div><a href={publicAgendaPath(workspace.event.slug)} target="_blank" rel="noreferrer">Full agenda <ExternalLink size={13} /></a></header>
      <main>{sessions.map((session) => { const room = workspace.rooms.find((item) => item.id === session.roomId); const track = workspace.tracks.find((item) => item.id === session.trackId); return <article key={session.id}><time>{formatEventTime(session.startsAt, workspace.event.timezone)}</time><i style={{ background: track?.color }} /><div><strong>{session.title}</strong><span>{session.speakerNames.join(", ")} · {room?.name}</span></div></article>; })}</main>
      <footer><Clock3 size={13} /> Program reflects the current live schedule when this page loads.</footer>
    </div>
  );
}
