import {
  CalendarPlus,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Heart,
  ListFilter,
  MapPin,
  Search,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { useLocation, useParams } from "react-router-dom";
import type { SpeakerProfile } from "../../shared/domain";
import { loadAgendaFavorites, saveAgendaFavorites } from "../agenda-favorites";
import { Avatar, EmptyState, LogoMark } from "../components";
import { useDialogA11y } from "../dialog-a11y";
import {
  eventDateKey,
  eventDayOptions,
  formatEventDateRange,
  formatEventDay,
  formatEventTime,
  timeZoneAbbreviation,
} from "../event-time";
import {
  filterPublicSessions,
  isPublicWidgetKind,
  personalScheduleIcs,
  publicSessionViews,
  publicWidgetConfigFromSearch,
  sortPublicSpeakers,
  type PublicSessionView,
  type PublicWidgetField,
  type PublicWidgetKind,
} from "../public-widget-model";
import { PublicHeader } from "../Shell";
import { useWorkspace } from "../workspace";

type PublicSpeaker = Omit<SpeakerProfile, "email">;

function PublicProgramHero({ kind }: { kind: PublicWidgetKind }) {
  const { workspace } = useWorkspace();
  const copy: Record<PublicWidgetKind, { index: string; title: string; detail: string }> = {
    sessions: { index: "SESSION CATALOG", title: "Every session, with the context to choose well.", detail: "Search the program by idea or speaker, then narrow it by format, track, or room." },
    speakers: { index: "SPEAKER DIRECTORY", title: "The people behind the field notes.", detail: "An alphabetical directory with biographies and every session each speaker is joining." },
    agenda: { index: "ROOM × TIME", title: "The live program, mapped to place and time.", detail: "Move between event days and open any block for the complete session brief." },
    itinerary: { index: "PERSONAL ITINERARY", title: "Build the event day you want to have.", detail: "Save sessions without an account and export your choices to any calendar." },
    gallery: { index: "SPEAKER GALLERY", title: "Meet the voices shaping the program.", detail: "Browse the visual lineup, search by name, and open a complete speaker profile." },
  };
  return (
    <section className="public-program-hero">
      <div>
        <p className="eyebrow">{formatEventDateRange(workspace.event)} · {workspace.event.venue}</p>
        <h1>{copy[kind].title}</h1>
        <p>{copy[kind].detail}</p>
      </div>
      <aside>
        <span>{workspace.event.shortName}</span>
        <strong>{copy[kind].index}</strong>
        <small>{timeZoneAbbreviation(workspace.event.startsAt, workspace.event.timezone)} · Live published data</small>
      </aside>
    </section>
  );
}

function WidgetPage({ kind, embedded, children }: { kind: PublicWidgetKind; embedded?: boolean; children: React.ReactNode }) {
  const { workspace } = useWorkspace();
  const location = useLocation();
  const config = useMemo(() => publicWidgetConfigFromSearch(location.search, kind), [kind, location.search]);
  const style = { "--widget-accent": config.accent } as CSSProperties;
  if (embedded) {
    return (
      <div className={`public-widget-embed public-widget-embed--${config.theme}${config.plain ? " public-widget-embed--plain" : ""}`} style={style}>
        {!config.plain && <header className="public-widget-embed__header"><LogoMark compact /><div><strong>{workspace.event.shortName}</strong><span>{formatEventDateRange(workspace.event)} · Live {kind}</span></div><a href={`/events/${encodeURIComponent(workspace.event.slug)}/${kind}`} target="_blank" rel="noreferrer">Open full view <ExternalLink size={13} /></a></header>}
        <main>{children}</main>
      </div>
    );
  }
  return (
    <div className="public-page program-page public-program" style={style}>
      <PublicHeader active={kind} />
      <main><PublicProgramHero kind={kind} />{children}</main>
    </div>
  );
}

function DayTabs({ activeDay, onChange, sessionViews }: { activeDay?: string; onChange: (day: string) => void; sessionViews: PublicSessionView[] }) {
  const { workspace } = useWorkspace();
  const days = eventDayOptions(workspace.event, sessionViews.map((view) => view.session));
  return (
    <div className="public-day-tabs" aria-label="Event days">
      {days.map((day, index) => <button type="button" key={day.key} className={day.key === activeDay ? "active" : ""} aria-pressed={day.key === activeDay} onClick={() => onChange(day.key)}><span>{day.weekday}</span><strong>{day.day}</strong><small>Day {index + 1}</small></button>)}
    </div>
  );
}

function SpeakerIdentity({ speaker, compact = false }: { speaker: PublicSpeaker; compact?: boolean }) {
  return (
    <span className={`public-speaker-identity${compact ? " public-speaker-identity--compact" : ""}`}>
      <Avatar name={speaker.name} size="sm" />
      <span><strong>{speaker.name}</strong><small>{[speaker.title || "Speaker", speaker.company].filter(Boolean).join(" · ")}</small></span>
    </span>
  );
}

function SessionDetail({ view, onClose, returnFocusRef }: { view: PublicSessionView; onClose: () => void; returnFocusRef: RefObject<HTMLElement | null> }) {
  const { workspace } = useWorkspace();
  const dialogRef = useDialogA11y<HTMLElement>(onClose, true, returnFocusRef);
  return (
    <div className="modal-backdrop public-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <article ref={dialogRef} className="public-detail-panel" role="dialog" aria-modal="true" aria-labelledby="public-session-detail-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p className="eyebrow">{view.formatLabel} · {view.track?.name ?? "Program"}</p><h2 id="public-session-detail-title">{view.session.title}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close session details"><X size={19} /></button></header>
        <div className="public-detail-panel__facts">
          <span><Clock3 size={15} /> {formatEventDay(view.session.startsAt!, workspace.event.timezone)}, {formatEventTime(view.session.startsAt, workspace.event.timezone)}–{formatEventTime(view.session.endsAt, workspace.event.timezone)}</span>
          <span><MapPin size={15} /> {view.room?.name ?? "Room to be announced"}</span>
        </div>
        <p className="public-detail-panel__description">{view.session.description || "The event team will publish the complete description shortly."}</p>
        <section><h3>Speakers ({view.speakers.length})</h3><div className="public-detail-speakers">{view.speakers.map((speaker) => <SpeakerIdentity speaker={speaker} key={speaker.id} />)}{!view.speakers.length && <p className="muted">Speaker announcement coming soon.</p>}</div></section>
      </article>
    </div>
  );
}

function SpeakerDetail({ speaker, views, onClose, returnFocusRef }: { speaker: PublicSpeaker; views: PublicSessionView[]; onClose: () => void; returnFocusRef: RefObject<HTMLElement | null> }) {
  const { workspace } = useWorkspace();
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialogRef = useDialogA11y<HTMLElement>(onClose, true, returnFocusRef);
  const sessions = views.filter((view) => view.session.speakerIds.includes(speaker.id));
  return (
    <div className="modal-backdrop public-detail-backdrop" role="presentation" onMouseDown={onClose}>
      <article ref={dialogRef} className="public-detail-panel public-speaker-detail" role="dialog" aria-modal="true" aria-labelledby="public-speaker-detail-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
        <header><div className="public-speaker-detail__identity">{speaker.headshotUrl && !failed ? <img src={speaker.headshotUrl} alt={`Portrait of ${speaker.name}`} onError={() => setFailed(true)} /> : <Avatar name={speaker.name} size="lg" />}<div><p className="eyebrow">{[speaker.title || "Speaker", speaker.company].filter(Boolean).join(" · ")}</p><h2 id="public-speaker-detail-title">{speaker.name}</h2></div></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close speaker details"><X size={19} /></button></header>
        <div><p className={expanded ? "public-speaker-bio" : "public-speaker-bio public-speaker-bio--clamped"}>{speaker.bio || "Biography coming soon."}</p>{speaker.bio && <button type="button" className="text-button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? "Show less" : "Show more"} <ChevronDown size={14} /></button>}</div>
        <section><h3>Sessions ({sessions.length})</h3><div className="public-speaker-sessions">{sessions.map((view) => <article key={view.session.id}><span style={{ background: view.track?.color ?? workspace.event.accent }} /><div><strong>{view.session.title}</strong><small>{formatEventDay(view.session.startsAt!, workspace.event.timezone)} · {formatEventTime(view.session.startsAt, workspace.event.timezone)}–{formatEventTime(view.session.endsAt, workspace.event.timezone)} · {view.room?.name}</small></div></article>)}</div></section>
      </article>
    </div>
  );
}

function SessionFilters({ query, setQuery, trackId, setTrackId, sessionFormat, setSessionFormat, roomId, setRoomId, count }: {
  query: string; setQuery: (value: string) => void; trackId: string; setTrackId: (value: string) => void;
  sessionFormat: string; setSessionFormat: (value: string) => void; roomId: string; setRoomId: (value: string) => void; count: number;
}) {
  const { workspace } = useWorkspace();
  const [open, setOpen] = useState(false);
  const activeCount = [trackId, sessionFormat, roomId].filter((value) => value !== "all").length;
  return (
    <div className="public-catalog-toolbar">
      <label className="search-control public-search"><Search size={17} /><input aria-label="Search sessions by title or speaker" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search session title or speaker…" /></label>
      <button type="button" className={`button button--quiet${activeCount ? " active" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open}><ListFilter size={16} /> Filters {activeCount > 0 && <span className="filter-count">{activeCount}</span>}</button>
      <span className="public-result-count" aria-live="polite"><strong>{count}</strong> {count === 1 ? "session" : "sessions"}</span>
      {open && <section className="public-filter-panel" aria-label="Session filters">
        <label><span>Track</span><select value={trackId} onChange={(event) => setTrackId(event.target.value)}><option value="all">All tracks</option>{workspace.tracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}</select></label>
        <label><span>Format</span><select value={sessionFormat} onChange={(event) => setSessionFormat(event.target.value)}><option value="all">All formats</option><option value="keynote">Keynote</option><option value="talk">Talk</option><option value="workshop">Workshop</option><option value="panel">Panel</option><option value="lightning">Lightning talk</option><option value="break">Break</option><option value="networking">Networking</option></select></label>
        <label><span>Location</span><select value={roomId} onChange={(event) => setRoomId(event.target.value)}><option value="all">All rooms</option>{workspace.rooms.map((room) => <option value={room.id} key={room.id}>{room.name}</option>)}</select></label>
        <button type="button" className="text-button" disabled={!activeCount} onClick={() => { setTrackId("all"); setSessionFormat("all"); setRoomId("all"); }}>Clear filters</button>
      </section>}
    </div>
  );
}

function useCatalog(kind: PublicWidgetKind) {
  const { workspace, publicSpeakers } = useWorkspace();
  const location = useLocation();
  const config = useMemo(() => publicWidgetConfigFromSearch(location.search, kind), [kind, location.search]);
  const views = useMemo(() => publicSessionViews(workspace.sessions, workspace.tracks, workspace.rooms, publicSpeakers), [publicSpeakers, workspace.rooms, workspace.sessions, workspace.tracks]);
  return { workspace, publicSpeakers, config, views };
}

function fieldVisible(fields: PublicWidgetField[], field: PublicWidgetField) {
  return fields.includes(field);
}

export function PublicSessionsList({ embedded = false }: { embedded?: boolean }) {
  const { workspace, config, views } = useCatalog("sessions");
  const [query, setQuery] = useState("");
  const [trackId, setTrackId] = useState(config.trackId);
  const [sessionFormat, setSessionFormat] = useState(config.sessionFormat);
  const [roomId, setRoomId] = useState(config.roomId);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<PublicSessionView | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const filtered = filterPublicSessions(views, { query, trackId, sessionFormat, roomId });
  const toggleExpanded = (id: string) => setExpanded((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return (
    <WidgetPage kind="sessions" embedded={embedded}>
      <section className="public-widget-surface public-session-catalog" aria-labelledby="session-catalog-title">
        <header className="public-widget-title"><div><p className="eyebrow">Browse the program</p><h2 id="session-catalog-title">Sessions list</h2></div><span>Updated from the organizer’s published program</span></header>
        <SessionFilters {...{ query, setQuery, trackId, setTrackId, sessionFormat, setSessionFormat, roomId, setRoomId }} count={filtered.length} />
        <div className="public-session-list">
          {filtered.map((view) => {
            const isExpanded = expanded.has(view.session.id);
            return <article className="public-session-card" key={view.session.id}>
              <div className="public-session-card__rail" style={{ background: view.track?.color ?? workspace.event.accent }} />
              <div className="public-session-card__body">
                <div className="public-session-card__tags">{fieldVisible(config.fields, "format") && <span>{view.formatLabel}</span>}{fieldVisible(config.fields, "track") && <span>{view.track?.name ?? "Program"}</span>}</div>
                <h3>{view.session.title}</h3>
                {fieldVisible(config.fields, "description") && <div className="public-session-card__description"><p className={isExpanded ? "" : "clamped"}>{view.session.description || "Full description coming soon."}</p><button type="button" className="text-button" onClick={() => toggleExpanded(view.session.id)} aria-expanded={isExpanded}>{isExpanded ? "Show less" : "Show more"} <ChevronDown size={13} /></button></div>}
                <div className="public-session-card__facts">{fieldVisible(config.fields, "time") && <span><Clock3 size={14} /> {formatEventDay(view.session.startsAt!, workspace.event.timezone)} · {formatEventTime(view.session.startsAt, workspace.event.timezone)}–{formatEventTime(view.session.endsAt, workspace.event.timezone)}</span>}{fieldVisible(config.fields, "room") && <span><MapPin size={14} /> {view.room?.name ?? "Room TBA"}</span>}</div>
                {fieldVisible(config.fields, "speakers") && <div className="public-session-card__speakers">{view.speakers.map((speaker) => <SpeakerIdentity speaker={speaker} compact key={speaker.id} />)}{!view.speakers.length && <span className="muted">Speaker announcement coming soon</span>}</div>}
              </div>
              <button type="button" className="button button--quiet public-session-card__detail" onClick={(event) => { returnFocusRef.current = event.currentTarget; setSelected(view); }}>View details</button>
            </article>;
          })}
          {!filtered.length && <EmptyState title="No sessions match" detail="Clear a filter or try a broader title or speaker search." />}
        </div>
      </section>
      {selected && <SessionDetail view={selected} onClose={() => setSelected(null)} returnFocusRef={returnFocusRef} />}
    </WidgetPage>
  );
}

export function PublicSpeakersList({ embedded = false }: { embedded?: boolean }) {
  const { publicSpeakers, views, config } = useCatalog("speakers");
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<PublicSpeaker | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const filteredViews = filterPublicSessions(views, { trackId: config.trackId, sessionFormat: config.sessionFormat, roomId: config.roomId });
  const contentFilterActive = [config.trackId, config.sessionFormat, config.roomId].some((value) => value !== "all");
  const visibleSpeakerIds = new Set(filteredViews.flatMap((view) => view.session.speakerIds));
  const speakers = sortPublicSpeakers(publicSpeakers)
    .filter((speaker) => !contentFilterActive || visibleSpeakerIds.has(speaker.id))
    .filter((speaker) => speaker.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <WidgetPage kind="speakers" embedded={embedded}>
      <section className="public-widget-surface public-speaker-directory" aria-labelledby="speaker-directory-title">
        <header className="public-widget-title"><div><p className="eyebrow">A–Z by surname</p><h2 id="speaker-directory-title">Speakers list</h2></div><span><Users size={15} /> {speakers.length} confirmed speakers</span></header>
        <label className="search-control public-search"><Search size={17} /><input aria-label="Search speakers by name" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by speaker name…" /></label>
        <div className="public-speaker-list">{speakers.map((speaker) => {
          const sessions = filteredViews.filter((view) => view.session.speakerIds.includes(speaker.id));
          return <button type="button" className="public-speaker-row" key={speaker.id} onClick={(event) => { returnFocusRef.current = event.currentTarget; setSelected(speaker); }}><span className="public-speaker-row__portrait">{speaker.headshotUrl && !failed.has(speaker.id) ? <img src={speaker.headshotUrl} alt={`Portrait of ${speaker.name}`} loading="lazy" onError={() => setFailed((current) => new Set(current).add(speaker.id))} /> : <Avatar name={speaker.name} size="lg" />}</span><span className="public-speaker-row__identity"><strong>{speaker.name}</strong><small>{speaker.title || "Speaker"} · {speaker.company || "Independent"}</small><span>{speaker.bio || "Biography coming soon."}</span></span><span className="public-speaker-row__sessions"><strong>{sessions.length}</strong><small>{sessions.length === 1 ? "session" : "sessions"}</small></span><span className="public-speaker-row__open">Open profile <ExternalLink size={14} /></span></button>;
        })}{!speakers.length && <EmptyState title="No speaker matches" detail="Try another first or last name." />}</div>
      </section>
      {selected && <SpeakerDetail speaker={selected} views={filteredViews} onClose={() => setSelected(null)} returnFocusRef={returnFocusRef} />}
    </WidgetPage>
  );
}

export function PublicAgendaGrid({ embedded = false }: { embedded?: boolean }) {
  const { workspace, config, views } = useCatalog("agenda");
  const days = eventDayOptions(workspace.event, views.map((view) => view.session));
  const [selectedDay, setSelectedDay] = useState(() => days[0]?.key ?? eventDateKey(workspace.event.startsAt, workspace.event.timezone));
  const [selected, setSelected] = useState<PublicSessionView | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const dayViews = filterPublicSessions(views.filter((view) => eventDateKey(view.session.startsAt!, workspace.event.timezone) === selectedDay), { trackId: config.trackId, sessionFormat: config.sessionFormat, roomId: config.roomId });
  const rooms = workspace.rooms.filter((room) => dayViews.some((view) => view.session.roomId === room.id));
  const times = [...new Set(dayViews.map((view) => view.session.startsAt!))].sort((a, b) => new Date(a).getTime() - new Date(b).getTime());
  return (
    <WidgetPage kind="agenda" embedded={embedded}>
      <section className="public-widget-surface public-agenda-grid-section" aria-labelledby="agenda-grid-title">
        <header className="public-widget-title"><div><p className="eyebrow">Room × time</p><h2 id="agenda-grid-title">Agenda</h2></div><span>Times shown in {timeZoneAbbreviation(workspace.event.startsAt, workspace.event.timezone)}</span></header>
        <DayTabs activeDay={selectedDay} onChange={setSelectedDay} sessionViews={views} />
        {dayViews.length > 0 ? <div className="public-agenda-grid-scroll"><div className="public-agenda-grid" style={{ "--agenda-room-count": Math.max(rooms.length, 1) } as CSSProperties}>
          <div className="public-agenda-grid__corner"><Clock3 size={15} /> Time</div>{rooms.map((room) => <div className="public-agenda-grid__room" key={room.id}><MapPin size={14} /> {room.name}</div>)}
          {times.map((time) => <div className="public-agenda-grid__row" key={time}>
            <time>{formatEventTime(time, workspace.event.timezone)}</time>
            {rooms.map((room) => <div className="public-agenda-grid__cell" key={room.id}>{dayViews.filter((view) => view.session.startsAt === time && view.session.roomId === room.id).map((view) => <button type="button" className="public-agenda-block" key={view.session.id} style={{ borderTopColor: view.track?.color ?? workspace.event.accent }} onClick={(event) => { returnFocusRef.current = event.currentTarget; setSelected(view); }}><span>{view.formatLabel} · {view.track?.name ?? "Program"}</span><strong>{view.session.title}</strong><small>{formatEventTime(view.session.startsAt, workspace.event.timezone)}–{formatEventTime(view.session.endsAt, workspace.event.timezone)}</small></button>)}</div>)}
          </div>)}
        </div></div> : <EmptyState title="No sessions on this day" detail="Choose another event day or check back when the program is updated." />}
      </section>
      {selected && <SessionDetail view={selected} onClose={() => setSelected(null)} returnFocusRef={returnFocusRef} />}
    </WidgetPage>
  );
}

export function PublicItinerary({ embedded = false }: { embedded?: boolean }) {
  const { workspace, config, views } = useCatalog("itinerary");
  const days = eventDayOptions(workspace.event, views.map((view) => view.session));
  const [selectedDay, setSelectedDay] = useState(() => days[0]?.key ?? eventDateKey(workspace.event.startsAt, workspace.event.timezone));
  const [query, setQuery] = useState("");
  const [trackId, setTrackId] = useState(config.trackId);
  const [personalOnly, setPersonalOnly] = useState(false);
  const [favorites, setFavorites] = useState(() => loadAgendaFavorites(workspace.event.slug));
  const [exported, setExported] = useState(false);
  const toggleFavorite = (id: string) => setFavorites((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); saveAgendaFavorites(workspace.event.slug, next); return next; });
  const filtered = filterPublicSessions(views, { query, trackId, sessionFormat: config.sessionFormat, roomId: config.roomId })
    .filter((view) => eventDateKey(view.session.startsAt!, workspace.event.timezone) === selectedDay)
    .filter((view) => !personalOnly || favorites.has(view.session.id));
  const favoriteViews = views.filter((view) => favorites.has(view.session.id));
  const exportCalendar = () => {
    const blob = new Blob([personalScheduleIcs(workspace.event.name, favoriteViews)], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${workspace.event.slug}-my-schedule.ics`;
    anchor.click();
    URL.revokeObjectURL(url);
    setExported(true);
  };
  return (
    <WidgetPage kind="itinerary" embedded={embedded}>
      <section className="public-widget-surface public-itinerary" aria-labelledby="itinerary-title">
        <header className="public-widget-title"><div><p className="eyebrow">Chronological planner</p><h2 id="itinerary-title">Schedule itinerary</h2></div><span><Heart size={15} fill={favorites.size ? "currentColor" : "none"} /> {favorites.size} saved</span></header>
        <div className="public-itinerary__controls"><label className="search-control public-search"><Search size={17} /><input aria-label="Search itinerary" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search sessions or speakers…" /></label><label className="select-control"><span className="sr-only">Filter itinerary by track</span><select value={trackId} onChange={(event) => setTrackId(event.target.value)}><option value="all">All tracks</option>{workspace.tracks.map((track) => <option value={track.id} key={track.id}>{track.name}</option>)}</select></label><div className="segmented-control" aria-label="Itinerary view"><button type="button" className={!personalOnly ? "active" : ""} aria-pressed={!personalOnly} onClick={() => setPersonalOnly(false)}>All sessions</button><button type="button" className={personalOnly ? "active" : ""} aria-pressed={personalOnly} onClick={() => setPersonalOnly(true)}>My schedule ({favorites.size})</button></div><button type="button" className="button button--quiet" disabled={!favorites.size} onClick={exportCalendar}><CalendarPlus size={16} /> Export .ics</button></div>
        {exported && <p className="public-export-success" role="status"><Check size={15} /> Calendar file downloaded with {favoriteViews.length} {favoriteViews.length === 1 ? "session" : "sessions"}.</p>}
        <DayTabs activeDay={selectedDay} onChange={setSelectedDay} sessionViews={views} />
        <div className="public-itinerary-list">{filtered.map((view) => <article className={`public-itinerary-card${favorites.has(view.session.id) ? " selected" : ""}`} key={view.session.id}>
          <time><strong>{formatEventTime(view.session.startsAt, workspace.event.timezone)}</strong><span>{formatEventTime(view.session.endsAt, workspace.event.timezone)}</span></time>
          <div><div className="public-session-card__tags"><span>{view.formatLabel}</span><span>{view.track?.name ?? "Program"}</span></div><h3>{view.session.title}</h3><p>{view.session.description || "Full description coming soon."}</p><div className="public-session-card__facts"><span><Clock3 size={14} /> {formatEventDay(view.session.startsAt!, workspace.event.timezone)} · {formatEventTime(view.session.startsAt, workspace.event.timezone)}–{formatEventTime(view.session.endsAt, workspace.event.timezone)}</span><span><MapPin size={14} /> {view.room?.name ?? "Room TBA"}</span></div><div className="public-session-card__speakers">{view.speakers.map((speaker) => <SpeakerIdentity speaker={speaker} compact key={speaker.id} />)}</div></div>
          <button type="button" className={favorites.has(view.session.id) ? "favorite-button selected" : "favorite-button"} onClick={() => toggleFavorite(view.session.id)} aria-pressed={favorites.has(view.session.id)} aria-label={`${favorites.has(view.session.id) ? "Remove" : "Add"} ${view.session.title} ${favorites.has(view.session.id) ? "from" : "to"} my schedule`}><Heart size={18} fill={favorites.has(view.session.id) ? "currentColor" : "none"} /></button>
        </article>)}{!filtered.length && <EmptyState title={personalOnly ? "No saved sessions on this day" : "No sessions match"} detail={personalOnly ? "Save a session or choose a day that contains one of your selections." : "Try another search, track, or event day."} />}</div>
      </section>
    </WidgetPage>
  );
}

export function PublicSpeakerGallery({ embedded = false }: { embedded?: boolean }) {
  const { publicSpeakers, views, config } = useCatalog("gallery");
  const [query, setQuery] = useState("");
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<PublicSpeaker | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const filteredViews = filterPublicSessions(views, { trackId: config.trackId, sessionFormat: config.sessionFormat, roomId: config.roomId });
  const contentFilterActive = [config.trackId, config.sessionFormat, config.roomId].some((value) => value !== "all");
  const visibleSpeakerIds = new Set(filteredViews.flatMap((view) => view.session.speakerIds));
  const speakers = sortPublicSpeakers(publicSpeakers)
    .filter((speaker) => !contentFilterActive || visibleSpeakerIds.has(speaker.id))
    .filter((speaker) => speaker.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <WidgetPage kind="gallery" embedded={embedded}>
      <section className="public-widget-surface public-gallery" aria-labelledby="speaker-gallery-title">
        <header className="public-widget-title"><div><p className="eyebrow">Visual directory · A–Z by surname</p><h2 id="speaker-gallery-title">Speaker gallery</h2></div><span><UserRound size={15} /> {speakers.length} profiles</span></header>
        <label className="search-control public-search"><Search size={17} /><input aria-label="Search gallery by speaker name" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by speaker name…" /></label>
        <div className="public-gallery-grid">{speakers.map((speaker) => <button type="button" className="public-gallery-card" key={speaker.id} onClick={(event) => { returnFocusRef.current = event.currentTarget; setSelected(speaker); }}><span className="public-gallery-card__image">{speaker.headshotUrl && !failed.has(speaker.id) ? <img src={speaker.headshotUrl} alt={`Portrait of ${speaker.name}`} loading="lazy" decoding="async" onError={() => setFailed((current) => new Set(current).add(speaker.id))} /> : <span className="public-gallery-card__fallback"><Avatar name={speaker.name} size="lg" /><small>Photo coming soon</small></span>}</span><span className="public-gallery-card__copy"><small>{speaker.company || "Independent"}</small><strong>{speaker.name}</strong><span>{speaker.title || "Speaker"}</span><em>View profile <ExternalLink size={13} /></em></span></button>)}{!speakers.length && <EmptyState title="No speaker matches" detail="Try another first or last name." />}</div>
      </section>
      {selected && <SpeakerDetail speaker={selected} views={filteredViews} onClose={() => setSelected(null)} returnFocusRef={returnFocusRef} />}
    </WidgetPage>
  );
}

export function PublicWidgetEmbed() {
  const { widget = "" } = useParams<{ widget: string }>();
  if (!isPublicWidgetKind(widget)) return <div className="public-unavailable" role="alert"><h1>Widget not found</h1><p>Choose sessions, speakers, agenda, itinerary, or gallery.</p></div>;
  if (widget === "sessions") return <PublicSessionsList embedded />;
  if (widget === "speakers") return <PublicSpeakersList embedded />;
  if (widget === "agenda") return <PublicAgendaGrid embedded />;
  if (widget === "itinerary") return <PublicItinerary embedded />;
  return <PublicSpeakerGallery embedded />;
}
