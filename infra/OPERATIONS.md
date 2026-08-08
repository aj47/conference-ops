# Operator runbook

## Prerequisites

- Cloudflare account with Workers, D1, R2, Queues, Email Routing, and optionally Zero Trust Access enabled
- Terraform 1.8.x, Node.js 22, pnpm, and repository dependencies installed
- a least-privilege Cloudflare API token
- a dedicated R2 S3 access key pair for Terraform state
- verified Email Routing sender address
- separate staging and production hostnames, variables, secrets, and GitHub Environments

Email Routing is optional for a demo staging deployment. Set `ENABLE_CLOUDFLARE_EMAIL=false` to remove the native binding from rendered Jobs configuration. Do not exercise delivery in that mode: attempted email jobs fail into the D1 outbox, retry through the queue, and eventually surface in the DLQ. Production email remains explicit opt-in after sender/domain verification.

Run all examples from the repository root unless a command changes directories.

## Bootstrap remote state

The state bucket has local bootstrap state because a backend cannot create itself.

```bash
cd infra/bootstrap
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
```

Keep `infra/bootstrap/terraform.tfstate*` encrypted and backed up outside the repository. `prevent_destroy` protects the bucket from ordinary Terraform destroys, but it does not protect against dashboard or API deletion.

Create an R2 API token limited to this state bucket, then export it only in the operator shell or CI secret store:

```bash
export AWS_ACCESS_KEY_ID='...'
export AWS_SECRET_ACCESS_KEY='...'
export AWS_ENDPOINT_URL_S3='https://<account-id>.r2.cloudflarestorage.com'
```

## Provision an environment manually

```bash
export CLOUDFLARE_API_TOKEN='...'
cp infra/environments/staging.tfvars.example infra/terraform/staging.auto.tfvars
cd infra/terraform
terraform init -reconfigure -backend-config=../environments/staging.s3.tfbackend
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform apply tfplan
terraform output wrangler_bindings
```

For production, use the production backend and variables. Always confirm the plan names only the intended environment. Never pass application secrets as Terraform variables.

If Terraform discovers existing manually-created resources, import them into the correct environment state rather than recreating them. Retain `prevent_destroy` after import.

## Configure GitHub Environments

Create `staging` and `production` Environments. Restrict both to the `main` branch, protect production with required reviewers, and populate every item in [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md). Leave repository variable `DEPLOY_ENABLED` unset until remote state, environment variables, and secrets are complete; then set it to `true` to enable push-to-main staging deploys.

The R2 S3 backend does not provide Terraform state locking in this stack. GitHub environment concurrency is the deployment single-writer control. Do not run a local apply while CI plan/apply is active; announce manual maintenance and disable automated deploys for its window.

Pushes to `main` invoke the deploy workflow for staging. Production requires `workflow_dispatch`. The workflow serializes each environment and applies this order:

1. reusable CI verification
2. Terraform plan/apply
3. D1 migration
4. optional explicit staging seed
5. Realtime Worker
6. Jobs Worker
7. App Worker and static assets
8. `/api/health` check

The production GitHub Environment approval happens before credentials are released.

## Render and deploy manually

After Terraform apply, get the D1 UUID and render configs. Rendered files may contain environment topology and are ignored by Git.

```bash
export CLOUDFLARE_D1_DATABASE_ID="$(terraform -chdir=infra/terraform output -raw d1_database_id)"
export PUBLIC_APP_URL='https://staging.example.com'
export APP_CUSTOM_DOMAIN='staging.example.com'
export MAIL_FROM='program@example.com'
export MAIL_REPLY_TO='replies@example.com'
export ACCELEVENTS_EVENT_URL=''
export ACCELEVENTS_ENABLED='false'
export ENABLE_CLOUDFLARE_EMAIL='false'
export ENABLE_PREVIEW_ACCESS='false'
node scripts/render-wrangler-config.mjs --environment staging
node scripts/check-deploy-prerequisites.mjs staging
install -m 600 artifacts/wrangler/wrangler.jsonc wrangler.jsonc
install -m 600 artifacts/wrangler/wrangler.jobs.jsonc wrangler.jobs.jsonc
install -m 600 artifacts/wrangler/wrangler.realtime.jsonc wrangler.realtime.jsonc
```

Render secrets from the environment; the files are mode `0600` and the command prints no values:

```bash
node scripts/write-worker-secrets.mjs --worker app --out-file artifacts/secrets/app.json --cleanup-out-file artifacts/secrets/app-cleanup.json
node scripts/write-worker-secrets.mjs --worker jobs --out-file artifacts/secrets/jobs.json --cleanup-out-file artifacts/secrets/jobs-cleanup.json
node scripts/write-worker-secrets.mjs --worker realtime --out-file artifacts/secrets/realtime.json
```

