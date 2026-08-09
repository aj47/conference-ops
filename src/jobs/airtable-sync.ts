import type { Bindings } from "../server/env";
import {
  AIRTABLE_COMMAND_FIELDS,
  AIRTABLE_ENTITY_REGISTRY,
  AIRTABLE_RECORD_FIELDS,
  airtableEntity,
  validateAirtableRemoteValue,
  type AirtableEntityDefinition,
} from "../shared/airtable-schema";
import { AirtableClient, AirtableHttpError, AirtableRateLimitError, airtableRequestsPerSecond, type AirtableFields, type AirtableRecord } from "./airtable-client";

const MAX_CHANGE_ATTEMPTS = 5;
const CHANGE_LEASE_MS = 10 * 60 * 1_000;

interface ConnectionRow {
  id: string;
  event_id: string | null;
  base_id: string;
  records_table_id: string;
  commands_table_id: string;
  authority: "d1" | "airtable";
  enabled: number;
  status: "provisioning" | "syncing" | "healthy" | "degraded" | "blocked" | "disabled";
  webhook_id: string | null;
  webhook_cursor: number;
  webhook_expires_at: number | null;
  last_reconciled_at: number | null;
  reconciliation_started_at: number | null;
}

interface ChangeRow {
  id: string;
  connection_id: string;
  entity_type: string;
  local_key: string;
  operation: "upsert" | "tombstone";
  attempts: number;
  generation: number;
}

interface RecordMapRow {
  airtable_record_id: string;
  last_local_hash: string | null;
  last_remote_hash: string | null;
  last_synced_at: number;
}

interface RemoteRecordMapRow extends RecordMapRow {
  entity_type: string;
  local_key: string;
}

