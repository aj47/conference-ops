import {
  ArrowUpRight,
  CalendarCheck,
  Check,
  CircleDashed,
  CloudUpload,
  Download,
  Eye,
  FileJson,
  MailCheck,
  Radio,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { CommunicationKind, ConferenceExportKind } from "../api";
import { conferenceApi } from "../api";
import { Field, InlineAlert, PageHeader, ProgressBar, SectionHeading, StatusPill } from "../components";
import { useWorkspace } from "../workspace";

type RecipientGroup = "accepted" | "incomplete" | "all";

function unique(values: string[]) {
  return [...new Set(values)];
}

function batches(values: string[], size = 50) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

function templatePreview(kind: CommunicationKind, eventName: string) {
  if (kind === "acceptance") {
    return {
      subject: `You’re speaking at ${eventName}`,
      message: "Hi [speaker], your proposal has been accepted. Sign in to review your onboarding tasks.",
    };
  }
  if (kind === "calendar") {
    return {
      subject: `Your ${eventName} session: [session title]`,
      message: "Your session has been scheduled. The message includes a calendar invitation with a stable UID.",
    };
  }
  return {
    subject: `Speaker task reminder · ${eventName}`,
    message: "Hi [speaker], you have outstanding speaker tasks. Sign in to complete them.",
  };
}

export function PublishCenter() {
  const { workspace, builder, setNotice, publishAgenda } = useWorkspace();
  const [agendaRevision, setAgendaRevision] = useState(2);
  const [agendaLive, setAgendaLive] = useState(workspace.event.status === "agenda_published");
  const [agendaPublishing, setAgendaPublishing] = useState(false);
  const [kind, setKind] = useState<CommunicationKind>("acceptance");
  const [recipients, setRecipients] = useState<RecipientGroup>("accepted");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [calendarSending, setCalendarSending] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ConferenceExportKind | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const accepted = workspace.proposals.filter((proposal) => proposal.status === "accepted");
  const allSpeakerIds = unique(workspace.proposals.flatMap((proposal) => proposal.speakers.map((speaker) => speaker.id)));
  const knownSpeakerIds = new Set(allSpeakerIds);
  const acceptedSpeakerIds = unique(accepted.flatMap((proposal) => proposal.speakers.map((speaker) => speaker.id)));
  const openTaskSpeakerIds = unique(
    workspace.tasks
      .filter((task) => task.status !== "complete" && task.status !== "waived" && knownSpeakerIds.has(task.speakerId))
      .map((task) => task.speakerId),
  );
  const recipientIds = recipients === "accepted" ? acceptedSpeakerIds : recipients === "incomplete" ? openTaskSpeakerIds : allSpeakerIds;
  const calendarSpeakerIds = unique(
    workspace.sessions
      .filter((session) => session.status === "scheduled" || session.status === "published")
      .flatMap((session) => session.speakerIds)
      .filter((speakerId) => knownSpeakerIds.has(speakerId)),
  );
  const preview = templatePreview(kind, workspace.event.name);
  const readiness = [
    { label: "CFP confirmation email", ready: builder.confirmationEnabled, to: "/forms" },
    { label: "Accepted speaker profiles", ready: accepted.every((proposal) => proposal.speakers.every((speaker) => speaker.profileComplete)), to: "/speaker-ops" },
    { label: "Accepted sessions on grid", ready: accepted.every((proposal) => workspace.sessions.some((session) => session.proposalId === proposal.id && session.status !== "unscheduled")), to: "/schedule" },
    { label: "Published speaker resources", ready: workspace.resources.some((resource) => resource.status === "published"), to: "/speaker-ops" },
  ];
  const readyCount = readiness.filter((item) => item.ready).length;

  const queueMessage = async () => {
    if (!recipientIds.length) {
      setSendError("No speaker profiles match this recipient group.");
      return;
    }
    setSending(true);
    setSendError(null);
    const operationId = crypto.randomUUID();
    try {
      const results = await Promise.all(
        batches(recipientIds).map((recipientBatch, index) =>
          conferenceApi.sendCommunication(workspace.actor.id, workspace.event.id, {
            kind,
            recipientIds: recipientBatch,
            idempotencyKey: `${operationId}:${index + 1}`,
          }),
        ),
      );
      const queued = results.reduce((total, result) => total + result.queued, 0);
      setNotice(`${queued} ${kind} ${queued === 1 ? "message" : "messages"} queued for delivery.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The communication batch could not be queued.";
      setSendError(message);
      setNotice(message);
    } finally {
      setSending(false);
    }
  };

  const downloadExport = async (exportKind: ConferenceExportKind) => {
    setExporting(exportKind);
    setExportError(null);
    try {
      const { blob, fileName } = await conferenceApi.downloadExport(
        workspace.actor.id,
        workspace.event.id,
        exportKind,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setNotice(`${fileName} downloaded from the current workspace snapshot.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The export could not be downloaded.";
      setExportError(message);
      setNotice(message);
    } finally {
      setExporting(null);
    }
  };

  const queueCalendarInvitations = async () => {
    if (!calendarSpeakerIds.length) {
      setCalendarError("Schedule at least one speaker session before queuing calendar invitations.");
      return;
    }
    setCalendarSending(true);
    setCalendarError(null);
    const operationId = crypto.randomUUID();
    try {
      const results = await Promise.all(
        batches(calendarSpeakerIds).map((recipientBatch, index) =>
          conferenceApi.sendCommunication(workspace.actor.id, workspace.event.id, {
            kind: "calendar",
            recipientIds: recipientBatch,
            idempotencyKey: `${operationId}:${index + 1}`,
          }),
        ),
      );
      const queued = results.reduce((total, result) => total + result.queued, 0);
      setNotice(`${queued} calendar ${queued === 1 ? "invitation" : "invitations"} queued for scheduled sessions.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Calendar invitations could not be queued.";
      setCalendarError(message);
      setNotice(message);
    } finally {
      setCalendarSending(false);
    }
  };

  return (
    <>
      <PageHeader eyebrow="Publication desk · Controlled release" title="Make the public promise match operations." description="Publish immutable agenda revisions, queue transactional communication, and export the same records downstream." actions={<Link to="/agenda" className="button button--quiet"><Eye size={16} /> Public preview</Link>} />
      <div className="publish-readiness">
        <div><p className="eyebrow">Release readiness</p><strong>{readyCount}/{readiness.length}</strong><ProgressBar label="Checks passing" value={readyCount} max={readiness.length} /></div>
        <div className="readiness-checks">{readiness.map((item) => <Link key={item.label} to={item.to} className={item.ready ? "ready" : "blocked"}>{item.ready ? <Check size={15} /> : <CircleDashed size={15} />}<span>{item.label}</span><ArrowUpRight size={13} /></Link>)}</div>
      </div>
      <div className="publish-grid">
        <section className="paper-panel publish-agenda">
          <SectionHeading title="Agenda revision" description="A release is a frozen public snapshot, not the live editor state." action={<StatusPill status={agendaLive ? "published" : "draft"} />} />
          <div className="revision-ticket"><div><span>REVISION</span><strong>R{agendaRevision}</strong></div><div><span>SESSIONS</span><strong>{workspace.sessions.filter((session) => session.status !== "unscheduled").length}</strong></div><div><span>ROOMS</span><strong>{workspace.rooms.length}</strong></div><div><span>UPDATED</span><strong>08 AUG / 09:42</strong></div></div>
          <InlineAlert tone={readyCount === readiness.length ? "info" : "warning"}>{readyCount === readiness.length ? "All release checks pass. This revision is safe to publish." : `${readiness.length - readyCount} release checks need attention. You may still publish a draft preview, but the public release remains guarded.`}</InlineAlert>
          <div className="button-row"><button type="button" className="button button--quiet" onClick={() => setNotice("Private agenda preview link copied.")}><Eye size={15} /> Preview revision</button><button type="button" className="button button--primary" onClick={async () => { setAgendaPublishing(true); try { await publishAgenda(); setAgendaLive(true); setAgendaRevision((value) => value + 1); } finally { setAgendaPublishing(false); } }} disabled={readyCount !== readiness.length || agendaLive || agendaPublishing}><Radio size={15} /> {agendaPublishing ? "Publishing…" : agendaLive ? `R${agendaRevision - 1} is public` : `Publish R${agendaRevision}`}</button></div>
        </section>

        <section className="paper-panel communications-composer">
          <SectionHeading title="Communications queue" description="Each send is durable, retryable, and tracked by an idempotency key." action={<MailCheck size={19} />} />
          <div className="field-grid field-grid--2"><Field label="Message"><select value={kind} onChange={(event) => { setKind(event.target.value as CommunicationKind); setSendError(null); }}><option value="acceptance">Acceptance & next steps</option><option value="reminder">Outstanding task reminder</option><option value="calendar">Calendar update</option></select></Field><Field label="Recipients"><select value={recipients} onChange={(event) => { setRecipients(event.target.value as RecipientGroup); setSendError(null); }}><option value="accepted">Accepted speakers</option><option value="incomplete">People with open tasks</option><option value="all">All submitters</option></select></Field></div>
          <Field label="Template subject" hint="This is the operational template currently configured by the server."><input value={preview.subject} readOnly /></Field>
          <Field label="Template message"><textarea rows={5} value={preview.message} readOnly /></Field>
          {sendError && <InlineAlert tone="danger">{sendError}</InlineAlert>}
          <div className="send-proof"><ShieldCheck size={16} /><span><strong>{recipientIds.length} unique {recipientIds.length === 1 ? "recipient" : "recipients"}</strong><small>Resolved by speaker profile ID · batches are capped at 50 recipients</small></span></div>
          <button type="button" className="button button--dark button--full" disabled={sending || recipientIds.length === 0} onClick={() => void queueMessage()}><Send size={16} /> {sending ? "Queuing…" : `Queue ${recipientIds.length} ${recipientIds.length === 1 ? "message" : "messages"}`}</button>
        </section>

        <section className="paper-panel integration-panel">
          <SectionHeading title="Accelevents handoff" description="API publishing is opportunistic; inspectable export is always available." action={<CloudUpload size={19} />} />
          <div className="integration-state"><span className="integration-state__mark">AE</span><div><strong>Manual action required</strong><p>Enterprise API entitlement has not been confirmed. No remote records were changed.</p></div></div>
          {exportError && <InlineAlert tone="danger">{exportError}</InlineAlert>}
          <div className="export-list"><button type="button" disabled={exporting !== null} onClick={() => void downloadExport("speakers.csv")}><Users size={16} /><span><strong>Speakers.csv</strong><small>{allSpeakerIds.length} unique records</small></span><Download size={15} /></button><button type="button" disabled={exporting !== null} onClick={() => void downloadExport("program.json")}><FileJson size={16} /><span><strong>Program.json</strong><small>{workspace.sessions.length} sessions plus speaker and event records</small></span><Download size={15} /></button></div>
        </section>

        <section className="paper-panel calendar-panel">
          <SectionHeading title="Calendar delivery" description="Create, reschedule, and cancel with one stable invitation identity." action={<CalendarCheck size={19} />} />
          <ol className="delivery-steps"><li className="done"><Check size={14} /><span><strong>UIDs assigned</strong><small>Stable across every update</small></span></li><li className="done"><Check size={14} /><span><strong>Sequences calculated</strong><small>Revision changes increment</small></span></li><li><CircleDashed size={14} /><span><strong>{calendarSpeakerIds.length} speakers selected</strong><small>Only speakers on scheduled or published sessions</small></span></li></ol>
          {calendarError && <InlineAlert tone="danger">{calendarError}</InlineAlert>}
          <button type="button" className="button button--quiet button--full" disabled={calendarSending || calendarSpeakerIds.length === 0} onClick={() => void queueCalendarInvitations()}><Send size={15} /> {calendarSending ? "Queuing invitations…" : `Queue calendar invitations (${calendarSpeakerIds.length})`}</button>
        </section>
      </div>
    </>
  );
}
