import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Mail,
  RefreshCw,
} from "lucide-react";
import type {
  CommunicationDelivery,
  CommunicationDeliveryKind,
  CommunicationDeliveryStatus,
} from "../shared/domain";
import { EmptyState, InlineAlert } from "./components";

const kindLabels: Record<CommunicationDeliveryKind, string> = {
  submission_confirmation: "Submission confirmation",
  acceptance: "Acceptance decision",
  rejection: "Decline decision",
  revision_request: "Change request",
  reminder: "Speaker task reminder",
  draft_reminder: "CFP draft reminder",
  calendar: "Calendar invitation",
  staff_invitation: "Staff invitation",
  operational_email: "Operational email",
};

const statusLabels: Record<CommunicationDeliveryStatus, string> = {
  queued: "Queued",
  processing: "Delivering",
  sent: "Sent",
  failed: "Retrying",
  dead: "Stopped",
};

function formatDeliveryTime(value: string, timezone: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(date);
}

function DeliveryRow({ delivery, timezone }: { delivery: CommunicationDelivery; timezone: string }) {
  const Icon = delivery.transport === "calendar" ? CalendarClock : Mail;
  const attemptLabel = delivery.attempts === 0 ? "No attempts yet" : `${delivery.attempts} ${delivery.attempts === 1 ? "attempt" : "attempts"}`;
  return (
    <li className="delivery-ledger__row" data-status={delivery.status}>
      <span className="delivery-ledger__rail" aria-hidden="true"><Icon size={15} /></span>
      <div className="delivery-ledger__message">
        <div className="delivery-ledger__title-line">
          <span className="delivery-kind">{kindLabels[delivery.kind]}</span>
          <h4>{delivery.subject}</h4>
        </div>
        <p>{delivery.recipientName ? <><strong>{delivery.recipientName}</strong><span aria-hidden="true"> · </span></> : null}{delivery.recipient}</p>
        <dl className="delivery-ledger__timestamps">
          <div><dt>Queued</dt><dd><time dateTime={delivery.createdAt}>{formatDeliveryTime(delivery.createdAt, timezone)}</time></dd></div>
          <div><dt>Updated</dt><dd><time dateTime={delivery.updatedAt}>{formatDeliveryTime(delivery.updatedAt, timezone)}</time></dd></div>
          {delivery.sentAt && <div><dt>Delivered</dt><dd><time dateTime={delivery.sentAt}>{formatDeliveryTime(delivery.sentAt, timezone)}</time></dd></div>}
        </dl>
        {delivery.lastError && <p className="delivery-ledger__error"><AlertTriangle size={14} aria-hidden="true" /><span><strong>Last delivery error</strong>{delivery.lastError}</span></p>}
      </div>
      <div className="delivery-ledger__state">
        <span className={`delivery-state delivery-state--${delivery.status}`}>{statusLabels[delivery.status]}</span>
        <small>{attemptLabel}</small>
      </div>
    </li>
  );
}

export function CommunicationDeliveryHistory({
  deliveries,
  loading,
  error,
  timezone,
  onRefresh,
}: {
  deliveries: CommunicationDelivery[];
  loading: boolean;
  error: string | null;
  timezone: string;
  onRefresh: () => void;
}) {
  const sent = deliveries.filter((delivery) => delivery.status === "sent").length;
  const inFlight = deliveries.filter((delivery) => delivery.status === "queued" || delivery.status === "processing").length;
  const attention = deliveries.filter((delivery) => delivery.status === "failed" || delivery.status === "dead").length;
  return (
    <section className="communication-history" aria-labelledby="communication-history-title">
      <header className="communication-history__head">
        <div><p className="eyebrow">Durable delivery ledger</p><h3 id="communication-history-title">What was sent, to whom, and what happened.</h3><p>Showing the latest 100 event-scoped email and calendar deliveries. Message bodies and provider credentials stay private.</p></div>
        <button type="button" className="button button--quiet" aria-disabled={loading} onClick={() => { if (!loading) onRefresh(); }}><RefreshCw className={loading ? "spin" : undefined} size={15} /> {loading ? "Refreshing…" : "Refresh history"}</button>
      </header>
      <div className="delivery-summary" aria-label="Delivery status summary">
        <div><CheckCircle2 size={16} aria-hidden="true" /><span><strong>{sent}</strong> sent</span></div>
        <div><Clock3 size={16} aria-hidden="true" /><span><strong>{inFlight}</strong> in flight</span></div>
        <div><AlertTriangle size={16} aria-hidden="true" /><span><strong>{attention}</strong> need attention</span></div>
      </div>
      {error && <InlineAlert tone="danger"><div className="delivery-history-error"><span>{error}</span><button type="button" className="button button--quiet" onClick={onRefresh}>Try again</button></div></InlineAlert>}
      {loading && deliveries.length === 0 && <div className="delivery-history-loading" role="status"><RefreshCw className="spin" size={17} /><span>Loading the delivery ledger…</span></div>}
      {!loading && !error && deliveries.length === 0 && <EmptyState title="No communications queued yet" detail="Acceptance notices, task reminders, calendar invitations, and other workflow messages will appear here after they enter the durable queue." />}
      {deliveries.length > 0 && <ol className="delivery-ledger">{deliveries.map((delivery) => <DeliveryRow key={delivery.id} delivery={delivery} timezone={timezone} />)}</ol>}
    </section>
  );
}
