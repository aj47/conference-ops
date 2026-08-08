import { MapPin, Pencil, Plus, Tags, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Room, Track } from "../shared/domain";
import { Field, InlineAlert } from "./components";
import { useDialogA11y } from "./dialog-a11y";
import { useWorkspace } from "./workspace";

type DeleteCandidate = { kind: "room" | "track"; id: string; name: string };

const initialRoom = { name: "", capacity: 100 };

export function VenueSettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    workspace,
    createRoom,
    updateRoom,
    deleteRoom,
    createTrack,
    updateTrack,
    deleteTrack,
  } = useWorkspace();
  const [roomDraft, setRoomDraft] = useState(initialRoom);
  const [trackDraft, setTrackDraft] = useState({ name: "", color: workspace.event.accent });
  const [roomEdit, setRoomEdit] = useState<Room | null>(null);
  const [trackEdit, setTrackEdit] = useState<Track | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<DeleteCandidate | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drawerRef = useDialogA11y<HTMLDivElement>(onClose, open);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setDeleteCandidate(null);
  }, [open]);

  if (!open) return null;

  const run = async (key: string, action: () => Promise<void>) => {
    setPendingKey(key);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The venue plan could not be updated.");
    } finally {
      setPendingKey(null);
    }
  };

  const roomUsage = (roomId: string) => workspace.sessions.filter((session) => session.roomId === roomId).length;
  const trackUsage = (trackId: string) => workspace.sessions.filter((session) => session.trackId === trackId).length;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <div
        ref={drawerRef}
        className="drawer drawer--wide venue-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="venue-settings-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer__head">
          <div>
            <p className="eyebrow">Schedule foundations</p>
            <h2 id="venue-settings-title">Rooms & tracks</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close room and track settings"><X size={18} /></button>
        </div>

        <div className="drawer__body venue-drawer__body">
          <p className="venue-drawer__intro">Build the physical room plan and the program lanes used by every schedule placement. Names must be unique within this event.</p>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}

          <section className="venue-resource-section" aria-labelledby="rooms-title">
            <div className="venue-resource-section__head">
              <span className="venue-resource-section__mark"><MapPin size={17} /></span>
              <div><h3 id="rooms-title">Rooms</h3><p>{workspace.rooms.length} configured</p></div>
            </div>
            <div className="venue-resource-list">
              {workspace.rooms.map((room) => {
                const usage = roomUsage(room.id);
                const editing = roomEdit?.id === room.id;
                return (
                  <article className="venue-resource-row" key={room.id}>
                    {editing ? (
                      <form
                        className="venue-resource-edit"
                        aria-label={`Edit ${room.name}`}
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!roomEdit) return;
                          void run(`room:${room.id}`, async () => {
                            await updateRoom(room.id, { name: roomEdit.name, capacity: roomEdit.capacity });
                            setRoomEdit(null);
                          });
                        }}
                      >
                        <Field label="Room name"><input data-dialog-initial-focus required maxLength={120} value={roomEdit.name} onChange={(event) => setRoomEdit({ ...roomEdit, name: event.target.value })} /></Field>
                        <Field label="Capacity"><input required type="number" min={1} max={100000} value={roomEdit.capacity} onChange={(event) => setRoomEdit({ ...roomEdit, capacity: Number(event.target.value) })} /></Field>
                        <div className="venue-resource-edit__actions"><button type="button" className="button button--quiet" onClick={() => setRoomEdit(null)}>Cancel</button><button type="submit" className="button button--dark" disabled={pendingKey === `room:${room.id}` || !roomEdit.name.trim()}>{pendingKey === `room:${room.id}` ? "Saving…" : "Save room"}</button></div>
                      </form>
                    ) : (
                      <>
                        <div className="venue-resource-row__copy"><strong>{room.name}</strong><span>{room.capacity.toLocaleString()} seats · {usage ? `${usage} ${usage === 1 ? "session" : "sessions"}` : "not yet used"}</span></div>
                        <div className="venue-resource-row__actions">
                          <button type="button" className="icon-button" aria-label={`Edit ${room.name}`} onClick={() => { setRoomEdit(room); setTrackEdit(null); setDeleteCandidate(null); }}><Pencil size={15} /></button>
                          <button type="button" className="icon-button icon-button--danger" aria-label={usage ? `${room.name} cannot be deleted while sessions use it` : `Delete ${room.name}`} disabled={Boolean(usage)} onClick={() => setDeleteCandidate({ kind: "room", id: room.id, name: room.name })}><Trash2 size={15} /></button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
              {!workspace.rooms.length && <p className="venue-resource-list__empty">No rooms yet. Add the first room before placing sessions.</p>}
            </div>
            <form
              className="venue-resource-create"
              aria-label="Add a room"
              onSubmit={(event) => {
                event.preventDefault();
                void run("room:create", async () => {
                  await createRoom(roomDraft);
                  setRoomDraft(initialRoom);
                });
              }}
            >
              <Field label="New room"><input required maxLength={120} value={roomDraft.name} onChange={(event) => setRoomDraft({ ...roomDraft, name: event.target.value })} placeholder="Main theater" /></Field>
              <Field label="Seats"><input required type="number" min={1} max={100000} value={roomDraft.capacity} onChange={(event) => setRoomDraft({ ...roomDraft, capacity: Number(event.target.value) })} /></Field>
              <button type="submit" className="button button--quiet" disabled={pendingKey === "room:create" || !roomDraft.name.trim()}><Plus size={15} /> {pendingKey === "room:create" ? "Adding…" : "Add room"}</button>
            </form>
          </section>

          <section className="venue-resource-section" aria-labelledby="tracks-title">
            <div className="venue-resource-section__head">
              <span className="venue-resource-section__mark venue-resource-section__mark--track"><Tags size={17} /></span>
              <div><h3 id="tracks-title">Program tracks</h3><p>{workspace.tracks.length} configured</p></div>
            </div>
            <div className="venue-resource-list">
              {workspace.tracks.map((track) => {
                const usage = trackUsage(track.id);
                const editing = trackEdit?.id === track.id;
                return (
                  <article className="venue-resource-row" key={track.id}>
                    {editing ? (
                      <form
                        className="venue-resource-edit"
                        aria-label={`Edit ${track.name}`}
                        onSubmit={(event) => {
                          event.preventDefault();
                          if (!trackEdit) return;
                          void run(`track:${track.id}`, async () => {
                            await updateTrack(track.id, { name: trackEdit.name, color: trackEdit.color });
                            setTrackEdit(null);
                          });
                        }}
                      >
                        <Field label="Track name"><input data-dialog-initial-focus required maxLength={120} value={trackEdit.name} onChange={(event) => setTrackEdit({ ...trackEdit, name: event.target.value })} /></Field>
                        <Field label={`Color ${trackEdit.color.toUpperCase()}`}><input className="venue-color-input" type="color" value={trackEdit.color} onChange={(event) => setTrackEdit({ ...trackEdit, color: event.target.value })} /></Field>
                        <div className="venue-resource-edit__actions"><button type="button" className="button button--quiet" onClick={() => setTrackEdit(null)}>Cancel</button><button type="submit" className="button button--dark" disabled={pendingKey === `track:${track.id}` || !trackEdit.name.trim()}>{pendingKey === `track:${track.id}` ? "Saving…" : "Save track"}</button></div>
                      </form>
                    ) : (
                      <>
                        <div className="venue-resource-row__copy venue-resource-row__copy--track"><i style={{ background: track.color }} /><span><strong>{track.name}</strong><small>{track.color.toUpperCase()} · {usage ? `${usage} ${usage === 1 ? "session" : "sessions"}` : "not yet used"}</small></span></div>
                        <div className="venue-resource-row__actions">
                          <button type="button" className="icon-button" aria-label={`Edit ${track.name}`} onClick={() => { setTrackEdit(track); setRoomEdit(null); setDeleteCandidate(null); }}><Pencil size={15} /></button>
                          <button type="button" className="icon-button icon-button--danger" aria-label={usage ? `${track.name} cannot be deleted while sessions use it` : `Delete ${track.name}`} disabled={Boolean(usage)} onClick={() => setDeleteCandidate({ kind: "track", id: track.id, name: track.name })}><Trash2 size={15} /></button>
                        </div>
                      </>
                    )}
                  </article>
                );
              })}
              {!workspace.tracks.length && <p className="venue-resource-list__empty">No tracks yet. Add a program lane before placing sessions.</p>}
            </div>
            <form
              className="venue-resource-create venue-resource-create--track"
              aria-label="Add a program track"
              onSubmit={(event) => {
                event.preventDefault();
                void run("track:create", async () => {
                  await createTrack(trackDraft);
                  setTrackDraft({ name: "", color: workspace.event.accent });
                });
              }}
            >
              <Field label="New track"><input required maxLength={120} value={trackDraft.name} onChange={(event) => setTrackDraft({ ...trackDraft, name: event.target.value })} placeholder="AI safety" /></Field>
              <Field label={`Color ${trackDraft.color.toUpperCase()}`}><input className="venue-color-input" type="color" value={trackDraft.color} onChange={(event) => setTrackDraft({ ...trackDraft, color: event.target.value })} /></Field>
              <button type="submit" className="button button--quiet" disabled={pendingKey === "track:create" || !trackDraft.name.trim()}><Plus size={15} /> {pendingKey === "track:create" ? "Adding…" : "Add track"}</button>
            </form>
          </section>

          {deleteCandidate && (
            <div className="venue-delete-confirmation" role="alertdialog" aria-labelledby="venue-delete-title" aria-describedby="venue-delete-detail">
              <div><strong id="venue-delete-title">Remove {deleteCandidate.name}?</strong><p id="venue-delete-detail">This removes it from this event’s schedule options. This cannot be undone.</p></div>
              <div><button type="button" className="button button--quiet" onClick={() => setDeleteCandidate(null)}>Keep it</button><button type="button" className="button button--danger" disabled={pendingKey === `${deleteCandidate.kind}:delete`} onClick={() => void run(`${deleteCandidate.kind}:delete`, async () => { if (deleteCandidate.kind === "room") await deleteRoom(deleteCandidate.id); else await deleteTrack(deleteCandidate.id); setDeleteCandidate(null); })}>{pendingKey === `${deleteCandidate.kind}:delete` ? "Removing…" : "Remove"}</button></div>
            </div>
          )}
        </div>

        <div className="drawer__foot"><button type="button" className="button button--dark" onClick={onClose}>Done</button></div>
      </div>
    </div>
  );
}