interface PreparedRecord {
  change: ChangeRow;
  entity: AirtableEntityDefinition;
  externalKey: string;
  hash: string;
  fields: AirtableFields;
  existingMap: RecordMapRow | null;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function normalizedJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return [...value];
  if (Array.isArray(value)) return value.map(normalizedJsonValue);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizedJsonValue(entry)]));
  }
  return String(value);
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(normalizedJsonValue(value));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function quote(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function parseLocalKey(entity: AirtableEntityDefinition, localKey: string) {
  let values: unknown;
  try {
    values = JSON.parse(localKey);
  } catch {
    throw new Error(`Invalid local key for ${entity.entityType}`);
  }
  if (!Array.isArray(values) || values.length !== entity.keyColumns.length || values.some((value) => typeof value !== "string" && typeof value !== "number")) {
    throw new Error(`Invalid local key cardinality for ${entity.entityType}`);
  }
  return values as Array<string | number>;
}

function selectSql(entity: AirtableEntityDefinition) {
  const columns = entity.selectColumns?.map(quote).join(", ") ?? "*";
  const where = entity.keyColumns.map((column) => `${quote(column)} = ?`).join(" AND ");
  return `SELECT ${columns} FROM ${quote(entity.tableName)} WHERE ${where}`;
}

async function loadLocalRow(db: D1Database, entity: AirtableEntityDefinition, localKey: string) {
  const values = parseLocalKey(entity, localKey);
  return db.prepare(selectSql(entity)).bind(...values).first<Record<string, unknown>>();
}

async function eventIdForRow(db: D1Database, entity: AirtableEntityDefinition, localKey: string, row: Record<string, unknown>) {
  if (entity.eventIdColumn) return row[entity.eventIdColumn] === null || row[entity.eventIdColumn] === undefined ? "" : String(row[entity.eventIdColumn]);
  if (!entity.eventIdSql) return "";
  const result = await db.prepare(entity.eventIdSql).bind(...parseLocalKey(entity, localKey)).first<{ event_id: string | null }>();
  return result?.event_id ?? "";
}

function displayName(entity: AirtableEntityDefinition, row: Record<string, unknown>, localKey: string) {
  const parts = entity.displayColumns.map((column) => row[column]).filter((value) => value !== null && value !== undefined && String(value).trim());
  return parts.length ? parts.map(String).join(" · ").slice(0, 500) : `${entity.entityType} ${localKey}`;
}

function sourceUpdatedAt(entity: AirtableEntityDefinition, row: Record<string, unknown>) {
  const candidate = row.updated_at ?? row.created_at ?? (entity.sourceVersionColumn ? row[entity.sourceVersionColumn] : undefined);
  if (typeof candidate === "number" && Number.isFinite(candidate)) return new Date(candidate).toISOString();
  if (candidate instanceof Date) return candidate.toISOString();
  const date = candidate === null || candidate === undefined ? null : new Date(String(candidate));
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
}

function externalKey(entityType: string, localKey: string) {
  return `${entityType}:${localKey}`;
}

export function parseExternalKey(value: string) {
  const separator = value.indexOf(":");
  if (separator <= 0) return null;
  const entityType = value.slice(0, separator);
  const localKey = value.slice(separator + 1);
  const entity = airtableEntity(entityType);
  if (!entity) return null;
  try {
    parseLocalKey(entity, localKey);
    return { entity, localKey };
  } catch {
    return null;
  }
}

async function recordMap(db: D1Database, change: Pick<ChangeRow, "connection_id" | "entity_type" | "local_key">) {
  return db.prepare(`SELECT airtable_record_id, last_local_hash, last_remote_hash, last_synced_at
    FROM airtable_record_maps WHERE connection_id = ? AND entity_type = ? AND local_key = ?`)
    .bind(change.connection_id, change.entity_type, change.local_key)
    .first<RecordMapRow>();
}

async function recordMapByRemoteId(db: D1Database, connectionId: string, airtableRecordId: string) {
  return db.prepare(`SELECT entity_type, local_key, airtable_record_id, last_local_hash, last_remote_hash, last_synced_at
    FROM airtable_record_maps WHERE connection_id = ? AND airtable_record_id = ?`)
    .bind(connectionId, airtableRecordId).first<RemoteRecordMapRow>();
}

async function prepareRecord(db: D1Database, change: ChangeRow, now: number): Promise<PreparedRecord> {
  const entity = airtableEntity(change.entity_type);
  if (!entity) throw new Error(`Unknown Airtable entity type: ${change.entity_type}`);
  const existingMap = await recordMap(db, change);
  const row = change.operation === "tombstone" ? null : await loadLocalRow(db, entity, change.local_key);
  const deleted = !row;
  const payload = row ? normalizedJsonValue(row) : {};
  const hash = await sha256(canonicalJson({ entityType: entity.entityType, localKey: change.local_key, deleted, payload }));
  const fields: AirtableFields = {
    [AIRTABLE_RECORD_FIELDS.externalKey]: externalKey(entity.entityType, change.local_key),
    [AIRTABLE_RECORD_FIELDS.entityType]: entity.entityType,
    [AIRTABLE_RECORD_FIELDS.eventId]: row ? await eventIdForRow(db, entity, change.local_key, row) : "",
    [AIRTABLE_RECORD_FIELDS.displayName]: row ? displayName(entity, row, change.local_key) : `${entity.entityType} deleted`,
    [AIRTABLE_RECORD_FIELDS.payloadJson]: canonicalJson(payload),
    [AIRTABLE_RECORD_FIELDS.deleted]: deleted,
    [AIRTABLE_RECORD_FIELDS.sourceVersion]: row && entity.sourceVersionColumn && row[entity.sourceVersionColumn] !== undefined ? String(row[entity.sourceVersionColumn]) : "",
    [AIRTABLE_RECORD_FIELDS.syncHash]: hash,
    [AIRTABLE_RECORD_FIELDS.lastSyncedAt]: new Date(now).toISOString(),
  };
  const updatedAt = row ? sourceUpdatedAt(entity, row) : undefined;
  if (updatedAt) fields[AIRTABLE_RECORD_FIELDS.sourceUpdatedAt] = updatedAt;
  return { change, entity, externalKey: String(fields[AIRTABLE_RECORD_FIELDS.externalKey]), hash, fields, existingMap };
}

function clientForConnection(env: Bindings, connection: ConnectionRow) {
  if (!env.AIRTABLE_TOKEN) throw new Error("AIRTABLE_TOKEN is not configured for the Jobs Worker");
  if (env.AIRTABLE_BASE_ID && env.AIRTABLE_BASE_ID !== connection.base_id) throw new Error("The enabled Airtable connection does not match AIRTABLE_BASE_ID");
  return new AirtableClient({
    token: env.AIRTABLE_TOKEN,
    baseId: connection.base_id,
    requestsPerSecond: airtableRequestsPerSecond(env.AIRTABLE_MAX_REQUESTS_PER_SECOND),
  });
}

async function markChangeFailure(db: D1Database, change: ChangeRow, error: unknown, now: number) {
  const attempts = change.attempts + 1;
  const dead = attempts >= MAX_CHANGE_ATTEMPTS || error instanceof AirtableHttpError && !error.retryable;
  const retryAfterMs = error instanceof AirtableRateLimitError ? error.retryAfterMs : Math.min(15 * 60_000, 15_000 * 2 ** attempts);
  const message = error instanceof Error ? error.message : String(error);
  const result = await db.prepare(`UPDATE airtable_change_queue SET status = ?, attempts = ?, available_at = ?, lease_expires_at = NULL,
      last_error = ?, updated_at = ? WHERE id = ? AND generation = ? AND status = 'processing'`)
    .bind(dead ? "dead" : "failed", attempts, now + retryAfterMs, message.slice(0, 2_000), now, change.id, change.generation)
    .run();
  if (!result.meta.changes) return false;
  await db.prepare(`UPDATE airtable_connections SET status = ?, last_error = ?, updated_at = ? WHERE id = ?`)
    .bind(dead ? "blocked" : "degraded", message.slice(0, 2_000), now, change.connection_id)
    .run();
  return true;
}

async function finishPreparedRecord(db: D1Database, prepared: PreparedRecord, remote: AirtableRecord, now: number) {
  await db.batch([
    db.prepare(`INSERT INTO airtable_record_maps
      (connection_id, entity_type, local_key, airtable_record_id, last_local_hash, last_remote_hash, last_synced_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
        airtable_record_id = excluded.airtable_record_id, last_local_hash = excluded.last_local_hash,
        last_remote_hash = excluded.last_remote_hash, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`)
      .bind(prepared.change.connection_id, prepared.change.entity_type, prepared.change.local_key, remote.id, prepared.hash, prepared.hash, now, now),
    db.prepare("DELETE FROM airtable_change_queue WHERE id = ? AND generation = ? AND status = 'processing'")
      .bind(prepared.change.id, prepared.change.generation),
  ]);
}

async function connectionById(db: D1Database, connectionId: string) {
  return db.prepare(`SELECT id, event_id, base_id, records_table_id, commands_table_id, authority, enabled, status, webhook_id,
      webhook_cursor, webhook_expires_at, last_reconciled_at, reconciliation_started_at
      FROM airtable_connections WHERE id = ? AND enabled = 1 AND event_id IS NULL`)
    .bind(connectionId).first<ConnectionRow>();
}

async function completeDrainedReconciliations(db: D1Database, connectionId: string | undefined, now: number) {
  return db.prepare(`UPDATE airtable_connections
    SET last_reconciled_at = ?, reconciliation_started_at = NULL,
      status = CASE
        WHEN EXISTS (SELECT 1 FROM airtable_conflicts WHERE connection_id = airtable_connections.id AND status = 'open') THEN 'blocked'
        ELSE 'healthy'
      END,
      last_error = CASE
        WHEN EXISTS (SELECT 1 FROM airtable_conflicts WHERE connection_id = airtable_connections.id AND status = 'open')
          THEN COALESCE(last_error, 'Airtable synchronization has unresolved conflicts.')
        ELSE NULL
      END,
      updated_at = ?
    WHERE reconciliation_started_at IS NOT NULL
      AND event_id IS NULL
      AND (? IS NULL OR id = ?)
      AND NOT EXISTS (SELECT 1 FROM airtable_change_queue WHERE connection_id = airtable_connections.id)`)
    .bind(now, now, connectionId ?? null, connectionId ?? null).run();
}

async function markConnectionSyncSuccess(db: D1Database, connectionId: string, now: number, activity: "push" | "pull") {
  const timestampColumn = activity === "push" ? "last_push_at" : "last_pull_at";
  await db.prepare(`UPDATE airtable_connections SET ${timestampColumn} = ?,
      status = CASE
        WHEN EXISTS (SELECT 1 FROM airtable_change_queue WHERE connection_id = airtable_connections.id AND status = 'dead')
          OR EXISTS (SELECT 1 FROM airtable_conflicts WHERE connection_id = airtable_connections.id AND status = 'open') THEN 'blocked'
        WHEN EXISTS (SELECT 1 FROM airtable_change_queue WHERE connection_id = airtable_connections.id AND status = 'failed') THEN 'degraded'
        WHEN reconciliation_started_at IS NOT NULL THEN 'syncing'
        ELSE 'healthy'
      END,
      last_error = CASE
        WHEN EXISTS (SELECT 1 FROM airtable_change_queue WHERE connection_id = airtable_connections.id AND status = 'dead')
          OR EXISTS (SELECT 1 FROM airtable_conflicts WHERE connection_id = airtable_connections.id AND status = 'open')
          THEN COALESCE(last_error, 'Airtable synchronization has unresolved work.')
        WHEN EXISTS (SELECT 1 FROM airtable_change_queue WHERE connection_id = airtable_connections.id AND status = 'failed')
          THEN COALESCE(last_error, 'Airtable synchronization has changes waiting to retry.')
        ELSE NULL
      END,
      updated_at = ? WHERE id = ?`)
    .bind(now, now, connectionId).run();
}

export async function drainAirtableChanges(env: Bindings, options: { connectionId?: string; limit?: number; now?: number } = {}) {
  if (env.AIRTABLE_ENABLED !== "true") return { claimed: 0, synced: 0, echoed: 0, failed: 0 };
  const now = options.now ?? Date.now();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const due = await env.DB.prepare(`SELECT id, connection_id, entity_type, local_key, operation, attempts, generation
    FROM airtable_change_queue
    WHERE available_at <= ? AND attempts < ? AND (? IS NULL OR connection_id = ?)
      AND EXISTS (SELECT 1 FROM airtable_connections
        WHERE id = airtable_change_queue.connection_id AND enabled = 1 AND event_id IS NULL)
      AND (status IN ('queued', 'failed') OR (status = 'processing' AND lease_expires_at <= ?))
    ORDER BY available_at, created_at LIMIT ?`)
    .bind(now, MAX_CHANGE_ATTEMPTS, options.connectionId ?? null, options.connectionId ?? null, now, limit)
    .all<ChangeRow>();
  const claimed: ChangeRow[] = [];
  for (const row of due.results) {
    const result = await env.DB.prepare(`UPDATE airtable_change_queue SET status = 'processing', lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND generation = ? AND (status IN ('queued', 'failed') OR (status = 'processing' AND lease_expires_at <= ?))`)
      .bind(now + CHANGE_LEASE_MS, now, row.id, row.generation, now).run();
    if (result.meta.changes) claimed.push(row);
  }

  let synced = 0;
  let echoed = 0;
  let failed = 0;
  const changesByConnection = new Map<string, ChangeRow[]>();
  for (const change of claimed) changesByConnection.set(change.connection_id, [...(changesByConnection.get(change.connection_id) ?? []), change]);
  for (const [connectionId, changes] of changesByConnection) {
    const connection = await connectionById(env.DB, connectionId);
    if (!connection) {
      for (const change of changes) failed += await markChangeFailure(env.DB, change, new Error("Airtable connection is disabled or missing"), now) ? 1 : 0;
      continue;
    }
    const client = clientForConnection(env, connection);
    for (let index = 0; index < changes.length; index += 10) {
      const slice = changes.slice(index, index + 10);
      try {
        const prepared = await Promise.all(slice.map((change) => prepareRecord(env.DB, change, now)));
        const outbound: PreparedRecord[] = [];
        for (const record of prepared) {
          if (record.existingMap?.airtable_record_id && record.existingMap.last_remote_hash === record.hash) {
            await env.DB.batch([
              env.DB.prepare(`UPDATE airtable_record_maps SET last_local_hash = ?, last_synced_at = ?, updated_at = ?
                WHERE connection_id = ? AND entity_type = ? AND local_key = ?`)
                .bind(record.hash, now, now, record.change.connection_id, record.change.entity_type, record.change.local_key),
              env.DB.prepare("DELETE FROM airtable_change_queue WHERE id = ? AND generation = ? AND status = 'processing'")
                .bind(record.change.id, record.change.generation),
            ]);
            echoed += 1;
          } else {
            outbound.push(record);
          }
        }
        if (!outbound.length) continue;
        const responses = await client.upsertRecords(connection.records_table_id, outbound.map((record) => ({ fields: record.fields })), AIRTABLE_RECORD_FIELDS.externalKey);
        const remoteRecords = responses.flatMap((response) => response.records);
        if (remoteRecords.length !== outbound.length) throw new Error("Airtable returned an incomplete upsert response");
        const remoteByExternalKey = new Map(remoteRecords.map((record) => [String(record.fields[AIRTABLE_RECORD_FIELDS.externalKey] ?? ""), record]));
        for (const record of outbound) {
          const remote = remoteByExternalKey.get(record.externalKey);
          if (!remote) throw new Error(`Airtable omitted the canonical record for ${record.externalKey}`);
          await finishPreparedRecord(env.DB, record, remote, now);
          synced += 1;
        }
        await markConnectionSyncSuccess(env.DB, connection.id, now, "push");
      } catch (error) {
        for (const change of slice) failed += await markChangeFailure(env.DB, change, error, now) ? 1 : 0;
      }
    }
  }
  await completeDrainedReconciliations(env.DB, options.connectionId, now);
  return { claimed: claimed.length, synced, echoed, failed };
}

export async function enqueueFullAirtableReconciliation(db: D1Database, connectionId: string, now = Date.now()) {
  const supported = await db.prepare("SELECT id FROM airtable_connections WHERE id = ? AND enabled = 1 AND event_id IS NULL")
    .bind(connectionId).first<{ id: string }>();
  if (!supported) throw new Error("Airtable reconciliation requires the enabled environment-wide connector");
  let enqueued = 0;
  for (const entity of AIRTABLE_ENTITY_REGISTRY) {
    const columns = entity.keyColumns.map(quote).join(", ");
    const rows = await db.prepare(`SELECT ${columns} FROM ${quote(entity.tableName)}`).all<Record<string, unknown>>();
    for (const row of rows.results) {
      const localKey = JSON.stringify(entity.keyColumns.map((column) => row[column]));
      const result = await db.prepare(`INSERT INTO airtable_change_queue
        (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'upsert', 'queued', 0, 1, ?, ?, ?)
        ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET operation = 'upsert', status = 'queued',
          attempts = 0, generation = airtable_change_queue.generation + 1, available_at = excluded.available_at,
          lease_expires_at = NULL, last_error = NULL, updated_at = excluded.updated_at`)
        .bind(crypto.randomUUID(), connectionId, entity.entityType, localKey, now, now, now).run();
      enqueued += result.meta.changes ? 1 : 0;
    }
  }
  await db.prepare("UPDATE airtable_connections SET status = 'syncing', reconciliation_started_at = ?, updated_at = ? WHERE id = ?")
    .bind(now, now, connectionId).run();
  return enqueued;
}

export function resolveAirtableAuthority(authority: "d1" | "airtable", selfEcho: boolean) {
  if (selfEcho) return "ignore" as const;
  return authority === "d1" ? "restore_airtable" as const : "apply_airtable" as const;
}

async function insertConflict(db: D1Database, input: {
  connectionId: string;
  entityType: string;
  localKey: string;
  airtableRecordId?: string;
  reason: string;
  localHash?: string | null;
  remoteHash?: string | null;
  remotePayload?: Record<string, unknown>;
  now: number;
}) {
  await db.prepare(`INSERT INTO airtable_conflicts
    (id, connection_id, entity_type, local_key, airtable_record_id, reason, local_hash, remote_hash, remote_payload, status, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?
    WHERE NOT EXISTS (SELECT 1 FROM airtable_conflicts WHERE connection_id = ? AND entity_type = ? AND local_key = ? AND reason = ? AND status = 'open')`)
    .bind(crypto.randomUUID(), input.connectionId, input.entityType, input.localKey, input.airtableRecordId ?? null,
      input.reason, input.localHash ?? null, input.remoteHash ?? null, JSON.stringify(input.remotePayload ?? {}), input.now, input.now,
      input.connectionId, input.entityType, input.localKey, input.reason).run();
  await db.prepare("UPDATE airtable_connections SET status = 'blocked', last_error = ?, updated_at = ? WHERE id = ?")
    .bind(input.reason.slice(0, 2_000), input.now, input.connectionId).run();
}

function databaseValue(value: unknown, localValue: unknown): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof localValue === "number" && typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  return canonicalJson(value);
}

