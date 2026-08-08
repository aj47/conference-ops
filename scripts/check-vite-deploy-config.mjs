#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { URL, pathToFileURL } from "node:url";

function requireMatch(actual, wanted, label) {
  if (actual !== wanted) throw new Error(`${label} must be ${wanted}; received ${actual ?? "nothing"}`);
}

export function validateGeneratedViteConfig(config, environment) {
  if (!["staging", "production"].includes(environment)) throw new Error("Environment must be staging or production");
  const expected = {
    name: `conference-ops-${environment}-app`,
    database: `conference-ops-${environment}`,
    bucket: `conference-ops-${environment}-uploads`,
    queue: `conference-ops-${environment}-jobs`,
    realtime: `conference-ops-${environment}-realtime`,
  };

  requireMatch(config.name, expected.name, "Generated Worker name");
  requireMatch(config.main, "index.js", "Generated Worker entrypoint");
  requireMatch(config.vars?.ENVIRONMENT, environment, "Generated environment binding");
  requireMatch(config.vars?.DEMO_MODE, environment === "staging" ? "true" : "false", "Generated demo-mode binding");
  requireMatch(config.d1_databases?.find((entry) => entry.binding === "DB")?.database_name, expected.database, "Generated D1 binding");
  requireMatch(config.r2_buckets?.find((entry) => entry.binding === "UPLOADS")?.bucket_name, expected.bucket, "Generated R2 binding");
  requireMatch(config.queues?.producers?.find((entry) => entry.binding === "JOBS_QUEUE")?.queue, expected.queue, "Generated Queue binding");
  requireMatch(config.services?.find((entry) => entry.binding === "REALTIME")?.service, expected.realtime, "Generated realtime binding");
  if (!config.assets?.directory) throw new Error("Generated Worker config is missing the built static-assets directory");
  requireMatch(config.assets.binding, "ASSETS", "Generated assets binding");
  requireMatch(config.assets.not_found_handling, "single-page-application", "Generated assets fallback");
  if (!config.assets.run_worker_first?.includes("/api/*")) throw new Error("Generated assets config must route /api/* through the Worker");
  if (!config.assets.run_worker_first?.includes("/events/*/embed/agenda")) throw new Error("Generated assets config must route event-scoped agenda embeds through the Worker");
  const publicUrl = new URL(config.vars?.PUBLIC_APP_URL ?? "invalid:");
  requireMatch(config.vars?.BETTER_AUTH_URL, publicUrl.origin, "Generated auth origin");
  if (publicUrl.protocol !== "https:") throw new Error("Generated public origin must use HTTPS");
  if (/__[A-Z0-9_]+__/.test(JSON.stringify(config))) throw new Error("Generated Worker config contains unresolved deployment tokens");
  return expected;
}

function parseStaticAssetHeaderRules(source) {
  const rules = new Map();
  let currentRule;

  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      currentRule = line.trim();
      rules.set(currentRule, []);
      continue;
    }
    if (currentRule) rules.get(currentRule).push(line.trim());
  }

  return rules;
}

export function validateStaticAssetHeaders(source) {
  const rules = parseStaticAssetHeaderRules(source);
  const assetHeaders = rules.get("/assets/*") ?? [];
  if (!assetHeaders.includes("Cache-Control: public, max-age=31536000, immutable")) {
    throw new Error("Built static assets are missing immutable cache headers");
  }

  for (const pathPattern of ["/embed/*", "/events/:slug/embed/agenda"]) {
    const embedHeaders = rules.get(pathPattern) ?? [];
    if (
      !embedHeaders.includes("! Content-Security-Policy")
      || !embedHeaders.some((header) => header.startsWith("Content-Security-Policy:") && header.includes("frame-ancestors *"))
      || !embedHeaders.includes("! X-Frame-Options")
    ) {
      throw new Error(`Built static assets are missing the explicit embed framing exception for ${pathPattern}`);
    }
  }

  return true;
}

export async function checkViteDeployConfig(environment, rootDirectory = process.cwd()) {
  const redirectPath = path.resolve(rootDirectory, ".wrangler/deploy/config.json");
  const redirect = JSON.parse(await readFile(redirectPath, "utf8"));
  if (!redirect.configPath) throw new Error("Vite did not write a Wrangler deploy config path");
  const configPath = path.resolve(path.dirname(redirectPath), redirect.configPath);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  validateGeneratedViteConfig(config, environment);

  const assetsDirectory = path.resolve(path.dirname(configPath), config.assets.directory);
  await access(assetsDirectory);
  const headers = await readFile(path.join(assetsDirectory, "_headers"), "utf8");
  validateStaticAssetHeaders(headers);

  return { environment, configPath, worker: config.name, assets: config.assets.directory, valid: true };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  const environment = process.argv[2];
  if (!["staging", "production"].includes(environment)) throw new Error("First argument must be staging or production");
  process.stdout.write(`${JSON.stringify(await checkViteDeployConfig(environment))}\n`);
}
