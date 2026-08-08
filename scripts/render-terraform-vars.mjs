#!/usr/bin/env node

import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseArgs(argv) {
  const result = { environment: "", outFile: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--environment" || argument === "--env") result.environment = argv[++index] ?? "";
    else if (argument === "--out-file") result.outFile = argv[++index] ?? "";
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!["staging", "production"].includes(result.environment)) throw new Error("--environment must be staging or production");
  result.outFile ||= `artifacts/terraform/${result.environment}.tfvars.json`;
  return result;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalJson(name, fallback) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}

function optionalBoolean(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function optionalInteger(name) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

const options = parseArgs(process.argv.slice(2));
const accountId = required("CLOUDFLARE_ACCOUNT_ID");
if (!/^[0-9a-fA-F]{32}$/.test(accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID must be 32 hexadecimal characters");

const allowedEmails = optionalJson("PREVIEW_ACCESS_ALLOWED_EMAILS_JSON", []);
const allowedIdps = optionalJson("PREVIEW_ACCESS_ALLOWED_IDPS_JSON", []);
const serviceTokenIds = optionalJson("PREVIEW_ACCESS_SERVICE_TOKEN_IDS_JSON", []);
const dnsRecords = optionalJson("DNS_RECORDS_JSON", {});
if (!Array.isArray(allowedEmails)) throw new Error("PREVIEW_ACCESS_ALLOWED_EMAILS_JSON must be a JSON array");
if (!Array.isArray(allowedIdps)) throw new Error("PREVIEW_ACCESS_ALLOWED_IDPS_JSON must be a JSON array");
if (!Array.isArray(serviceTokenIds)) throw new Error("PREVIEW_ACCESS_SERVICE_TOKEN_IDS_JSON must be a JSON array");
if (!dnsRecords || Array.isArray(dnsRecords) || typeof dnsRecords !== "object") throw new Error("DNS_RECORDS_JSON must be a JSON object");

const values = {
  cloudflare_account_id: accountId,
  environment: options.environment,
  enable_preview_access: optionalBoolean("ENABLE_PREVIEW_ACCESS"),
  preview_access_allowed_emails: allowedEmails,
  preview_access_allowed_idps: allowedIdps,
  preview_access_service_token_ids: serviceTokenIds,
  dns_records: dnsRecords,
  enable_d1_read_replication: optionalBoolean("ENABLE_D1_READ_REPLICATION"),
};

const optionalStrings = {
  cloudflare_zone_id: process.env.CLOUDFLARE_ZONE_ID?.trim(),
  preview_access_hostname: process.env.PREVIEW_ACCESS_HOSTNAME?.trim(),
  d1_primary_location_hint: process.env.D1_PRIMARY_LOCATION_HINT?.trim(),
  r2_location: process.env.R2_LOCATION?.trim(),
};
for (const [key, value] of Object.entries(optionalStrings)) {
  if (value) values[key] = value;
}
const optionalIntegers = {
  jobs_queue_retention_seconds: optionalInteger("JOBS_QUEUE_RETENTION_SECONDS"),
  jobs_dlq_retention_seconds: optionalInteger("JOBS_DLQ_RETENTION_SECONDS"),
};
for (const [key, value] of Object.entries(optionalIntegers)) {
  if (value !== undefined) values[key] = value;
}

await mkdir(path.dirname(options.outFile), { recursive: true });
await writeFile(options.outFile, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
await chmod(options.outFile, 0o600);
process.stdout.write(`${JSON.stringify({ environment: options.environment, outFile: options.outFile, previewAccess: values.enable_preview_access, dnsRecordCount: Object.keys(dnsRecords).length })}\n`);
