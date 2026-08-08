import {
  AlertTriangle,
  CalendarDays,
  Check,
  Clock3,
  GripVertical,
  ListFilter,
  MoveRight,
  Plus,
  Radio,
  Settings2,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { ScheduleConflict } from "../../shared/domain";
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

export function ScheduleBoard() {
  const { workspace, detectConflicts, scheduleSession, addDirectSession, setNotice, privateWorkspaceEventId } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const dayOptions = useMemo(() => eventDayOptions(workspace.event, workspace.sessions), [workspace.event, workspace.sessions]);
  const [selectedDay, setSelectedDay] = useState(() => eventDateKey(workspace.event.startsAt, workspace.event.timezone));
  const activeDay = dayOptions.find((day) => day.key === selectedDay) ?? dayOptions[0];
  const slots = useMemo(
    () => activeDay ? scheduleSlotStarts(workspace.event, activeDay, workspace.sessions) : [],
    [activeDay, workspace.event, workspace.sessions],
  );
  const [trackFilter, setTrackFilter] = useState("all");
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

  const unscheduled = workspace.sessions.filter((session) => session.status === "unscheduled");
  const visibleSessions = workspace.sessions.filter((session) => trackFilter === "all" || session.trackId === trackFilter);
  const scheduled = visibleSessions.filter((session) => session.startsAt && session.roomId && eventDateKey(session.startsAt, workspace.event.timezone) === activeDay?.key);
  const conflictCount = pending?.conflicts.length ?? 0;
  const speakers = [...new Map(workspace.proposals.flatMap((proposal) => proposal.speakers).map((speaker) => [speaker.id, speaker])).values()];
  const directSpeakerOptional = direct.format === "break" || direct.format === "networking";

  useEffect(() => {
    if (trackFilter !== "all" && !workspace.tracks.some((track) => track.id === trackFilter)) setTrackFilter("all");
  }, [trackFilter, workspace.tracks]);

  const durationFor = (sessionId: string) => {
    const session = workspace.sessions.find((item) => item.id === sessionId);
    const proposal = workspace.proposals.find((item) => item.id === session?.proposalId);
    if (session?.startsAt && session.endsAt) return Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000);
    return proposal?.durationMinutes ?? 30;
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
        description="Drag sessions onto the grid or place them by keyboard. Conflicts enter a review queue; overrides require a durable reason."
        actions={<><button type="button" className="button button--quiet" onClick={() => setVenueOpen(true)}><Settings2 size={16} /> Rooms & tracks</button><button type="button" className="button button--quiet" onClick={() => setDirectOpen(true)}><Plus size={16} /> Add direct session</button><label className="select-control"><CalendarDays size={16} /><span className="sr-only">Schedule day</span><select value={activeDay?.key ?? ""} onChange={(event) => setSelectedDay(event.target.value)}>{dayOptions.map((day, index) => <option key={day.key} value={day.key}>Day {index + 1} · {day.label}</option>)}</select></label><Link to={privateEventPath("/publish", eventId)} className="button button--primary"><Radio size={16} /> Review & publish</Link></>}
      />

      <div className="schedule-toolbar">
        <label className="select-control"><ListFilter size={15} /><span className="sr-only">Filter schedule by track</span><select value={trackFilter} onChange={(event) => setTrackFilter(event.target.value)}><option value="all">All tracks</option>{workspace.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
        <div className="schedule-legend">{workspace.tracks.length ? workspace.tracks.map((track) => <span key={track.id}><i style={{ background: track.color }} />{track.name}</span>) : <span>No tracks configured</span>}</div>
        <span className={`conflict-counter${conflictCount ? " conflict-counter--active" : ""}`}><ShieldAlert size={15} /> {conflictCount} conflicts</span>
      </div>

      <div className="schedule-layout">
        <aside className="unscheduled-drawer">
          <SectionHeading title="Ready to place" description={`${unscheduled.length} sessions outside the grid`} />
          {unscheduled.length ? unscheduled.map((session) => {
            const proposal = workspace.proposals.find((item) => item.id === session.proposalId);
            return (
              <article
                key={session.id}
                className="unscheduled-card"
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
                          draggable
                          onDragStart={() => setDraggingId(session.id)}
                          onDragEnd={() => setDraggingId(null)}
                          className="schedule-card"
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
      </div>

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
