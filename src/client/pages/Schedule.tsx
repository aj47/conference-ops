import {
  AlertTriangle,
  CalendarRange,
  CalendarDays,
  Check,
  Clock3,
  GripVertical,
  LayoutGrid,
  List,
  ListFilter,
  MoveRight,
  Plus,
  Radio,
  Settings2,
  ShieldAlert,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { ProgramSession, Proposal, Room, ScheduleConflict, Track } from "../../shared/domain";
import { buildAutoSchedulePlan, type AutoSchedulePlan } from "../auto-schedule";
import { EmptyState, Field, InlineAlert, PageHeader, SectionHeading, StatusPill } from "../components";
import { useDialogA11y } from "../dialog-a11y";
import {
  addMinutes,
  eventDateKey,
  eventDayOptions,
  formatEventTime,
  scheduleSlotStarts,
  timeZoneAbbreviation,
} from "../event-time";
import { privateEventPath } from "../private-routes";
import {
  chronologicalSessions,
  persistentScheduleConflicts,
  scheduleDayGroups,
  scheduleViewFromValue,
  type PersistentScheduleConflict,
  type ScheduleDayGroup,
  type ScheduleViewId,
} from "../schedule-views";
import { useWorkspace } from "../workspace";
import { VenueSettingsDrawer } from "../VenueSettingsDrawer";

interface PendingMove {
  sessionId: string;
  roomId: string;
  trackId: string;
  startsAt: string;
  endsAt: string;
  conflicts: ScheduleConflict[];
}

const scheduleViews: Array<{ id: ScheduleViewId; label: string; detail: string; icon: typeof List }> = [
  { id: "list", label: "List", detail: "Scan every session", icon: List },
  { id: "board", label: "Day / rooms", detail: "Place and reschedule", icon: LayoutGrid },
  { id: "week", label: "Week", detail: "Read the full run", icon: CalendarRange },
  { id: "conflicts", label: "Conflicts", detail: "Review live overlaps", icon: ShieldAlert },
];

function sessionLocation(session: ProgramSession, rooms: Room[], tracks: Track[]) {
  return {
    room: rooms.find((room) => room.id === session.roomId)?.name ?? "Room not set",
    track: tracks.find((track) => track.id === session.trackId)?.name ?? "Track not set",
  };
}

function sessionDayLabel(session: Pick<ProgramSession, "startsAt">, timezone: string) {
  if (!session.startsAt) return "Unscheduled";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  }).format(new Date(session.startsAt));
}

function durationMinutesForSession(session: ProgramSession | undefined, proposals: Proposal[]) {
  if (!session) return 30;
  if (session.startsAt && session.endsAt) {
    return Math.max(5, Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000));
  }
  return proposals.find((proposal) => proposal.id === session.proposalId)?.durationMinutes ?? 30;
}

function ScheduleViewSwitcher({
  active,
  conflictCount,
  onChange,
}: {
  active: ScheduleViewId;
  conflictCount: number;
  onChange: (view: ScheduleViewId) => void;
}) {
  return (
    <div className="schedule-view-switcher" role="group" aria-label="Schedule view">
      {scheduleViews.map((view) => {
        const Icon = view.icon;
        return (
          <button
            type="button"
            key={view.id}
            className={active === view.id ? "active" : ""}
            aria-pressed={active === view.id}
            onClick={() => onChange(view.id)}
          >
            <Icon size={15} />
            <span><strong>{view.label}{view.id === "conflicts" && conflictCount ? ` · ${conflictCount}` : ""}</strong><small>{view.detail}</small></span>
          </button>
        );
      })}
    </div>
  );
}

function ScheduleListView({
  sessions,
  rooms,
  tracks,
  timezone,
  onOpenBoard,
  onPlace,
}: {
  sessions: ProgramSession[];
  rooms: Room[];
  tracks: Track[];
  timezone: string;
  onOpenBoard: (session: ProgramSession) => void;
  onPlace: (sessionId: string) => void;
}) {
  const ordered = chronologicalSessions(sessions);
  const placedCount = ordered.filter((session) => session.startsAt && session.roomId).length;
  const unplacedCount = ordered.length - placedCount;
  return (
    <section className="schedule-view-panel schedule-list-view" aria-labelledby="schedule-list-title">
      <header className="schedule-view-heading">
        <div><p className="eyebrow">Run-of-show index</p><h2 id="schedule-list-title">Every session, one scan.</h2><p>Unplaced work stays visible beside the sessions already committed to a room and time.</p></div>
        <dl><div><dt>Placed</dt><dd>{placedCount}</dd></div><div><dt>Ready to place</dt><dd>{unplacedCount}</dd></div></dl>
      </header>
      {ordered.length ? (
        <div className="schedule-list" role="list" aria-label="All schedule sessions">
          {ordered.map((session, index) => {
            const location = sessionLocation(session, rooms, tracks);
            const placed = Boolean(session.startsAt && session.endsAt && session.roomId);
            return (
              <article className={`schedule-list-row${placed ? "" : " schedule-list-row--unplaced"}`} role="listitem" key={session.id}>
                <span className="schedule-list-row__number">{String(index + 1).padStart(2, "0")}</span>
                <div className="schedule-list-row__time">
                  <strong>{sessionDayLabel(session, timezone)}</strong>
                  <span>{session.startsAt && session.endsAt ? `${formatEventTime(session.startsAt, timezone)}–${formatEventTime(session.endsAt, timezone)}` : "Needs room + time"}</span>
                </div>
                <div className="schedule-list-row__session"><strong>{session.title}</strong><span>{session.speakerNames.join(" · ") || "Program block"}</span></div>
                <div className="schedule-list-row__stage"><strong>{location.room}</strong><span>{location.track}</span></div>
                <StatusPill status={session.status} />
                <button type="button" className="button button--quiet" onClick={() => placed ? onOpenBoard(session) : onPlace(session.id)}>{placed ? "Open on board" : "Place session"} <MoveRight size={14} /></button>
              </article>
            );
          })}
        </div>
      ) : <EmptyState title="No sessions yet" detail="Accepted proposals and direct program blocks will appear here before they are placed." />}
    </section>
  );
}

