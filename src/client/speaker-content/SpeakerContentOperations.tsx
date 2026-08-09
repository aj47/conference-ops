import {
  Archive,
  BellRing,
  Check,
  Clock3,
  Download,
  FileArchive,
  FileClock,
  FileUp,
  History,
  Mail,
  MessageSquareText,
  PencilLine,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  outstandingTask,
  parseSpeakerCsv,
  renderSpeakerTemplate,
  type SpeakerCommunicationLog,
  type SpeakerContentSession,
  type SpeakerContentSnapshot,
  type SpeakerWorkflowStatus,
} from "../../shared/speaker-content";
import { Avatar, EmptyState, Field, InlineAlert, StatusPill } from "../components";
import { dateTimeLocalToInstant, instantToDateTimeLocal } from "../event-time";
import { useWorkspace } from "../workspace";
import { managedSpeakerPayload, speakerContentApi, type ManagedSpeakerPayload } from "../speaker-content-api";
import "./speaker-content.css";

const tabs = [
  { id: "roster", label: "Roster", icon: Users },
  { id: "progress", label: "Progress", icon: Check },
  { id: "files", label: "Files", icon: Archive },
  { id: "sessions", label: "Session content", icon: PencilLine },
  { id: "communications", label: "Communications", icon: Mail },
] as const;

type Tab = typeof tabs[number]["id"];

const emptySpeaker: ManagedSpeakerPayload = {
  name: "",
  email: "",
  title: "",
  company: "",
  bio: "",
  workflowStatus: "invited",
  socialLinks: {},
  travelDetails: "",
  published: false,
};

function displayDate(value: string, withTime = false) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(new Date(value));
}

function downloadPath(path: string, actorId: string, role: string) {
  return fetch(path, { headers: { "x-demo-actor": actorId, "x-event-role": role } }).then(async (response) => {
    if (!response.ok) throw new Error("The file could not be downloaded.");
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const name = decodeURIComponent(disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] ?? "speaker-deliverables.zip");
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(href), 1_000);
  });
}

function countForTab(tab: Tab, snapshot: SpeakerContentSnapshot) {
  if (tab === "roster") return snapshot.speakers.length;
  if (tab === "progress") return snapshot.tasks.filter(outstandingTask).length;
  if (tab === "files") return snapshot.files.length;
  if (tab === "sessions") return snapshot.sessions.filter((session) => session.contentStatus !== "approved").length;
  return snapshot.communications.length;
}

function localSnapshotKey(eventId: string, actorId: string) {
  return `conference-ops-speaker-content:${eventId}:${actorId}`;
}

export function SpeakerContentOperations() {
  const { workspace, source, privateWorkspaceEventId } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const [snapshot, setSnapshot] = useState<SpeakerContentSnapshot | null>(null);
  const [tab, setTab] = useState<Tab>("roster");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const persistDemoSnapshot = (next: SpeakerContentSnapshot) => {
    setSnapshot(next);
    if (source === "demo") window.localStorage.setItem(localSnapshotKey(eventId, workspace.actor.id), JSON.stringify(next));
  };

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const loaded = await speakerContentApi.snapshot(workspace.actor.id, workspace.actor.role, eventId);
      if (source === "demo") {
        const stored = window.localStorage.getItem(localSnapshotKey(eventId, workspace.actor.id));
        if (stored) {
          try {
            setSnapshot(JSON.parse(stored) as SpeakerContentSnapshot);
            return;
          } catch {
            window.localStorage.removeItem(localSnapshotKey(eventId, workspace.actor.id));
          }
        }
      }
      setSnapshot(loaded);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Speaker operations could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, [eventId, workspace.actor.id, workspace.actor.role]); // eslint-disable-line react-hooks/exhaustive-deps

  const afterMutation = async (message: string, demoUpdate?: (current: SpeakerContentSnapshot) => SpeakerContentSnapshot) => {
    setNotice(message);
    setError("");
    if (source === "demo" && demoUpdate && snapshot) {
      persistDemoSnapshot({ ...demoUpdate(snapshot), generatedAt: new Date().toISOString() });
    } else {
      await refresh();
    }
  };

  if (loading && !snapshot) return <div className="speaker-content-loading"><RefreshCw className="spin" size={18} /> Loading speaker operations…</div>;
  if (!snapshot) return <InlineAlert tone="danger">{error || "Speaker operations are unavailable."}</InlineAlert>;

  return (
    <section className="speaker-content-shell" aria-label="Speaker and content operations">
      <div className="speaker-content-commandbar">
        <div>
          <p className="eyebrow">Speaker operations cockpit</p>
          <h2>Roster to show-ready, in one traceable flow.</h2>
          <p>Every assignment, file version, content approval, and communication stays attached to the person and session it belongs to.</p>
        </div>
        <button type="button" className="button button--quiet" disabled={loading} onClick={() => void refresh()}><RefreshCw size={15} className={loading ? "spin" : ""} /> Refresh</button>
      </div>
      <nav className="speaker-content-tabs" aria-label="Speaker operations sections">
        {tabs.map((item) => {
          const Icon = item.icon;
          const count = countForTab(item.id, snapshot);
          return <button key={item.id} type="button" aria-current={tab === item.id ? "page" : undefined} onClick={() => { setTab(item.id); setNotice(""); setError(""); }}><Icon size={16} /><span>{item.label}</span><b>{count}</b></button>;
        })}
      </nav>
      <div className="speaker-content-notices" aria-live="polite">
        {notice && <InlineAlert tone="info">{notice}</InlineAlert>}
        {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      </div>
      {tab === "roster" && <RosterView snapshot={snapshot} source={source} eventId={eventId} actor={workspace.actor} onError={setError} onComplete={afterMutation} />}
      {tab === "progress" && <ProgressView snapshot={snapshot} source={source} eventId={eventId} timezone={workspace.event.timezone} actor={workspace.actor} onError={setError} onComplete={afterMutation} />}
      {tab === "files" && <FilesView snapshot={snapshot} eventId={eventId} actor={workspace.actor} onError={setError} onComplete={afterMutation} />}
      {tab === "sessions" && <SessionsView snapshot={snapshot} source={source} eventId={eventId} actor={workspace.actor} onError={setError} onComplete={afterMutation} />}
      {tab === "communications" && <CommunicationsView snapshot={snapshot} source={source} eventId={eventId} actor={workspace.actor} onError={setError} onComplete={afterMutation} />}
    </section>
  );
}