async function enqueueAirtableRestore(db: D1Database, connectionId: string, entityType: string, localKey: string, now: number) {
  await db.prepare(`INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'upsert', 'queued', 0, 1, ?, ?, ?)
    ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET operation = 'upsert', status = 'queued', attempts = 0,
      generation = airtable_change_queue.generation + 1, available_at = excluded.available_at,
      lease_expires_at = NULL, last_error = NULL, updated_at = excluded.updated_at`)
    .bind(crypto.randomUUID(), connectionId, entityType, localKey, now, now, now).run();
}

export interface AirtableAuthorityReadinessRow {
  event_id: string | null;
  enabled: number;
  status: string;
  webhook_id: string | null;
  webhook_expires_at: number | null;
  last_reconciled_at: number | null;
  reconciliation_started_at: number | null;
  pending_changes: number;
  dead_changes: number;
  open_conflicts: number;
}

export function airtableAuthorityPromotionBlockersForRow(row: AirtableAuthorityReadinessRow, now = Date.now()) {
  const blockers: string[] = [];
  if (row.event_id !== null) blockers.push("event-scoped connectors are unsupported; use the environment-wide connector");
  if (!row.enabled) blockers.push("the connector is disabled");
  if (row.status !== "healthy") blockers.push(`connector health is ${row.status}`);
  if (!row.webhook_id) blockers.push("the webhook is not configured");
  else if (!row.webhook_expires_at || row.webhook_expires_at <= now) blockers.push("the webhook is expired");
  if (row.reconciliation_started_at !== null) blockers.push("a full reconciliation is still running");
  if (row.last_reconciled_at === null) blockers.push("a full reconciliation has not completed");
  if (Number(row.pending_changes)) blockers.push(`${Number(row.pending_changes)} queued or retrying change(s) remain`);
  if (Number(row.dead_changes)) blockers.push(`${Number(row.dead_changes)} dead change(s) require resolution`);
  if (Number(row.open_conflicts)) blockers.push(`${Number(row.open_conflicts)} open conflict(s) require resolution`);
  return blockers;
}

