# Conference Ops

Conference Ops is a Cloudflare-native workspace for running a call for proposals through review, speaker onboarding, scheduling, publishing, and external event-platform handoff. It is designed around the work an organizer actually needs to finish: multiple versioned CFPs, track-to-reviewer routing, review queues, controlled revisions, automatic acceptance activation, organizer-authored onboarding forms and file requests, collaborative file history, conflict-aware scheduling, participant resources, working communications/calendar delivery, public embeds, Airtable canonical records, audit history, and operational reporting.

**Live walkthrough:** [conference-ops-staging-app.techfren.workers.dev](https://conference-ops-staging-app.techfren.workers.dev) · [Public CFP](https://conference-ops-staging-app.techfren.workers.dev/submit/ai-engineer-summit-2026) · [Published agenda](https://conference-ops-staging-app.techfren.workers.dev/events/ai-engineer-summit-2026/agenda)

The staging walkthrough starts in demo mode and includes an in-product persona switcher for organizer, reviewer, applicant, and speaker journeys. No setup or credentials are required.

Organizers can also start from a clean account instead of seed data. Creating an event grants organizer access and initializes a private CFP draft, a routed review round, a Main room and General track, hotel-stay and flight-reimbursement forms, profile/slides/calendar tasks, decision and reminder templates, scheduled reminder rules, and public agenda/gallery embeds. The **Program setup** workspace lets organizers map every CFP track to one or more reviewers, configure the active scoring plan, edit persistent onboarding tasks, publish participant resources, write the messages the workflow actually sends, tune reminder timing, and ask a read-only readiness assistant what needs attention next. Rooms and tracks remain fully organizer-managed as the venue plan changes.

The current product boundary and the evidence-backed comparison with Sessionboard's participant and organizer workflows are documented in [docs/SESSIONBOARD-PARITY.md](docs/SESSIONBOARD-PARITY.md).

## Prospective-client pilot

The persistent organizer pilot is a separate, non-demo Workers.dev environment. Each prospect creates and verifies an account, receives an isolated organization, and creates an event from scratch. The in-product Control Room includes a nine-step trial runway and links to the bundled [Organizer Trial Guide](public/conference-ops-organizer-trial-guide.pdf).

The pilot defaults to a 30-day evaluation, synthetic or representative test data, native Cloudflare email, and disabled Accelevents. Airtable is the canonical business-record system when its per-environment connection is commissioned; D1 remains the transactional workflow mirror and continues to own authentication, authorization, queue leases, and upload metadata. Provision it with the `pilot` Terraform and Wrangler environment; do not reuse the demo staging database or its persona switcher.

## Stack

- React and Vite for the browser application
- Hono Workers API and Better Auth
- Cloudflare D1 for relational state
- private R2 storage for speaker files
- Cloudflare Queues plus a DLQ for email, calendar, and integration jobs
- Airtable canonical business records with webhook reconciliation and guarded Workflow Commands
- a Durable Object Worker for event-scoped realtime updates
- Terraform for stateful account resources; Wrangler for Worker code, bindings, routes, and Durable Object migrations

The deployment model requires pilot, staging, and production to use separate databases, buckets, queues, Workers, secrets, and Terraform state keys whenever those environments are provisioned. See [ARCHITECTURE.md](ARCHITECTURE.md) for the service boundaries and [infra/OPERATIONS.md](infra/OPERATIONS.md) for the runbook.

## Local development

Requirements: Node.js 22, pnpm, and the versions of Wrangler and Drizzle pinned in `package.json`.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm db:migrate:local
pnpm dev
```

The default local configuration runs in demo mode. It is useful for product review without an account or external services.

To exercise the real D1-backed account and workflow data, render a demo seed with a password that is never committed:

```bash
mkdir -p artifacts
DEMO_USER_PASSWORD='choose-a-local-password' node scripts/render-demo-seed.mjs
pnpm exec wrangler d1 execute DB --local --file artifacts/demo-seed.sql
```

The seed creates four verified roles with the same supplied password:

| Role | Email |
| --- | --- |
| Organizer | `maya@aiengineer.events` |
| Reviewer | `dev@aiengineer.events` |
| Applicant | `leah@example.com` |
| Speaker | `marco@example.com` |

The seed is intentionally outside `migrations/`; it is never applied as part of a production migration.

## Verification

```bash
pnpm verify
pnpm smoke:production-local
pnpm test:e2e
pnpm audit --prod
bash scripts/verify-migrations.sh
terraform fmt -check -recursive infra
```

The end-to-end suite covers the organizer schedule lifecycle, public CFP, speaker portal, agenda/embed, communications, and exports in desktop Chromium and a mobile WebKit viewport.

`verify-migrations.sh` creates an isolated temporary D1, applies every generated migration, renders the password hash, loads the realistic seed, checks representative row counts, and runs `PRAGMA foreign_key_check`.

`pnpm smoke:production-local` is the stateful release-path gate that demo mode cannot provide. It creates an isolated local D1/R2/Queue sandbox and ephemeral credentials, starts the Worker with `DEMO_MODE=false`, and signs in real applicant and organizer accounts through Better Auth. The harness creates, restores, edits, submits, and withdraws an account-owned multi-speaker draft; routes another submission to review; completes a task; accepts the proposal and verifies automatic session, speaker-access, onboarding-task, and decision-email activation; rejects an out-of-window schedule write; atomically publishes an agenda selection; persists durable submission and acceptance communications; and initializes a fresh event with its operational defaults. It then checks the resulting workflow records and foreign-key integrity directly in D1, always removes its temporary state, and never invokes Wrangler with `--remote`.

The harness deliberately uses loopback HTTP with `ENVIRONMENT=local` so the session cookie can be tested without a local TLS certificate. It does not replace deployment checks for Secure cookies, Cloudflare Access, Email Routing delivery, Realtime service bindings, or remote resource permissions.

When the schema changes, edit `src/server/db/schema.ts`, then generate rather than hand-writing the migration:

```bash
pnpm db:generate
```

Review generated SQL before committing it. A production rollback is a new forward migration or a tested D1 restore, never deletion of an applied migration.

## Cloudflare deployment

Infrastructure is split deliberately:

- `infra/terraform/` owns D1, R2, queues, the DLQ, optional non-Worker DNS, and optional staging Access.
- `wrangler*.jsonc` owns application, jobs, and realtime Workers plus their bindings and Worker custom domains.
- `infra/bootstrap/` creates the R2 bucket used for Terraform state. Bootstrap state remains local and protected.
- `.github/workflows/deploy.yml` serializes Terraform, D1 migration, and the realtime → jobs → app rollout.

Pushes to `main` always verify. They deploy staging only after the repository variable `DEPLOY_ENABLED=true` is deliberately set; this keeps the initial repository green before Cloudflare state and secrets exist. Production is manual and should use a protected GitHub Environment with required reviewers. Demo seeding is an explicit staging-only workflow option and defaults off.

Release status on 2026-08-09: the linked demo staging environment was provisioned manually and is not yet imported into Terraform state; production is not provisioned. Do not run Terraform apply against the live staging resources until the state bucket exists and those exact resources have been imported and reconciled to a zero-change plan.

Before the first deployment, complete [infra/DEPLOYMENT_CHECKLIST.md](infra/DEPLOYMENT_CHECKLIST.md). Airtable provisioning, authority cutover, and recovery are in [infra/AIRTABLE.md](infra/AIRTABLE.md). Accelevents remains optional and is documented in [infra/ACCELEVENTS.md](infra/ACCELEVENTS.md).

## Useful commands

```bash
# Check that a rendered config contains the right environment and no tokens
node scripts/check-deploy-prerequisites.mjs staging

# Render configs after Terraform returns the D1 ID
CLOUDFLARE_D1_DATABASE_ID=... \
PUBLIC_APP_URL=https://staging.example.com \
MAIL_FROM=program@example.com \
node scripts/render-wrangler-config.mjs --environment staging

# Compile all three Workers without uploading
# In a clean/ephemeral checkout, activate the rendered configs first.
install -m 600 artifacts/wrangler/wrangler.jsonc wrangler.jsonc
install -m 600 artifacts/wrangler/wrangler.jobs.jsonc wrangler.jobs.jsonc
install -m 600 artifacts/wrangler/wrangler.realtime.jsonc wrangler.realtime.jsonc
pnpm exec wrangler deploy --dry-run --env staging --config wrangler.realtime.jsonc
pnpm exec wrangler deploy --dry-run --env staging --config wrangler.jobs.jsonc
CLOUDFLARE_ENV=staging pnpm build
CLOUDFLARE_ENV=staging pnpm exec wrangler deploy --dry-run
```

## License

MIT. See [LICENSE](LICENSE).
