import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { validateGeneratedViteConfig, validateStaticAssetHeaders } from "../../scripts/check-vite-deploy-config.mjs";
import app from "../../src/server/index";
import type { Bindings } from "../../src/server/env";

const readinessToken = "readiness-token-that-is-at-least-32-characters";

function preflight(environment: "staging" | "production", emailEnabled: boolean) {
  return spawnSync(process.execPath, ["scripts/check-deploy-prerequisites.mjs", environment, "--inputs-only"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      CLOUDFLARE_ACCOUNT_ID: "00000000000000000000000000000000",
      CLOUDFLARE_API_TOKEN: "ci-placeholder-token",
      AWS_ACCESS_KEY_ID: "ci-state-key",
      AWS_SECRET_ACCESS_KEY: "ci-state-secret",
      BETTER_AUTH_SECRET: "auth-secret-that-is-at-least-32-characters",
      REALTIME_TOKEN: readinessToken,
      PUBLIC_APP_URL: `https://${environment}.example.com`,
      APP_CUSTOM_DOMAIN: "",
      ENABLE_CLOUDFLARE_EMAIL: String(emailEnabled),
      MAIL_FROM: emailEnabled ? "program@example.com" : "",
      ENABLE_PREVIEW_ACCESS: "false",
      ACCELEVENTS_ENABLED: "false",
    },
  });
}

function generatedConfig(environment: "staging" | "production") {
  return {
    name: `conference-ops-${environment}-app`,
    main: "index.js",
    vars: {
      ENVIRONMENT: environment,
      DEMO_MODE: environment === "staging" ? "true" : "false",
      PUBLIC_APP_URL: `https://${environment}.example.com`,
      BETTER_AUTH_URL: `https://${environment}.example.com`,
    },
    d1_databases: [{ binding: "DB", database_name: `conference-ops-${environment}` }],
    r2_buckets: [{ binding: "UPLOADS", bucket_name: `conference-ops-${environment}-uploads` }],
    queues: { producers: [{ binding: "JOBS_QUEUE", queue: `conference-ops-${environment}-jobs` }] },
    services: [{ binding: "REALTIME", service: `conference-ops-${environment}-realtime` }],
    assets: { binding: "ASSETS", directory: "../client", not_found_handling: "single-page-application", run_worker_first: ["/api/*", "/events/*/embed/agenda"] },
  };
}

function readinessBindings(overrides: Partial<Bindings> = {}): Bindings {
  const first = vi.fn().mockResolvedValue({ ok: 1 });
  const fetch = vi.fn().mockResolvedValue(Response.json({ status: "ok", service: "conference-ops-realtime", durableObject: true }));
  return {
    DB: { prepare: vi.fn(() => ({ first })) } as unknown as D1Database,
    UPLOADS: {} as R2Bucket,
    JOBS_QUEUE: {} as Queue,
    REALTIME: { fetch } as unknown as Fetcher,
    ENVIRONMENT: "production",
    DEMO_MODE: "false",
    PUBLIC_APP_URL: "https://conference.example.com",
    BETTER_AUTH_URL: "https://conference.example.com",
    BETTER_AUTH_SECRET: "auth-secret-that-is-at-least-32-characters",
    REALTIME_TOKEN: readinessToken,
    MAIL_FROM: "program@example.com",
    MAIL_REPLY_TO: "replies@example.com",
    ...overrides,
  };
}

describe("deployment preflight", () => {
  it("does not expose deploy scripts that bypass rendered configuration", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts?: Record<string, string> };
    const mutatingDeployScripts = Object.entries(packageJson.scripts ?? {})
      .filter(([, command]) => /\bwrangler\s+deploy\b/.test(command) && !/(?:^|\s)--dry-run(?:\s|$)/.test(command));

    expect(mutatingDeployScripts).toEqual([]);
  });

  it("requires native email delivery for production account verification", () => {
    const result = preflight("production", false);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Production requires ENABLE_CLOUDFLARE_EMAIL=true");
  });

  it("allows email-disabled staging and email-enabled production", () => {
    expect(preflight("staging", false).status).toBe(0);
    expect(preflight("production", true).status).toBe(0);
  });
});

