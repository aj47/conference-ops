#!/usr/bin/env node
/* global fetch, Headers */

// Repeatable stateful-path smoke test. This creates an isolated Wrangler/D1/R2/
// Queue sandbox under the OS temp directory, uses DEMO_MODE=false, signs in
// through Better Auth, and verifies applicant writes both through HTTP and D1.
// ENVIRONMENT stays "local" so Better Auth can issue a non-Secure cookie over
// loopback HTTP; production TLS, Access, Email delivery, and Realtime remain
// deployment smoke-test responsibilities. No remote Wrangler command is used.

import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryPrefix = path.join(tmpdir(), "conference-ops-production-smoke.");
const temporaryDirectory = await mkdtemp(temporaryPrefix);
const stateDirectory = path.join(temporaryDirectory, "state");
const configPath = path.join(temporaryDirectory, "wrangler.smoke.jsonc");
const envPath = path.join(temporaryDirectory, "runtime.env");
const seedPath = path.join(temporaryDirectory, "seed.sql");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const password = `Smoke-${randomBytes(24).toString("base64url")}!`;
const authSecret = randomBytes(48).toString("base64url");
const realtimeToken = randomBytes(48).toString("base64url");
let worker;
let cleaned = false;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert(address && typeof address === "object", "Could not allocate a local port");
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectDirectory,
      env: { ...process.env, CI: "true", NO_COLOR: "1", ...options.env },
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => { stdout += String(chunk); });
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed (${signal ?? code})${stderr ? `\n${stderr}` : ""}`));
    });
  });
}

async function stopWorker() {
  if (!worker || worker.exitCode !== null || worker.signalCode !== null) return;
  worker.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => worker.once("exit", resolve)),
    delay(5_000),
  ]);
  if (worker.exitCode === null && worker.signalCode === null) worker.kill("SIGKILL");
}

async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  await stopWorker();
  if (!temporaryDirectory.startsWith(temporaryPrefix)) throw new Error(`Refusing to remove unexpected directory: ${temporaryDirectory}`);
  await rm(temporaryDirectory, { recursive: true, force: true });
}

process.once("SIGINT", () => cleanup().finally(() => process.exit(130)));
process.once("SIGTERM", () => cleanup().finally(() => process.exit(143)));

const workerLogs = [];
function rememberWorkerLog(chunk) {
  workerLogs.push(String(chunk));
  if (workerLogs.length > 80) workerLogs.shift();
  if (process.env.SMOKE_VERBOSE === "true") process.stderr.write(chunk);
}

function updateCookies(response, cookies) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";", 1)[0];
    const separator = pair.indexOf("=");
    if (separator <= 0) continue;
    const name = pair.slice(0, separator);
    const value = pair.slice(separator + 1);
    if (value) cookies.set(name, value);
    else cookies.delete(name);
  }
}

async function main() {
  const port = await freePort();
  const inspectorPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const config = {
    name: "conference-ops-production-path-smoke",
    main: path.join(projectDirectory, "src/server/index.ts"),
    compatibility_date: "2026-08-08",
    compatibility_flags: ["nodejs_compat"],
    assets: {
      binding: "ASSETS",
      directory: path.join(projectDirectory, "dist/client"),
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*", "/events/*/embed/agenda"],
    },
    vars: {
      ENVIRONMENT: "local",
      DEMO_MODE: "false",
      PUBLIC_APP_URL: origin,
      BETTER_AUTH_URL: origin,
      MAIL_FROM: "smoke@example.invalid",
      MAIL_REPLY_TO: "smoke@example.invalid",
      ACCELEVENTS_ENABLED: "false",
    },
    d1_databases: [{
      binding: "DB",
      database_name: "conference-ops-production-path-smoke",
      database_id: "local-conference-ops-production-path-smoke",
      migrations_dir: path.join(projectDirectory, "migrations"),
    }],
    r2_buckets: [{ binding: "UPLOADS", bucket_name: "conference-ops-production-path-smoke-uploads" }],
    queues: { producers: [{ binding: "JOBS_QUEUE", queue: "conference-ops-production-path-smoke-jobs" }] },
  };

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await writeFile(envPath, `BETTER_AUTH_SECRET=${authSecret}\nREALTIME_TOKEN=${realtimeToken}\n`, { mode: 0o600 });

  await run(process.execPath, ["scripts/render-demo-seed.mjs", "--out-file", seedPath], {
    env: { DEMO_USER_PASSWORD: password },
  });
  await run(pnpm, ["exec", "wrangler", "d1", "migrations", "apply", "DB", "--local", "--persist-to", stateDirectory, "--config", configPath]);
  await run(pnpm, ["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", stateDirectory, "--config", configPath, "--file", seedPath]);
  const future = Date.now() + 30 * 24 * 60 * 60 * 1000;
  await run(pnpm, ["exec", "wrangler", "d1", "execute", "DB", "--local", "--persist-to", stateDirectory, "--config", configPath, "--command", `UPDATE events SET cfp_closes_at = ${future} WHERE id = 'event-aie-2026'; UPDATE submission_forms SET closes_at = ${future}, max_submissions_per_user = 10 WHERE id = 'form-main-cfp';`]);

  worker = spawn(pnpm, [
    "exec", "wrangler", "dev", "--local",
    "--ip", "127.0.0.1", "--port", String(port), "--inspector-port", String(inspectorPort),
    "--persist-to", stateDirectory, "--config", configPath, "--env-file", envPath, "--log-level", "info",
  ], {
    cwd: projectDirectory,
    env: { ...process.env, CI: "true", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  worker.stdout.on("data", rememberWorkerLog);
  worker.stderr.on("data", rememberWorkerLog);

  const deadline = Date.now() + 90_000;
  let health;
  while (Date.now() < deadline) {
    if (worker.exitCode !== null) throw new Error(`Local Worker exited before becoming healthy.\n${workerLogs.join("")}`);
    try {
      health = await fetch(`${origin}/api/health`);
      if (health.ok) break;
    } catch {
      // Wrangler is still starting.
    }
    await delay(250);
  }
  assert(health?.ok, `Local Worker did not become healthy.\n${workerLogs.join("")}`);
  const healthBody = await health.json();
  assert(healthBody.environment === "local", `Unexpected local environment: ${healthBody.environment}`);

  if (process.env.SMOKE_BROWSER_HOLD === "true") {
    process.stdout.write(`${JSON.stringify({ browserSmoke: "ready", origin, email: "leah@example.com", password })}\n`);
    await delay(30 * 60 * 1000);
    return;
  }

  const cookies = new Map();
  async function api(route, init = {}) {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    headers.set("origin", origin);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (cookies.size) headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
    const response = await fetch(`${origin}${route}`, { ...init, headers });
    updateCookies(response, cookies);
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { response, body };
  }

  const unauthorized = await api("/api/v1/bootstrap?eventId=event-aie-2026&role=applicant");
  assert(unauthorized.response.status === 401, `Expected unauthenticated bootstrap to return 401; received ${unauthorized.response.status}`);

  const signIn = await api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: "leah@example.com", password }),
  });
  if (signIn.response.status >= 500) await delay(1_000);
  if (signIn.response.status >= 500 && workerLogs.join("").includes("no such column: account.userId")) {
    throw new Error("Better Auth/D1 schema mismatch: the runtime queries account.userId but the applied migrations create account.user_id");
  }
  assert(signIn.response.status === 200, `Better Auth sign-in failed (${signIn.response.status}): ${JSON.stringify(signIn.body)}`);
  assert(signIn.body?.user?.email === "leah@example.com", "Better Auth returned the wrong user");
  assert(cookies.size > 0, "Better Auth did not issue a session cookie");

  const initialBootstrap = await api("/api/v1/bootstrap?eventId=event-aie-2026&role=applicant");
  assert(initialBootstrap.response.status === 200, `Authenticated bootstrap failed: ${JSON.stringify(initialBootstrap.body)}`);
  assert(initialBootstrap.body?.data?.actor?.id === "user-applicant", "Bootstrap did not resolve the signed-in applicant");
  assert(initialBootstrap.body?.data?.actor?.role === "applicant", "Bootstrap did not resolve applicant membership");
  assert(initialBootstrap.body.data.tasks.some((task) => task.id === "task-4"), "Applicant task was missing from bootstrap");
  const existingEnrollment = await api("/api/v1/enroll", {
    method: "POST",
    body: JSON.stringify({ eventId: "event-aie-2026" }),
  });
  assert(existingEnrollment.response.status === 200 && existingEnrollment.body?.data?.existing === true, `Existing applicant enrollment was not idempotent: ${JSON.stringify(existingEnrollment.body)}`);

  const draftTitle = "Account-synced draft smoke";
  const draftSummary = "A durable account draft used to verify resume, co-speaker updates, submission, and explicit withdrawal.";
  const draftPayload = {
    title: draftTitle,
    summary: draftSummary,
    category: "Developer experience",
    format: "panel",
    durationMinutes: 45,
    level: "intermediate",
    responses: {
      "field-title": draftTitle,
      "field-summary": draftSummary,
      "field-category": "Developer experience",
      "field-format": "Panel",
      "field-repo": "https://example.com/account-draft-smoke",
    },
    speakers: [
      { name: "Leah Okafor", email: "leah@example.com", title: "Founder", company: "Tracewell", bio: "Builds observability systems for long-running AI workflows." },
      { name: "Sam Rivera", email: "sam.rivera@example.com", title: "Staff Engineer", company: "Northstar", bio: "Builds durable agent infrastructure." },
    ],
    submit: false,
  };
  const unknownResponseRejected = await api("/api/v1/events/event-aie-2026/submissions", {
    method: "POST",
    body: JSON.stringify({
      formId: "form-main-cfp",
      ...draftPayload,
      responses: { ...draftPayload.responses, "field-not-published": "must not persist" },
    }),
  });
  assert(unknownResponseRejected.response.status === 422 && unknownResponseRejected.body?.error?.code === "FORM_VALIDATION_FAILED", `Unknown form response was not rejected: ${JSON.stringify(unknownResponseRejected.body)}`);
  const draftCreated = await api("/api/v1/events/event-aie-2026/submissions", {
    method: "POST",
    body: JSON.stringify({ formId: "form-main-cfp", ...draftPayload }),
  });
  assert(draftCreated.response.status === 201 && draftCreated.body?.data?.status === "draft", `Account draft creation failed: ${JSON.stringify(draftCreated.body)}`);
  const draftProposalId = draftCreated.body.data.id;

  const draftBootstrap = await api("/api/v1/bootstrap?eventId=event-aie-2026&role=applicant");
  const restoredDraft = draftBootstrap.body?.data?.proposals?.find((proposal) => proposal.id === draftProposalId);
  assert(restoredDraft?.version === 1, `Draft bootstrap did not expose version 1: ${JSON.stringify(restoredDraft)}`);
  assert(restoredDraft?.responses?.["field-repo"] === "https://example.com/account-draft-smoke", "Draft bootstrap did not preserve raw versioned responses");
  assert(restoredDraft?.speakers?.length === 2, `Draft bootstrap did not preserve both speakers: ${JSON.stringify(restoredDraft?.speakers)}`);

  const updatedDraftTitle = `${draftTitle} · resumed`;
  const draftUpdated = await api(`/api/v1/events/event-aie-2026/submissions/${draftProposalId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...draftPayload,
      title: updatedDraftTitle,
      responses: { ...draftPayload.responses, "field-title": updatedDraftTitle, "field-repo": "https://example.com/restored-account-draft" },
      speakers: [
        draftPayload.speakers[0],
        { name: "Bo Chen", email: "bo.chen@example.com", title: "Researcher", company: "Open Lab", bio: "Studies reliable evaluation systems." },
      ],
      expectedVersion: 1,
    }),
  });
  assert(draftUpdated.response.status === 200 && draftUpdated.body?.data?.version === 2, `Account draft update failed: ${JSON.stringify(draftUpdated.body)}`);

  const updatedBootstrap = await api("/api/v1/bootstrap?eventId=event-aie-2026&role=applicant");
  const resumedDraft = updatedBootstrap.body?.data?.proposals?.find((proposal) => proposal.id === draftProposalId);
  assert(resumedDraft?.title === updatedDraftTitle && resumedDraft?.version === 2, `Resumed draft was not projected with its new version: ${JSON.stringify(resumedDraft)}`);
  assert(resumedDraft?.speakers?.length === 2 && resumedDraft.speakers.some((speaker) => speaker.email === "bo.chen@example.com"), `Resumed draft co-speaker roster was not reconciled: ${JSON.stringify(resumedDraft?.speakers)}`);

  const draftSubmitted = await api(`/api/v1/events/event-aie-2026/submissions/${draftProposalId}`, {
    method: "PUT",
    body: JSON.stringify({
      ...draftPayload,
      title: updatedDraftTitle,
      responses: { ...draftPayload.responses, "field-title": updatedDraftTitle, "field-repo": "https://example.com/restored-account-draft" },
      speakers: [draftPayload.speakers[0], { name: "Bo Chen", email: "bo.chen@example.com", title: "Researcher", company: "Open Lab", bio: "Studies reliable evaluation systems." }],
      submit: true,
      expectedVersion: 2,
    }),
  });
  assert(draftSubmitted.response.status === 200 && draftSubmitted.body?.data?.status === "under_review", `Resumed draft submission failed: ${JSON.stringify(draftSubmitted.body)}`);
  const draftWithdrawn = await api(`/api/v1/events/event-aie-2026/submissions/${draftProposalId}/withdraw`, { method: "POST" });
  assert(draftWithdrawn.response.status === 200 && draftWithdrawn.body?.data?.status === "withdrawn", `Applicant withdrawal failed: ${JSON.stringify(draftWithdrawn.body)}`);

  const proposalTitle = "Production-path smoke proposal";
  const submission = await api("/api/v1/events/event-aie-2026/submissions", {
    method: "POST",
    body: JSON.stringify({
      formId: "form-main-cfp",
      title: proposalTitle,
      summary: "A local production-path check for authenticated persistence, routing, assignment, and task completion.",
      category: "Evaluation & safety",
      format: "talk",
      durationMinutes: 30,
      level: "intermediate",
      responses: {
        "field-title": proposalTitle,
        "field-summary": "A local production-path check for authenticated persistence, routing, assignment, and task completion.",
        "field-category": "Developer experience",
        "field-format": "Talk",
        "field-repo": "https://example.com/conference-ops-smoke",
      },
      speakers: [{
        name: "Leah Okafor",
        email: "leah@example.com",
        title: "Founder",
        company: "Tracewell",
        bio: "Builds observability systems for long-running AI workflows.",
      }],
      submit: true,
    }),
  });
  assert(submission.response.status === 201, `Applicant submission failed (${submission.response.status}): ${JSON.stringify(submission.body)}`);
  assert(submission.body?.data?.status === "under_review", `Unexpected submitted proposal status: ${submission.body?.data?.status}`);
  assert(submission.body?.data?.assignments === 1, `Expected one review assignment; received ${submission.body?.data?.assignments}`);
  assert(submission.body?.data?.confirmationQueued === true, "Submission confirmation intent was not queued");
  const proposalId = submission.body.data.id;
  assert(/^[0-9a-f-]{36}$/i.test(proposalId), `Unexpected proposal id: ${proposalId}`);

  const task = await api("/api/v1/events/event-aie-2026/tasks/task-4/complete", {
    method: "POST",
    body: JSON.stringify({ complete: true }),
  });
  assert(task.response.status === 200, `Applicant task completion failed: ${JSON.stringify(task.body)}`);
  assert(task.body?.data?.status === "complete", "Applicant task was not completed");

  const finalBootstrap = await api("/api/v1/bootstrap?eventId=event-aie-2026&role=applicant");
  assert(finalBootstrap.response.status === 200, "Final bootstrap failed");
  assert(finalBootstrap.body.data.proposals.some((proposal) => proposal.id === proposalId && proposal.title === proposalTitle), "Persisted proposal was missing from bootstrap");
  assert(finalBootstrap.body.data.tasks.some((candidate) => candidate.id === "task-4" && candidate.status === "complete"), "Persisted task completion was missing from bootstrap");

  cookies.clear();
  const organizerSignIn = await api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: "maya@aiengineer.events", password }),
  });
  assert(organizerSignIn.response.status === 200, `Organizer sign-in failed (${organizerSignIn.response.status}): ${JSON.stringify(organizerSignIn.body)}`);
  assert(organizerSignIn.body?.user?.id === "user-organizer", `Organizer sign-in returned the wrong user: ${JSON.stringify(organizerSignIn.body?.user)}`);
  const organizerBootstrap = await api("/api/v1/bootstrap?eventId=event-aie-2026&role=organizer");
  assert(organizerBootstrap.response.status === 200, `Organizer bootstrap failed: ${JSON.stringify(organizerBootstrap.body)}`);
  assert(organizerBootstrap.body?.data?.actor?.role === "organizer", `Organizer bootstrap returned role ${organizerBootstrap.body?.data?.actor?.role}`);

  const stagedDecision = await api(`/api/v1/events/event-aie-2026/proposals/${proposalId}/decision`, {
    method: "POST",
    body: JSON.stringify({ status: "accept_queue", note: "Production-path committee staging." }),
  });
  assert(stagedDecision.response.status === 200, `Organizer queue move failed: ${JSON.stringify(stagedDecision.body)}`);
  assert(stagedDecision.body?.data?.status === "accept_queue", `Unexpected staged proposal status: ${stagedDecision.body?.data?.status}`);
  assert(Number(stagedDecision.body?.data?.speakerTasksCreated) === 0, "A staged queue move created onboarding work before final acceptance");

  const decision = await api(`/api/v1/events/event-aie-2026/proposals/${proposalId}/decision`, {
    method: "POST",
    body: JSON.stringify({ status: "accepted", note: "Production-path acceptance creates onboarding work." }),
  });
  assert(decision.response.status === 200, `Organizer decision failed: ${JSON.stringify(decision.body)}`);
  assert(decision.body?.data?.status === "accepted", `Unexpected final proposal status: ${decision.body?.data?.status}`);
  assert(Number(decision.body?.data?.speakerTasksCreated) >= 1, "Acceptance did not instantiate speaker tasks");
  const acceptedWorkspace = await api("/api/v1/bootstrap?eventId=event-aie-2026&role=organizer");
  const acceptedFormTask = acceptedWorkspace.body?.data?.tasks?.find((candidate) =>
    candidate.speakerId === "speaker-leah" && candidate.formId === "form-logistics",
  );
  assert(acceptedFormTask?.id, `Acceptance did not expose Leah's linked logistics form task: ${JSON.stringify(acceptedWorkspace.body?.data?.tasks)}`);
  assert(acceptedFormTask.proposalId === proposalId, `Submission task was not scoped to its accepted proposal: ${JSON.stringify(acceptedFormTask)}`);
  assert(acceptedFormTask.targetTitle === proposalTitle, `Submission task did not project its proposal title: ${JSON.stringify(acceptedFormTask)}`);

  const outsideWindow = await api("/api/v1/events/event-aie-2026/sessions/session-unscheduled/schedule", {
    method: "POST",
    body: JSON.stringify({
      roomId: "room-cowell",
      trackId: "track-build",
      startsAt: "2026-08-30T00:45:00.000Z",
      endsAt: "2026-08-30T01:15:00.000Z",
    }),
  });
  assert(outsideWindow.response.status === 422 && outsideWindow.body?.error?.code === "OUTSIDE_EVENT_WINDOW", `Out-of-window schedule was not rejected: ${JSON.stringify(outsideWindow.body)}`);

  const agenda = await api("/api/v1/events/event-aie-2026/agenda/publish", {
    method: "POST",
    body: JSON.stringify({ sessionIds: ["session-evals", "session-redteam"] }),
  });
  assert(agenda.response.status === 200, `Agenda publication failed: ${JSON.stringify(agenda.body)}`);
  assert(agenda.body?.data?.publishedSessions === 2, "Agenda publication did not validate the complete selection");

  const acceptanceIdempotencyKey = `smoke-acceptance:${proposalId}`;
  const communication = await api("/api/v1/events/event-aie-2026/communications/send", {
    method: "POST",
    headers: { "idempotency-key": acceptanceIdempotencyKey },
    body: JSON.stringify({ kind: "acceptance", recipientIds: ["speaker-leah"] }),
  });
  assert(communication.response.status === 202, `Acceptance communication was not accepted: ${JSON.stringify(communication.body)}`);
  assert(communication.body?.data?.queued === 1, "Acceptance communication did not persist one job");

  const createdEvent = await api("/api/v1/events", {
    method: "POST",
    body: JSON.stringify({
      organizationName: "Production Path Events",
      name: "Production Path Conference 2027",
      shortName: "PPC 2027",
      slug: "production-path-conference-2027",
      description: "A clean event proves the organizer can start the complete lifecycle without seed-only configuration.",
      timezone: "America/Los_Angeles",
      startsAt: "2027-08-28T16:00:00.000Z",
      endsAt: "2027-08-29T01:00:00.000Z",
      cfpClosesAt: "2027-07-31T23:00:00.000Z",
      venue: "Test venue",
      websiteUrl: "https://example.com/production-path-2027",
      accent: "#2d6a6c",
    }),
  });
  assert(createdEvent.response.status === 201, `Fresh event creation failed: ${JSON.stringify(createdEvent.body)}`);
  const createdEventId = createdEvent.body?.data?.id;
  assert(/^[0-9a-f-]{36}$/i.test(createdEventId), `Unexpected created event id: ${createdEventId}`);
  const freshWorkspace = await api(`/api/v1/bootstrap?eventId=${encodeURIComponent(createdEventId)}`);
  assert(freshWorkspace.response.status === 200, `Fresh event bootstrap failed: ${JSON.stringify(freshWorkspace.body)}`);
  assert(freshWorkspace.body?.data?.actor?.role === "organizer", "Fresh event did not grant organizer membership");
  const freshForms = freshWorkspace.body?.data?.forms ?? [];
  assert(freshForms.filter((form) => form.kind === "cfp" && form.status === "draft").length === 1, "Fresh event did not initialize one private CFP draft");
  assert(freshForms.filter((form) => form.kind === "portal" && form.status === "published").length === 2, "Fresh event did not initialize hotel and flight portal forms");
  assert(freshWorkspace.body?.data?.taskTemplates?.length === 5, "Fresh event did not initialize the five-task onboarding plan");
  assert(freshWorkspace.body?.data?.messageTemplates?.length === 5, "Fresh event did not initialize workflow message templates");
  assert(freshWorkspace.body?.data?.reminderRules?.length === 2, "Fresh event did not initialize scheduled reminder rules");
  assert(freshWorkspace.body?.data?.rooms?.length === 1 && freshWorkspace.body?.data?.tracks?.length === 1, "Fresh event did not initialize schedule resources");

  cookies.clear();
  const applicantSignInAgain = await api("/api/auth/sign-in/email", {
    method: "POST",
    body: JSON.stringify({ email: "leah@example.com", password }),
  });
  assert(applicantSignInAgain.response.status === 200, `Applicant re-authentication failed: ${JSON.stringify(applicantSignInAgain.body)}`);
  const invalidTaskResponse = await api(`/api/v1/events/event-aie-2026/tasks/${acceptedFormTask.id}/response`, {
    method: "POST",
    body: JSON.stringify({
      responses: {
        "field-layout": "Classroom",
        "field-installs": "A current browser and a GitHub account.",
        "field-not-published": "must not persist",
      },
      submit: false,
    }),
  });
  assert(invalidTaskResponse.response.status === 422 && invalidTaskResponse.body?.error?.code === "FORM_VALIDATION_FAILED", `Unknown task response was not rejected: ${JSON.stringify(invalidTaskResponse.body)}`);
  const validTaskResponse = await api(`/api/v1/events/event-aie-2026/tasks/${acceptedFormTask.id}/response`, {
    method: "POST",
    body: JSON.stringify({
      responses: {
        "field-layout": "Classroom",
        "field-installs": "A current browser and a GitHub account.",
        "field-network": "Reliable Wi-Fi and one outlet per attendee.",
      },
      submit: true,
    }),
  });
  assert(validTaskResponse.response.status === 200 && validTaskResponse.body?.data?.taskStatus === "complete", `Valid task form response failed: ${JSON.stringify(validTaskResponse.body)}`);

  await stopWorker();
  const verification = await run(pnpm, [
    "exec", "wrangler", "d1", "execute", "DB", "--local", "--json",
    "--persist-to", stateDirectory, "--config", configPath,
    "--command", `SELECT
      (SELECT COUNT(*) FROM session WHERE user_id = 'user-applicant') AS sessions,
      (SELECT COUNT(*) FROM proposals WHERE id = '${proposalId}' AND owner_user_id = 'user-applicant' AND status = 'accepted') AS proposals,
      (SELECT COUNT(*) FROM proposals WHERE id = '${proposalId}' AND category = 'Developer experience' AND reviewer_group_id = 'group-dx') AS canonical_routing,
      (SELECT COUNT(*) FROM proposal_speakers WHERE proposal_id = '${proposalId}') AS speaker_links,
      (SELECT COUNT(*) FROM review_assignments WHERE proposal_id = '${proposalId}' AND reviewer_user_id = 'user-reviewer') AS assignments,
      (SELECT COUNT(*) FROM outbox WHERE idempotency_key = 'submission-confirmation:${proposalId}' AND status = 'queued') AS outbox_rows,
      (SELECT COUNT(*) FROM outbox WHERE idempotency_key = '${acceptanceIdempotencyKey}:speaker-leah' AND status = 'queued') AS communication_outbox_rows,
      (SELECT COUNT(*) FROM speaker_tasks WHERE speaker_profile_id = 'speaker-leah' AND event_id = 'event-aie-2026') AS accepted_speaker_tasks,
      (SELECT COUNT(*) FROM speaker_tasks WHERE speaker_profile_id = 'speaker-leah' AND event_id = 'event-aie-2026' AND proposal_id = '${proposalId}') AS accepted_submission_tasks,
      (SELECT COUNT(*) FROM speaker_tasks WHERE speaker_profile_id = 'speaker-leah' AND event_id = 'event-aie-2026' AND proposal_id IS NULL) AS accepted_contact_tasks,
      (SELECT public_agenda_revision FROM events WHERE id = 'event-aie-2026') AS agenda_revision,
      (SELECT COUNT(*) FROM speaker_tasks WHERE id = 'task-4' AND status = 'complete') AS completed_tasks,
      (SELECT COUNT(*) FROM proposals WHERE id = '${draftProposalId}' AND owner_user_id = 'user-applicant' AND status = 'withdrawn' AND version = 4) AS withdrawn_drafts,
      (SELECT COUNT(*) FROM proposal_speakers ps JOIN speaker_profiles sp ON sp.id = ps.speaker_profile_id WHERE ps.proposal_id = '${draftProposalId}' AND sp.email IN ('leah@example.com', 'bo.chen@example.com')) AS resumed_draft_speakers,
      (SELECT COUNT(*) FROM events WHERE id = '${createdEventId}' AND status = 'draft') AS fresh_events,
      (SELECT COUNT(*) FROM submission_forms WHERE event_id = '${createdEventId}' AND kind = 'cfp' AND status = 'draft') AS fresh_cfp_forms,
      (SELECT COUNT(*) FROM submission_forms WHERE event_id = '${createdEventId}' AND kind = 'portal' AND status = 'published') AS fresh_portal_forms,
      (SELECT COUNT(*) FROM review_rounds WHERE event_id = '${createdEventId}' AND status = 'active') AS fresh_review_rounds,
      (SELECT COUNT(*) FROM task_templates WHERE event_id = '${createdEventId}') AS fresh_task_templates,
      (SELECT COUNT(*) FROM message_templates WHERE event_id = '${createdEventId}' AND kind IS NOT NULL) AS fresh_message_templates,
      (SELECT COUNT(*) FROM communication_schedules WHERE event_id = '${createdEventId}') AS fresh_reminder_rules,
      (SELECT COUNT(*) FROM task_responses WHERE task_id = '${acceptedFormTask.id}' AND status = 'submitted' AND json_extract(responses, '$.field-layout') = 'Classroom') AS validated_task_responses,
      (SELECT COUNT(*) FROM pragma_foreign_key_check) AS foreign_key_violations;`,
  ], { capture: true });
  const row = JSON.parse(verification.stdout)[0]?.results?.[0];
  assert(row, "D1 verification returned no row");
  for (const key of ["sessions", "proposals", "canonical_routing", "speaker_links", "assignments", "outbox_rows", "communication_outbox_rows", "accepted_speaker_tasks", "accepted_submission_tasks", "accepted_contact_tasks", "agenda_revision", "completed_tasks", "withdrawn_drafts", "resumed_draft_speakers", "fresh_events", "fresh_cfp_forms", "fresh_portal_forms", "fresh_review_rounds", "fresh_task_templates", "fresh_message_templates", "fresh_reminder_rules", "validated_task_responses"]) {
    assert(Number(row[key]) >= 1, `Expected persisted ${key}; received ${row[key]}`);
  }
  assert(Number(row.accepted_submission_tasks) === 2, `Expected two proposal-target tasks; received ${row.accepted_submission_tasks}`);
  assert(Number(row.accepted_contact_tasks) === 4, `Expected four speaker-target tasks without proposal duplication; received ${row.accepted_contact_tasks}`);
  assert(Number(row.fresh_portal_forms) === 2, `Expected two fresh-event portal forms; received ${row.fresh_portal_forms}`);
  assert(Number(row.fresh_task_templates) === 5, `Expected five fresh-event onboarding templates; received ${row.fresh_task_templates}`);
  assert(Number(row.fresh_message_templates) === 5, `Expected five fresh-event message templates; received ${row.fresh_message_templates}`);
  assert(Number(row.fresh_reminder_rules) === 2, `Expected two fresh-event reminder rules; received ${row.fresh_reminder_rules}`);
  assert(Number(row.foreign_key_violations) === 0, `D1 has ${row.foreign_key_violations} foreign-key violations`);

  process.stdout.write(`${JSON.stringify({
    productionPathSmoke: "passed",
    demoMode: false,
    auth: "better-auth-email-password",
    bootstrap: "applicant",
    applicantDraft: { restored: true, updatedVersion: 2, coSpeakers: 2, submittedThenWithdrawn: true },
    submission: { status: "accepted", reviewAssignments: 1, canonicalCategoryRouting: true, unknownResponsesRejected: true, confirmationIntent: "outbox+local-queue", onboardingTasks: "instantiated" },
    agenda: { publishedSessions: 2, outsideWindowRejected: true },
    communications: { acceptanceIntent: "outbox+local-queue" },
    freshEvent: { id: createdEventId, cfp: "draft", portalForms: 2, roomAndTrack: "initialized", reviewRound: "active", onboardingTemplates: 5, messageTemplates: 5, reminderRules: 2 },
    task: { id: "task-4", status: "complete", formResponseValidated: true, unknownResponsesRejected: true },
    persistence: "isolated-local-d1",
    foreignKeyViolations: 0,
    limitations: ["local HTTP uses ENVIRONMENT=local for non-Secure cookies", "no live Cloudflare bindings, Email Routing delivery, Access policy, or Realtime service are exercised"],
  })}\n`);
}

try {
  await main();
} catch (error) {
  if (workerLogs.length) process.stderr.write(`\nLocal Worker log tail:\n${workerLogs.join("")}\n`);
  throw error;
} finally {
  await cleanup();
}