interface ViewProps {
  snapshot: SpeakerContentSnapshot;
  source: "api" | "demo";
  eventId: string;
  actor: { id: string; role: string; name: string };
  onError: (message: string) => void;
  onComplete: (message: string, demoUpdate?: (current: SpeakerContentSnapshot) => SpeakerContentSnapshot) => Promise<void>;
}

function RosterView({ snapshot, source, eventId, actor, onError, onComplete }: ViewProps) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState(snapshot.speakers[0]?.id ?? "");
  const [draft, setDraft] = useState<ManagedSpeakerPayload>(snapshot.speakers[0] ? managedSpeakerPayload(snapshot.speakers[0]) : emptySpeaker);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const filtered = snapshot.speakers.filter((speaker) => {
    const haystack = `${speaker.name} ${speaker.email} ${speaker.title} ${speaker.company}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase()) && (status === "all" || speaker.workflowStatus === status);
  });
  const selected = snapshot.speakers.find((speaker) => speaker.id === selectedId) ?? filtered[0];

  useEffect(() => {
    if (selected) setDraft(managedSpeakerPayload(selected));
  }, [selected?.id, snapshot.generatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    onError("");
    try { await action(); } catch (reason) { onError(reason instanceof Error ? reason.message : "The speaker record could not be updated."); } finally { setBusy(false); }
  };

  const save = () => selected && run(async () => {
    await speakerContentApi.updateSpeaker(actor.id, actor.role, eventId, selected.id, draft);
    await onComplete(`${draft.name}'s profile and workflow status were saved.`, (current) => ({
      ...current,
      speakers: current.speakers.map((speaker) => speaker.id === selected.id ? { ...speaker, ...draft } : speaker),
    }));
  });

  const importFile = async (file: File) => {
    await run(async () => {
      const csv = await file.text();
      const parsed = parseSpeakerCsv(csv);
      const result = await speakerContentApi.importSpeakers(actor.id, actor.role, eventId, csv);
      await onComplete(`${result.created} speaker${result.created === 1 ? "" : "s"} added; ${result.merged} matched by email.`, (current) => {
        const map = new Map(current.speakers.map((speaker) => [speaker.email.toLowerCase(), speaker]));
        for (const row of parsed) {
          const existing = map.get(row.email);
          map.set(row.email, existing ? { ...existing, ...row } : {
            id: crypto.randomUUID(), ...row, workflowStatus: "invited", socialLinks: {}, travelDetails: "",
            profileComplete: false, published: false, sessions: [],
          });
        }
        return { ...current, speakers: [...map.values()].sort((left, right) => left.name.localeCompare(right.name)) };
      });
      setImporting(false);
    });
  };

  return (
    <div className="speaker-roster-suite">
      <aside className="speaker-roster-suite__rail">
        <div className="speaker-suite-toolbar">
          <label className="speaker-suite-search"><Search size={15} /><span className="sr-only">Search speakers</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search roster" /></label>
          <select aria-label="Filter speaker workflow status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="invited">Invited</option><option value="confirmed">Confirmed</option><option value="onboarding">Onboarding</option><option value="ready">Ready</option><option value="declined">Declined</option></select>
        </div>
        <div className="speaker-roster-suite__actions">
          <button type="button" className="button button--primary" onClick={() => { setAdding(true); setImporting(false); }}><UserPlus size={15} /> Add speaker</button>
          <button type="button" className="button button--quiet" onClick={() => { setImporting(true); setAdding(false); }}><Upload size={15} /> Import CSV</button>
        </div>
        <div className="speaker-roster-suite__list" role="listbox" aria-label="Speaker roster">
          {filtered.map((speaker) => {
            const complete = snapshot.tasks.filter((task) => task.speakerId === speaker.id && task.status === "complete").length;
            const total = snapshot.tasks.filter((task) => task.speakerId === speaker.id).length;
            return <button type="button" role="option" aria-selected={selected?.id === speaker.id} key={speaker.id} onClick={() => { setSelectedId(speaker.id); setAdding(false); setImporting(false); }}><Avatar name={speaker.name} /><span><strong>{speaker.name}</strong><small>{speaker.title || "Role not added"}{speaker.company ? ` · ${speaker.company}` : ""}</small><em>{complete}/{total} tasks complete</em></span><StatusPill status={speaker.workflowStatus} /></button>;
          })}
          {!filtered.length && <EmptyState title="No speakers match" detail="Clear the search or choose another workflow status." />}
        </div>
      </aside>
      <main className="speaker-roster-suite__workfile">
        {adding ? <CreateSpeakerPanel busy={busy} onCancel={() => setAdding(false)} onCreate={(payload) => run(async () => {
          const result = await speakerContentApi.createSpeaker(actor.id, actor.role, eventId, payload);
          await onComplete(`${payload.name} was added to the speaker roster.`, (current) => ({ ...current, speakers: [...current.speakers, {
            id: result.id, ...payload, profileComplete: false, sessions: [],
          }].sort((left, right) => left.name.localeCompare(right.name)) }));
          setSelectedId(result.id);
          setAdding(false);
        })} /> : importing ? <section className="speaker-import-panel"><div className="speaker-panel-heading"><div><p className="eyebrow">Bulk roster intake</p><h3>Import speakers from CSV</h3><p>Email is the dedupe key. Existing records are enriched; new emails create one new speaker.</p></div><button type="button" className="icon-button" aria-label="Close import" onClick={() => setImporting(false)}><X size={17} /></button></div><div className="speaker-import-drop"><FileUp size={28} /><strong>Choose speakers.csv</strong><p>Required columns: Name, Email. Optional: Title, Company, Bio. Quoted commas are supported.</p><button type="button" className="button button--primary" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? "Importing…" : "Choose CSV"}</button><input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importFile(file); }} /></div><pre>name,email,title,company,bio{"\n"}Priya Raman,priya@example.com,Staff Engineer,Latticework Systems,"Build systems leader"</pre></section> : selected ? (
          <form className="speaker-workfile-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <header className="speaker-workfile-editor__head"><Avatar name={draft.name || selected.name} size="lg" /><div><p className="eyebrow">Organizer speaker record</p><h3>{selected.name}</h3><p>{selected.email}</p></div><label><span>Workflow status</span><select value={draft.workflowStatus} onChange={(event) => setDraft({ ...draft, workflowStatus: event.target.value as SpeakerWorkflowStatus })}><option value="invited">Invited</option><option value="confirmed">Confirmed</option><option value="onboarding">Onboarding</option><option value="ready">Ready</option><option value="declined">Declined</option></select></label></header>
            <div className="speaker-workfile-editor__grid">
              <section><h4>Identity</h4><div className="field-grid field-grid--2"><Field label="Name"><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="Email"><input required type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></Field><Field label="Role or title"><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="Company"><input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} /></Field></div><Field label="Public biography" hint={`${draft.bio.length} / 5,000`}><textarea rows={6} maxLength={5000} value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></Field></section>
              <section><h4>Public links</h4><div className="form-stack"><Field label="LinkedIn"><input type="url" value={draft.socialLinks.linkedin ?? ""} placeholder="https://linkedin.com/in/…" onChange={(event) => setDraft({ ...draft, socialLinks: { ...draft.socialLinks, linkedin: event.target.value } })} /></Field><Field label="X / Twitter"><input type="url" value={draft.socialLinks.x ?? ""} placeholder="https://x.com/…" onChange={(event) => setDraft({ ...draft, socialLinks: { ...draft.socialLinks, x: event.target.value } })} /></Field><Field label="Website"><input type="url" value={draft.socialLinks.website ?? ""} placeholder="https://…" onChange={(event) => setDraft({ ...draft, socialLinks: { ...draft.socialLinks, website: event.target.value } })} /></Field></div><label className="speaker-publish-toggle"><input type="checkbox" checked={draft.published} onChange={(event) => setDraft({ ...draft, published: event.target.checked })} /><span><strong>Publish speaker profile</strong><small>Eligible for attendee-facing speaker pages once content is ready.</small></span></label></section>
            </div>
            <section className="speaker-logistics"><div><h4>Travel and logistics</h4><p>Private organizer notes for arrival, lodging, accessibility, and dietary preferences.</p></div><textarea aria-label="Travel and logistics" rows={3} value={draft.travelDetails} placeholder="Arrival May 11, aisle seat; dietary: Vegetarian" onChange={(event) => setDraft({ ...draft, travelDetails: event.target.value })} /></section>
            <section className="speaker-assignment-strip"><div><h4>Session assignments</h4><p>Explicit links visible here and in this speaker’s portal.</p></div>{selected.sessions.length ? <ul>{selected.sessions.map((session) => <li key={session.id}><Sparkles size={15} /><span><strong>{session.title}</strong><small>{session.startsAt ? displayDate(session.startsAt, true) : "Schedule pending"}{session.room ? ` · ${session.room}` : ""}</small></span></li>)}</ul> : <p className="muted">No session is assigned yet. Use Session content to link one.</p>}</section>
            <section className="speaker-headshot-record"><div><h4>Headshot file</h4><p>{selected.headshot ? `${selected.headshot.fileName} · uploaded ${displayDate(selected.headshot.uploadedAt, true)}` : "No headshot uploaded yet."}</p></div><div>{selected.headshot && <a className="button button--quiet" href={selected.headshot.downloadUrl}><Download size={14} /> Download</a>}<label className="button button--quiet"><FileUp size={14} /> {selected.headshot ? "Replace" : "Upload"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { const input = event.currentTarget; const file = input.files?.[0]; input.value = ""; if (!file) return; void run(async () => { const upload = await speakerContentApi.uploadHeadshot(actor.id, actor.role, eventId, file); const payload = { ...draft, headshotUploadId: upload.id }; await speakerContentApi.updateSpeaker(actor.id, actor.role, eventId, selected.id, payload); await onComplete(`${file.name} is now ${selected.name}'s organizer-managed headshot.`); }); }} /></label></div></section>
            <footer><button type="button" className="button button--quiet" disabled={busy} onClick={() => void run(async () => { await speakerContentApi.recordCommunication(actor.id, actor.role, eventId, { kind: "invitation", recipientIds: [selected.id], subject: "Your speaker portal is ready", bodyTemplate: "Hi {{speaker.first_name}}, open your speaker portal: {{speaker.portal_url}}" }); await onComplete(source === "demo" ? `Portal invitation for ${selected.name} was recorded in the demo delivery log.` : `Portal invitation for ${selected.name} was queued and recorded in communications history.`); })}><Send size={14} /> {source === "demo" ? "Record portal invite" : "Send portal invite"}</button><button type="button" className="button button--danger" disabled={busy || selected.sessions.length > 0} title={selected.sessions.length ? "Remove session assignments before deleting this speaker." : undefined} onClick={() => { if (!window.confirm(`Delete ${selected.name}? This cannot be undone.`)) return; void run(async () => { await speakerContentApi.deleteSpeaker(actor.id, actor.role, eventId, selected.id); await onComplete(`${selected.name} was removed from the roster.`, (current) => ({ ...current, speakers: current.speakers.filter((speaker) => speaker.id !== selected.id) })); setSelectedId(""); }); }}><Trash2 size={14} /> Delete</button><button type="submit" className="button button--primary" disabled={busy}><Save size={15} /> {busy ? "Saving…" : "Save speaker record"}</button></footer>
          </form>
        ) : <EmptyState title="Start the speaker roster" detail="Add one speaker manually or import a CSV to create an operational roster." action={<button type="button" className="button button--primary" onClick={() => setAdding(true)}><Plus size={15} /> Add speaker</button>} />}
      </main>
    </div>
  );
}

