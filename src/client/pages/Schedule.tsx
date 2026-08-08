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
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ScheduleConflict } from "../../shared/domain";
import { EmptyState, Field, InlineAlert, PageHeader, SectionHeading, StatusPill } from "../components";
import { useWorkspace } from "../workspace";

const slots = ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30"];

function slotIso(slot: string) {
  return new Date(`2026-08-28T${slot}:00-07:00`).toISOString();
}

function endIso(slot: string, minutes: number) {
  const start = new Date(slotIso(slot));
  return new Date(start.getTime() + minutes * 60_000).toISOString();
}

function localTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Los_Angeles" }).format(new Date(value));
}

function gridSlot(value?: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Los_Angeles" }).format(new Date(value));
}

interface PendingMove {
  sessionId: string;
  roomId: string;
  trackId: string;
  startsAt: string;
  endsAt: string;
  conflicts: ScheduleConflict[];
}

export function ScheduleBoard() {
  const { workspace, detectConflicts, scheduleSession, addDirectSession, publishAgenda } = useWorkspace();
  const [trackFilter, setTrackFilter] = useState("all");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [placingRoom, setPlacingRoom] = useState(workspace.rooms[0]?.id ?? "");
  const [placingSlot, setPlacingSlot] = useState(slots[0]);
  const [placingTrack, setPlacingTrack] = useState(workspace.tracks[0]?.id ?? "");
  const [directOpen, setDirectOpen] = useState(false);
  const [directSaving, setDirectSaving] = useState(false);
  const [direct, setDirect] = useState({
    title: "",
    description: "",
    speakerId: "",
    kind: "guaranteed" as "guaranteed" | "sponsor" | "program",
    format: "talk" as "keynote" | "talk" | "workshop" | "panel" | "lightning" | "break" | "networking",
  });

  const unscheduled = workspace.sessions.filter((session) => session.status === "unscheduled");
  const visibleSessions = workspace.sessions.filter((session) => trackFilter === "all" || session.trackId === trackFilter);
  const scheduled = visibleSessions.filter((session) => session.startsAt && session.roomId);
  const conflictCount = pending?.conflicts.length ?? 0;
  const speakers = [...new Map(workspace.proposals.flatMap((proposal) => proposal.speakers).map((speaker) => [speaker.id, speaker])).values()];

  const durationFor = (sessionId: string) => {
    const session = workspace.sessions.find((item) => item.id === sessionId);
    const proposal = workspace.proposals.find((item) => item.id === session?.proposalId);
    if (session?.startsAt && session.endsAt) return Math.round((new Date(session.endsAt).getTime() - new Date(session.startsAt).getTime()) / 60_000);
    return proposal?.durationMinutes ?? 30;
  };

  const prepareMove = (sessionId: string, roomId: string, slot: string, trackId?: string) => {
    const payload = {
      roomId,
      trackId: trackId || workspace.sessions.find((session) => session.id === sessionId)?.trackId || workspace.tracks[0].id,
      startsAt: slotIso(slot),
      endsAt: endIso(slot, durationFor(sessionId)),
    };
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
      const slot = gridSlot(session.startsAt);
      const key = `${session.roomId}:${slot}`;
      map.set(key, [...(map.get(key) ?? []), session]);
    });
    return map;
  }, [scheduled]);

  return (
    <>
      <PageHeader
        eyebrow="Stage call sheet · Day one"
        title="Every room, track, and speaker gets one place."
        description="Drag sessions onto the grid or place them by keyboard. Conflicts enter a review queue; overrides require a durable reason."
        actions={<><button type="button" className="button button--quiet" onClick={() => setDirectOpen(true)}><Plus size={16} /> Add direct session</button><button type="button" className="button button--quiet"><CalendarDays size={16} /> Aug 28</button><button type="button" className="button button--primary" onClick={() => void publishAgenda()}><Radio size={16} /> Publish revision</button></>}
      />

      <div className="schedule-toolbar">
        <label className="select-control"><ListFilter size={15} /><select value={trackFilter} onChange={(event) => setTrackFilter(event.target.value)}><option value="all">All tracks</option>{workspace.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></label>
        <div className="schedule-legend">{workspace.tracks.map((track) => <span key={track.id}><i style={{ background: track.color }} />{track.name}</span>)}</div>
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
                <button type="button" className="text-link" onClick={() => { setPlacingId(session.id); setPlacingTrack(proposal?.category === "Evaluation & safety" ? "track-evaluate" : "track-build"); }}>Place with controls <MoveRight size={14} /></button>
              </article>
            );
          }) : <EmptyState title="Everything is placed" detail="Drag a scheduled card to move it or publish the current revision." />}
          <div className="drop-note"><GripVertical size={16} /><p><strong>Drag is optional.</strong> Every move is available through the Place controls for keyboard and touch users.</p></div>
        </aside>

        <section className="schedule-grid-wrap" aria-label="Schedule grid">
          <div className="schedule-grid" style={{ gridTemplateColumns: `72px repeat(${workspace.rooms.length}, minmax(190px, 1fr))` }}>
            <div className="schedule-grid__corner"><Clock3 size={15} /></div>
            {workspace.rooms.map((room) => <div className="schedule-grid__room" key={room.id}><strong>{room.name}</strong><span>{room.capacity} seats</span></div>)}
            {slots.flatMap((slot) => [
              <div className="schedule-grid__time" key={`time-${slot}`}><strong>{slot}</strong><span>PT</span></div>,
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
                          <span className="schedule-card__time">{localTime(session.startsAt)}—{localTime(session.endsAt)}</span>
                          <h3>{session.title}</h3>
                          <p><UserRound size={13} /> {session.speakerNames.join(", ")}</p>
                          <div><span>{track?.name ?? "No track"}</span><StatusPill status={session.status} /></div>
                        </article>
                      );
                    })}
                    {!entries.length && <span className="schedule-slot__empty">Drop here</span>}
                  </div>
                );
              }),
            ])}
          </div>
        </section>
      </div>

      {placingId && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPlacingId(null)}>
          <form className="drawer" role="dialog" aria-modal="true" aria-labelledby="place-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => { event.preventDefault(); prepareMove(placingId, placingRoom, placingSlot, placingTrack); }}>
            <div className="drawer__head"><div><p className="eyebrow">Accessible placement</p><h2 id="place-title">Place session</h2></div><button type="button" className="icon-button" onClick={() => setPlacingId(null)} aria-label="Close"><X size={18} /></button></div>
            <div className="drawer__body form-stack">
              <strong>{workspace.sessions.find((session) => session.id === placingId)?.title}</strong>
              <Field label="Room"><select value={placingRoom} onChange={(event) => setPlacingRoom(event.target.value)}>{workspace.rooms.map((room) => <option key={room.id} value={room.id}>{room.name} · {room.capacity} seats</option>)}</select></Field>
              <Field label="Start"><select value={placingSlot} onChange={(event) => setPlacingSlot(event.target.value)}>{slots.map((slot) => <option key={slot} value={slot}>{slot} PT</option>)}</select></Field>
              <Field label="Track"><select value={placingTrack} onChange={(event) => setPlacingTrack(event.target.value)}>{workspace.tracks.map((track) => <option key={track.id} value={track.id}>{track.name}</option>)}</select></Field>
            </div>
            <div className="drawer__foot"><button type="button" className="button button--quiet" onClick={() => setPlacingId(null)}>Cancel</button><button type="submit" className="button button--primary">Check and place</button></div>
          </form>
        </div>
      )}

      {pending && (
        <div className="conflict-tray" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
          <div className="conflict-tray__head"><span><AlertTriangle size={19} /><span><strong id="conflict-title">Conflict queue</strong><small>{pending.conflicts.length} resources need judgment</small></span></span><button type="button" className="icon-button" onClick={() => setPending(null)} aria-label="Close conflict queue"><X size={17} /></button></div>
          <div className="conflict-tray__list">
            {pending.conflicts.map((conflict, index) => <article key={`${conflict.type}-${conflict.sessionId}-${index}`}><span className="conflict-type">{conflict.type}</span><div><strong>{conflict.resourceName}</strong><p>Already committed to “{conflict.sessionTitle}” · {localTime(conflict.startsAt)}–{localTime(conflict.endsAt)}</p></div></article>)}
          </div>
          <InlineAlert tone="warning">Resolve by choosing another slot, or record why this exception is intentional. Overrides are audit logged.</InlineAlert>
          <Field label="Override reason" hint="Minimum 12 characters"><textarea rows={3} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="Why the overlap is safe and who approved it…" /></Field>
          <div className="conflict-tray__actions"><button type="button" className="button button--quiet" onClick={() => { setPlacingId(pending.sessionId); setPending(null); }}>Choose another slot</button><button type="button" className="button button--danger" disabled={overrideReason.trim().length < 12} onClick={async () => { await scheduleSession(pending.sessionId, { roomId: pending.roomId, trackId: pending.trackId, startsAt: pending.startsAt, endsAt: pending.endsAt, overrideReason: overrideReason.trim() }); setPending(null); }}><Check size={15} /> Override & place</button></div>
        </div>
      )}

      {directOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setDirectOpen(false)}>
          <form className="drawer drawer--wide" role="dialog" aria-modal="true" aria-labelledby="direct-session-title" onMouseDown={(event) => event.stopPropagation()} onSubmit={async (event) => { event.preventDefault(); setDirectSaving(true); try { await addDirectSession({ title: direct.title.trim(), description: direct.description.trim(), speakerIds: direct.speakerId ? [direct.speakerId] : [], kind: direct.kind, format: direct.format }); setDirectOpen(false); setDirect({ title: "", description: "", speakerId: "", kind: "guaranteed", format: "talk" }); } finally { setDirectSaving(false); } }}>
            <div className="drawer__head"><div><p className="eyebrow">Guaranteed · sponsor · program</p><h2 id="direct-session-title">Add direct session</h2></div><button type="button" className="icon-button" onClick={() => setDirectOpen(false)} aria-label="Close"><X size={18} /></button></div>
            <div className="drawer__body form-stack">
              <InlineAlert tone="info">Use this for keynotes, contracted sponsor sessions, breaks, or other program commitments that did not enter through the CFP. It starts unscheduled.</InlineAlert>
              <Field label="Session title"><input required minLength={3} value={direct.title} onChange={(event) => setDirect({ ...direct, title: event.target.value })} placeholder="Opening keynote: systems under pressure" /></Field>
              <Field label="Description"><textarea rows={4} value={direct.description} onChange={(event) => setDirect({ ...direct, description: event.target.value })} /></Field>
              <div className="field-grid field-grid--2">
                <Field label="Commitment"><select value={direct.kind} onChange={(event) => setDirect({ ...direct, kind: event.target.value as typeof direct.kind })}><option value="guaranteed">Guaranteed</option><option value="sponsor">Sponsor</option><option value="program">Program-created</option></select></Field>
                <Field label="Format"><select value={direct.format} onChange={(event) => setDirect({ ...direct, format: event.target.value as typeof direct.format })}><option value="keynote">Keynote</option><option value="talk">Talk</option><option value="workshop">Workshop</option><option value="panel">Panel</option><option value="lightning">Lightning</option><option value="break">Break</option><option value="networking">Networking</option></select></Field>
              </div>
              <Field label="Speaker" hint="Optional for breaks and sessions whose participant record is not ready"><select value={direct.speakerId} onChange={(event) => setDirect({ ...direct, speakerId: event.target.value })}><option value="">No linked speaker</option>{speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name} · {speaker.company}</option>)}</select></Field>
            </div>
            <div className="drawer__foot"><button type="button" className="button button--quiet" disabled={directSaving} onClick={() => setDirectOpen(false)}>Cancel</button><button type="submit" className="button button--primary" disabled={directSaving || direct.title.trim().length < 3}>{directSaving ? "Adding…" : "Add to ready-to-place"}</button></div>
          </form>
        </div>
      )}
    </>
  );
}