function ScheduleWeekView({
  groups,
  unscheduled,
  rooms,
  tracks,
  timezone,
  onOpenBoard,
  onPlace,
}: {
  groups: ScheduleDayGroup[];
  unscheduled: ProgramSession[];
  rooms: Room[];
  tracks: Track[];
  timezone: string;
  onOpenBoard: (session: ProgramSession) => void;
  onPlace: (sessionId: string) => void;
}) {
  return (
    <section className="schedule-view-panel schedule-week-view" aria-labelledby="schedule-week-title">
      <header className="schedule-view-heading">
        <div><p className="eyebrow">Weekly run sheet</p><h2 id="schedule-week-title">The whole program, day by day.</h2><p>Read each event day in time order, then jump into the placement board for a precise change.</p></div>
        <span className="schedule-week-view__timezone">All times · {timezone}</span>
      </header>
      {unscheduled.length > 0 && (
        <aside className="schedule-unplaced-strip" aria-label={`${unscheduled.length} sessions ready to place`}>
          <div><AlertTriangle size={17} /><span><strong>{unscheduled.length} ready to place</strong><small>These sessions are not part of a day until a room and time are selected.</small></span></div>
          <div>{unscheduled.map((session) => <button type="button" key={session.id} onClick={() => onPlace(session.id)}>{session.title} <MoveRight size={13} /></button>)}</div>
        </aside>
      )}
      <div className="schedule-week-grid">
        {groups.map((group, index) => (
          <section className="schedule-day-sheet" key={group.key} aria-labelledby={`schedule-day-${group.key}`}>
            <header><span>DAY {String(index + 1).padStart(2, "0")}</span><div><h3 id={`schedule-day-${group.key}`}>{group.label}</h3><p>{group.sessions.length} placed {group.sessions.length === 1 ? "session" : "sessions"}</p></div></header>
            {group.sessions.length ? <ol>{group.sessions.map((session) => {
              const location = sessionLocation(session, rooms, tracks);
              return (
                <li key={session.id}>
                  <time dateTime={session.startsAt}>{formatEventTime(session.startsAt, timezone)}<small>{formatEventTime(session.endsAt, timezone)}</small></time>
                  <i aria-hidden="true" />
                  <div><strong>{session.title}</strong><span>{location.room} · {location.track}</span><small>{session.speakerNames.join(" · ") || "Program block"}</small></div>
                  <button type="button" aria-label={`Open ${session.title} on the day and room board`} onClick={() => onOpenBoard(session)}><MoveRight size={15} /></button>
                </li>
              );
            })}</ol> : <EmptyState title="No placed sessions" detail="This day is open. Place a session from List or Day / rooms." />}
          </section>
        ))}
      </div>
    </section>
  );
}

