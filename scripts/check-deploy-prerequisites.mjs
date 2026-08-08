#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import process from "node:process";
import { URL } from "node:url";

const environment = process.argv[2];
const inputsOnly = process.argv.includes("--inputs-only");
const directoryArgument = process.argv.slice(3).find((argument) => argument !== "--inputs-only");
const directory = directoryArgument ?? "artifacts/wrangler";
if (!["pilot", "staging", "production"].includes(environment)) throw new Error("First argument must be pilot, staging, or production");

function requiredEnvironment(name, minimumLength = 1) {
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

if (inputsOnly) {
  const accountId = requiredEnvironment("CLOUDFLARE_ACCOUNT_ID");
  if (!/^[0-9a-fA-F]{32}$/.test(accountId)) throw new Error("CLOUDFLARE_ACCOUNT_ID must be 32 hexadecimal characters");
  requiredEnvironment("CLOUDFLARE_API_TOKEN");
  requiredEnvironment("AWS_ACCESS_KEY_ID");
  requiredEnvironment("AWS_SECRET_ACCESS_KEY");
  requiredEnvironment("BETTER_AUTH_SECRET", 32);
  requiredEnvironment("REALTIME_TOKEN", 32);

  const emailEnabled = optionalBoolean("ENABLE_CLOUDFLARE_EMAIL");
  if (["pilot", "production"].includes(environment) && !emailEnabled) {
    throw new Error(`${environment} requires ENABLE_CLOUDFLARE_EMAIL=true because account verification is mandatory`);
  }
  if (emailEnabled) requiredEnvironment("MAIL_FROM");

  const publicUrl = process.env.PUBLIC_APP_URL || (process.env.APP_CUSTOM_DOMAIN ? `https://${process.env.APP_CUSTOM_DOMAIN}` : "");
  if (!publicUrl) throw new Error("PUBLIC_APP_URL or APP_CUSTOM_DOMAIN is required");
  const parsed = new URL(publicUrl);
  if (parsed.protocol !== "https:") throw new Error("Deployment PUBLIC_APP_URL must use HTTPS");
  if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error("PUBLIC_APP_URL must be an origin without credentials, a path, query, or fragment");
  }
  const customDomain = process.env.APP_CUSTOM_DOMAIN?.trim() || "";
  if (customDomain && parsed.hostname.toLowerCase() !== customDomain.toLowerCase()) throw new Error("PUBLIC_APP_URL hostname must match APP_CUSTOM_DOMAIN");
  if (customDomain && parsed.port) throw new Error("PUBLIC_APP_URL cannot use a custom port with APP_CUSTOM_DOMAIN");

  const previewAccessEnabled = optionalBoolean("ENABLE_PREVIEW_ACCESS");
  if (previewAccessEnabled && environment !== "staging") throw new Error("Preview Access can only be enabled for staging");
  if (previewAccessEnabled && !customDomain) throw new Error("Preview Access requires APP_CUSTOM_DOMAIN");
  if (previewAccessEnabled && process.env.PREVIEW_ACCESS_HOSTNAME?.trim().toLowerCase() !== customDomain.toLowerCase()) {
    throw new Error("PREVIEW_ACCESS_HOSTNAME must match APP_CUSTOM_DOMAIN");
  }
  if (previewAccessEnabled) {
    requiredEnvironment("CF_ACCESS_CLIENT_ID");
    requiredEnvironment("CF_ACCESS_CLIENT_SECRET");
    const tokenIds = JSON.parse(requiredEnvironment("PREVIEW_ACCESS_SERVICE_TOKEN_IDS_JSON"));
    if (!Array.isArray(tokenIds) || tokenIds.length === 0) throw new Error("Preview Access health checks require at least one service-token ID");
  }

  const acceleventsEnabled = optionalBoolean("ACCELEVENTS_ENABLED");
  if (acceleventsEnabled) {
    requiredEnvironment("ACCELEVENTS_EVENT_URL");
    requiredEnvironment("ACCELEVENTS_API_KEY");
  }

  process.stdout.write(`${JSON.stringify({ environment, inputsValid: true })}\n`);
  process.exit(0);
}

const files = ["wrangler.jsonc", "wrangler.jobs.jsonc", "wrangler.realtime.jsonc"];
const expectedNames = {
  "wrangler.jsonc": `conference-ops-${environment}-app`,
  "wrangler.jobs.jsonc": `conference-ops-${environment}-jobs`,
  "wrangler.realtime.jsonc": `conference-ops-${environment}-realtime`,
};

for (const file of files) {
  const raw = await readFile(`${directory}/${file}`, "utf8");
  if (/__[A-Z0-9_]+__/.test(raw)) throw new Error(`${file} contains unresolved deployment tokens`);
  const config = JSON.parse(raw);
  if (config.env?.[environment]?.name !== expectedNames[file]) {
    throw new Error(`${file} has an unexpected ${environment} Worker name`);
  }
}

process.stdout.write(`${JSON.stringify({ environment, directory, valid: true })}\n`);
