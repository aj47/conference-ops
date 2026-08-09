import type { AirtableOperatorStatus } from "../shared/domain";
import type { Bindings } from "./env";

type ConnectionState = AirtableOperatorStatus["connection"]["state"];

interface AirtableConnectionStatusRow {
  id: string;
  event_id: string | null;
  authority: "d1" | "airtable";
  enabled: number;
  status: Exclude<ConnectionState, "not_configured">;
  schema_version: number;
  webhook_configured: number;
  webhook_expires_at: number | string | null;
  last_push_at: number | string | null;
  last_pull_at: number | string | null;
  last_reconciled_at: number | string | null;
}

interface AirtableWorkloadRow {
  pending: number;
  dead: number;
}

interface AirtableConflictRow {
  open_conflicts: number;
}

function timestampToIso(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function webhookState(configured: boolean, expiresAt: string | null, now: number): AirtableOperatorStatus["sync"]["webhook"] {
  if (!configured || !expiresAt) return "not_configured";
  const remaining = new Date(expiresAt).getTime() - now;
  if (remaining <= 0) return "expired";
  return remaining <= 24 * 60 * 60 * 1_000 ? "expiring" : "active";
}

function guidanceFor(status: Pick<AirtableOperatorStatus, "configured" | "enabled" | "health" | "authority">): AirtableOperatorStatus["guidance"] {
  if (status.health === "degraded") {
    return {
      mode: "recover",
      title: status.authority === "airtable" ? "Restore the mirror before more Airtable edits" : "Keep D1 authoritative while the connector recovers",
      detail: "A degraded connector can leave the workflow mirror stale. Investigate it from the server and Jobs Worker; this browser never accepts integration secrets.",
      steps: [
        "Verify the server-side Airtable configuration, Jobs Worker secret, and webhook renewal.",
        "Resolve dead changes and open conflicts, then run a full reconciliation.",
        "Confirm a clean push and pull before selecting Airtable as the source of truth.",
      ],
    };
  }
  if (!status.configured || !status.enabled) {
    return {
      mode: "commission",
      title: "Commission the connector server-side",
      detail: "Start with D1 authority. Provision the restricted Airtable base and credentials outside the browser, then prove the mirror before cutover.",
      steps: [
        "Provision the Records and Workflow Commands tables with a base-scoped token.",
        "Store the token and webhook MAC only in Worker secret storage, then enable the connection with D1 authority.",
        "Run a full reconciliation and validate event counts, hashes, push, pull, and webhook health.",
        "Switch authority only after the reconciliation is clean.",
      ],
    };
  }
  if (status.authority === "d1") {
    return {
      mode: "validate",
      title: "Validate the mirror before cutover",
      detail: "D1 still owns the business record. Airtable may be promoted only after a clean environment-wide reconciliation and platform-operator review.",
      steps: [
        "Confirm the latest full reconciliation completed after the most recent workflow change.",
        "Have the platform operator verify there are no pending or dead changes and no open conflicts.",
        "Compare canonical record hashes and counts, then use the audited authority command to cut over.",
      ],
    };
  }
  return {
    mode: "operate",
    title: "Operate Airtable as the guarded source of truth",
    detail: "Allowed descriptive edits flow from Airtable into D1. Identity, permissions, deletes, and lifecycle transitions still require validated app workflows or audited Workflow Commands.",
    steps: [
      "Use Conference Ops Records for allowlisted descriptive edits.",
      "Use Workflow Commands for supported lifecycle changes; do not hard-delete canonical rows.",
      "Escalate any Attention required state; the platform operator owns dead changes, conflicts, and reconciliation.",
    ],
  };
}

export function projectAirtableOperatorStatus(input: {
  envEnabled: boolean;
  authorityDefault?: "d1" | "airtable";
  connection?: AirtableConnectionStatusRow | null;
  workload?: AirtableWorkloadRow | null;
  conflicts?: AirtableConflictRow | null;
  now?: number;
}): AirtableOperatorStatus {
  const now = input.now ?? Date.now();
  const candidate = input.connection ?? null;
  const connection = candidate?.event_id === null ? candidate : null;
  const configured = connection !== null;
  const enabled = input.envEnabled && Boolean(connection?.enabled);
  const authority = connection?.authority ?? input.authorityDefault ?? "d1";
  const scope = connection ? "environment" : "none";
  const lastPushAt = timestampToIso(connection?.last_push_at);
  const lastPullAt = timestampToIso(connection?.last_pull_at);
  const lastReconciledAt = timestampToIso(connection?.last_reconciled_at);
  const webhookExpiresAt = timestampToIso(connection?.webhook_expires_at);
  const webhook = webhookState(Boolean(connection?.webhook_configured), webhookExpiresAt, now);
  const internalDead = Number(input.workload?.dead ?? 0);
  const internalOpenConflicts = Number(input.conflicts?.open_conflicts ?? 0);
  const connectionHealthy = connection?.status === "healthy";
  const webhookHealthy = webhook === "active" || webhook === "expiring";
  const health: AirtableOperatorStatus["health"] = !enabled
    ? authority === "airtable" ? "degraded" : "disabled"
    : connectionHealthy && webhookHealthy && internalDead === 0 && internalOpenConflicts === 0
      ? "healthy"
      : "degraded";
  const core = { configured, enabled, health, authority };

  return {
    ...core,
    connection: {
      scope,
      state: connection?.status ?? "not_configured",
      schemaVersion: connection?.schema_version ?? null,
    },
    sync: { lastPushAt, lastPullAt, lastReconciledAt, webhook, webhookExpiresAt },
    workload: {
      scope: "unavailable",
      pending: null,
      dead: null,
      openConflicts: null,
    },
    guidance: guidanceFor(core),
    generatedAt: new Date(now).toISOString(),
  };
}

export async function loadAirtableOperatorStatus(env: Bindings, _eventId: string, now = Date.now()) {
  const connection = await env.DB.prepare(`SELECT id, event_id, authority, enabled, status, schema_version,
      CASE WHEN webhook_id IS NULL THEN 0 ELSE 1 END AS webhook_configured,
      webhook_expires_at, last_push_at, last_pull_at, last_reconciled_at
    FROM airtable_connections
    WHERE event_id IS NULL
    ORDER BY enabled DESC, created_at
    LIMIT 1`)
    .first<AirtableConnectionStatusRow>();

  let workload: AirtableWorkloadRow | null = null;
  let conflicts: AirtableConflictRow | null = null;
  if (connection) {
    [workload, conflicts] = await Promise.all([
      env.DB.prepare(`SELECT
          COALESCE(SUM(CASE WHEN status IN ('queued', 'processing', 'failed') THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN status = 'dead' THEN 1 ELSE 0 END), 0) AS dead
        FROM airtable_change_queue WHERE connection_id = ?`)
        .bind(connection.id).first<AirtableWorkloadRow>(),
      env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END), 0) AS open_conflicts
        FROM airtable_conflicts WHERE connection_id = ?`)
        .bind(connection.id).first<AirtableConflictRow>(),
    ]);
  }

  return projectAirtableOperatorStatus({
    envEnabled: env.AIRTABLE_ENABLED === "true",
    authorityDefault: env.AIRTABLE_AUTHORITY_DEFAULT,
    connection,
    workload,
    conflicts,
    now,
  });
}
