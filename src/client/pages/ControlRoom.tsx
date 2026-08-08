import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  MapPin,
  Pencil,
  Radio,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { EmptyState, Field, InlineAlert, PageHeader, ProgressBar, SectionHeading, StatusPill } from "../components";
import { useWorkspace } from "../workspace";

function formatWhen(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function EventSettingsDialog({ onClose }: { onClose: () => void }) {
  const { workspace, updateEvent } = useWorkspace();
  const [draft, setDraft] = useState(workspace.event);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="drawer drawer--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-settings-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError("");
          try {
            await updateEvent(draft);
            onClose();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "Event details could not be saved.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="drawer__head">
          <div><p className="eyebrow">Event record</p><h2 id="event-settings-title">Working details</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close event settings"><X size={18} /></button>
        </div>
        <div className="drawer__body form-stack">
          <Field label="Event name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
          <div className="field-grid field-grid--2">
            <Field label="Short name"><input value={draft.shortName} onChange={(event) => setDraft({ ...draft, shortName: event.target.value })} /></Field>
            <Field label="Public slug"><input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} /></Field>
          </div>
          <Field label="What this event is for" hint={`${draft.description.length} / 1,000 characters`}>
            <textarea rows={4} maxLength={1000} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </Field>
          <div className="field-grid field-grid--2">
            <Field label="Venue"><input value={draft.venue} onChange={(event) => setDraft({ ...draft, venue: event.target.value })} /></Field>
            <Field label="Timezone"><select value={draft.timezone} onChange={(event) => setDraft({ ...draft, timezone: event.target.value })}><option>America/Los_Angeles</option><option>America/New_York</option><option>Europe/London</option><option>Asia/Singapore</option></select></Field>
            <Field label="Starts"><input type="datetime-local" value={draft.startsAt.slice(0, 16)} onChange={(event) => setDraft({ ...draft, startsAt: new Date(event.target.value).toISOString() })} /></Field>
            <Field label="Ends"><input type="datetime-local" value={draft.endsAt.slice(0, 16)} onChange={(event) => setDraft({ ...draft, endsAt: new Date(event.target.value).toISOString() })} /></Field>
          </div>
          <Field label="Event website"><input type="url" value={draft.websiteUrl} onChange={(event) => setDraft({ ...draft, websiteUrl: event.target.value })} /></Field>
          <div className="brand-swatches" aria-label="Event accent color">
            {["#e05b3f", "#2d6a6c", "#7564a8", "#bd8b2f"].map((color) => (
              <button key={color} type="button" className={draft.accent === color ? "selected" : ""} style={{ background: color }} onClick={() => setDraft({ ...draft, accent: color })} aria-label={`Use ${color} as event accent`} />
            ))}
          </div>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
        <div className="drawer__foot"><button type="button" className="button button--quiet" onClick={onClose} disabled={saving}>Cancel</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save event details"}</button></div>
      </form>
    </div>
  );
}

