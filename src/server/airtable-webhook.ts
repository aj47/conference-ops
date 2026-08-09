import type { Context } from "hono";
import type { AppEnv } from "./env";
import { dispatchPersistedJobs, persistOutboxJobs, type OutboxJob } from "./outbox-producer";

export interface AirtableWebhookSignal {
  baseId: string;
  webhookId: string;
}

function base64Bytes(value: string) {
  const decoded = atob(value);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function base64(value: ArrayBuffer) {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(left: string, right: string) {
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function verifyAirtableWebhookMac(rawBody: string, header: string | null | undefined, macSecretBase64: string) {
  const provided = header?.match(/^hmac-sha256=(.+)$/i)?.[1]?.trim();
  if (!provided || !macSecretBase64.trim()) return false;
  let keyBytes: Uint8Array;
  try {
    keyBytes = base64Bytes(macSecretBase64);
  } catch {
    return false;
  }
  const keyMaterial = Uint8Array.from(keyBytes).buffer as ArrayBuffer;
  const key = await crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  return constantTimeEqual(base64(signature), provided);
}

export function parseAirtableWebhookSignal(rawBody: string): AirtableWebhookSignal | null {
  try {
    const value = JSON.parse(rawBody) as Record<string, unknown>;
    const base = value.base as Record<string, unknown> | undefined;
    const webhook = value.webhook as Record<string, unknown> | undefined;
    const baseId = String(base?.id ?? value.baseId ?? "");
    const webhookId = String(webhook?.id ?? value.webhookId ?? "");
    if (!/^app[A-Za-z0-9]+$/.test(baseId) || !/^ach[A-Za-z0-9]+$/.test(webhookId)) return null;
    return { baseId, webhookId };
  } catch {
    return null;
  }
}

export async function handleAirtableWebhook(c: Context<AppEnv>) {
  if (c.env.AIRTABLE_ENABLED !== "true" || !c.env.AIRTABLE_WEBHOOK_MAC_SECRET) {
    return c.json({ error: { code: "NOT_FOUND", message: "Not found", requestId: c.get("requestId") } }, 404);
  }
  const rawBody = await c.req.text();
  const valid = await verifyAirtableWebhookMac(rawBody, c.req.header("x-airtable-content-mac"), c.env.AIRTABLE_WEBHOOK_MAC_SECRET);
  if (!valid) return c.json({ error: { code: "INVALID_AIRTABLE_MAC", message: "Invalid webhook signature", requestId: c.get("requestId") } }, 401);
  const signal = parseAirtableWebhookSignal(rawBody);
  if (!signal || c.env.AIRTABLE_BASE_ID && signal.baseId !== c.env.AIRTABLE_BASE_ID) return c.body(null, 204);
  const connection = await c.env.DB.prepare(`SELECT id FROM airtable_connections
    WHERE enabled = 1 AND event_id IS NULL AND base_id = ? AND webhook_id = ? LIMIT 1`)
    .bind(signal.baseId, signal.webhookId).first<{ id: string }>();
  if (!connection) return c.body(null, 204);
  const job: OutboxJob = {
    kind: "airtable",
    idempotencyKey: `airtable-webhook:${signal.webhookId}:${c.get("requestId")}`,
    payload: { action: "pull", connectionId: connection.id },
  };
  await persistOutboxJobs(c.env.DB, [job]);
  if (c.env.JOBS_QUEUE) await dispatchPersistedJobs(c.env.JOBS_QUEUE, [job]);
  return c.body(null, 204);
}