function CreateSpeakerPanel({ busy, onCancel, onCreate }: { busy: boolean; onCancel: () => void; onCreate: (payload: ManagedSpeakerPayload) => void }) {
  const [draft, setDraft] = useState(emptySpeaker);
  return <form className="speaker-create-panel" onSubmit={(event) => { event.preventDefault(); onCreate(draft); }}><div className="speaker-panel-heading"><div><p className="eyebrow">Manual roster entry</p><h3>Add a speaker</h3><p>Create the operational record before or after a session is accepted.</p></div><button type="button" className="icon-button" onClick={onCancel} aria-label="Close add speaker"><X size={17} /></button></div><div className="field-grid field-grid--2"><Field label="Name"><input required autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field><Field label="Email"><input required type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></Field><Field label="Role or title"><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="Company"><input value={draft.company} onChange={(event) => setDraft({ ...draft, company: event.target.value })} /></Field></div><Field label="Biography"><textarea rows={7} value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} /></Field><Field label="Workflow status"><select value={draft.workflowStatus} onChange={(event) => setDraft({ ...draft, workflowStatus: event.target.value as SpeakerWorkflowStatus })}><option value="invited">Invited</option><option value="confirmed">Confirmed</option><option value="onboarding">Onboarding</option><option value="ready">Ready</option></select></Field><footer><button type="button" className="button button--quiet" onClick={onCancel}>Cancel</button><button type="submit" className="button button--primary" disabled={busy}><UserPlus size={15} /> {busy ? "Adding…" : "Add speaker"}</button></footer></form>;
}

