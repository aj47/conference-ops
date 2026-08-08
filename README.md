# Conference Ops

Conference Ops is a Cloudflare-native workspace for running a call for proposals through review, speaker onboarding, scheduling, publishing, and external event-platform handoff. It is designed around the work an organizer actually needs to finish: versioned forms, review queues, conflict-aware scheduling, task-linked forms and file requests, a speaker portal, public embeds, communications, audit history, and operational reporting.

**Live walkthrough:** [conference-ops-staging-app.techfren.workers.dev](https://conference-ops-staging-app.techfren.workers.dev) · [Public CFP](https://conference-ops-staging-app.techfren.workers.dev/submit/ai-engineer-summit-2026) · [Published agenda](https://conference-ops-staging-app.techfren.workers.dev/agenda)

The staging walkthrough starts in demo mode and includes an in-product persona switcher for organizer, reviewer, applicant, and speaker journeys. No setup or credentials are required.

## Stack

- React and Vite for the browser application
- Hono Workers API and Better Auth
- Cloudflare D1 for relational state
- private R2 storage for speaker files
- Cloudflare Queues plus a DLQ for email, calendar, and integration jobs
- a Durable Object Worker for event-scoped realtime updates
- Terraform for stateful account resources; Wrangler for Worker code, bindings, routes, and Durable Object migrations

The staging and production environments use separate databases, buckets, queues, Workers, secrets, and Terraform state keys. See [ARCHITECTURE.md](ARCHITECTURE.md) for the service boundaries and [infra/OPERATIONS.md](infra/OPERATIONS.md) for the runbook.

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
pnpm test:e2e
pnpm audit --prod
bash scripts/verify-migrations.sh
terraform fmt -check -recursive infra
```

The end-to-end suite covers the organizer schedule lifecycle, public CFP, speaker portal, agenda/embed, communications, and exports in desktop Chromium and a mobile WebKit viewport.

`verify-migrations.sh` creates an isolated temporary D1, applies every generated migration, renders the password hash, loads the realistic seed, checks representative row counts, and runs `PRAGMA foreign_key_check`.

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

Before the first deployment, complete [infra/DEPLOYMENT_CHECKLIST.md](infra/DEPLOYMENT_CHECKLIST.md). Integration behavior and the manual import path are in [infra/ACCELEVENTS.md](infra/ACCELEVENTS.md).

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