describe("generated Vite deployment configuration", () => {
  it.each(["staging", "production"] as const)("accepts a complete %s topology", (environment) => {
    expect(validateGeneratedViteConfig(generatedConfig(environment), environment)).toMatchObject({
      name: `conference-ops-${environment}-app`,
      queue: `conference-ops-${environment}-jobs`,
    });
  });

  it("rejects a cross-environment service binding and unresolved tokens", () => {
    const crossed = generatedConfig("production");
    crossed.services[0].service = "conference-ops-staging-realtime";
    expect(() => validateGeneratedViteConfig(crossed, "production")).toThrow(/realtime binding/);

    const unresolved = generatedConfig("staging");
    (unresolved.vars as { ENVIRONMENT: string }).ENVIRONMENT = "__ENVIRONMENT__";
    expect(() => validateGeneratedViteConfig(unresolved, "staging")).toThrow();
  });

  it("requires event-scoped agenda embeds to run through the Worker", () => {
    const config = generatedConfig("staging");
    config.assets.run_worker_first = ["/api/*"];
    expect(() => validateGeneratedViteConfig(config, "staging")).toThrow(/agenda embeds through the Worker/);
  });

  it("allows framing for both legacy and event-scoped agenda embeds", () => {
    const headers = readFileSync("public/_headers", "utf8");
    expect(validateStaticAssetHeaders(headers)).toBe(true);

    expect(() => validateStaticAssetHeaders(headers.replace("/events/:slug/embed/agenda", "/events/:slug/agenda")))
      .toThrow(/\/events\/:slug\/embed\/agenda/);
  });
});

describe("event-scoped agenda embed assets", () => {
  it.each(["GET", "HEAD"] as const)("applies the framing policy at the Worker boundary for %s", async (method) => {
    const assetFetch = vi.fn(async (request: Request) => {
      expect(request.method).toBe(method);
      expect(new URL(request.url).pathname).toBe("/");
      return new Response(method === "GET" ? "embedded app shell" : null, {
        status: 206,
        statusText: "Partial Content",
        headers: {
          "cache-control": "public, max-age=0, must-revalidate",
          "content-security-policy": "default-src 'self'; frame-ancestors 'self'",
          etag: '"asset-version"',
          "cross-origin-opener-policy": "same-origin",
          "x-frame-options": "SAMEORIGIN",
        },
      });
    });
    const bindings = readinessBindings({ ASSETS: { fetch: assetFetch } as unknown as Fetcher });

    const response = await app.request("https://conference.example.com/events/summit-2026/embed/agenda", { method }, bindings);

    expect(assetFetch).toHaveBeenCalledOnce();
    expect(response.status).toBe(206);
    expect(response.statusText).toBe("Partial Content");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors *");
    expect(response.headers.get("content-security-policy")).not.toContain("frame-ancestors 'self'");
    expect(response.headers.get("content-security-policy")).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(response.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
    expect(response.headers.get("x-frame-options")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(response.headers.get("etag")).toBe('"asset-version"');
    expect(response.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(await response.text()).toBe(method === "GET" ? "embedded app shell" : "");
  });

  it("allows the Vite React preamble only in the local development CSP", async () => {
    const assetFetch = vi.fn(async () => new Response("embedded app shell", {
      headers: { "content-security-policy": "frame-ancestors 'self'", "x-frame-options": "SAMEORIGIN" },
    }));
    const bindings = readinessBindings({ ENVIRONMENT: "local", ASSETS: { fetch: assetFetch } as unknown as Fetcher });

    const response = await app.request("http://localhost/events/summit-2026/embed/agenda", undefined, bindings);

    expect(response.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors *");
    expect(response.headers.get("content-security-policy")).not.toContain("upgrade-insecure-requests");
    expect(response.headers.get("x-frame-options")).toBeNull();
  });
});

describe("authenticated readiness", () => {
  it("rejects unauthenticated probes without touching dependencies", async () => {
    const bindings = readinessBindings();
    const response = await app.request("https://conference.example.com/api/ready", undefined, bindings);

    expect(response.status).toBe(401);
    expect(bindings.DB.prepare).not.toHaveBeenCalled();
    expect(bindings.REALTIME?.fetch).not.toHaveBeenCalled();
  });

  it("proves configuration, D1, and the realtime service binding", async () => {
    const bindings = readinessBindings();
    const response = await app.request("https://conference.example.com/api/ready", {
      headers: { authorization: `Bearer ${readinessToken}` },
    }, bindings);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "ready",
      environment: "production",
      checks: { configuration: "ok", database: "ok", realtime: "ok" },
    });
    expect(bindings.DB.prepare).toHaveBeenCalledWith("SELECT 1 AS ok");
    expect(bindings.REALTIME?.fetch).toHaveBeenCalledOnce();
  });

  it("fails closed for production demo mode before dependency probes", async () => {
    const bindings = readinessBindings({ DEMO_MODE: "true" });
    const response = await app.request("https://conference.example.com/api/ready", {
      headers: { authorization: `Bearer ${readinessToken}` },
    }, bindings);

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ status: "not_ready", checks: { configuration: "failed", database: "skipped", realtime: "skipped" } });
    expect(bindings.DB.prepare).not.toHaveBeenCalled();
  });

});