export async function airtableAuthorityPromotionBlockers(db: D1Database, connectionId: string, now = Date.now()) {
  const row = await db.prepare(`SELECT event_id, enabled, status, webhook_id, webhook_expires_at, last_reconciled_at, reconciliation_started_at,
      (SELECT COUNT(*) FROM airtable_change_queue WHERE connection_id = airtable_connections.id AND status IN ('queued', 'processing', 'failed')) AS pending_changes,
      (SELECT COUNT(*) FROM airtable_change_queue WHERE connection_id = airtable_connections.id AND status = 'dead') AS dead_changes,
      (SELECT COUNT(*) FROM airtable_conflicts WHERE connection_id = airtable_connections.id AND status = 'open') AS open_conflicts
    FROM airtable_connections WHERE id = ?`)
    .bind(connectionId).first<AirtableAuthorityReadinessRow>();
  if (!row) return ["the connector does not exist"];
  return airtableAuthorityPromotionBlockersForRow(row, now);
}

async function applyRemoteRecord(env: Bindings, connection: ConnectionRow, remote: AirtableRecord, now: number) {
  const external = String(remote.fields[AIRTABLE_RECORD_FIELDS.externalKey] ?? "");
  const mappedRemote = await recordMapByRemoteId(env.DB, connection.id, remote.id);
  const parsed = parseExternalKey(external);
  if (!parsed) {
    await insertConflict(env.DB, {
      connectionId: connection.id,
      entityType: mappedRemote?.entity_type ?? "unknown",
      localKey: mappedRemote?.local_key ?? JSON.stringify([remote.id]),
      airtableRecordId: remote.id,
      reason: "The Airtable record has a malformed or unknown External Key.",
      localHash: mappedRemote?.last_local_hash,
      remotePayload: remote.fields,
      now,
    });
    return;
  }
  const { entity, localKey } = parsed;
  const map = await recordMap(env.DB, { connection_id: connection.id, entity_type: entity.entityType, local_key: localKey });
  if (mappedRemote && (mappedRemote.entity_type !== entity.entityType || mappedRemote.local_key !== localKey)) {
    await insertConflict(env.DB, {
      connectionId: connection.id,
      entityType: mappedRemote.entity_type,
      localKey: mappedRemote.local_key,
      airtableRecordId: remote.id,
      reason: "The External Key was changed on an already-mapped Airtable record. Rekeying canonical records is not allowed.",
      localHash: mappedRemote.last_local_hash,
      remotePayload: remote.fields,
      now,
    });
    return;
  }
  if (map && map.airtable_record_id !== remote.id) {
    await insertConflict(env.DB, {
      connectionId: connection.id,
      entityType: entity.entityType,
      localKey,
      airtableRecordId: remote.id,
      reason: "A different Airtable record is already mapped to this External Key. Duplicate canonical records are not allowed.",
      localHash: map.last_local_hash,
      remotePayload: remote.fields,
      now,
    });
    return;
  }
  if (!mappedRemote || !map) {
    await insertConflict(env.DB, {
      connectionId: connection.id,
      entityType: entity.entityType,
      localKey,
      airtableRecordId: remote.id,
      reason: "This Airtable record is not the mapped canonical record. Create and rekey operations require a Workflow Command.",
      localHash: map?.last_local_hash,
      remotePayload: remote.fields,
      now,
    });
    return;
  }
  const current = await loadLocalRow(env.DB, entity, localKey);
  if (!current) {
    await insertConflict(env.DB, { connectionId: connection.id, entityType: entity.entityType, localKey, airtableRecordId: remote.id, reason: "Airtable cannot create or resurrect this entity directly; use a Workflow Command.", remotePayload: remote.fields, now });
    return;
  }
  let remotePayload: Record<string, unknown>;
  try {
    const value = JSON.parse(String(remote.fields[AIRTABLE_RECORD_FIELDS.payloadJson] ?? "{}"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("payload must be an object");
    remotePayload = value as Record<string, unknown>;
  } catch (error) {
    await insertConflict(env.DB, { connectionId: connection.id, entityType: entity.entityType, localKey, airtableRecordId: remote.id, reason: `Invalid Payload JSON: ${error instanceof Error ? error.message : String(error)}`, remotePayload: remote.fields, now });
    return;
  }
  const keyValues = parseLocalKey(entity, localKey);
  const mismatchedKey = entity.keyColumns.find((column, index) => canonicalJson(remotePayload[column]) !== canonicalJson(keyValues[index]));
  if (mismatchedKey) {
    await insertConflict(env.DB, { connectionId: connection.id, entityType: entity.entityType, localKey, airtableRecordId: remote.id, reason: `Payload JSON key ${mismatchedKey} does not match the External Key.`, localHash: map.last_local_hash, remotePayload, now });
    return;
  }
  const currentColumns = new Set(Object.keys(current));
  const unexpectedColumns = Object.keys(remotePayload).filter((column) => !currentColumns.has(column));
  const missingColumns = Object.keys(current).filter((column) => !(column in remotePayload));
  if (unexpectedColumns.length || missingColumns.length) {
    await insertConflict(env.DB, {
      connectionId: connection.id,
      entityType: entity.entityType,
      localKey,
      airtableRecordId: remote.id,
      reason: `Payload JSON shape changed${unexpectedColumns.length ? `; unexpected fields: ${unexpectedColumns.join(", ")}` : ""}${missingColumns.length ? `; missing fields: ${missingColumns.join(", ")}` : ""}.`,
      localHash: map.last_local_hash,
      remotePayload,
      now,
    });
    return;
  }
  const deleted = remote.fields[AIRTABLE_RECORD_FIELDS.deleted] === true;
  const remoteHash = await sha256(canonicalJson({ entityType: entity.entityType, localKey, deleted, payload: normalizedJsonValue(remotePayload) }));
  const localHash = await sha256(canonicalJson({ entityType: entity.entityType, localKey, deleted: false, payload: normalizedJsonValue(current) }));
  const expectedDerivedFields: Array<[string, unknown]> = [
    [AIRTABLE_RECORD_FIELDS.entityType, entity.entityType],
    [AIRTABLE_RECORD_FIELDS.eventId, await eventIdForRow(env.DB, entity, localKey, current)],
    [AIRTABLE_RECORD_FIELDS.displayName, displayName(entity, current, localKey)],
    [AIRTABLE_RECORD_FIELDS.sourceVersion, entity.sourceVersionColumn && current[entity.sourceVersionColumn] !== undefined ? String(current[entity.sourceVersionColumn]) : ""],
    [AIRTABLE_RECORD_FIELDS.syncHash, map.last_local_hash ?? map.last_remote_hash ?? localHash],
    [AIRTABLE_RECORD_FIELDS.sourceUpdatedAt, sourceUpdatedAt(entity, current)],
    [AIRTABLE_RECORD_FIELDS.lastSyncedAt, new Date(map.last_synced_at).toISOString()],
  ];
  const driftedDerivedFields = expectedDerivedFields.filter(([field, expected]) => {
    const actual = remote.fields[field];
    if ((actual === undefined || actual === null || actual === "") && (expected === undefined || expected === null || expected === "")) return false;
    return canonicalJson(actual) !== canonicalJson(expected);
  }).map(([field]) => field);
  if (driftedDerivedFields.length) {
    const reason = `Protected derived fields changed: ${driftedDerivedFields.join(", ")}.`;
    const pendingLocalChange = await env.DB.prepare(`SELECT 1 AS pending FROM airtable_change_queue
      WHERE connection_id = ? AND entity_type = ? AND local_key = ? AND status IN ('queued', 'processing', 'failed') LIMIT 1`)
      .bind(connection.id, entity.entityType, localKey).first<{ pending: number }>();
    if (connection.authority === "d1" || pendingLocalChange) await enqueueAirtableRestore(env.DB, connection.id, entity.entityType, localKey, now);
    else await insertConflict(env.DB, { connectionId: connection.id, entityType: entity.entityType, localKey, airtableRecordId: remote.id, reason, localHash, remoteHash, remotePayload, now });
    return;
  }
  const action = resolveAirtableAuthority(connection.authority, remoteHash === localHash || map?.last_local_hash === remoteHash);
  if (action === "ignore") {
    if (map.last_local_hash !== remoteHash) {
      await enqueueAirtableRestore(env.DB, connection.id, entity.entityType, localKey, now);
      return;
    }
    await env.DB.prepare(`INSERT INTO airtable_record_maps
      (connection_id, entity_type, local_key, airtable_record_id, last_local_hash, last_remote_hash, last_synced_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET airtable_record_id = excluded.airtable_record_id,
        last_remote_hash = excluded.last_remote_hash, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at`)
      .bind(connection.id, entity.entityType, localKey, remote.id, localHash, remoteHash, now, now).run();
    return;
  }
  if (action === "restore_airtable") {
    await enqueueAirtableRestore(env.DB, connection.id, entity.entityType, localKey, now);
    return;
  }
  if (deleted) {
    await insertConflict(env.DB, { connectionId: connection.id, entityType: entity.entityType, localKey, airtableRecordId: remote.id, reason: "Deletion is protected; use a Workflow Command.", localHash, remoteHash, remotePayload, now });
    return;
  }
  const mutable = new Set(entity.remoteMutableColumns);
  const protectedChanges = Object.keys(current).filter((column) => !entity.keyColumns.includes(column) && !mutable.has(column) && canonicalJson(current[column]) !== canonicalJson(remotePayload[column]));
  if (protectedChanges.length) {
    await insertConflict(env.DB, { connectionId: connection.id, entityType: entity.entityType, localKey, airtableRecordId: remote.id, reason: `Protected fields changed: ${protectedChanges.join(", ")}. Use a Workflow Command.`, localHash, remoteHash, remotePayload, now });
    return;
  }
  const changedColumns = entity.remoteMutableColumns.filter((column) => column in remotePayload && canonicalJson(current[column]) !== canonicalJson(remotePayload[column]));
  if (!changedColumns.length) return;
  const normalizedValues: unknown[] = [];
  for (const column of changedColumns) {
    const validation = validateAirtableRemoteValue(entity.entityType, column, remotePayload[column]);
    if (!validation.ok) {
      await insertConflict(env.DB, {
        connectionId: connection.id,
        entityType: entity.entityType,
        localKey,
        airtableRecordId: remote.id,
        reason: `Invalid Airtable value for ${column}: ${validation.error}.`,
        localHash,
        remoteHash,
        remotePayload,
        now,
      });
      return;
    }
    normalizedValues.push(validation.value);
  }
  const assignments = changedColumns.map((column) => `${quote(column)} = ?`);
  const where = entity.keyColumns.map((column) => `${quote(column)} = ?`).join(" AND ");
  const values = normalizedValues.map((value, index) => databaseValue(value, current[changedColumns[index]]));
  if (Object.prototype.hasOwnProperty.call(current, "updated_at")) {
    assignments.push(`${quote("updated_at")} = ?`);
    values.push(now);
  }
  if (entity.sourceVersionColumn === "version" && typeof current.version === "number") {
    assignments.push(`${quote("version")} = ${quote("version")} + 1`);
  }
  if (entity.entityType === "program_session" && changedColumns.some((column) => column === "title" || column === "description")) {
    assignments.push(`${quote("calendar_sequence")} = ${quote("calendar_sequence")} + 1`);
  }
  if (entity.entityType === "speaker_profile") {
    const bioIndex = changedColumns.indexOf("bio");
    const nextBio = bioIndex === -1 ? current.bio : normalizedValues[bioIndex];
    assignments.push(`${quote("profile_complete")} = ?`);
    values.push(typeof nextBio === "string" && nextBio.trim().length > 0 && current.headshot_upload_id ? 1 : 0);
  }
  let result: D1Result;
  try {
    result = await env.DB.prepare(`UPDATE ${quote(entity.tableName)} SET ${assignments.join(", ")} WHERE ${where}`)
      .bind(...values, ...parseLocalKey(entity, localKey)).run();
  } catch {
    await insertConflict(env.DB, {
      connectionId: connection.id,
      entityType: entity.entityType,
      localKey,
      airtableRecordId: remote.id,
      reason: "The Airtable edit violates a Conference Ops data constraint.",
      localHash,
      remoteHash,
      remotePayload,
      now,
    });
    return;
  }
  if (!result.meta.changes) throw new Error(`Airtable import did not update ${entity.entityType}`);
  await enqueueAirtableRestore(env.DB, connection.id, entity.entityType, localKey, now);
}

function collectAirtableRecordIds(value: unknown, result = new Set<string>()) {
  if (Array.isArray(value)) for (const entry of value) collectAirtableRecordIds(entry, result);
  else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (/^rec[A-Za-z0-9]+$/.test(key)) result.add(key);
      if (typeof entry === "string" && /^rec[A-Za-z0-9]+$/.test(entry)) result.add(entry);
      collectAirtableRecordIds(entry, result);
    }
  }
  return result;
}

