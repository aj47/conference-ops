import {
  ArrowRight,
  Clock3,
  Code2,
  ExternalLink,
  Heart,
  MapPin,
  Search,
  Sparkles,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Avatar, EmptyState, LogoMark, NoticeRegion } from "../components";
import { PublicHeader } from "../Shell";
import { useWorkspace } from "../workspace";

function sessionTime(value?: string) {
  if (!value) return "TBA";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date(value));
}

function PublicEventHero({ section }: { section: "agenda" | "speakers" }) {
  const { workspace } = useWorkspace();
  return (
    <section className="public-event-hero">
      <div><p className="eyebrow">28—29 August 2026 · San Francisco</p><h1>{section === "agenda" ? "A program for people who operate the systems." : "Meet the people behind the field notes."}</h1><p>{workspace.event.description}</p></div>
      <aside><span>FORT MASON CENTER</span><strong>{section === "agenda" ? "DAY 01 / FIELD PROGRAM" : "SPEAKER INDEX / 2026"}</strong><small>Times shown in Pacific Time</small></aside>
    </section>
  );
}

export function PublicAgenda() {
  const { workspace, setNotice } = useWorkspace();
  const [track, setTrack] = useState("all");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const sessions = workspace.sessions.filter((session) => session.startsAt && session.roomId && (track === "all" || session.trackId === track)).sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime());
  const toggleFavorite = (id: string) => setFavorites((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <div className="public-page program-page">
      <PublicHeader active="agenda" />
      <main>
        <PublicEventHero section="agenda" />
        <div className="agenda-controls"><div className="day-tabs"><button type="button" className="active"><span>FRI</span><strong>28</strong><small>Day one</small></button><button type="button" disabled><span>SAT</span><strong>29</strong><small>Publishing soon</small></button></div><label className="select-control"><span className="sr-only">Filter by track</span><select value={track} onChange={(event) => setTrack(event.target.value)}><option value="all">All program lanes</option>{workspace.tracks.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button type="button" className="button button--quiet" onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/embed/agenda`); setNotice("Embed URL copied."); }}><Code2 size={15} /> Embed agenda</button></div>
        <section className="public-agenda" aria-label="Friday agenda">
          {sessions.map((session) => { const room = workspace.rooms.find((item) => item.id === session.roomId); const lane = workspace.tracks.find((item) => item.id === session.trackId); return <article className="public-session" id={`session-${session.id}`} key={session.id}><div className="public-session__time"><strong>{sessionTime(session.startsAt)}</strong><span>{sessionTime(session.endsAt)}</span></div><div className="public-session__rail"><i style={{ background: lane?.color }} /></div><div className="public-session__body"><div className="public-session__meta"><span>{lane?.name ?? "Program"}</span><span><MapPin size={12} /> {room?.name}</span></div><h2>{session.title}</h2><p>{session.description}</p>{session.speakerNames.length > 0 && <div className="public-session__speakers"><span className="avatar-stack">{session.speakerNames.map((name) => <Avatar name={name} size="sm" key={name} />)}</span><strong>{session.speakerNames.join(" · ")}</strong></div>}</div><button type="button" className={favorites.has(session.id) ? "favorite-button selected" : "favorite-button"} onClick={() => toggleFavorite(session.id)} aria-pressed={favorites.has(session.id)} aria-label={`${favorites.has(session.id) ? "Remove" : "Add"} ${session.title} ${favorites.has(session.id) ? "from" : "to"} favorites`}><Heart size={18} fill={favorites.has(session.id) ? "currentColor" : "none"} /></button></article>; })}
          {!sessions.length && <EmptyState title="No sessions in this lane" detail="Choose All program lanes to return to the complete day." />}
        </section>
        <section className="program-cta"><div><p className="eyebrow">Bring a field note</p><h2>The next program starts with a specific story.</h2></div><Link to="/submit/ai-engineer-summit-2026" className="button button--primary button--large">Submit a session <ArrowRight size={16} /></Link></section>
      </main>
      <NoticeRegion />
    </div>
  );
}

export function SpeakerGallery() {
  const { workspace, publicSpeakers } = useWorkspace();
  const [query, setQuery] = useState("");
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
        <div className="gallery-toolbar"><label className="search-control"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a speaker, company, or subject…" /></label><span><Users size={15} /> {filtered.length} confirmed speakers</span></div>
        <section className="speaker-gallery">
          {filtered.map(({ speaker, session }, index) => <article className="speaker-card" key={speaker.id}><div className="speaker-card__portrait"><span className="speaker-card__number">{String(index + 1).padStart(2, "0")}</span><Avatar name={speaker.name} size="lg" /><i /></div><div className="speaker-card__copy"><p className="eyebrow">{speaker.title} · {speaker.company}</p><h2>{speaker.name}</h2><p>{speaker.bio}</p><div><Sparkles size={14} /><span>{session?.title ?? "Confirmed program speaker"}</span></div>{session ? <Link to={`/agenda#session-${session.id}`}>View on agenda <ArrowRight size={13} /></Link> : <span className="muted">Public profile</span>}</div></article>)}
          {!filtered.length && <EmptyState title="No speaker matches" detail="Try a broader company, title, or topic search." />}
        </section>
      </main>
    </div>
  );
}

export function AgendaEmbed() {
  const { workspace } = useWorkspace();
  const sessions = workspace.sessions.filter((session) => session.startsAt && session.roomId).sort((a, b) => new Date(a.startsAt!).getTime() - new Date(b.startsAt!).getTime());
  return (
    <div className="embed-page">
      <header><LogoMark compact /><div><strong>{workspace.event.shortName}</strong><span>Friday · August 28 · Pacific Time</span></div><a href="/agenda" target="_blank" rel="noreferrer">Full agenda <ExternalLink size={13} /></a></header>
      <main>{sessions.map((session) => { const room = workspace.rooms.find((item) => item.id === session.roomId); const track = workspace.tracks.find((item) => item.id === session.trackId); return <article key={session.id}><time>{sessionTime(session.startsAt)}</time><i style={{ background: track?.color }} /><div><strong>{session.title}</strong><span>{session.speakerNames.join(", ")} · {room?.name}</span></div></article>; })}</main>
      <footer><Clock3 size={13} /> Program updates automatically from the published revision.</footer>
    </div>
  );
}
