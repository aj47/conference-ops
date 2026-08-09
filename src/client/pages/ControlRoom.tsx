import {
  AlertCircle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  FileText,
  Flag,
  MailPlus,
  MapPin,
  Pencil,
  Radio,
  Settings2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { isAcceptedProposalStatus } from "../../shared/proposal-status";
import { isOutstandingTaskStatus } from "../../shared/task-status";
import { EmptyState, Field, InlineAlert, PageHeader, ProgressBar, SectionHeading, StatusPill } from "../components";
import { conferenceApi } from "../api";
import { useDialogA11y } from "../dialog-a11y";
import { controlRoomExceptions } from "../control-room-exceptions";
import {
  dateTimeLocalToInstant,
  formatEventDateRange,
  formatEventDateTime,
  formatShortDate,
  instantToDateTimeLocal,
  timeZoneAbbreviation,
} from "../event-time";
import { privateEventPath } from "../private-routes";
import { organizerTrialSteps } from "../trial-checklist";
import { useWorkspace } from "../workspace";

function EventSettingsDialog({ onClose }: { onClose: () => void }) {
  const { workspace, updateEvent } = useWorkspace();
  const dialogRef = useDialogA11y<HTMLFormElement>(onClose);
  const [draft, setDraft] = useState(workspace.event);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const updateLocalInstant = (field: "startsAt" | "endsAt" | "cfpClosesAt", value: string) => {
    try {
      setDraft({ ...draft, [field]: dateTimeLocalToInstant(value, draft.timezone) });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Choose a valid event time.");
    }
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        ref={dialogRef}
        className="drawer drawer--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-settings-title"
        tabIndex={-1}
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
          <Field label="Event name"><input data-dialog-initial-focus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
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
            <Field label="Starts"><input type="datetime-local" value={instantToDateTimeLocal(draft.startsAt, draft.timezone)} onChange={(event) => updateLocalInstant("startsAt", event.target.value)} /></Field>
            <Field label="Ends"><input type="datetime-local" value={instantToDateTimeLocal(draft.endsAt, draft.timezone)} onChange={(event) => updateLocalInstant("endsAt", event.target.value)} /></Field>
            <Field label="CFP closes"><input type="datetime-local" value={instantToDateTimeLocal(draft.cfpClosesAt, draft.timezone)} onChange={(event) => updateLocalInstant("cfpClosesAt", event.target.value)} /></Field>
          </div>
          <Field label="Event website"><input type="url" value={draft.websiteUrl} onChange={(event) => setDraft({ ...draft, websiteUrl: event.target.value })} /></Field>
          <div className="brand-swatches" aria-label="Event accent color">
            {["#e05b3f", "#2d6a6c", "#7564a8", "#bd8b2f"].map((color) => (
              <button key={color} type="button" className={draft.accent === color ? "selected" : ""} style={{ background: color }} onClick={() => setDraft({ ...draft, accent: color })} aria-label={`Use ${color} as event accent`} aria-pressed={draft.accent === color} />
            ))}
          </div>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
        <div className="drawer__foot"><button type="button" className="button button--quiet" onClick={onClose} disabled={saving}>Cancel</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save event details"}</button></div>
      </form>
    </div>
  );
}

function StaffInviteDialog({ onClose }: { onClose: () => void }) {
  const { workspace, setNotice } = useWorkspace();
  const dialogRef = useDialogA11y<HTMLFormElement>(onClose);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"reviewer" | "organizer">("reviewer");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        ref={dialogRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="staff-invite-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          setSending(true);
          setError("");
          try {
            const invitation = await conferenceApi.inviteStaff(
              workspace.actor.id,
              workspace.event.id,
              { email: email.trim(), role },
            );
            setNotice(`Invitation queued for ${invitation.email}. It expires in seven days.`);
            onClose();
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : "The staff invitation could not be queued.");
          } finally {
            setSending(false);
          }
        }}
      >
        <div className="drawer__head">
          <div><p className="eyebrow">Event team</p><h2 id="staff-invite-title">Invite a collaborator</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close staff invitation"><X size={18} /></button>
        </div>
        <div className="drawer__body form-stack">
          <p className="muted">The invitation is delivered through the durable message queue. After a reviewer accepts, assign their tracks in Program setup → Review routing.</p>
          <Field label="Email address"><input data-dialog-initial-focus required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="reviewer@example.com" /></Field>
          <Field label="Event role"><select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="reviewer">Reviewer</option><option value="organizer">Organizer</option></select></Field>
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
        </div>
        <div className="drawer__foot"><button type="button" className="button button--quiet" onClick={onClose} disabled={sending}>Cancel</button><button className="button button--primary" type="submit" disabled={sending || !email.trim()}>{sending ? "Queuing…" : "Queue invitation"}</button></div>
      </form>
    </div>
  );
}

