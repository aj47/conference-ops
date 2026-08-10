import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  CircleOff,
  Database,
  RefreshCw,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AirtableOperatorHealth, AirtableOperatorStatus } from "../shared/domain";
import { conferenceApi } from "./api";
import { InlineAlert } from "./components";
import { useWorkspace } from "./workspace";

const healthCopy: Record<AirtableOperatorHealth, { label: string; title: string; detail: string }> = {
  healthy: {
    label: "Healthy",
    title: "The guarded mirror is operating normally.",
    detail: "Use the authority rail below to see which system currently owns business records.",
  },
  degraded: {
    label: "Attention required",
    title: "The connector needs operator attention.",
    detail: "Keep workflow changes in the current authority until reconciliation is clean.",
  },
  disabled: {
    label: "Disabled",
    title: "Airtable sync is not active for this environment.",
    detail: "D1 remains the source of truth until the server-side connector is commissioned.",
  },
};

function formatTime(value: string | null, timezone: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(value));
}

function sourceRole(status: AirtableOperatorStatus, source: "d1" | "airtable") {
  if (status.authority === source) return "Source of truth";
  if (source === "airtable" && !status.configured) return "Not connected";
  return "Validated mirror";
}

export function AirtableStatusCard({
  status,
  timezone,
  refreshing,
  onRefresh,
}: {
  status: AirtableOperatorStatus;
  timezone: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const copy = healthCopy[status.health];
  const HealthIcon = status.health === "healthy" ? CheckCircle2 : status.health === "degraded" ? AlertTriangle : CircleOff;
  const webhookLabel = status.sync.webhook.replaceAll("_", " ");
  const clientTitle = status.health === "healthy" && status.authority === "airtable"
    ? "Airtable is connected and current."
    : status.health === "healthy"
      ? "Airtable is a current, validated mirror."
      : copy.title;
  const clientDetail = status.health === "healthy"
    ? "Client-safe business records are synchronized. Keep operating the event normally; Conference Ops handles validation, workflow actions, files, authentication, and delivery."
    : copy.detail;

  return (
    <article className="airtable-operator" data-health={status.health} aria-labelledby="airtable-status-title">
      <header className="airtable-operator__status">
        <span className="airtable-operator__signal" aria-hidden="true"><HealthIcon size={20} /></span>
        <div>
          <span className="airtable-health-label">{status.health === "healthy" ? "Connected and current" : copy.label}</span>
          <h3 id="airtable-status-title">{clientTitle}</h3>
          <p>{clientDetail}</p>
        </div>
        <button type="button" className="button button--quiet" aria-busy={refreshing} onClick={() => { if (!refreshing) onRefresh(); }}>
          <RefreshCw className={refreshing ? "spin" : undefined} size={15} />
          {refreshing ? "Refreshing…" : "Refresh status"}
        </button>
      </header>

      <div className="airtable-client-proof" aria-label="Airtable synchronization proof">
        <div><small>Business source</small><strong>{status.authority === "airtable" ? "Airtable" : "Conference Ops"}</strong><span>{status.authority === "airtable" ? "Edits flow into the event workflow" : "Airtable mirrors validated event records"}</span></div>
        <div><small>Last app → Airtable</small><strong>{formatTime(status.sync.lastPushAt, timezone)}</strong><span>Most recent reflected workflow change</span></div>
        <div><small>Last Airtable → app</small><strong>{formatTime(status.sync.lastPullAt, timezone)}</strong><span>Most recent accepted source edit</span></div>
      </div>

      <details className="airtable-diagnostics">
        <summary><span><ShieldCheck size={16} /> Platform diagnostics</span><span>Authority rail, reconciliation, and webhook status <ChevronDown size={15} /></span></summary>
        <div className="airtable-diagnostics__body">
      <div className="airtable-authority" aria-label={`${status.authority === "airtable" ? "Airtable" : "D1"} is the current source of truth`}>
        <div className={status.authority === "d1" ? "airtable-authority__node active" : "airtable-authority__node"}>
          <Database size={20} aria-hidden="true" />
          <span><small>{sourceRole(status, "d1")}</small><strong>D1 workflow store</strong><em>Validation, transactions, app reads</em></span>
        </div>
        <div className={`airtable-authority__bridge${status.authority === "airtable" ? " airtable-authority__bridge--reverse" : ""}`}>
          <ArrowRight size={19} aria-hidden="true" />
          <span>{status.enabled ? "Guarded sync" : "Connector off"}</span>
        </div>
        <div className={status.authority === "airtable" ? "airtable-authority__node active" : "airtable-authority__node"}>
          <span className="airtable-authority__airtable-mark" aria-hidden="true">A</span>
          <span><small>{sourceRole(status, "airtable")}</small><strong>Airtable records</strong><em>Business data and audited commands</em></span>
        </div>
      </div>

      <div className="airtable-operator__grid">
        <section className="airtable-ledger" aria-labelledby="airtable-ledger-title">
          <div className="section-heading"><div><p className="eyebrow">Operational ledger</p><h3 id="airtable-ledger-title">Sync evidence</h3></div><span className="airtable-scope">{status.connection.scope === "event" ? "This event" : status.connection.scope === "environment" ? "Environment connector" : "No connection"}</span></div>
          <dl>
            <div><dt>Connection</dt><dd>{status.connection.state.replaceAll("_", " ")}{status.connection.schemaVersion ? ` · schema v${status.connection.schemaVersion}` : ""}</dd></div>
            <div><dt>D1 → Airtable</dt><dd>{formatTime(status.sync.lastPushAt, timezone)}</dd></div>
            <div><dt>Airtable → D1</dt><dd>{formatTime(status.sync.lastPullAt, timezone)}</dd></div>
            <div><dt>Full reconcile</dt><dd>{formatTime(status.sync.lastReconciledAt, timezone)}</dd></div>
            <div><dt><Webhook size={13} aria-hidden="true" /> Webhook</dt><dd><span className={`airtable-webhook airtable-webhook--${status.sync.webhook}`}>{webhookLabel}</span>{status.sync.webhookExpiresAt ? ` · renews by ${formatTime(status.sync.webhookExpiresAt, timezone)}` : ""}</dd></div>
          </dl>
          {status.workload.scope === "event" ? (
            <div className="airtable-workload" aria-label="Event-scoped synchronization workload">
              <div><strong>{status.workload.pending}</strong><span>Pending / retrying</span></div>
              <div data-alert={Boolean(status.workload.dead)}><strong>{status.workload.dead}</strong><span>Dead changes</span></div>
              <div data-alert={Boolean(status.workload.openConflicts)}><strong>{status.workload.openConflicts}</strong><span>Open conflicts</span></div>
            </div>
          ) : (
            <p className="airtable-workload-note"><ShieldCheck size={15} aria-hidden="true" /> {status.connection.scope === "environment"
              ? "Environment-wide queue and conflict details are intentionally hidden from event organizers. Escalate an Attention required state to the platform operator using the Airtable runbook."
              : "Queue and conflict details become available only to the platform operator after the environment connector is commissioned."}</p>
          )}
        </section>

        <aside className="airtable-guidance" data-mode={status.guidance.mode} aria-labelledby="airtable-guidance-title">
          <p className="eyebrow">Operator next step</p>
          <h3 id="airtable-guidance-title">{status.guidance.title}</h3>
          <p>{status.guidance.detail}</p>
          <ol>{status.guidance.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <p className="airtable-guidance__boundary"><ShieldCheck size={15} aria-hidden="true" /> Tokens, webhook secrets, raw records, queue details, and cross-event totals are never returned to this screen. Event organizers escalate degraded states; they do not resolve connector work here.</p>
        </aside>
      </div>
        </div>
      </details>
      <footer>Generated {formatTime(status.generatedAt, timezone)} · Read-only operator status</footer>
    </article>
  );
}

export function AirtablePanel() {
  const { workspace } = useWorkspace();
  const [status, setStatus] = useState<AirtableOperatorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const next = await conferenceApi.airtableStatus(workspace.actor.id, workspace.event.id);
      if (request === requestSequence.current) setStatus(next);
    } catch (caught) {
      if (request === requestSequence.current) setError(caught instanceof Error ? caught.message : "Airtable status could not be loaded.");
    } finally {
      if (request === requestSequence.current) setLoading(false);
    }
  }, [workspace.actor.id, workspace.event.id]);

  useEffect(() => {
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  return (
    <section className="program-config-panel">
      <div className="program-config-panel__head"><div><p className="eyebrow">Airtable source</p><h2>See that the event and the base agree.</h2><p>The client view leads with source-of-truth and last-sync proof. Platform diagnostics stay available below without exposing credentials, raw records, or cross-event operations.</p></div></div>
      {error && <InlineAlert tone="danger"><span className="delivery-history-error"><span>{error}</span><button type="button" className="button button--quiet" onClick={() => void load()}>Try again</button></span></InlineAlert>}
      {loading && !status && <div className="airtable-operator-loading" role="status"><RefreshCw className="spin" size={18} /> Reading protected connector status…</div>}
      {status && <AirtableStatusCard status={status} timezone={workspace.event.timezone} refreshing={loading} onRefresh={() => void load()} />}
    </section>
  );
}