async function processWorkflowCommands(env: Bindings, connection: ConnectionRow, client: AirtableClient, now: number) {
  const statusField = AIRTABLE_COMMAND_FIELDS.status;
  const commands = await client.listRecords(connection.commands_table_id, { filterByFormula: `{${statusField}}='Pending'` });
  let processed = 0;
  for (const command of commands) {
    const commandType = String(command.fields[AIRTABLE_COMMAND_FIELDS.commandType] ?? "").trim();
    const idempotencyKey = String(command.fields[AIRTABLE_COMMAND_FIELDS.idempotencyKey] ?? command.id).trim();
    const targetEntity = String(command.fields[AIRTABLE_COMMAND_FIELDS.targetEntity] ?? "").trim();
    const targetKey = String(command.fields[AIRTABLE_COMMAND_FIELDS.targetKey] ?? "").trim();
    let parameters: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(String(command.fields[AIRTABLE_COMMAND_FIELDS.parametersJson] ?? "{}"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) parameters = parsed as Record<string, unknown>;
    } catch {
      parameters = {};
    }
    const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO airtable_commands
      (id, connection_id, airtable_record_id, command_type, target_entity, target_key, parameters, idempotency_key,
       status, result, requested_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'processing', '{}', ?, ?, ?)`)
      .bind(crypto.randomUUID(), connection.id, command.id, commandType, targetEntity, targetKey, JSON.stringify(parameters), idempotencyKey, now, now, now).run();
    if (!inserted.meta.changes) {
      const prior = await env.DB.prepare(`SELECT command_type, target_entity, target_key, parameters, status, result, last_error, processed_at
        FROM airtable_commands WHERE connection_id = ? AND idempotency_key = ?`)
        .bind(connection.id, idempotencyKey)
        .first<{ command_type: string; target_entity: string; target_key: string; parameters: string; status: string; result: string; last_error: string | null; processed_at: number | null }>();
      if (!prior) throw new Error("The Airtable command idempotency record disappeared");
      let priorParameters: Record<string, unknown> = {};
      let priorResult: Record<string, unknown> = {};
      try { priorParameters = JSON.parse(prior.parameters) as Record<string, unknown>; } catch { priorParameters = {}; }
      try { priorResult = JSON.parse(prior.result) as Record<string, unknown>; } catch { priorResult = {}; }
      const collision = prior.command_type !== commandType || prior.target_entity !== targetEntity || prior.target_key !== targetKey
        || canonicalJson(priorParameters) !== canonicalJson(parameters);
      if (collision) {
        await client.updateRecord(connection.commands_table_id, command.id, {
          [AIRTABLE_COMMAND_FIELDS.status]: "Rejected",
          [AIRTABLE_COMMAND_FIELDS.resultJson]: "{}",
          [AIRTABLE_COMMAND_FIELDS.error]: "This Idempotency Key was already used for a different command.",
          [AIRTABLE_COMMAND_FIELDS.processedAt]: new Date(now).toISOString(),
        });
        processed += 1;
        continue;
      }
      if (["succeeded", "rejected", "failed"].includes(prior.status)) {
        const status = prior.status === "succeeded" ? "Succeeded" : prior.status === "failed" ? "Failed" : "Rejected";
        await client.updateRecord(connection.commands_table_id, command.id, {
          [AIRTABLE_COMMAND_FIELDS.status]: status,
          [AIRTABLE_COMMAND_FIELDS.resultJson]: canonicalJson(priorResult),
          [AIRTABLE_COMMAND_FIELDS.error]: prior.last_error ?? "",
          [AIRTABLE_COMMAND_FIELDS.processedAt]: new Date(prior.processed_at ?? now).toISOString(),
        });
        processed += 1;
        continue;
      }
      // The supported adapters are deliberately idempotent, so replaying a
      // command left in processing by an interrupted Worker is safe.
    }
    let status = "Rejected";
    let result: Record<string, unknown> = {};
    let error = "This protected transition does not yet have a domain command adapter.";
    if (commandType === "full_reconcile") {
      const enqueued = await enqueueFullAirtableReconciliation(env.DB, connection.id, now);
      status = "Succeeded";
      result = { enqueued };
      error = "";
    } else if (commandType === "set_authority" && (parameters.authority === "d1" || parameters.authority === "airtable")) {
      const blockers = parameters.authority === "airtable"
        ? await airtableAuthorityPromotionBlockers(env.DB, connection.id, now)
        : [];
      if (blockers.length) {
        error = `Airtable cannot become the source of truth: ${blockers.join("; ")}.`;
      } else {
        await env.DB.prepare("UPDATE airtable_connections SET authority = ?, updated_at = ? WHERE id = ?")
          .bind(parameters.authority, now, connection.id).run();
        status = "Succeeded";
        result = { authority: parameters.authority };
        error = "";
      }
    }
    await env.DB.prepare(`UPDATE airtable_commands SET status = ?, result = ?, last_error = ?, processed_at = ?, updated_at = ?
      WHERE connection_id = ? AND idempotency_key = ?`)
      .bind(status === "Succeeded" ? "succeeded" : "rejected", JSON.stringify(result), error || null, now, now, connection.id, idempotencyKey).run();
    await client.updateRecord(connection.commands_table_id, command.id, {
      [AIRTABLE_COMMAND_FIELDS.status]: status,
      [AIRTABLE_COMMAND_FIELDS.resultJson]: canonicalJson(result),
      [AIRTABLE_COMMAND_FIELDS.error]: error,
      [AIRTABLE_COMMAND_FIELDS.processedAt]: new Date(now).toISOString(),
    });
    processed += 1;
  }
  return processed;
}

export async function pullAirtableChanges(env: Bindings, connectionId: string, now = Date.now()) {
  if (env.AIRTABLE_ENABLED !== "true") return { records: 0, commands: 0 };
  const connection = await connectionById(env.DB, connectionId);
  if (!connection) throw new Error("Airtable connection is disabled or missing");
  if (!connection.webhook_id) throw new Error("Airtable webhook is not configured");
  const client = clientForConnection(env, connection);
  let cursor = connection.webhook_cursor || undefined;
  let mightHaveMore = false;
  const recordIds = new Set<string>();
  do {
    const previousCursor = cursor;
    const page = await client.listWebhookPayloads(connection.webhook_id, cursor);
    collectAirtableRecordIds(page, recordIds);
    const nextCursor = Number(page.cursor);
    if (Number.isFinite(nextCursor)) cursor = nextCursor;
    mightHaveMore = page.mightHaveMore === true;
    if (mightHaveMore && (cursor === undefined || cursor === previousCursor)) {
      throw new Error("Airtable webhook payload pagination did not advance its cursor");
    }
  } while (mightHaveMore);
  let records = 0;
  for (const recordId of recordIds) {
    try {
      const remote = await client.getRecord(connection.records_table_id, recordId);
      await applyRemoteRecord(env, connection, remote, now);
      records += 1;
    } catch (error) {
      if (!(error instanceof AirtableHttpError) || error.status !== 404) throw error;
      const map = await env.DB.prepare(`SELECT entity_type, local_key, last_local_hash FROM airtable_record_maps
        WHERE connection_id = ? AND airtable_record_id = ?`).bind(connection.id, recordId)
        .first<{ entity_type: string; local_key: string; last_local_hash: string | null }>();
      if (map) await insertConflict(env.DB, { connectionId: connection.id, entityType: map.entity_type, localKey: map.local_key, airtableRecordId: recordId, reason: "The canonical Airtable record was hard-deleted. Restore it or resolve this conflict.", localHash: map.last_local_hash, now });
    }
  }
  const commands = await processWorkflowCommands(env, connection, client, now);
  await env.DB.prepare("UPDATE airtable_connections SET webhook_cursor = ?, updated_at = ? WHERE id = ?")
    .bind(cursor ?? connection.webhook_cursor, now, connection.id).run();
  await markConnectionSyncSuccess(env.DB, connection.id, now, "pull");
  return { records, commands };
}

export async function refreshAirtableWebhook(env: Bindings, connectionId: string, now = Date.now()) {
  const connection = await connectionById(env.DB, connectionId);
  if (!connection?.webhook_id) return false;
  if (connection.webhook_expires_at && connection.webhook_expires_at > now + 48 * 60 * 60_000) return false;
  const refreshed = await clientForConnection(env, connection).refreshWebhook(connection.webhook_id);
  const expiresAt = new Date(refreshed.expirationTime).getTime();
  if (!Number.isFinite(expiresAt)) throw new Error("Airtable returned an invalid webhook expiration time");
  await env.DB.prepare("UPDATE airtable_connections SET webhook_expires_at = ?, updated_at = ? WHERE id = ?")
    .bind(expiresAt, now, connection.id).run();
  return true;
}

export async function enabledAirtableConnections(db: D1Database) {
  const result = await db.prepare(`SELECT id, event_id, base_id, records_table_id, commands_table_id, authority, enabled, status, webhook_id,
      webhook_cursor, webhook_expires_at, last_reconciled_at, reconciliation_started_at
      FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at`).all<ConnectionRow>();
  return result.results;
}
