#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

const target = process.argv[2];
if (!target) throw new Error("Pass the generated migration path to append Airtable triggers");
const requestedEntityTypes = new Set();
for (let index = 3; index < process.argv.length; index += 1) {
  if (process.argv[index] !== "--entity" || !process.argv[index + 1]) throw new Error("Use --entity <entity-type> to limit trigger rendering");
  requestedEntityTypes.add(process.argv[index + 1]);
  index += 1;
}

const registrySource = await readFile(new URL("../src/shared/airtable-schema.ts", import.meta.url), "utf8");
const definitions = [...registrySource.matchAll(/entity\(\{ entityType: "([^"]+)", tableName: "([^"]+)", keyColumns: \[([^\]]+)\]/g)]
  .map((match) => ({
    entityType: match[1],
    tableName: match[2],
    keyColumns: [...match[3].matchAll(/"([^"]+)"/g)].map((column) => column[1]),
  }))
  .filter((definition) => requestedEntityTypes.size === 0 || requestedEntityTypes.has(definition.entityType));

if (!definitions.length) throw new Error("No Airtable entity definitions were found");
for (const requested of requestedEntityTypes) {
  if (!definitions.some((definition) => definition.entityType === requested)) throw new Error(`Unknown Airtable entity: ${requested}`);
}

const quote = (identifier) => `"${identifier.replaceAll('"', '""')}"`;
const now = "(CAST(strftime('%s', 'now') AS INTEGER) * 1000)";
const connection = "(SELECT id FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL ORDER BY created_at LIMIT 1)";

function trigger(definition, action) {
  const row = action === "DELETE" ? "OLD" : "NEW";
  const operation = action === "DELETE" ? "tombstone" : "upsert";
  const key = `json_array(${definition.keyColumns.map((column) => `${row}.${quote(column)}`).join(", ")})`;
  const name = `airtable_${definition.tableName}_${action.toLowerCase()}`;
  return `CREATE TRIGGER ${quote(name)} AFTER ${action} ON ${quote(definition.tableName)}
WHEN EXISTS (SELECT 1 FROM airtable_connections WHERE enabled = 1 AND event_id IS NULL)
BEGIN
  INSERT INTO airtable_change_queue
    (id, connection_id, entity_type, local_key, operation, status, attempts, generation, available_at, lease_expires_at, last_error, created_at, updated_at)
  VALUES
    (lower(hex(randomblob(16))), ${connection}, '${definition.entityType}', ${key}, '${operation}', 'queued', 0, 1, ${now}, NULL, NULL, ${now}, ${now})
  ON CONFLICT(connection_id, entity_type, local_key) DO UPDATE SET
    operation = excluded.operation,
    status = 'queued',
    attempts = 0,
    generation = airtable_change_queue.generation + 1,
    available_at = excluded.available_at,
    lease_expires_at = NULL,
    last_error = NULL,
    updated_at = excluded.updated_at;
END;`;
}

const marker = "-- Airtable canonical-record change capture";
const source = await readFile(target, "utf8");
if (source.includes(marker)) throw new Error(`${target} already contains Airtable triggers`);
const rendered = definitions.flatMap((definition) => ["INSERT", "UPDATE", "DELETE"].map((action) => trigger(definition, action))).join("\n--> statement-breakpoint\n");
await writeFile(target, `${source.trimEnd()}\n--> statement-breakpoint\n${marker}\n${rendered}\n`);
process.stdout.write(`${JSON.stringify({ target, entityCount: definitions.length, triggerCount: definitions.length * 3 })}\n`);