export function ControlRoom() {
  const { workspace, privateWorkspaceEventId } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const inviteActive = inviteOpen || searchParams.get("action") === "invite-staff";
  const closeInvite = () => {
    setInviteOpen(false);
    if (searchParams.get("action") === "invite-staff") {
      const next = new URLSearchParams(searchParams);
      next.delete("action");
      setSearchParams(next, { replace: true });
    }
  };
  const acceptedProposals = workspace.proposals.filter((proposal) => proposal.eventId === eventId && isAcceptedProposalStatus(proposal.status));
  const accepted = acceptedProposals.length;
  const acceptedSpeakers = [...new Map(acceptedProposals.flatMap((proposal) => proposal.speakers).map((speaker) => [speaker.id, speaker])).values()];
  const acceptedSpeakerIds = new Set(acceptedSpeakers.map((speaker) => speaker.id));
  const reviewPending = workspace.proposals.filter((proposal) => ["submitted", "under_review"].includes(proposal.status)).length;
  const unscheduled = workspace.sessions.filter((session) => session.status === "unscheduled").length;
  const openTasks = workspace.tasks.filter((task) => task.eventId === eventId && acceptedSpeakerIds.has(task.speakerId) && isOutstandingTaskStatus(task.status));
  const overdueTasks = openTasks.filter((task) => task.status === "overdue");
  const incompleteProfiles = acceptedSpeakers.filter((speaker) => !speaker.profileComplete);
  const interventionItems = controlRoomExceptions(eventId, overdueTasks, incompleteProfiles, unscheduled);
  const primaryIntervention = interventionItems[0];
  const now = new Date().toISOString();
  const currentWeekday = new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: workspace.event.timezone }).format(new Date(now));
  const trialSteps = organizerTrialSteps(workspace, eventId);
  const completedTrialSteps = trialSteps.filter((step) => step.complete).length;

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    workspace.proposals.forEach((proposal) => counts.set(proposal.category, (counts.get(proposal.category) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [workspace.proposals]);

  const phases = [
    {
      marker: "NOW",
      date: formatShortDate(now, workspace.event.timezone),
      title: "Review the evidence",
      detail: `${reviewPending} proposals still need a committee signal before decisions lock.`,
      action: "Open review desk",
      to: privateEventPath("/reviews", eventId),
      tone: "rust",
      icon: FileText,
    },
    {
      marker: "NEXT",
      date: formatShortDate(workspace.event.cfpClosesAt, workspace.event.timezone),
      title: "Close the call",
      detail: `CFP closes ${formatEventDateTime(workspace.event.cfpClosesAt, workspace.event.timezone)}. Review saved drafts and plan outreach 48 hours before.`,
      action: "Check form rules",
      to: privateEventPath("/forms", eventId),
      tone: "ochre",
      icon: Clock3,
    },
    {
      marker: "THEN",
      date: formatShortDate(workspace.event.startsAt, workspace.event.timezone),
      title: "Lock the room grid",
      detail: `${accepted} accepted sessions, ${unscheduled} still waiting for a room and start time.`,
      action: "Open schedule board",
      to: privateEventPath("/schedule", eventId),
      tone: "teal",
      icon: CalendarClock,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={`Program control room · ${currentWeekday} shift`}
        title="The conference is a living system."
        description="One operational view of what needs judgment now, what is waiting on people, and what the public will see next."
        actions={<><a className="button button--quiet" href="/conference-ops-organizer-trial-guide.pdf" target="_blank" rel="noreferrer"><FileText size={16} /> Organizer guide</a><Link className="button button--quiet" to="/events/new"><Sparkles size={16} /> New event</Link><button type="button" className="button button--quiet" onClick={() => setInviteOpen(true)}><MailPlus size={16} /> Invite staff</button><button type="button" className="button button--quiet" onClick={() => setSettingsOpen(true)}><Settings2 size={16} /> Event details</button></>}
      />

      <section className="event-brief" aria-label="Current event details">
        <div className="event-brief__title"><span className="live-dot" /> <strong>{workspace.event.name}</strong><StatusPill status={workspace.event.status} /></div>
        <div><MapPin size={15} /> {workspace.event.venue}</div>
        <div><CalendarClock size={15} /> {formatEventDateRange(workspace.event)} · {timeZoneAbbreviation(workspace.event.startsAt, workspace.event.timezone)}</div>
        <button type="button" onClick={() => setSettingsOpen(true)}><Pencil size={14} /> Edit</button>
      </section>

      <section className="trial-runway" aria-labelledby="trial-runway-title">
        <div className="trial-runway__intro">
          <p className="eyebrow">Organizer trial runway</p>
          <h2 id="trial-runway-title">Run one complete event loop.</h2>
          <p>Use your own event data. Each completed step reflects committed workspace state, so you can leave, reload, and continue later.</p>
          <ProgressBar label={`${completedTrialSteps} of ${trialSteps.length} steps complete`} value={completedTrialSteps} max={trialSteps.length} />
        </div>
        <ol className="trial-runway__steps">
          {trialSteps.map((step, index) => (
            <li key={step.id} className={step.complete ? "complete" : ""}>
              <span className="trial-runway__marker" aria-hidden="true">{step.complete ? <CheckCircle2 size={15} /> : String(index + 1).padStart(2, "0")}</span>
              <span><strong>{step.label}</strong><small>{step.detail}</small></span>
              <Link to={step.to} target={step.external ? "_blank" : undefined} rel={step.external ? "noreferrer" : undefined} aria-label={`${step.label}: ${step.detail}`}><ArrowUpRight size={15} /></Link>
            </li>
          ))}
        </ol>
        <div className="trial-runway__foot"><Flag size={16} /><span><strong>Use the guide as your test script.</strong> Credentials and private invitation links should be shared separately.</span></div>
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
          <div className="call-sheet__footer"><Radio size={16} /><span>Committed workflow actions update this workspace immediately; other open workspaces refresh automatically about every 25 seconds.</span></div>
        </section>

        <aside className="risk-ledger" aria-labelledby="risk-title">
          <SectionHeading title="Needs intervention" description="Exceptions before they become day-of problems." />
          <div className="risk-ledger__count"><strong>{overdueTasks.length + incompleteProfiles.length + unscheduled}</strong><span>open exceptions</span></div>
          <div className="risk-list">
            {interventionItems.map((item) => {
              const Icon = item.kind === "task" ? AlertCircle : item.kind === "profile" ? Users : CalendarClock;
              return <Link to={item.to} key={item.key}><Icon size={16} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronMini /></Link>;
            })}
          </div>
          {primaryIntervention && <Link to={primaryIntervention.to} className="button button--dark button--full">{primaryIntervention.action}</Link>}
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
                  <div><strong>{activity.actor}</strong> {activity.action} <b>{activity.target}</b><small>{formatEventDateTime(activity.at, workspace.event.timezone)}</small></div>
                </li>
              ))}
            </ol>
          ) : <EmptyState title="No desk notes yet" detail="Material decisions and operational changes will appear here." />}
        </section>
      </div>
      {settingsOpen && <EventSettingsDialog onClose={() => setSettingsOpen(false)} />}
      {inviteActive && <StaffInviteDialog onClose={closeInvite} />}
    </>
  );
}

function ChevronMini() {
  return <ArrowUpRight size={14} aria-hidden="true" />;
}
