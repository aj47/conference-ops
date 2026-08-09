#!/usr/bin/env node

import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const result = { worker: "", outFile: "", cleanupOutFile: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--worker") result.worker = argv[++index] ?? "";
    else if (argument === "--out-file") result.outFile = argv[++index] ?? "";
    else if (argument === "--cleanup-out-file") result.cleanupOutFile = argv[++index] ?? "";
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!["app", "jobs", "realtime"].includes(result.worker)) throw new Error("--worker must be app, jobs, or realtime");
  if (!result.outFile) throw new Error("--out-file is required");
  return result;
}

function requiredSecret(name, minimumLength = 1) {
  const value = process.env[name] ?? "";
  if (value.length < minimumLength) throw new Error(`${name} must contain at least ${minimumLength} characters`);
  return value;
}

function optionalBoolean(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

const options = parseArgs(process.argv.slice(2));
const secrets = {};
const cleanup = {};

if (options.worker === "app") {
  secrets.BETTER_AUTH_SECRET = requiredSecret("BETTER_AUTH_SECRET", 32);
  secrets.REALTIME_TOKEN = requiredSecret("REALTIME_TOKEN", 32);
  if (optionalBoolean("AIRTABLE_ENABLED")) secrets.AIRTABLE_WEBHOOK_MAC_SECRET = requiredSecret("AIRTABLE_WEBHOOK_MAC_SECRET");
  else cleanup.AIRTABLE_WEBHOOK_MAC_SECRET = null;
  cleanup.BOOTSTRAP_TOKEN = null;
}
if (options.worker === "jobs") {
  const integrationEnabled = optionalBoolean("ACCELEVENTS_ENABLED");
  if (integrationEnabled) secrets.ACCELEVENTS_API_KEY = requiredSecret("ACCELEVENTS_API_KEY");
  else cleanup.ACCELEVENTS_API_KEY = null;
  if (optionalBoolean("AIRTABLE_ENABLED")) secrets.AIRTABLE_TOKEN = requiredSecret("AIRTABLE_TOKEN");
  else cleanup.AIRTABLE_TOKEN = null;
}
if (options.worker === "realtime") {
  secrets.REALTIME_TOKEN = requiredSecret("REALTIME_TOKEN", 32);
}

await mkdir(path.dirname(options.outFile), { recursive: true });
await writeFile(options.outFile, `${JSON.stringify(secrets)}\n`, { mode: 0o600 });
await chmod(options.outFile, 0o600);
if (options.cleanupOutFile) {
  await mkdir(path.dirname(options.cleanupOutFile), { recursive: true });
  await writeFile(options.cleanupOutFile, `${JSON.stringify(cleanup)}\n`, { mode: 0o600 });
  await chmod(options.cleanupOutFile, 0o600);
}
process.stdout.write(`${JSON.stringify({ worker: options.worker, outFile: options.outFile, secretCount: Object.keys(secrets).length, cleanupOutFile: options.cleanupOutFile || null, deletionCount: Object.keys(cleanup).length })}\n`);
