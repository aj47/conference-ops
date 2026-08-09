import type { Bindings } from "./env";
import {
  airtableAuthorityPromotionBlockersForRow,
  type AirtableAuthorityReadinessRow,
} from "../jobs/airtable-sync";

export type ReadinessCheck = "configuration" | "database" | "airtable" | "realtime";

export interface ReadinessResult {
  ready: boolean;
  checks: Record<ReadinessCheck, "ok" | "failed" | "skipped">;
  failedCheck?: ReadinessCheck;
  detail?: string;
}

function origin(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function configurationIssues(env: Bindings) {
  const issues: string[] = [];
  const publicUrl = origin(env.PUBLIC_APP_URL);
  const authUrl = origin(env.BETTER_AUTH_URL);

  if (!env.DB) issues.push("DB binding is missing");
  if (!env.UPLOADS) issues.push("UPLOADS binding is missing");
  if (!env.JOBS_QUEUE) issues.push("JOBS_QUEUE binding is missing");
  if (!env.REALTIME) issues.push("REALTIME binding is missing");
  if (!env.REALTIME_TOKEN || env.REALTIME_TOKEN.length < 32) issues.push("REALTIME_TOKEN is missing or too short");
  if (!publicUrl) issues.push("PUBLIC_APP_URL must be an origin");
  if (!authUrl) issues.push("BETTER_AUTH_URL must be an origin");
  if (publicUrl && authUrl && publicUrl.origin !== authUrl.origin) issues.push("PUBLIC_APP_URL and BETTER_AUTH_URL must match");
  if (env.ENVIRONMENT !== "local" && publicUrl?.protocol !== "https:") issues.push("PUBLIC_APP_URL must use HTTPS outside local development");
  if (env.ENVIRONMENT === "production" && env.DEMO_MODE !== "false") issues.push("Production cannot run in demo mode");

  return issues;
}

export function hasReadinessAuthorization(header: string | undefined, token: string | undefined) {
  return Boolean(token && token.length >= 32 && header === `Bearer ${token}`);
}

export async function probeReadiness(env: Bindings): Promise<ReadinessResult> {
  const checks: ReadinessResult["checks"] = { configuration: "failed", database: "skipped", airtable: "skipped", realtime: "skipped" };
  const issues = configurationIssues(env);
  if (issues.length) return { ready: false, checks, failedCheck: "configuration", detail: issues.join("; ") };
  checks.configuration = "ok";

  try {
    const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    if (Number(row?.ok) !== 1) throw new Error("D1 did not return the readiness sentinel");
    checks.database = "ok";
  } catch (error) {
    return { ready: false, checks, failedCheck: "database", detail: error instanceof Error ? error.message : String(error) };
  }

  try {
    const authoritative = await env.DB.prepare(`SELECT event_id, enabled, status, webhook_id, webhook_expires_at,
        last_reconciled_at, reconciliation_started_at,
        (SELECT COUNT(*) FROM airtable_change_queue WHERE connection_id = airtable_connections.id AND status IN ('queued', 'processing', 'failed')) AS pending_changes,
        (SELECT COUNT(*) FROM airtable_change_queue WHERE connection_id = airtable_connections.id AND status = 'dead') AS dead_changes,
        (SELECT COUNT(*) FROM airtable_conflicts WHERE connection_id = airtable_connections.id AND status = 'open') AS open_conflicts
      FROM airtable_connections WHERE authority = 'airtable'`)
      .all<AirtableAuthorityReadinessRow>();
    const integrationExpected = env.AIRTABLE_ENABLED === "true" || env.AIRTABLE_AUTHORITY_DEFAULT === "airtable" || authoritative.results.length > 0;
    if (integrationExpected) {
      const blockers = authoritative.results.flatMap((row) => airtableAuthorityPromotionBlockersForRow(row));
      if (authoritative.results.length && env.AIRTABLE_ENABLED !== "true") blockers.unshift("Airtable is authoritative while synchronization is disabled");
      if (env.AIRTABLE_AUTHORITY_DEFAULT === "airtable" && authoritative.results.length === 0) blockers.push("Airtable is configured as the default authority but no authoritative connection exists");
      if (blockers.length) throw new Error(blockers.join("; "));
      checks.airtable = "ok";
    }
  } catch (error) {
    checks.airtable = "failed";
    return { ready: false, checks, failedCheck: "airtable", detail: error instanceof Error ? error.message : String(error) };
  }

  try {
    const response = await env.REALTIME!.fetch(new Request("https://realtime.internal/health", {
      headers: { authorization: `Bearer ${env.REALTIME_TOKEN}` },
    }));
    const payload = await response.json().catch(() => null) as { status?: string } | null;
    if (!response.ok || payload?.status !== "ok") throw new Error(`Realtime readiness returned HTTP ${response.status}`);
    checks.realtime = "ok";
  } catch (error) {
    return { ready: false, checks, failedCheck: "realtime", detail: error instanceof Error ? error.message : String(error) };
  }

  return { ready: true, checks };
}
