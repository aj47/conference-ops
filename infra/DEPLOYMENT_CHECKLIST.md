# Deployment and secret checklist

Use this checklist for the first environment deployment and every production promotion.

## Cloudflare foundation

- [ ] Account ID is the intended account; staging and production names are distinct.
- [ ] R2 Terraform-state bucket exists and bootstrap state is encrypted/backed up.
- [ ] Dedicated state-bucket access key is stored only as `TF_STATE_ACCESS_KEY_ID` / `TF_STATE_SECRET_ACCESS_KEY`.
- [ ] Backend key is `conference-ops/staging.tfstate` or `conference-ops/production.tfstate` as appropriate.
- [ ] Terraform plan creates or updates only the selected environment.
- [ ] D1, upload R2, jobs queue, DLQ, and state bucket retain `prevent_destroy`.
- [ ] No resource is simultaneously owned by Terraform and Wrangler.

## GitHub Environment variables

- [ ] `CLOUDFLARE_ACCOUNT_ID` — 32-character account ID
- [ ] `CLOUDFLARE_ZONE_ID` — optional zone ID when a custom domain is used
- [ ] `PUBLIC_APP_URL` — exact HTTPS origin, no path
- [ ] `APP_CUSTOM_DOMAIN` — optional hostname only, no scheme/path
- [ ] `MAIL_FROM` — Email Routing-authorized sender
- [ ] `MAIL_REPLY_TO` — monitored reply address; defaults to sender if omitted
- [ ] `ENABLE_CLOUDFLARE_EMAIL` — `true` only when the API token has Email Routing scope and the sender is verified
- [ ] `ACCELEVENTS_EVENT_URL` — event identifier expected by the connector, or blank when integration is disabled
- [ ] `ACCELEVENTS_ENABLED` — keep `false`; enable only after jobs-only credentials plus tested speaker/session upserts and read-back exist
- [ ] `ENABLE_PREVIEW_ACCESS`, `PREVIEW_ACCESS_HOSTNAME`, reviewer email/IdP JSON, and optional service-token ID JSON describe the intended staging policy.
- [ ] `DNS_RECORDS_JSON`, D1/R2 location, and D1 replication variables reflect reviewed Terraform desired state.
- [ ] Queue and DLQ retention are 86400 seconds on Free, or a supported paid-plan value.
- [ ] `DEPLOY_ENABLED=true` is set only after the first four sections of this checklist are complete.

## GitHub Environment secrets

- [ ] `CLOUDFLARE_API_TOKEN` has only required account/zone permissions and an expiry/rotation owner.
- [ ] `TF_STATE_ACCESS_KEY_ID` and `TF_STATE_SECRET_ACCESS_KEY` are dedicated to the state bucket.
- [ ] `BETTER_AUTH_SECRET` is random, at least 32 characters, and unique to this environment.
- [ ] `REALTIME_TOKEN` is random, at least 32 characters, unique, and different from the auth secret.
- [ ] `ACCELEVENTS_API_KEY` is present only after API preflight succeeds.
- [ ] `DEMO_USER_PASSWORD` exists only in staging when explicit seed use is planned.
- [ ] Access health-check service credentials are configured only with a matching least-privilege Access policy.
- [ ] No secret is stored in Terraform variables, `.env`, repository files, workflow logs, or artifacts.

## Domain, Access, and email

- [ ] Worker custom domain resolves to the App Worker and is Wrangler-owned.
- [ ] Staging Access, if enabled, protects the exact custom hostname and includes the intended reviewers.
- [ ] Production does not inherit the preview-only Access configuration.
- [ ] Staging contains synthetic data only; its demo persona mode is never used for real event or attendee records.
- [ ] Confirm whether the public iframe should remain universally embeddable for the event site; origin allowlist enforcement is not enabled in the MVP.
- [ ] Email Routing is active and `MAIL_FROM` is an allowed sender for the Jobs Worker binding.
- [ ] Authentication, communication, and REQUEST/CANCEL calendar messages reach a controlled test mailbox.
- [ ] SPF, DKIM, and DMARC alignment is reviewed for the sending domain.

## Data and migration

- [ ] `pnpm db:generate` reports no uncommitted migration drift.
- [ ] `bash scripts/verify-migrations.sh` succeeds with zero foreign-key violations.
- [ ] Migration SQL has been reviewed for table rebuilds, locks, nullability, and backfill assumptions.
- [ ] Previous application code remains compatible with additive schema changes during rollout.
- [ ] A current D1 recovery point/export is identifiable before production migration.
- [ ] Demo seed is off for production and off for any staging database containing data that must be preserved.

## Application release

- [ ] `pnpm verify` passes.
- [ ] all three Wrangler dry-runs pass with rendered target-environment configuration.
- [ ] Realtime deploys before Jobs; Jobs deploys before App.
- [ ] D1 migrations apply before Workers that require the new schema receive traffic.
- [ ] `/api/health` reports the selected environment.
- [ ] Organizer, reviewer, applicant, and speaker smoke tests use separate accounts.
- [ ] Form draft/public version separation, proposal submission, review, scheduling conflict handling, tasks, upload access, and public embeds are smoke tested.
- [ ] Queue backlog, DLQ, outbox failures, Worker errors, and D1 error rates are watched through the rollout window.

## Integration and fallback

- [ ] Accelevents preflight confirms the API key can access the intended event.
- [ ] One speaker and one session upsert are tested before bulk sync.
- [ ] Read-back confirms remote IDs and values; mappings are recorded locally.
- [ ] Delete propagation is disabled; local deletions require an explicit human decision remotely.
- [ ] Organizer has the CSV fallback package and understands the reconciliation procedure in [ACCELEVENTS.md](ACCELEVENTS.md).

## Promotion and rollback

- [ ] Production GitHub Environment requires a human approver and an allowed branch.
- [ ] Release owner, migration owner, smoke tester, and rollback decision maker are named.
- [ ] Last known-good App, Jobs, and Realtime versions are recorded.
- [ ] Older code/D1 compatibility has been checked; Durable Object changes have a forward-fix plan.
- [ ] Incident channel and maintenance/customer communication path are ready.