Then follow the CI deployment order:

```bash
pnpm exec wrangler d1 migrations apply DB --remote --env staging --config wrangler.jsonc
CLOUDFLARE_ENV=staging pnpm build
pnpm exec wrangler deploy --env staging --config wrangler.realtime.jsonc --secrets-file artifacts/secrets/realtime.json
pnpm exec wrangler deploy --env staging --config wrangler.jobs.jsonc --secrets-file artifacts/secrets/jobs.json
CLOUDFLARE_ENV=staging pnpm exec wrangler deploy --secrets-file artifacts/secrets/app.json
pnpm exec wrangler secret bulk artifacts/secrets/app-cleanup.json --name conference-ops-staging-app
pnpm exec wrangler secret bulk artifacts/secrets/jobs-cleanup.json --name conference-ops-staging-jobs
curl --fail --retry 5 "$PUBLIC_APP_URL/api/health"
```

Vite writes the App Worker deployment redirect with its built static-assets directory; deploying the rendered source config directly omits those generated assets. Run manual deployments only from a clean checkout. Delete rendered secret files and restore the three checked-in Wrangler templates afterward if the checkout is not ephemeral.

The example above is the integrations-off/no-Access path. When Access is enabled, export matching `APP_CUSTOM_DOMAIN` and `PREVIEW_ACCESS_HOSTNAME`, configure the service-token ID in Terraform, and pass its client ID/secret headers to the health request. When Email is enabled, export the verified sender/reply-to and confirm the deployment token has Email Routing scope.

## Demo seed

Demo seeding is staging-only, explicit, and off by default. It replaces records with deterministic IDs and can cascade over prior demo records; never use it to preserve hand-entered staging data.

The shipped staging Worker uses in-process demo mode for the evaluator walkthrough, so these D1 accounts are for explicit persistence/auth testing rather than the default persona-switching experience. Do not put real data in demo staging.

```bash
export DEMO_USER_PASSWORD='a-unique-staging-only-password'
node scripts/render-demo-seed.mjs
pnpm exec wrangler d1 execute DB --remote --env staging --config artifacts/wrangler/wrangler.jsonc --file artifacts/demo-seed.sql
```

Do not run this command against production. The deployment workflow enforces the same environment restriction.

## Routine checks

- App: `/api/health` returns `status: ok` and the expected environment.
- D1: migration list is fully applied and `PRAGMA foreign_key_check` returns no rows.
- Queue: backlog age is stable; DLQ has no unexplained messages.
- Jobs: outbox does not accumulate `failed` or `dead` rows.
- Realtime: an authorized WebSocket connection receives its initial `connected` message and responds to `ping` with `pong`.
- Email: a test recipient receives a message from the approved sender; calendar invitation times match the event timezone.
- Integrations: preflight succeeds or affected records are deliberately in `manual_action`.
- Public surfaces: the published form version, agenda, speaker gallery, and public iframe match the organizer preview; record any future origin restriction as a separate rollout.

## Incident response and rollback

Start an incident record, name one operator, and stop concurrent deploys.

### Application-only regression

Use Cloudflare deployment history or Wrangler rollback to restore the last known-good Worker version. Roll back App, Jobs, and Realtime independently. Confirm the older code is compatible with current D1 columns before restoring traffic. Static asset and Worker code versions should move together.

### Jobs or queue incident

Pause delivery before replaying an uncontrolled failure. Inspect both the Cloudflare DLQ and D1 outbox. Correct the cause, deploy Jobs, then replay a small sample with the original idempotency keys. Watch `attempts`, `last_error`, and remote side effects before draining the rest.

Never copy a DLQ body into a new job with a new idempotency key unless duplication is explicitly safe.

### Database incident

Wrangler captures a backup before a remote migration. For an accidental data write or bad migration:

1. stop or route away application writers;
2. record the incident time and D1 backup/bookmark before experimenting;
3. export the current database for evidence;
4. restore the candidate backup into staging or a disposable database and run integrity/smoke checks;
5. restore production only after review;
6. deploy a forward-compatible application/migration and verify counts, foreign keys, auth, and the affected workflow.

Never edit or delete an applied migration to simulate rollback.

### Terraform incident

Do not run `terraform destroy` against staging or production. If state and Cloudflare disagree, take a state copy, inspect with `terraform state list` and read-only Cloudflare checks, then import/move exact resources. Do not remove `prevent_destroy` just to make a plan green.

## Offboarding and rotation

- Remove the operator from Cloudflare and GitHub Environment access.
- Revoke personal/API tokens and rotate shared state credentials if scope cannot exclude that operator.
- Rotate deployment, auth, realtime, Access service, and integration secrets as applicable.
- Review recent audit events, Worker deploys, Terraform state changes, and secret access.