function ProgressView({ snapshot, source, eventId, timezone, actor, onError, onComplete }: ViewProps & { timezone: string }) {
  const [status, setStatus] = useState("all");
  const [speakerId, setSpeakerId] = useState("all");
  const [kind, setKind] = useState("all");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("Confirm participation");
  const [description, setDescription] = useState("Confirm that you are participating and acknowledge the speaker expectations.");
  const [dueAt, setDueAt] = useState(() => instantToDateTimeLocal(new Date(Date.now() + 7 * 86400000).toISOString(), timezone));
  const [taskKind, setTaskKind] = useState<"general" | "file_request">("general");
  const [speakerIds, setSpeakerIds] = useState<string[]>([]);
  const [sessionId, setSessionId] = useState("");
  const filtered = snapshot.tasks.filter((task) => (status === "all" || status === "open" && outstandingTask(task) || task.status === status) && (speakerId === "all" || task.speakerId === speakerId) && (kind === "all" || task.kind === kind));
  const outstandingSpeakers = [...new Set(snapshot.tasks.filter(outstandingTask).map((task) => task.speakerId))];

  const run = async (action: () => Promise<void>) => { setBusy(true); onError(""); try { await action(); } catch (reason) { onError(reason instanceof Error ? reason.message : "The task workflow could not be updated."); } finally { setBusy(false); } };
  return <div className="speaker-progress-suite"><header><div><p className="eyebrow">Per-speaker assignment matrix</p><h3>Onboarding and deliverables progress</h3><p>Filter the full speaker-task matrix without opening individual records.</p></div><div><button type="button" className="button button--quiet" disabled={busy || !outstandingSpeakers.length} onClick={() => void run(async () => { await speakerContentApi.recordCommunication(actor.id, actor.role, eventId, { kind: "task_reminder", recipientIds: outstandingSpeakers, subject: "Outstanding speaker tasks", bodyTemplate: "Hi {{speaker.first_name}}, please review your outstanding tasks and due dates in {{speaker.portal_url}}." }); await onComplete(source === "demo" ? `${outstandingSpeakers.length} reminder${outstandingSpeakers.length === 1 ? "" : "s"} recorded in the demo delivery log.` : `${outstandingSpeakers.length} reminder${outstandingSpeakers.length === 1 ? "" : "s"} queued for speakers with outstanding tasks.`); })}><BellRing size={15} /> {source === "demo" ? "Record" : "Send"} reminders ({outstandingSpeakers.length})</button><button type="button" className="button button--primary" onClick={() => { setCreating(!creating); if (!speakerIds.length) setSpeakerIds(snapshot.speakers.map((speaker) => speaker.id)); }}><Plus size={15} /> Create task</button></div></header>
    {creating && <form className="speaker-task-composer" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await speakerContentApi.createTasks(actor.id, actor.role, eventId, { title, description, dueAt: dateTimeLocalToInstant(dueAt, timezone), kind: taskKind, speakerIds, ...(sessionId ? { sessionId } : {}) }); const ids = result.taskIds; await onComplete(`${title} was assigned to ${result.created} speaker${result.created === 1 ? "" : "s"}.`, (current) => ({ ...current, tasks: [...current.tasks, ...speakerIds.map((assignedId, index) => ({ id: ids[index] ?? crypto.randomUUID(), speakerId: assignedId, speakerName: current.speakers.find((speaker) => speaker.id === assignedId)?.name ?? "Speaker", title, description, kind: taskKind, dueAt: dateTimeLocalToInstant(dueAt, timezone), status: "not_started" as const, versions: [], comments: [], ...(sessionId ? { sessionId, sessionTitle: current.sessions.find((session) => session.id === sessionId)?.title } : {}) }))] })); setCreating(false); }); }}><div className="speaker-panel-heading"><div><p className="eyebrow">Ad-hoc multi-speaker assignment</p><h4>{taskKind === "file_request" ? "Request a deliverable" : "Create an action task"}</h4></div><button type="button" className="icon-button" aria-label="Close task composer" onClick={() => setCreating(false)}><X size={16} /></button></div><div className="field-grid field-grid--2"><Field label="Task title"><input required value={title} onChange={(event) => setTitle(event.target.value)} /></Field><Field label="Task type"><select value={taskKind} onChange={(event) => setTaskKind(event.target.value as typeof taskKind)}><option value="general">General / action</option><option value="file_request">File request</option></select></Field><Field label="Due date"><input required type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></Field><Field label="Session assignment" hint="Optional"><select value={sessionId} onChange={(event) => setSessionId(event.target.value)}><option value="">No specific session</option>{snapshot.sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}</select></Field></div><Field label="Instructions"><textarea required rows={4} value={description} onChange={(event) => setDescription(event.target.value)} /></Field><fieldset><legend>Assign to speakers</legend><div className="speaker-check-grid">{snapshot.speakers.map((speaker) => <label key={speaker.id}><input type="checkbox" checked={speakerIds.includes(speaker.id)} onChange={(event) => setSpeakerIds(event.target.checked ? [...speakerIds, speaker.id] : speakerIds.filter((id) => id !== speaker.id))} /><Avatar name={speaker.name} /><span>{speaker.name}<small>{speaker.company || speaker.email}</small></span></label>)}</div></fieldset><footer><span>{speakerIds.length} selected</span><button type="submit" className="button button--primary" disabled={busy || !speakerIds.length}>{busy ? "Assigning…" : "Assign task"}</button></footer></form>}
    <div className="speaker-progress-filters"><label>Status<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="open">Incomplete / open</option><option value="complete">Complete</option><option value="overdue">Overdue</option><option value="waived">Waived</option></select></label><label>Speaker<select value={speakerId} onChange={(event) => setSpeakerId(event.target.value)}><option value="all">All speakers</option>{snapshot.speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}</select></label><label>Work type<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">All work</option><option value="general">General tasks</option><option value="file_request">Deliverables</option></select></label><span>{filtered.length} of {snapshot.tasks.length} assignments</span></div>
    <div className="speaker-progress-table" role="table" aria-label="Speaker task progress"><div role="row" className="speaker-progress-table__head"><span role="columnheader">Speaker</span><span role="columnheader">Task</span><span role="columnheader">Due</span><span role="columnheader">Evidence</span><span role="columnheader">Status</span></div>{filtered.map((task) => <div role="row" key={task.id}><span role="cell"><Avatar name={task.speakerName} /><strong>{task.speakerName}</strong></span><span role="cell"><strong>{task.title}</strong><small>{task.sessionTitle ? `For “${task.sessionTitle}”` : task.kind === "file_request" ? "File request" : "General action"}</small></span><span role="cell"><Clock3 size={14} /> {displayDate(task.dueAt)}</span><span role="cell">{task.versions.length ? <><FileClock size={14} /><strong>{task.versions.length} version{task.versions.length === 1 ? "" : "s"}</strong></> : <small>No submission</small>}</span><span role="cell"><StatusPill status={task.status} /></span></div>)}{!filtered.length && <EmptyState title="No assignments in this view" detail="Change one of the filters or create a new task." />}</div>
  </div>;
}