function ScheduleConflictsView({
  conflicts,
  rooms,
  tracks,
  timezone,
  onOpenBoard,
}: {
  conflicts: PersistentScheduleConflict[];
  rooms: Room[];
  tracks: Track[];
  timezone: string;
  onOpenBoard: (session?: ProgramSession) => void;
}) {
  const resourceCount = conflicts.reduce((total, conflict) => total + conflict.resources.length, 0);
  return (
    <section className="schedule-view-panel schedule-conflicts-view" aria-labelledby="schedule-conflicts-title">
      <header className="schedule-view-heading schedule-view-heading--danger">
        <div><p className="eyebrow">Persistent conflict review</p><h2 id="schedule-conflicts-title">Overlaps that still exist in the live grid.</h2><p>This docket is derived from the current schedule, so intentional overrides remain visible after reload until one of the sessions moves.</p></div>
        <dl><div><dt>Session pairs</dt><dd>{conflicts.length}</dd></div><div><dt>Resource collisions</dt><dd>{resourceCount}</dd></div></dl>
      </header>
      {conflicts.length ? <div className="conflict-docket">{conflicts.map((conflict, index) => (
        <article key={conflict.id}>
          <header><span>CONFLICT {String(index + 1).padStart(2, "0")}</span><div>{conflict.resources.map((resource) => <span className="conflict-type" key={`${resource.type}:${resource.id}`}>{resource.type} · {resource.name}</span>)}</div></header>
          <div className="conflict-docket__sessions">{conflict.sessions.map((session) => {
            const location = sessionLocation(session, rooms, tracks);
            return (
              <section key={session.id}>
                <p>{sessionDayLabel(session, timezone)} · {formatEventTime(session.startsAt, timezone)}–{formatEventTime(session.endsAt, timezone)}</p>
                <h3>{session.title}</h3>
                <span>{location.room} · {location.track}</span>
                {session.overrideReason && <small><Check size={12} /> Override recorded: {session.overrideReason}</small>}
                <button type="button" className="button button--quiet" onClick={() => onOpenBoard(session)}>Open exact session <MoveRight size={14} /></button>
              </section>
            );
          })}</div>
        </article>
      ))}</div> : <EmptyState title="No active schedule conflicts" detail="Room, track, and speaker overlaps will appear here whenever they exist in the current grid." action={<button type="button" className="button button--primary" onClick={() => onOpenBoard()}>Open day / rooms</button>} />}
    </section>
  );
}

