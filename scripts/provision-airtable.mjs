#!/usr/bin/env node

import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

const token = process.env.AIRTABLE_TOKEN?.trim();
if (!token) throw new Error("AIRTABLE_TOKEN is required");
const publicAppUrl = process.env.PUBLIC_APP_URL?.trim();
if (!publicAppUrl) throw new Error("PUBLIC_APP_URL is required to create the webhook");
const callback = new URL("/api/v1/integrations/airtable/webhook", publicAppUrl).toString();
const outputFile = process.env.AIRTABLE_PROVISION_OUTPUT?.trim() || "artifacts/airtable/provisioning.json";

const recordsTable = {
  name: "Conference Ops Records",
  description: "Canonical Conference Ops business records. External Key is stable; lifecycle transitions use Workflow Commands.",
  fields: [
    { name: "External Key", type: "singleLineText" },
    { name: "Entity Type", type: "singleLineText" },
    { name: "Event ID", type: "singleLineText" },
    { name: "Display Name", type: "singleLineText" },
    { name: "Payload JSON", type: "multilineText" },
    { name: "Deleted", type: "checkbox", options: { color: "redBright", icon: "xCheckbox" } },
    { name: "Source Version", type: "singleLineText" },
    { name: "Sync Hash", type: "singleLineText" },
    { name: "Source Updated At", type: "singleLineText" },
    { name: "Last Synced At", type: "singleLineText" },
  ],
};

const commandsTable = {
  name: "Workflow Commands",
  description: "Audited requests for protected Conference Ops workflow transitions.",
  fields: [
    { name: "Command ID", type: "singleLineText" },
    { name: "Command Type", type: "singleLineText" },
    { name: "Target Entity", type: "singleLineText" },
    { name: "Target Key", type: "singleLineText" },
    { name: "Parameters JSON", type: "multilineText" },
    { name: "Idempotency Key", type: "singleLineText" },
    { name: "Status", type: "singleLineText" },
    { name: "Result JSON", type: "multilineText" },
    { name: "Error", type: "multilineText" },
    { name: "Requested At", type: "singleLineText" },
    { name: "Processed At", type: "singleLineText" },
  ],
};

async function airtable(endpoint, init = {}) {
  const response = await globalThis.fetch(`https://api.airtable.com/v0/${endpoint}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  const body = await response.text();
  if (!response.ok) {
    const error = new Error(`Airtable ${response.status}: ${body.slice(0, 2_000)}`);
    error.status = response.status;
    throw error;
  }
  return body ? JSON.parse(body) : undefined;
}

async function previousArtifact() {
  try {
    const parsed = JSON.parse(await readFile(outputFile, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw new Error(`Could not read the existing Airtable provisioning artifact: ${error instanceof Error ? error.message : String(error)}`);
  }
}

let baseId = process.env.AIRTABLE_BASE_ID?.trim() || "";
let tables;
if (!baseId) {
  const workspaceId = process.env.AIRTABLE_WORKSPACE_ID?.trim();
  if (!workspaceId) throw new Error("Set AIRTABLE_BASE_ID or AIRTABLE_WORKSPACE_ID");
  const created = await airtable("meta/bases", {
    method: "POST",
    body: JSON.stringify({ name: process.env.AIRTABLE_BASE_NAME?.trim() || "Conference Ops", workspaceId, tables: [recordsTable, commandsTable] }),
  });
  baseId = created.id;
  tables = created.tables;
} else {
  const schema = await airtable(`meta/bases/${encodeURIComponent(baseId)}/tables`);
  tables = schema.tables;
  for (const definition of [recordsTable, commandsTable]) {
    let table = tables.find((candidate) => candidate.name === definition.name);
    if (!table) {
      table = await airtable(`meta/bases/${encodeURIComponent(baseId)}/tables`, { method: "POST", body: JSON.stringify(definition) });
      tables.push(table);
      continue;
    }
    for (const field of definition.fields) {
      const existing = table.fields?.find((candidate) => candidate.name === field.name);
      if (existing && existing.type !== field.type) {
        throw new Error(`${definition.name}.${field.name} must be ${field.type}; found ${existing.type}`);
      }
      if (existing) continue;
      const created = await airtable(`meta/bases/${encodeURIComponent(baseId)}/tables/${encodeURIComponent(table.id)}/fields`, {
        method: "POST",
        body: JSON.stringify(field),
      });
      table.fields = [...(table.fields ?? []), created];
    }
  }
}

const records = tables.find((table) => table.name === recordsTable.name);
const commands = tables.find((table) => table.name === commandsTable.name);
if (!records || !commands) throw new Error("Airtable provisioning did not return both required tables");

let webhook;
const previous = await previousArtifact();
if (previous?.baseId === baseId && previous.callback === callback && /^ach[A-Za-z0-9]+$/.test(previous.webhookId) && previous.webhookMacSecretBase64) {
  try {
    const refreshed = await airtable(`bases/${encodeURIComponent(baseId)}/webhooks/${encodeURIComponent(previous.webhookId)}/refresh`, { method: "POST", body: "{}" });
    webhook = { id: previous.webhookId, macSecretBase64: previous.webhookMacSecretBase64, expirationTime: refreshed.expirationTime };
  } catch (error) {
    if (!error || typeof error !== "object" || ![404, 422].includes(error.status)) throw error;
  }
}
if (!webhook) {
  webhook = await airtable(`bases/${encodeURIComponent(baseId)}/webhooks`, {
    method: "POST",
    body: JSON.stringify({
      notificationUrl: callback,
      specification: { options: { filters: { dataTypes: ["tableData"], changeTypes: ["add", "update", "remove"] } } },
    }),
  });
}
if (!/^ach[A-Za-z0-9]+$/.test(webhook.id) || !webhook.macSecretBase64 || !webhook.expirationTime) {
  throw new Error("Airtable returned an incomplete webhook response");
}

const artifact = {
  baseId,
  recordsTableId: records.id,
  commandsTableId: commands.id,
  webhookId: webhook.id,
  webhookMacSecretBase64: webhook.macSecretBase64,
  webhookExpirationTime: webhook.expirationTime,
  callback,
  schemaVersion: 1,
  authority: process.env.AIRTABLE_AUTHORITY_DEFAULT === "airtable" ? "airtable" : "d1",
};
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
await chmod(outputFile, 0o600);
process.stdout.write(`${JSON.stringify({ baseId, recordsTableId: records.id, commandsTableId: commands.id, webhookId: webhook.id, outputFile })}\n`);