function FilesView({ snapshot, eventId, actor, onError, onComplete }: Omit<ViewProps, "source">) {
  const [selected, setSelected] = useState<string[]>([]);
  const [taskId, setTaskId] = useState(snapshot.files[0]?.taskId ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [readyUrl, setReadyUrl] = useState("");
  const active = snapshot.files.find((file) => file.taskId === taskId) ?? snapshot.files[0];
  const activeTask = snapshot.tasks.find((task) => task.id === active?.taskId);
  const run = async (action: () => Promise<void>) => { setBusy(true); onError(""); try { await action(); } catch (reason) { onError(reason instanceof Error ? reason.message : "The file action could not be completed."); } finally { setBusy(false); } };
  return <div className="speaker-files-suite"><header><div><p className="eyebrow">Central content library</p><h3>Latest deliverables, with every prior version intact</h3><p>Select current files for a session-grouped ZIP. Every row keeps speaker, session, date, and version metadata.</p></div><button type="button" className="button button--primary" disabled={busy || !selected.length} onClick={() => void run(async () => { const result = await speakerContentApi.prepareExport(actor.id, actor.role, eventId, selected); setReadyUrl(result.downloadUrl); await onComplete(`ZIP is ready with the latest version from ${result.selected} selected file${result.selected === 1 ? "" : "s"}, grouped by session.`); })}><FileArchive size={16} /> Generate latest-version ZIP ({selected.length})</button></header>
    {readyUrl && <div className="speaker-export-ready"><Check size={17} /><span><strong>Export ready</strong><small>One folder per session, latest file versions only.</small></span><button type="button" className="button button--quiet" onClick={() => void run(() => downloadPath(readyUrl, actor.id, actor.role))}><Download size={14} /> Download ZIP</button></div>}
    <div className="speaker-files-layout"><section className="speaker-file-library"><div className="speaker-file-library__head"><label><input type="checkbox" checked={selected.length === snapshot.files.length && snapshot.files.length > 0} onChange={(event) => setSelected(event.target.checked ? snapshot.files.map((file) => file.taskId) : [])} /> Select all</label><span>{snapshot.files.length} uploaded deliverables</span></div>{snapshot.files.map((file) => <article key={file.id} className={active?.id === file.id ? "selected" : ""}><input aria-label={`Select ${file.fileName} from ${file.speakerName}`} type="checkbox" checked={selected.includes(file.taskId)} onChange={(event) => setSelected(event.target.checked ? [...selected, file.taskId] : selected.filter((id) => id !== file.taskId))} /><button type="button" onClick={() => setTaskId(file.taskId)}><FileUp size={18} /><span><strong>{file.fileName}</strong><small>{file.sessionTitle || "Unassigned session"}</small><small>{file.speakerName} · {displayDate(file.uploadedAt, true)}</small></span><b>{file.versionCount} version{file.versionCount === 1 ? "" : "s"}</b></button></article>)}{!snapshot.files.length && <EmptyState title="No uploaded deliverables" detail="File-request submissions will appear here with their complete version chain." />}</section>
      <aside className="speaker-file-detail">{active && activeTask ? <><div className="speaker-panel-heading"><div><p className="eyebrow">File detail</p><h4>{active.fileName}</h4><p>{active.sessionTitle || "Unassigned session"} · {active.speakerName}</p></div><StatusPill status={activeTask.status} /></div><section><h5>Version history</h5><ol className="speaker-file-versions">{active.versions.map((version, index) => <li key={version.uploadId}><span><b>v{active.versions.length - index}</b><FileClock size={15} /></span><div><strong>{version.fileName}</strong><small>{displayDate(version.uploadedAt, true)} · {version.byteSize ? `${Math.max(1, Math.round(version.byteSize / 1024))} KB` : "Stored file"}</small></div>{version.current && <em>Current</em>}<button type="button" className="icon-button" aria-label={`Download ${version.fileName} version ${active.versions.length - index}`} onClick={() => void run(() => downloadPath(version.downloadUrl, actor.id, actor.role))}><Download size={15} /></button></li>)}</ol></section><section><h5>File discussion</h5><div className="speaker-file-comments">{activeTask.comments.map((item) => <article key={item.id}><MessageSquareText size={15} /><p><strong>{item.authorName}</strong><span>{displayDate(item.createdAt, true)}</span><br />{item.body}</p></article>)}{!activeTask.comments.length && <p className="muted">No comments yet. Add review context without sending a separate email.</p>}</div><form onSubmit={(event) => { event.preventDefault(); if (!comment.trim()) return; void run(async () => { await speakerContentApi.addTaskComment(actor.id, actor.role, eventId, activeTask.id, comment); setComment(""); await onComplete("Your reply was added to the cross-role file discussion."); }); }}><textarea aria-label="Reply to file discussion" rows={3} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Thanks — please confirm the final version by Tuesday." /><button type="submit" className="button button--quiet" disabled={busy || !comment.trim()}><MessageSquareText size={14} /> Add reply</button></form></section></> : <EmptyState title="Choose a file" detail="Open a deliverable to review versions, downloads, and its cross-role discussion." />}</aside>
    </div>
  </div>;
}

function SessionsView({ snapshot, source, eventId, actor, onError, onComplete }: ViewProps) {
  const [selectedId, setSelectedId] = useState(snapshot.sessions[0]?.id ?? "");
  const selected = snapshot.sessions.find((session) => session.id === selectedId) ?? snapshot.sessions[0];
  const [draft, setDraft] = useState(selected);
  const [busy, setBusy] = useState(false);
  useEffect(() => setDraft(selected), [selected, snapshot.generatedAt]);
  const run = async (action: () => Promise<void>) => { setBusy(true); onError(""); try { await action(); } catch (reason) { onError(reason instanceof Error ? reason.message : "Session content could not be updated."); } finally { setBusy(false); } };
  if (!selected || !draft) return <EmptyState title="No sessions yet" detail="Accept a proposal or create a direct session before editing program content." />;
  return <div className="speaker-session-suite"><aside><div><p className="eyebrow">Content approval queue</p><h3>Sessions</h3><p>Only approved content is eligible for the public agenda.</p></div>{snapshot.sessions.map((session) => <button key={session.id} type="button" className={session.id === selected.id ? "selected" : ""} onClick={() => setSelectedId(session.id)}><span><strong>{session.title}</strong><small>{session.speakerNames.join(", ") || "No speaker assigned"}</small></span><StatusPill status={session.contentStatus.replace("_", " ")} /></button>)}</aside><main><form onSubmit={(event) => { event.preventDefault(); void run(async () => { await speakerContentApi.updateSession(actor.id, actor.role, eventId, selected.id, { title: draft.title, description: draft.description, contentStatus: draft.contentStatus, speakerIds: draft.speakerIds }); await onComplete(`“${draft.title}” was saved as ${draft.contentStatus.replace("_", " ")}.`, (current) => ({ ...current, sessions: current.sessions.map((session) => session.id === selected.id ? { ...session, ...draft, speakerNames: current.speakers.filter((speaker) => draft.speakerIds.includes(speaker.id)).map((speaker) => speaker.name), history: source === "demo" ? [...session.history, { id: crypto.randomUUID(), version: session.history.length + 1, title: draft.title, description: draft.description, editorName: actor.name, createdAt: new Date().toISOString() }].reverse() : session.history } : session) })); }); }}><div className="speaker-panel-heading"><div><p className="eyebrow">Central session editor</p><h3>{selected.title}</h3><p>{selected.scheduleStatus} · {selected.format}</p></div><label>Content status<select value={draft.contentStatus} onChange={(event) => setDraft({ ...draft, contentStatus: event.target.value as SpeakerContentSession["contentStatus"] })}><option value="draft">Draft</option><option value="in_review">In review</option><option value="approved">Approved</option></select></label></div><Field label="Session title"><input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field><Field label="Abstract / description" hint={`${draft.description.length} / 20,000`}><textarea rows={9} maxLength={20000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></Field><fieldset><legend>Assigned speakers</legend><div className="speaker-check-grid">{snapshot.speakers.map((speaker) => <label key={speaker.id}><input type="checkbox" checked={draft.speakerIds.includes(speaker.id)} onChange={(event) => setDraft({ ...draft, speakerIds: event.target.checked ? [...draft.speakerIds, speaker.id] : draft.speakerIds.filter((id) => id !== speaker.id) })} /><Avatar name={speaker.name} /><span>{speaker.name}<small>{speaker.title || speaker.company}</small></span></label>)}</div></fieldset><footer><span><strong>{draft.contentStatus === "approved" ? "Public agenda eligible" : "Held from public agenda"}</strong><small>Approval is a persisted content gate independent of schedule placement.</small></span><button type="submit" className="button button--primary" disabled={busy}><Save size={15} /> {busy ? "Saving…" : "Save content version"}</button></footer></form><section className="speaker-version-history"><div><History size={18} /><span><h4>Attributed version history</h4><p>Every save records the editor, timestamp, and restorable session snapshot.</p></span></div><ol>{selected.history.map((revision) => <li key={revision.id}><span><b>v{revision.version}</b></span><div><strong>{revision.title}</strong><small>{revision.editorName} · {displayDate(revision.createdAt, true)}{revision.restoredFromVersion ? ` · restored from v${revision.restoredFromVersion}` : ""}</small><p>{revision.description.slice(0, 180)}{revision.description.length > 180 ? "…" : ""}</p></div><button type="button" className="button button--quiet" disabled={busy} onClick={() => void run(async () => { await speakerContentApi.restoreSession(actor.id, actor.role, eventId, selected.id, revision.id); await onComplete(`Version ${revision.version} was restored and captured as a new audit version.`); })}><RotateCcw size={14} /> Restore</button></li>)}{!selected.history.length && <EmptyState title="No edits recorded yet" detail="The first save captures the original content and the edited version, both attributed to the organizer." />}</ol></section></main></div>;
}

function CommunicationsView({ snapshot, source, eventId, actor, onError, onComplete }: ViewProps) {
  const [recipientIds, setRecipientIds] = useState(snapshot.speakers.map((speaker) => speaker.id));
  const [subject, setSubject] = useState("Welcome to our conference speakers");
  const [body, setBody] = useState("Hi {{speaker.first_name}},\n\nWelcome to the speaker community. Your session is “{{session.title}}”. Review your next steps at {{speaker.portal_url}}.");
  const [previewId, setPreviewId] = useState(snapshot.speakers[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const previewSpeaker = snapshot.speakers.find((speaker) => speaker.id === previewId) ?? snapshot.speakers[0];
  const preview = previewSpeaker ? renderSpeakerTemplate(body, previewSpeaker, `${window.location.origin}/portal/home?eventId=${encodeURIComponent(eventId)}&role=speaker`) : "Choose a recipient to preview merge fields.";
  const run = async (action: () => Promise<void>) => { setBusy(true); onError(""); try { await action(); } catch (reason) { onError(reason instanceof Error ? reason.message : "The communication could not be recorded."); } finally { setBusy(false); } };
  return <div className="speaker-comms-suite"><main><div className="speaker-panel-heading"><div><p className="eyebrow">Safe communications workspace</p><h3>Compose and personalize</h3><p>{source === "demo" ? "Demo sends are recorded with resolved previews without delivering live email." : "Production sends enter the durable outbox, dispatch through the configured queue, and remain visible in delivery history."}</p></div><span className="speaker-sandbox-badge">{source === "demo" ? "Demo · no live delivery" : "Production outbox"}</span></div><form onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await speakerContentApi.recordCommunication(actor.id, actor.role, eventId, { kind: "general", recipientIds, subject, bodyTemplate: body }); const now = new Date().toISOString(); await onComplete(`${result.recorded} personalized message${result.recorded === 1 ? "" : "s"} ${result.deliveryMode === "queue" ? "queued and" : ""} recorded in communications history.`, (current) => ({ ...current, communications: [{ id: crypto.randomUUID(), kind: "general", recipientIds, recipientNames: current.speakers.filter((speaker) => recipientIds.includes(speaker.id)).map((speaker) => speaker.name), subject, bodyTemplate: body, renderedPreviews: current.speakers.filter((speaker) => recipientIds.includes(speaker.id)).map((speaker) => ({ speakerId: speaker.id, speakerName: speaker.name, body: renderSpeakerTemplate(body, speaker, `${window.location.origin}/portal/home?eventId=${eventId}&role=speaker`) })), status: "recorded", deliveryMode: "sandbox", createdAt: now, actorName: actor.name }, ...current.communications] })); }); }}><fieldset><legend>Recipients</legend><div className="speaker-comms-selectall"><label><input type="checkbox" checked={recipientIds.length === snapshot.speakers.length && snapshot.speakers.length > 0} onChange={(event) => setRecipientIds(event.target.checked ? snapshot.speakers.map((speaker) => speaker.id) : [])} /> Select all speakers</label><span>{recipientIds.length} selected</span></div><div className="speaker-check-grid">{snapshot.speakers.map((speaker) => <label key={speaker.id}><input type="checkbox" checked={recipientIds.includes(speaker.id)} onChange={(event) => setRecipientIds(event.target.checked ? [...recipientIds, speaker.id] : recipientIds.filter((id) => id !== speaker.id))} /><Avatar name={speaker.name} /><span>{speaker.name}<small>{speaker.workflowStatus}</small></span></label>)}</div></fieldset><Field label="Subject"><input required value={subject} onChange={(event) => setSubject(event.target.value)} /></Field><Field label="Template body" hint="Merge fields: {{speaker.first_name}}, {{speaker.name}}, {{session.title}}, {{speaker.portal_url}}"><textarea required rows={9} value={body} onChange={(event) => setBody(event.target.value)} /></Field><footer><span>Each recipient gets their own resolved preview in the delivery log.</span><button type="submit" className="button button--primary" disabled={busy || !recipientIds.length}><Send size={15} /> {busy ? (source === "demo" ? "Recording…" : "Queuing…") : `${source === "demo" ? "Record" : "Send"} ${recipientIds.length} message${recipientIds.length === 1 ? "" : "s"}`}</button></footer></form></main><aside><section className="speaker-message-preview"><div><p className="eyebrow">Per-recipient preview</p><select aria-label="Preview recipient" value={previewId} onChange={(event) => setPreviewId(event.target.value)}>{snapshot.speakers.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}</select></div><h4>{subject}</h4><pre>{preview}</pre></section><section className="speaker-comms-history"><div><p className="eyebrow">Communications history</p><h4>Recorded sends</h4></div>{snapshot.communications.map((entry: SpeakerCommunicationLog) => <article key={entry.id}><span><Mail size={15} /></span><div><strong>{entry.subject}</strong><small>{entry.recipientNames.join(", ")}</small><small>{entry.actorName} · {displayDate(entry.createdAt, true)}</small></div><em>{entry.deliveryMode}</em></article>)}{!snapshot.communications.length && <EmptyState title="No messages recorded" detail="A saved send will appear here with recipients and timestamp." />}</section></aside></div>;
}