export function ScheduleBoard() {
  const { workspace, detectConflicts, scheduleSession, addDirectSession, setNotice, privateWorkspaceEventId } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const [searchParams, setSearchParams] = useSearchParams();
  const view = scheduleViewFromValue(searchParams.get("view"));
  const targetSessionId = searchParams.get("session");
  const dayOptions = useMemo(() => eventDayOptions(workspace.event, workspace.sessions), [workspace.event, workspace.sessions]);
  const [selectedDay, setSelectedDay] = useState(() => searchParams.get("day") ?? eventDateKey(workspace.event.startsAt, workspace.event.timezone));
  const activeDay = dayOptions.find((day) => day.key === selectedDay) ?? dayOptions[0];
  const slots = useMemo(
    () => activeDay ? scheduleSlotStarts(workspace.event, activeDay, workspace.sessions) : [],
    [activeDay, workspace.event, workspace.sessions],
  );
  const [trackFilter, setTrackFilter] = useState(() => searchParams.get("track") ?? "all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [placingRoom, setPlacingRoom] = useState(workspace.rooms[0]?.id ?? "");
  const [placingSlot, setPlacingSlot] = useState(slots[0] ?? workspace.event.startsAt);
  const [placingTrack, setPlacingTrack] = useState(workspace.tracks[0]?.id ?? "");
  const [directOpen, setDirectOpen] = useState(false);
  const [venueOpen, setVenueOpen] = useState(false);
  const [directSaving, setDirectSaving] = useState(false);
  const [autoPlan, setAutoPlan] = useState<AutoSchedulePlan | null>(null);
  const [autoApplying, setAutoApplying] = useState(false);
  const [direct, setDirect] = useState({
    title: "",
    description: "",
    speakerId: "",
    kind: "guaranteed" as "guaranteed" | "sponsor" | "program",
    format: "talk" as "keynote" | "talk" | "workshop" | "panel" | "lightning" | "break" | "networking",
  });
  const placementDialogRef = useDialogA11y<HTMLFormElement>(() => setPlacingId(null), Boolean(placingId));
  const conflictDialogRef = useDialogA11y<HTMLDivElement>(() => setPending(null), Boolean(pending));
  const directDialogRef = useDialogA11y<HTMLFormElement>(() => setDirectOpen(false), directOpen);
  const autoDialogRef = useDialogA11y<HTMLElement>(() => {
    if (!autoApplying) setAutoPlan(null);
  }, Boolean(autoPlan));

  const unscheduled = workspace.sessions.filter((session) => session.status === "unscheduled");
  const visibleSessions = workspace.sessions.filter((session) => trackFilter === "all" || session.trackId === trackFilter);
  const scheduled = visibleSessions.filter((session) => session.startsAt && session.roomId && eventDateKey(session.startsAt, workspace.event.timezone) === activeDay?.key);
  const conflictDocket = useMemo(
    () => persistentScheduleConflicts(workspace.sessions, workspace.rooms, workspace.tracks),
    [workspace.rooms, workspace.sessions, workspace.tracks],
  );
  const weekGroups = useMemo(
    () => scheduleDayGroups(workspace.event, visibleSessions),
    [visibleSessions, workspace.event],
  );
  const conflictCount = conflictDocket.length;
  const speakers = [...new Map(workspace.proposals.flatMap((proposal) => proposal.speakers).map((speaker) => [speaker.id, speaker])).values()];
  const directSpeakerOptional = direct.format === "break" || direct.format === "networking";
  const autoScheduleSlots = useMemo(() => dayOptions.flatMap((day) => {
    const starts = scheduleSlotStarts(workspace.event, day, workspace.sessions);
    if (!starts.length) return [];
    const dayEndsAt = addMinutes(starts.at(-1)!, 30);
    return starts.map((startsAt) => ({ startsAt, dayEndsAt }));
  }), [dayOptions, workspace.event, workspace.sessions]);

  const updateScheduleQuery = (updates: Partial<Record<"view" | "day" | "track" | "session", string | null>>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };

  const changeView = (nextView: ScheduleViewId) => {
    updateScheduleQuery({ view: nextView, session: null });
  };

  const changeDay = (day: string) => {
    setSelectedDay(day);
    updateScheduleQuery({ day, session: null });
  };

  const changeTrack = (track: string) => {
    setTrackFilter(track);
    updateScheduleQuery({ track: track === "all" ? null : track, session: null });
  };

  useEffect(() => {
    const requestedDay = searchParams.get("day");
    if (requestedDay && dayOptions.some((day) => day.key === requestedDay) && requestedDay !== selectedDay) {
      setSelectedDay(requestedDay);
      return;
    }
    if (!dayOptions.some((day) => day.key === selectedDay) && dayOptions[0]) setSelectedDay(dayOptions[0].key);
  }, [dayOptions, searchParams, selectedDay]);

  useEffect(() => {
    const requestedTrack = searchParams.get("track") ?? "all";
    const validTrack = requestedTrack === "all" || workspace.tracks.some((track) => track.id === requestedTrack);
    const nextTrack = validTrack ? requestedTrack : "all";
    if (nextTrack !== trackFilter) setTrackFilter(nextTrack);
  }, [searchParams, trackFilter, workspace.tracks]);

  useEffect(() => {
    const sessionId = searchParams.get("session");
    if (view !== "board" || !sessionId) return;
    const timeout = window.setTimeout(() => {
      const target = document.getElementById(`schedule-session-${sessionId}`);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "center", inline: "center" });
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [searchParams, view, workspace.sessions]);

  const durationFor = (sessionId: string) => {
    const session = workspace.sessions.find((item) => item.id === sessionId);
    return durationMinutesForSession(session, workspace.proposals);
  };

  const previewAutoSchedule = () => {
    if (!unscheduled.length) {
      setNotice("Every session is already placed. Move an existing card when the run of show changes.");
      return;
    }
    if (!workspace.rooms.length || !workspace.tracks.length) {
      setNotice("Add at least one room and one track before using assisted placement.");
      setVenueOpen(true);
      return;
    }
    const durationMinutes = Object.fromEntries(unscheduled.map((session) => [session.id, durationMinutesForSession(session, workspace.proposals)]));
    const preferredTrackIds = Object.fromEntries(unscheduled.map((session) => {
      const proposal = workspace.proposals.find((item) => item.id === session.proposalId);
      const categories = proposal?.category.split(",").map((value) => value.trim().toLowerCase()) ?? [];
      const matched = workspace.tracks.find((track) => categories.includes(track.name.trim().toLowerCase()));
      return [session.id, session.trackId ?? matched?.id];
    }));
    setAutoPlan(buildAutoSchedulePlan({
      sessions: workspace.sessions,
      rooms: workspace.rooms,
      tracks: workspace.tracks,
      slots: autoScheduleSlots,
      durationMinutes,
      preferredTrackIds,
    }));
  };

  const applyAutoSchedule = async () => {
    if (!autoPlan?.placements.length || autoApplying) return;
    setAutoApplying(true);
    let applied = 0;
    try {
      for (const placement of autoPlan.placements) {
        await scheduleSession(placement.sessionId, {
          roomId: placement.roomId,
          trackId: placement.trackId,
          startsAt: placement.startsAt,
          endsAt: placement.endsAt,
        });
        applied += 1;
      }
      setAutoPlan(null);
      changeView("board");
      setNotice(`Assisted placement scheduled ${applied} conflict-free ${applied === 1 ? "session" : "sessions"}.${autoPlan.unplaced.length ? ` ${autoPlan.unplaced.length} still need a manual decision.` : ""}`);
    } catch {
      setNotice(`${applied} placements were saved before the schedule changed. Refresh the preview and apply the remaining sessions.`);
    } finally {
      setAutoApplying(false);
    }
  };

  const openPlacement = (sessionId: string) => {
    if (!workspace.rooms.length || !workspace.tracks.length) {
      setNotice("Add at least one room and one track before placing sessions.");
      setVenueOpen(true);
      return;
    }
    const session = workspace.sessions.find((item) => item.id === sessionId);
    const proposal = workspace.proposals.find((item) => item.id === session?.proposalId);
    const matchingTrack = workspace.tracks.find((track) => proposal?.category.toLowerCase().includes(track.name.toLowerCase()));
    setPlacingRoom(session?.roomId ?? workspace.rooms[0]?.id ?? "");
    setPlacingSlot(session?.startsAt ?? slots[0] ?? workspace.event.startsAt);
    setPlacingTrack(session?.trackId ?? matchingTrack?.id ?? workspace.tracks[0]?.id ?? "");
    setPlacingId(sessionId);
  };

  const openOnBoard = (session?: ProgramSession) => {
    const day = session?.startsAt ? eventDateKey(session.startsAt, workspace.event.timezone) : activeDay?.key;
    if (day) setSelectedDay(day);
    setTrackFilter("all");
    updateScheduleQuery({
      view: "board",
      day: day ?? null,
      track: null,
      session: session?.id ?? null,
    });
  };

  const openPlacementFromView = (sessionId: string) => {
    setTrackFilter("all");
    updateScheduleQuery({ view: "board", track: null, session: null });
    openPlacement(sessionId);
  };

  const prepareMove = (sessionId: string, roomId: string, startsAt: string, trackId?: string) => {
    const resolvedTrackId = trackId || workspace.sessions.find((session) => session.id === sessionId)?.trackId || workspace.tracks[0]?.id;
    if (!roomId || !resolvedTrackId) {
      setNotice("Add at least one room and one track before placing sessions.");
      setVenueOpen(true);
      setDraggingId(null);
      return;
    }
    const payload = {
      roomId,
      trackId: resolvedTrackId,
      startsAt,
      endsAt: addMinutes(startsAt, durationFor(sessionId)),
    };
    if (new Date(payload.startsAt) < new Date(workspace.event.startsAt) || new Date(payload.endsAt) > new Date(workspace.event.endsAt)) {
      setNotice("That session would extend outside the event schedule. Choose an earlier start time.");
      setDraggingId(null);
      return;
    }
    const conflicts = detectConflicts(sessionId, payload);
    if (conflicts.length) {
      setPending({ sessionId, ...payload, conflicts });
      setOverrideReason("");
    } else {
      void scheduleSession(sessionId, payload);
    }
    setDraggingId(null);
    setPlacingId(null);
  };

  const occupiedMap = useMemo(() => {
    const map = new Map<string, typeof scheduled>();
    scheduled.forEach((session) => {
      const key = `${session.roomId}:${new Date(session.startsAt!).toISOString()}`;
      map.set(key, [...(map.get(key) ?? []), session]);
    });
    return map;
  }, [scheduled]);

  return (
    <>
      <PageHeader
        eyebrow={`Stage call sheet · ${activeDay?.label ?? "Event day"}`}
        title="Every room, track, and speaker gets one place."
        description="Scan the run of show in List or Week, place sessions by room, and keep every active overlap visible in the conflict docket."
        actions={<><button type="button" className="button button--quiet" onClick={previewAutoSchedule}><Sparkles size={16} /> Auto-place safe sessions</button><button type="button" className="button button--quiet" onClick={() => setVenueOpen(true)}><Settings2 size={16} /> Rooms & tracks</button><button type="button" className="button button--quiet" onClick={() => setDirectOpen(true)}><Plus size={16} /> Add direct session</button>{view === "board" && <label className="select-control"><CalendarDays size={16} /><span className="sr-only">Schedule day</span><select value={activeDay?.key ?? ""} onChange={(event) => changeDay(event.target.value)}>{dayOptions.map((day, index) => <option key={day.key} value={day.key}>Day {index + 1} · {day.label}</option>)}</select></label>}<Link to={privateEventPath("/publish", eventId)} className="button button--primary"><Radio size={16} /> Review & publish</Link></>}
      />

      <ScheduleViewSwitcher active={view} conflictCount={conflictCount} onChange={changeView} />
      <div className="schedule-toolbar">
        {view !== "conflicts" && <label className="select-control"><ListFilter size={15} /><span className="sr-only">Filter schedule by track</span><select value={trackFilter} onChange={(event) => changeTrack(event.target.value)}><option value="all">All tracks</option>{workspace.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>}
        <div className="schedule-legend">{workspace.tracks.length ? workspace.tracks.map((track) => <span key={track.id}><i style={{ background: track.color }} />{track.name}</span>) : <span>No tracks configured</span>}</div>
        <button type="button" className={`conflict-counter${conflictCount ? " conflict-counter--active" : ""}`} onClick={() => changeView("conflicts")} aria-label={`Open conflicts view, ${conflictCount} active session ${conflictCount === 1 ? "pair" : "pairs"}`}><ShieldAlert size={15} /> {conflictCount} active {conflictCount === 1 ? "conflict" : "conflicts"}</button>
      </div>

      {view === "list" && <ScheduleListView sessions={visibleSessions} rooms={workspace.rooms} tracks={workspace.tracks} timezone={workspace.event.timezone} onOpenBoard={openOnBoard} onPlace={openPlacementFromView} />}
      {view === "week" && <ScheduleWeekView groups={weekGroups} unscheduled={trackFilter === "all" ? unscheduled : []} rooms={workspace.rooms} tracks={workspace.tracks} timezone={workspace.event.timezone} onOpenBoard={openOnBoard} onPlace={openPlacementFromView} />}
      {view === "conflicts" && <ScheduleConflictsView conflicts={conflictDocket} rooms={workspace.rooms} tracks={workspace.tracks} timezone={workspace.event.timezone} onOpenBoard={openOnBoard} />}

      {view === "board" && <div className="schedule-layout">
        <aside className="unscheduled-drawer">
          <SectionHeading title="Ready to place" description={`${unscheduled.length} sessions outside the grid`} />
          {unscheduled.length ? unscheduled.map((session) => {
            const proposal = workspace.proposals.find((item) => item.id === session.proposalId);
            return (
              <article
                key={session.id}
                id={`schedule-session-${session.id}`}
                className={`unscheduled-card${targetSessionId === session.id ? " unscheduled-card--targeted" : ""}`}
                tabIndex={targetSessionId === session.id ? -1 : undefined}
                draggable
                onDragStart={() => setDraggingId(session.id)}
                onDragEnd={() => setDraggingId(null)}
              >
                <div className="unscheduled-card__grip"><GripVertical size={15} /><span>{proposal?.durationMinutes ?? 30}m</span></div>
                <h3>{session.title}</h3>
                <p>{session.speakerNames.join(", ")}</p>
                <button type="button" className="text-link" onClick={() => openPlacement(session.id)}>Place with controls <MoveRight size={14} /></button>
              </article>
            );
          }) : <EmptyState title="Everything is placed" detail="Use Reschedule to move a live session immediately, or review scheduled additions before publication." />}
          <div className="drop-note"><GripVertical size={16} /><p><strong>Drag is optional.</strong> Every move is available through the Place controls for keyboard and touch users.</p></div>
        </aside>

        <section className="schedule-grid-wrap" tabIndex={0} aria-labelledby="schedule-grid-title" aria-describedby="schedule-grid-instructions">
          <h2 className="sr-only" id="schedule-grid-title">Schedule timetable for {activeDay?.label ?? "the selected event day"}</h2>
          <p className="sr-only" id="schedule-grid-instructions">Scroll horizontally to review every room. Use each session card's Reschedule button to move it without dragging.</p>
          {workspace.rooms.length && workspace.tracks.length ? <div className="schedule-grid" style={{ gridTemplateColumns: `72px repeat(${workspace.rooms.length}, minmax(190px, 1fr))` }}>
            <div className="schedule-grid__corner"><Clock3 size={15} /></div>
            {workspace.rooms.map((room) => <div className="schedule-grid__room" key={room.id}><strong>{room.name}</strong><span>{room.capacity} seats</span></div>)}
            {slots.flatMap((slot) => [
              <div className="schedule-grid__time" key={`time-${slot}`}><strong>{formatEventTime(slot, workspace.event.timezone)}</strong><span>{timeZoneAbbreviation(slot, workspace.event.timezone)}</span></div>,
              ...workspace.rooms.map((room) => {
                const entries = occupiedMap.get(`${room.id}:${slot}`) ?? [];
                return (
                  <div
                    key={`${room.id}-${slot}`}
                    className={`schedule-slot${draggingId ? " schedule-slot--ready" : ""}`}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => { event.preventDefault(); if (draggingId) prepareMove(draggingId, room.id, slot); }}
                  >
                    {entries.map((session) => {
                      const track = workspace.tracks.find((item) => item.id === session.trackId);
                      return (
                        <article
                          id={`schedule-session-${session.id}`}
                          draggable
                          onDragStart={() => setDraggingId(session.id)}
                          onDragEnd={() => setDraggingId(null)}
                          className={`schedule-card${targetSessionId === session.id ? " schedule-card--targeted" : ""}`}
                          tabIndex={targetSessionId === session.id ? -1 : undefined}
                          style={{ "--track-color": track?.color ?? "#171713" } as React.CSSProperties}
                          key={session.id}
                        >
                          <span className="schedule-card__time">{formatEventTime(session.startsAt, workspace.event.timezone)}—{formatEventTime(session.endsAt, workspace.event.timezone)}</span>
                          <h3>{session.title}</h3>
                          <p><UserRound size={13} /> {session.speakerNames.join(", ")}</p>
                          <div><span>{track?.name ?? "No track"}</span><StatusPill status={session.status} /></div>
                          <button type="button" draggable={false} className="schedule-card__move" aria-label={`Reschedule ${session.title}`} onClick={() => openPlacement(session.id)}><MoveRight size={13} /> Reschedule</button>
                        </article>
                      );
                    })}
                    {!entries.length && <span className="schedule-slot__empty">Drop here</span>}
                  </div>
                );
              }),
            ])}
          </div> : <EmptyState title="Set the stage before placing sessions" detail="Add at least one room and one program track. They become the columns and color lanes used throughout this schedule." action={<button type="button" className="button button--primary" onClick={() => setVenueOpen(true)}><Settings2 size={16} /> Configure rooms & tracks</button>} />}
        </section>
      </div>}

      {autoPlan && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => { if (!autoApplying) setAutoPlan(null); }}>
          <aside ref={autoDialogRef} className="drawer drawer--wide auto-schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="auto-schedule-title" aria-busy={autoApplying} tabIndex={-1} onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawer__head"><div><p className="eyebrow">Deterministic schedule assist</p><h2 id="auto-schedule-title">Preview safe placements</h2></div><button type="button" className="icon-button" disabled={autoApplying} onClick={() => setAutoPlan(null)} aria-label="Close assisted placement preview"><X size={18} /></button></div>
            <div className="drawer__body auto-schedule-dialog__body">
              <InlineAlert tone="info"><Sparkles size={16} /><span><strong>No black box and no silent overrides.</strong> Longer sessions are placed first. Every suggestion is checked against room, track, and speaker conflicts before anything is saved.</span></InlineAlert>
              <dl className="auto-schedule-summary"><div><dt>Safe to place</dt><dd>{autoPlan.placements.length}</dd></div><div><dt>Needs judgment</dt><dd>{autoPlan.unplaced.length}</dd></div></dl>
              {autoPlan.placements.length ? <ol className="auto-schedule-plan" aria-label="Proposed session placements">{autoPlan.placements.map((placement) => {
                const session = workspace.sessions.find((item) => item.id === placement.sessionId);
                const room = workspace.rooms.find((item) => item.id === placement.roomId);
                const track = workspace.tracks.find((item) => item.id === placement.trackId);
                return <li key={placement.sessionId}><span><strong>{session?.title ?? "Session"}</strong><small>{sessionDayLabel({ startsAt: placement.startsAt }, workspace.event.timezone)} · {formatEventTime(placement.startsAt, workspace.event.timezone)}–{formatEventTime(placement.endsAt, workspace.event.timezone)}</small></span><span><strong>{room?.name ?? "Room"}</strong><small>{track?.name ?? "Track"}</small></span></li>;
              })}</ol> : <EmptyState title="No complete conflict-free plan" detail="Add schedule capacity or place the remaining sessions manually. The assistant never creates an override." />}
              {autoPlan.unplaced.length > 0 && <InlineAlert tone="warning"><AlertTriangle size={16} /><span><strong>{autoPlan.unplaced.length} {autoPlan.unplaced.length === 1 ? "session still needs" : "sessions still need"} organizer judgment.</strong> Keep them in Ready to place, add another room or track, or adjust the run window.</span></InlineAlert>}
            </div>
            <div className="drawer__foot"><button type="button" className="button button--quiet" disabled={autoApplying} onClick={() => setAutoPlan(null)}>{autoPlan.placements.length ? "Cancel" : "Close"}</button>{autoPlan.placements.length > 0 && <button type="button" data-dialog-initial-focus className="button button--primary" disabled={autoApplying} onClick={() => void applyAutoSchedule()}><Sparkles size={15} /> {autoApplying ? "Applying safe plan…" : `Apply ${autoPlan.placements.length} ${autoPlan.placements.length === 1 ? "placement" : "placements"}`}</button>}</div>
          </aside>
        </div>
      )}

      {placingId && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPlacingId(null)}>
          <form ref={placementDialogRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="place-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); prepareMove(placingId, placingRoom, placingSlot, placingTrack); }}>
            <div className="drawer__head"><div><p className="eyebrow">Accessible placement</p><h2 id="place-title">Place session</h2></div><button type="button" className="icon-button" onClick={() => setPlacingId(null)} aria-label="Close"><X size={18} /></button></div>
            <div className="drawer__body form-stack">
              <strong>{workspace.sessions.find((session) => session.id === placingId)?.title}</strong>
              <Field label="Room"><select data-dialog-initial-focus value={placingRoom} onChange={(event) => setPlacingRoom(event.target.value)}>{workspace.rooms.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.capacity} seats</option>)}</select></Field>
              <Field label="Start"><select value={placingSlot} onChange={(event) => setPlacingSlot(event.target.value)}>{slots.map((slot) => <option key={slot} value={slot}>{formatEventTime(slot, workspace.event.timezone)} {timeZoneAbbreviation(slot, workspace.event.timezone)}</option>)}</select></Field>
              <Field label="Track"><select value={placingTrack} onChange={(event) => setPlacingTrack(event.target.value)}>{workspace.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></Field>
            </div>
            <div className="drawer__foot"><button type="button" className="button button--quiet" onClick={() => setPlacingId(null)}>Cancel</button><button type="submit" className="button button--primary">Check and place</button></div>
          </form>
        </div>
      )}

      {pending && (
        <div ref={conflictDialogRef} className="conflict-tray" role="dialog" aria-modal="true" aria-labelledby="conflict-title" tabIndex={-1}>
          <div className="conflict-tray__head"><span><AlertTriangle size={19} /><span><strong id="conflict-title">Conflict queue</strong><small>{pending.conflicts.length} resources need judgment</small></span></span><button type="button" className="icon-button" onClick={() => setPending(null)} aria-label="Close conflict queue"><X size={17} /></button></div>
          <div className="conflict-tray__list">
            {pending.conflicts.map((conflict, index) => <article key={`${conflict.type}-${conflict.sessionId}-${index}`}><span className="conflict-type">{conflict.type}</span><div><strong>{conflict.resourceName}</strong><p>Already committed to “{conflict.sessionTitle}” · {formatEventTime(conflict.startsAt, workspace.event.timezone)}–{formatEventTime(conflict.endsAt, workspace.event.timezone)}</p></div></article>)}
          </div>
          <InlineAlert tone="warning">Resolve by choosing another slot, or record why this exception is intentional. Overrides are audit logged.</InlineAlert>
          <Field label="Override reason" hint="Minimum 12 characters"><textarea data-dialog-initial-focus rows={3} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Why the overlap is safe and who approved it…" /></Field>
          <div className="conflict-tray__actions"><button type="button" className="button button--quiet" onClick={() => { setPlacingId(pending.sessionId); setPending(null); }}>Choose another slot</button><button type="button" className="button button--danger" disabled={overrideReason.trim().length < 12} onClick={async () => { await scheduleSession(pending.sessionId, { roomId: pending.roomId, trackId: pending.trackId, startsAt: pending.startsAt, endsAt: pending.endsAt, overrideReason: overrideReason.trim() }); setPending(null); }}><Check size={15} /> Override & place</button></div>
        </div>
      )}

      {directOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDirectOpen(false)}>
          <form ref={directDialogRef} className="drawer drawer--wide" role="dialog" aria-modal="true" aria-labelledby="direct-session-title" tabIndex={-1} onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); if (!directSpeakerOptional && !direct.speakerId) { setNotice("Choose an existing event speaker for this session format."); return; } setDirectSaving(true); try { await addDirectSession({ title: direct.title.trim(), description: direct.description.trim(), speakerIds: direct.speakerId ? [direct.speakerId] : [], kind: direct.kind, format: direct.format }); setDirectOpen(false); setDirect({ title: "", description: "", speakerId: "", kind: "guaranteed", format: "talk" }); } finally { setDirectSaving(false); } }}>
            <div className="drawer__head"><div><p className="eyebrow">Guaranteed · sponsor · program</p><h2 id="direct-session-title">Add direct session</h2></div><button type="button" className="icon-button" onClick={() => setDirectOpen(false)} aria-label="Close"><X size={18} /></button></div>
            <div className="drawer__body form-stack">
              <InlineAlert tone="info">Use this for keynotes, contracted sponsor sessions, breaks, or other program commitments that did not enter through the CFP. It starts unscheduled.</InlineAlert>
              <Field label="Session title"><input data-dialog-initial-focus required minLength={3} value={direct.title} onChange={(event) => setDirect({ ...direct, title: event.target.value })} placeholder="Opening keynote: systems under pressure" /></Field>
              <Field label="Description"><textarea rows={4} value={direct.description} onChange={(event) => setDirect({ ...direct, description: event.target.value })} /></Field>
              <div className="field-grid field-grid--2">
                <Field label="Commitment"><select value={direct.kind} onChange={(event) => setDirect({ ...direct, kind: event.target.value as typeof direct.kind })}><option value="guaranteed">Guaranteed</option><option value="sponsor">Sponsor</option><option value="program">Program-created</option></select></Field>
                <Field label="Format"><select value={direct.format} onChange={(event) => setDirect({ ...direct, format: event.target.value as typeof direct.format })}><option value="keynote">Keynote</option><option value="talk">Talk</option><option value="workshop">Workshop</option><option value="panel">Panel</option><option value="lightning">Lightning</option><option value="break">Break</option><option value="networking">Networking</option></select></Field>
              </div>
              <Field label="Speaker" hint={directSpeakerOptional ? "Optional for breaks and networking" : "Required for this session format"}><select required={!directSpeakerOptional} value={direct.speakerId} onChange={(event) => setDirect({ ...direct, speakerId: event.target.value })}><option value="">{directSpeakerOptional ? "No linked speaker" : "Choose an event speaker"}</option>{speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name} · {speaker.company}</option>)}</select></Field>
            </div>
            <div className="drawer__foot"><button type="button" className="button button--quiet" disabled={directSaving} onClick={() => setDirectOpen(false)}>Cancel</button><button type="submit" className="button button--primary" disabled={directSaving || direct.title.trim().length < 3 || (!directSpeakerOptional && !direct.speakerId)}>{directSaving ? "Adding…" : "Add to ready-to-place"}</button></div>
          </form>
        </div>
      )}

      <VenueSettingsDrawer open={venueOpen} onClose={() => setVenueOpen(false)} />
    </>
  );
}
