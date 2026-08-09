#!/usr/bin/env node

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL } from "node:url";

const templates = ["wrangler.jsonc", "wrangler.jobs.jsonc", "wrangler.realtime.jsonc"];

function parseArgs(argv) {
  const result = { environment: "", outDir: "artifacts/wrangler" };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--environment" || argument === "--env") result.environment = argv[++index] ?? "";
    else if (argument === "--out-dir") result.outDir = argv[++index] ?? result.outDir;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!["pilot", "staging", "production"].includes(result.environment)) {
    throw new Error("--environment must be pilot, staging, or production");
  }
  return result;
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optionalBoolean(name, fallback = false) {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function normalizePublicUrl(customDomain) {
  const explicit = process.env.PUBLIC_APP_URL?.trim();
  const value = explicit || (customDomain ? `https://${customDomain}` : "");
  if (!value) throw new Error("Set PUBLIC_APP_URL or APP_CUSTOM_DOMAIN before rendering Wrangler configuration");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error("PUBLIC_APP_URL must use HTTPS outside localhost");
  }
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("PUBLIC_APP_URL must be an origin without credentials, a path, query, or fragment");
  }
  if (customDomain && parsed.hostname.toLowerCase() !== customDomain.toLowerCase()) {
    throw new Error("PUBLIC_APP_URL hostname must match APP_CUSTOM_DOMAIN");
  }
  if (customDomain && parsed.port) throw new Error("PUBLIC_APP_URL cannot use a custom port with APP_CUSTOM_DOMAIN");
  return parsed.origin;
}

function replaceTokens(value, replacements) {
  if (typeof value === "string") return replacements[value] ?? value;
  if (Array.isArray(value)) return value.map((entry) => replaceTokens(entry, replacements));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceTokens(entry, replacements)]));
  }
  return value;
}

const options = parseArgs(process.argv.slice(2));
const customDomain = process.env.APP_CUSTOM_DOMAIN?.trim() || "";
if (customDomain && (customDomain.includes("://") || customDomain.includes("/"))) {
  throw new Error("APP_CUSTOM_DOMAIN must be a hostname without a scheme or path");
}
if (customDomain && new URL(`https://${customDomain}`).hostname.toLowerCase() !== customDomain.toLowerCase()) {
  throw new Error("APP_CUSTOM_DOMAIN must be a valid hostname without a port");
}

const previewAccessEnabled = optionalBoolean("ENABLE_PREVIEW_ACCESS");
if (previewAccessEnabled && options.environment !== "staging") throw new Error("Preview Access can only be enabled for staging");
if (previewAccessEnabled && !customDomain) throw new Error("Preview Access requires APP_CUSTOM_DOMAIN");
const previewAccessHostname = process.env.PREVIEW_ACCESS_HOSTNAME?.trim() || "";
if (previewAccessEnabled && previewAccessHostname.toLowerCase() !== customDomain.toLowerCase()) {
  throw new Error("PREVIEW_ACCESS_HOSTNAME must match APP_CUSTOM_DOMAIN");
}

const emailEnabled = optionalBoolean("ENABLE_CLOUDFLARE_EMAIL");
const mailFrom = process.env.MAIL_FROM?.trim() || (emailEnabled ? requiredEnvironment("MAIL_FROM") : "program@example.invalid");
const airtableEnabled = optionalBoolean("AIRTABLE_ENABLED");
const airtableBaseId = process.env.AIRTABLE_BASE_ID?.trim() || "";
if (airtableEnabled && !/^app[A-Za-z0-9]+$/.test(airtableBaseId)) throw new Error("AIRTABLE_BASE_ID must be a valid base ID when Airtable is enabled");
const airtableAuthority = process.env.AIRTABLE_AUTHORITY_DEFAULT?.trim() || "d1";
if (!["d1", "airtable"].includes(airtableAuthority)) throw new Error("AIRTABLE_AUTHORITY_DEFAULT must be d1 or airtable");
const airtableRequestsPerSecond = process.env.AIRTABLE_MAX_REQUESTS_PER_SECOND?.trim() || "4";
if (!Number.isFinite(Number(airtableRequestsPerSecond)) || Number(airtableRequestsPerSecond) <= 0 || Number(airtableRequestsPerSecond) > 4) {
  throw new Error("AIRTABLE_MAX_REQUESTS_PER_SECOND must be between 0 and 4");
}

const publicAppUrl = normalizePublicUrl(customDomain);
const replacements = {
  __D1_DATABASE_ID__: requiredEnvironment("CLOUDFLARE_D1_DATABASE_ID"),
  __PUBLIC_APP_URL__: publicAppUrl,
  __MAIL_FROM__: mailFrom,
  __MAIL_REPLY_TO__: process.env.MAIL_REPLY_TO?.trim() || mailFrom,
  __ACCELEVENTS_EVENT_URL__: process.env.ACCELEVENTS_EVENT_URL?.trim() || "",
  __ACCELEVENTS_ENABLED__: optionalBoolean("ACCELEVENTS_ENABLED") ? "true" : "false",
  __AIRTABLE_ENABLED__: airtableEnabled ? "true" : "false",
  __AIRTABLE_BASE_ID__: airtableBaseId,
  __AIRTABLE_AUTHORITY_DEFAULT__: airtableAuthority,
  __AIRTABLE_MAX_REQUESTS_PER_SECOND__: airtableRequestsPerSecond,
};

await mkdir(options.outDir, { recursive: true });

for (const template of templates) {
  const source = JSON.parse(await readFile(template, "utf8"));
  if (!source.env?.[options.environment]) throw new Error(`${template} has no ${options.environment} environment`);
  source.env = { [options.environment]: source.env[options.environment] };

  if (template === "wrangler.jobs.jsonc" && !emailEnabled) {
    delete source.send_email;
    delete source.env[options.environment].send_email;
  }

  if (template === "wrangler.jsonc" && customDomain) {
    const route = { pattern: customDomain, custom_domain: true };
    const zoneId = process.env.CLOUDFLARE_ZONE_ID?.trim();
    if (zoneId) route.zone_id = zoneId;
    source.env[options.environment].routes = [route];
    source.env[options.environment].workers_dev = false;
  }

  const rendered = replaceTokens(source, replacements);
  const serialized = `${JSON.stringify(rendered, null, 2)}\n`;
  const unresolved = serialized.match(/__[A-Z0-9_]+__/g);
  if (unresolved) throw new Error(`${template} still contains unresolved tokens: ${[...new Set(unresolved)].join(", ")}`);

  await writeFile(path.join(options.outDir, template), serialized, { mode: 0o600 });
}

process.stdout.write(`${JSON.stringify({ environment: options.environment, outDir: options.outDir, publicAppUrl, customDomain: customDomain || null })}\n`);
