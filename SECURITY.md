# Security

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or exposed credential. Use the repository's private security-advisory channel and include affected routes, environment, reproduction steps, and whether any data or secret may have been accessed. Revoke exposed credentials before investigation continues.

## Trust boundaries

- Better Auth sessions identify users; event memberships authorize organizer, reviewer, applicant, and speaker operations.
- Cloudflare Access is optional defense in depth for a staging hostname. It does not replace application authorization and is intentionally blocked from production by Terraform's configuration guard.
- The browser never receives `BETTER_AUTH_SECRET`, `REALTIME_TOKEN`, Cloudflare credentials, R2 credentials, or the Accelevents API key.
- The Realtime Worker accepts application traffic only with its independent bearer secret.
- D1 is authoritative. Accelevents and public embeds receive deliberately limited projections.

All new API writes should validate the actor's event membership, scope object lookup by `event_id`, reject stale versions where concurrent edits matter, and emit an audit entry for privileged workflow decisions.

## Secret handling

Secret values live in the target GitHub Environment and are passed to Wrangler through mode-`0600` ephemeral JSON files. The scripts report only file paths and key counts. They never print values. Terraform consumes only the Cloudflare provider token from the environment; no application, integration, or state-backend secret is a Terraform variable.

Required secrets:

- `CLOUDFLARE_API_TOKEN`: least-privilege token for the resources in this stack
- `TF_STATE_ACCESS_KEY_ID` and `TF_STATE_SECRET_ACCESS_KEY`: dedicated R2 S3 credentials for the state bucket
- `BETTER_AUTH_SECRET`: independent random value of at least 32 characters per environment
- `REALTIME_TOKEN`: independent random value of at least 32 characters per environment

Optional secrets:

- `ACCELEVENTS_API_KEY`: only when API sync has passed preflight
- `DEMO_USER_PASSWORD`: staging only, and only if explicit demo seeding is needed
- `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET`: CI health checks through a protected preview, with a matching Access service-token rule

Never reuse auth, realtime, backend, or integration credentials across staging and production. Rotate on personnel changes, suspected disclosure, and according to the organization's credential policy. A Better Auth secret rotation invalidates existing sessions and should be communicated.

Staging demo mode bypasses account authentication to support evaluator persona switching and returns synthetic, non-persistent workflow results. Treat that environment as public sample software: never copy production records, real attendee files, live integration credentials, or privileged operational data into it. Protect a private preview with Access when review must be restricted.

## Data protection

- R2 uploads remain private; file reads are mediated by the API and event ownership checks.
- Uploads have purpose-specific size and MIME allowlists. Content-type checks are not malware scanning; add a scanning/quarantine workflow before accepting files from untrusted public users at scale.
- Logs and audit metadata must not contain passwords, tokens, full session cookies, or uploaded document contents.
- D1 exports and Terraform state can contain sensitive metadata. Store copies encrypted with restricted access and a documented retention period.
- `allowed_embed_origins` should contain exact HTTPS origins. Avoid wildcards, and review it when an event closes.
- Public speaker and agenda publication is explicit. A complete profile is not automatically consent to publish.

Before production, define retention and deletion windows for rejected proposals, reviewer notes, audit logs, inactive accounts, and uploaded files. Test account/event deletion against both D1 and R2 so metadata and objects do not diverge.

## Cloudflare hardening

- Scope the deployment token to the target account and only Workers Scripts, D1, R2, Queues, Workers Routes/DNS when used, Access when used, and Email Routing capabilities required by the workflow.
- Restrict GitHub production Environment access and require human approval. Do not permit untrusted fork pull requests to access environment secrets.
- Keep `prevent_destroy` on D1, upload R2, queues, DLQ, and the Terraform state bucket. Treat any requested bypass as a reviewed maintenance event with a verified backup.
- Enable log retention appropriate to the data classification and sample production traces conservatively.
- Configure rate limiting and abuse controls for public auth, CFP, embed, and upload routes before broad public launch.

## Dependency and change hygiene

CI runs lint, typecheck, unit tests, a production build, isolated migration replay with foreign-key checks, Worker dry-runs, Terraform validation, and an offline plan. Review generated migrations and dependency-lock changes. Apply destructive schema cleanup only in a later release after all live code has stopped reading the old structure.