export function ControlRoom() {
  const { workspace } = useWorkspace();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const accepted = workspace.proposals.filter((proposal) => proposal.status === "accepted").length;
  const reviewPending = workspace.proposals.filter((proposal) => ["submitted", "under_review"].includes(proposal.status)).length;
  const unscheduled = workspace.sessions.filter((session) => session.status === "unscheduled").length;
  const openTasks = workspace.tasks.filter((task) => task.status !== "complete");
  const overdueTasks = openTasks.filter((task) => task.status === "overdue");
  const incompleteProfiles = workspace.proposals.flatMap((proposal) => proposal.speakers).filter((speaker) => !speaker.profileComplete);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    workspace.proposals.forEach((proposal) => counts.set(proposal.category, (counts.get(proposal.category) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [workspace.proposals]);

  const phases = [
    {
      marker: "NOW",
      date: "08 AUG",
      title: "Review the evidence",
      detail: `${reviewPending} proposals still need a committee signal before decisions lock.`,
      action: "Open review desk",
      to: "/reviews",
      tone: "rust",
      icon: FileText,
    },
    {
      marker: "NEXT",
      date: "13 AUG",
      title: "Close the call",
      detail: `CFP closes ${formatWhen(workspace.event.cfpClosesAt)}. Draft reminders are queued 48 hours before.`,
      action: "Check form rules",
      to: "/forms",
      tone: "ochre",
      icon: Clock3,
    },
    {
      marker: "THEN",
      date: "18 AUG",
      title: "Lock the room grid",
      detail: `${accepted} accepted sessions, ${unscheduled} still waiting for a room and start time.`,
      action: "Open schedule board",
      to: "/schedule",
      tone: "teal",
      icon: CalendarClock,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Program control room · Saturday shift"
        title="The conference is a living system."
        description="One operational view of what needs judgment now, what is waiting on people, and what the public will see next."
        actions={<button type="button" className="button button--quiet" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /> Event details</button>}
      />

      <section className="event-brief" aria-label="Current event details">
        <div className="event-brief__title"><span className="live-dot" /> <strong>{workspace.event.name}</strong><StatusPill status={workspace.event.status} /></div>
        <div><MapPin size={15} /> {workspace.event.venue}</div>
        <div><CalendarClock size={15} /> Aug 28–29 · {workspace.event.timezone.replace("America/", "")}</div>
        <button type="button" onClick={() => setSettingsOpen(true)}><Pencil size={14} /> Edit</button>
      </section>

      <div className="control-layout">
        <section className="call-sheet" aria-labelledby="call-sheet-title">
          <SectionHeading title="Program call sheet" description="The next consequential handoffs, in order." action={<span className="folio">RUN 06 / REV 3</span>} />
          <div className="call-sheet__line" aria-hidden="true" />
          {phases.map((phase) => {
            const Icon = phase.icon;
            return (
              <article className={`call-sheet__row call-sheet__row--${phase.tone}`} key={phase.marker}>
                <div className="call-sheet__marker"><span>{phase.marker}</span><strong>{phase.date}</strong></div>
                <div className="call-sheet__pin"><Icon size={17} /></div>
                <div className="call-sheet__copy"><h3>{phase.title}</h3><p>{phase.detail}</p></div>
                <Link to={phase.to} className="text-link">{phase.action}<ArrowUpRight size={14} /></Link>
              </article>
            );
          })}
          <div className="call-sheet__footer"><Radio size={16} /><span>Realtime changes are reflected here after each committed workflow action.</span></div>
        </section>

        <aside className="risk-ledger" aria-labelledby="risk-title">
          <SectionHeading title="Needs intervention" description="Exceptions before they become day-of problems." />
          <div className="risk-ledger__count"><strong>{overdueTasks.length + incompleteProfiles.length + unscheduled}</strong><span>open exceptions</span></div>
          <div className="risk-list">
            {overdueTasks.map((task) => (
              <Link to="/speaker-ops" key={task.id}><AlertCircle size={16} /><span><strong>{task.title}</strong><small>Overdue · speaker task</small></span><ChevronMini /></Link>
            ))}
            {incompleteProfiles.slice(0, 2).map((speaker) => (
              <Link to="/speaker-ops" key={speaker.id}><Users size={16} /><span><strong>{speaker.name}</strong><small>Public profile incomplete</small></span><ChevronMini /></Link>
            ))}
            {unscheduled > 0 && <Link to="/schedule"><CalendarClock size={16} /><span><strong>{unscheduled} unscheduled session</strong><small>Needs room and time</small></span><ChevronMini /></Link>}
          </div>
          <Link to="/speaker-ops" className="button button--dark button--full">Work the exception queue</Link>
        </aside>
      </div>

      <div className="dashboard-grid">
        <section className="paper-panel">
          <SectionHeading title="Intake shape" description={`${workspace.proposals.length} proposals across ${categories.length} review lanes.`} />
          <div className="category-bars">
            {categories.map(([category, count]) => <ProgressBar key={category} label={`${category} · ${count}`} value={count} max={workspace.proposals.length} />)}
          </div>
          <div className="stat-strip">
            <div><span>Awaiting signal</span><strong>{reviewPending}</strong></div>
            <div><span>Accepted</span><strong>{accepted}</strong></div>
            <div><span>Active tasks</span><strong>{openTasks.length}</strong></div>
          </div>
        </section>

        <section className="paper-panel">
          <SectionHeading title="Latest desk notes" description="A compact audit trail of material changes." />
          {workspace.activity.length ? (
            <ol className="activity-list">
              {workspace.activity.map((activity) => (
                <li key={activity.id} className={`activity-list__item activity-list__item--${activity.tone}`}>
                  <span className="activity-list__icon">{activity.tone === "positive" ? <CheckCircle2 size={15} /> : activity.tone === "warning" ? <AlertCircle size={15} /> : <Sparkles size={15} />}</span>
                  <div><strong>{activity.actor}</strong> {activity.action} <b>{activity.target}</b><small>{formatWhen(activity.at)}</small></div>
                </li>
              ))}
            </ol>
          ) : <EmptyState title="No desk notes yet" detail="Material decisions and operational changes will appear here." />}
        </section>
      </div>
      {settingsOpen && <EventSettingsDialog onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

function ChevronMini() {
  return <ArrowUpRight size={14} aria-hidden="true" />;
}
