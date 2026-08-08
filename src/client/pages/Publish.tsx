import {
  ArrowUpRight,
  CalendarCheck,
  Check,
  CircleDashed,
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
import { projectConferenceExport } from "../../shared/conference-export";
import { isAcceptedProposalStatus } from "../../shared/proposal-status";
import type { CommunicationKind, ConferenceExportKind } from "../api";
import type { MessageTemplateDefinition } from "../../shared/domain";
import { conferenceApi } from "../api";
import { Field, InlineAlert, PageHeader, ProgressBar, SectionHeading, StatusPill } from "../components";
import { privateEventPath } from "../private-routes";
import { publicAgendaPath } from "../public-routes";
import { useWorkspace } from "../workspace";

type MessageKind = Exclude<CommunicationKind, "calendar">;

function unique(values: string[]) {
  return [...new Set(values)];
}

function batches(values: string[], size = 50) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

function templatePreview(kind: CommunicationKind, eventName: string, templates: MessageTemplateDefinition[]) {
  const configured = templates.find((template) => template.kind === kind);
  if (configured) {
    const variables: Record<string, string> = {
      "event.name": eventName,
      "speaker.name": "[speaker]",
      "proposal.title": "[proposal title]",
      "decision.feedback": "[organizer feedback]",
      "speaker.portal_url": "[speaker portal link]",
      "task.count": "[open task count]",
      "session.title": "[session title]",
      "session.room": "[room]",
    };
    const render = (value: string) => Object.entries(variables).reduce(
      (result, [key, replacement]) => result.replaceAll(`{{${key}}}`, replacement),
      value,
    );
    return { subject: render(configured.subject), message: render(configured.text) };
  }
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
  const { workspace, setNotice, publishAgenda, privateWorkspaceEventId } = useWorkspace();
  const eventId = privateWorkspaceEventId ?? workspace.event.id;
  const [agendaPublishing, setAgendaPublishing] = useState(false);
  const [kind, setKind] = useState<MessageKind>("acceptance");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [calendarSending, setCalendarSending] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<ConferenceExportKind | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const accepted = workspace.proposals.filter((proposal) =>
    proposal.eventId === workspace.event.id && isAcceptedProposalStatus(proposal.status));
  const exportProjection = projectConferenceExport(workspace);
  const exportedSpeakerCount = exportProjection.speakers.length;
  const exportedSessionCount = exportProjection.sessions.length;
  const acceptedSpeakerIds = unique(accepted.flatMap((proposal) => proposal.speakers.map((speaker) => speaker.id)));
  const acceptedSpeakerIdSet = new Set(acceptedSpeakerIds);
  const openTaskSpeakerIds = unique(
    workspace.tasks
      .filter((task) => task.status !== "complete" && task.status !== "waived" && acceptedSpeakerIdSet.has(task.speakerId))
      .map((task) => task.speakerId),
  );
  const recipientIds = kind === "acceptance" ? acceptedSpeakerIds : openTaskSpeakerIds;
  const recipientLabel = kind === "acceptance" ? "Accepted speakers" : "People with open tasks";
  const calendarSpeakerIds = unique(
    exportProjection.sessions.flatMap((session) => session.speakerIds),
  );
  const publishedSessionCount = workspace.sessions.filter((session) => session.status === "published").length;
  const pendingAgendaCount = workspace.sessions.filter((session) => session.status === "scheduled").length;
  const agendaLive = workspace.event.status === "agenda_published" || publishedSessionCount > 0;
  const hasPendingAgendaAdditions = pendingAgendaCount > 0;
  const preview = templatePreview(kind, workspace.event.name, workspace.messageTemplates ?? []);
  const readiness = [
    { label: "Accepted speaker profiles", ready: accepted.every((proposal) => proposal.speakers.every((speaker) => speaker.profileComplete)), to: privateEventPath("/speaker-ops", eventId) },
    { label: "Accepted sessions on grid", ready: accepted.every((proposal) => workspace.sessions.some((session) => session.proposalId === proposal.id && session.status !== "unscheduled")), to: privateEventPath("/schedule", eventId) },
  ];
  const readyCount = readiness.filter((item) => item.ready).length;
  const agendaPath = publicAgendaPath(workspace.event.slug);

  const copyAgendaPreview = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${agendaPath}`);
      setNotice("Agenda preview link copied.");
    } catch {
      setNotice("Could not copy the agenda link. Open Public preview and copy the address from your browser.");
    }
  };

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
      <PageHeader eyebrow="Publication desk · Controlled release" title="Make the public promise match operations." description="Release scheduled additions to the public agenda, queue transactional communication, and export the same records downstream." actions={<Link to={agendaPath} className="button button--quiet"><Eye size={16} /> Public preview</Link>} />
      <div className="publish-readiness">
        <div><p className="eyebrow">Release readiness</p><strong>{readyCount}/{readiness.length}</strong><ProgressBar label="Checks passing" value={readyCount} max={readiness.length} /></div>
        <div className="readiness-checks">{readiness.map((item) => <Link key={item.label} to={item.to} className={item.ready ? "ready" : "blocked"}>{item.ready ? <Check size={15} /> : <CircleDashed size={15} />}<span>{item.label}</span><ArrowUpRight size={13} /></Link>)}</div>
      </div>
      <div className="publish-grid">
        <section className="paper-panel publish-agenda">
          <SectionHeading title="Agenda release" description="Publishing adds scheduled sessions. Rescheduling a published session updates the live program immediately." action={<StatusPill status={agendaLive && hasPendingAgendaAdditions ? "additions pending" : agendaLive ? "published" : "draft"} />} />
          <div className="revision-ticket"><div><span>PUBLIC</span><strong>{publishedSessionCount}</strong></div><div><span>TO PUBLISH</span><strong>{pendingAgendaCount}</strong></div><div><span>ROOMS</span><strong>{workspace.rooms.length}</strong></div><div><span>LIVE EDITS</span><strong>Immediate</strong></div></div>
          <InlineAlert tone={readyCount === readiness.length ? "info" : "warning"}>{readyCount === readiness.length ? "All release checks pass. Scheduled additions are ready to publish." : `${readiness.length - readyCount} release checks need attention before scheduled additions can go public. Already-published session edits remain live.`}</InlineAlert>
          <div className="button-row"><button type="button" className="button button--quiet" onClick={() => void copyAgendaPreview()}><Eye size={15} /> Copy preview link</button><button type="button" className="button button--primary" onClick={async () => { setAgendaPublishing(true); try { await publishAgenda(); } finally { setAgendaPublishing(false); } }} disabled={readyCount !== readiness.length || (agendaLive && !hasPendingAgendaAdditions) || agendaPublishing}><Radio size={15} /> {agendaPublishing ? "Publishing…" : agendaLive && !hasPendingAgendaAdditions ? "Agenda is live" : agendaLive ? `Publish ${pendingAgendaCount} ${pendingAgendaCount === 1 ? "addition" : "additions"}` : "Publish agenda"}</button></div>
        </section>

        <section className="paper-panel communications-composer">
          <SectionHeading title="Communications queue" description="Each send is durable, retryable, and tracked by an idempotency key." action={<MailCheck size={19} />} />
          <div className="field-grid field-grid--2"><Field label="Message"><select value={kind} onChange={(event) => { setKind(event.target.value as MessageKind); setSendError(null); }}><option value="acceptance">Acceptance follow-up</option><option value="reminder">Outstanding task reminder</option></select></Field><Field label="Eligible audience" hint="Audience rules prevent accidental sends to ineligible speakers."><input value={recipientLabel} readOnly /></Field></div>
          <Field label="Template subject" hint="Edit this operational template in Program setup → Communications."><input value={preview.subject} readOnly /></Field>
          <Field label="Template message"><textarea rows={5} value={preview.message} readOnly /></Field>
          {sendError && <InlineAlert tone="danger">{sendError}</InlineAlert>}
          <div className="send-proof"><ShieldCheck size={16} /><span><strong>{recipientIds.length} unique {recipientIds.length === 1 ? "recipient" : "recipients"}</strong><small>Resolved by speaker profile ID · batches are capped at 50 recipients</small></span></div>
          <button type="button" className="button button--dark button--full" disabled={sending || recipientIds.length === 0} onClick={() => void queueMessage()}><Send size={16} /> {sending ? "Queuing…" : `Queue ${recipientIds.length} ${recipientIds.length === 1 ? "message" : "messages"}`}</button>
        </section>

        <section className="paper-panel integration-panel">
          <SectionHeading title="Safe program exports" description="Download the accepted speakers and scheduled or public sessions approved for downstream use." action={<Download size={19} />} />
          <div className="integration-state"><span className="integration-state__mark">CSV</span><div><strong>Portable handoff</strong><p>The pilot deliberately skips third-party event-platform sync. These scoped exports remain the reliable handoff.</p></div></div>
          {exportError && <InlineAlert tone="danger">{exportError}</InlineAlert>}
          <div className="export-list"><button type="button" disabled={exporting !== null} onClick={() => void downloadExport("speakers.csv")}><Users size={16} /><span><strong>Speakers.csv</strong><small>{exportedSpeakerCount} approved {exportedSpeakerCount === 1 ? "speaker" : "speakers"}</small></span><Download size={15} /></button><button type="button" disabled={exporting !== null} onClick={() => void downloadExport("sessions.csv")}><CalendarCheck size={16} /><span><strong>Sessions.csv</strong><small>{exportedSessionCount} scheduled or public {exportedSessionCount === 1 ? "session" : "sessions"}</small></span><Download size={15} /></button><button type="button" disabled={exporting !== null} onClick={() => void downloadExport("program.json")}><FileJson size={16} /><span><strong>Program.json</strong><small>{exportedSessionCount} {exportedSessionCount === 1 ? "session" : "sessions"} plus {exportedSpeakerCount} approved {exportedSpeakerCount === 1 ? "speaker" : "speakers"}</small></span><Download size={15} /></button></div>
        </section>

        <section className="paper-panel calendar-panel">
          <SectionHeading title="Calendar delivery" description="Create invitations and resend schedule updates with one stable invitation identity." action={<CalendarCheck size={19} />} />
          <ol className="delivery-steps"><li className="done"><Check size={14} /><span><strong>UIDs assigned</strong><small>Stable across every update</small></span></li><li className="done"><Check size={14} /><span><strong>Sequences calculated</strong><small>Invite-field revisions increment</small></span></li><li><CircleDashed size={14} /><span><strong>{calendarSpeakerIds.length} speakers selected</strong><small>Only speakers on scheduled or published sessions</small></span></li></ol>
          {calendarError && <InlineAlert tone="danger">{calendarError}</InlineAlert>}
          <button type="button" className="button button--quiet button--full" disabled={calendarSending || calendarSpeakerIds.length === 0} onClick={() => void queueCalendarInvitations()}><Send size={15} /> {calendarSending ? "Queuing invitations…" : `Queue calendar invitations (${calendarSpeakerIds.length})`}</button>
        </section>
      </div>
    </>
  );
}
