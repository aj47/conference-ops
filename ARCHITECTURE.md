# Architecture

## System shape

```text
Browser / public embed
        |
        v
App Worker + static assets ---- service binding ----> Realtime Worker
        |                                              Durable Objects
        +---- D1 (workflow and auth state)
        +---- private R2 (uploads)
        +---- Jobs Queue ----> Jobs Worker ----> Email Routing
                                  |   |
                                  |   +--------> Accelevents (optional)
                                  +------------> D1 outbox / sync records
```

The application Worker serves the built SPA and the Hono API. D1 is the source of truth. External integrations are projections of local state and never become authoritative for proposals, people, tasks, or the agenda.

## Runtime components

### App Worker

The App Worker terminates HTTP requests, runs Better Auth, enforces event roles, validates writes, and owns all transactional workflow changes. `/api/*` runs Worker-first; the public agenda, gallery, and `/embed/agenda` are static SPA routes that load their read-only data from the public API. Static response policy blocks cross-origin framing except for `/embed/*`, and hashed `/assets/*` files are cached immutably.

Every state-changing operation should remain event-scoped and auditable. Optimistic versions protect editable forms, proposals, and sessions from stale writes. A published form points to `published_version`; organizers can continue an unpublished `current_version` without changing the public CFP.

Fresh-event creation is a transactional workflow rather than an empty database shell. It grants the creator organizer membership and initializes a private CFP draft/version with standard proposal and participant fields, a General reviewer group and active weighted review round, a Main room and General track, a slide file request, profile/slides/calendar task templates, and agenda/gallery embeds. Organizers can create, edit, and delete event-scoped rooms and tracks afterward; duplicate resources and deletion of resources already used by sessions are rejected.

### D1

D1 stores authentication records, organizations and event memberships, form definitions and immutable versions, proposals and reviews, speakers, tasks, rooms, tracks, sessions, resource pages, embeds, outbox state, integration mappings, and audit events.

Generated migrations under `migrations/` are append-only. Stateful Terraform resources carry `prevent_destroy`; this is a safety rail, not a backup strategy.

### R2 uploads

The uploads bucket is private. D1 stores metadata and ownership while R2 stores bytes under event- and actor-scoped keys. The API enforces purpose-specific file types and sizes and checks event/owner access before returning an object. Public speaker images still flow through an application-controlled route.

### Queue and jobs Worker

Email, calendar, and Accelevents work enters the environment-specific jobs queue. The Worker records idempotency keys in the D1 outbox before delivery, retries transient failures with backoff, and routes exhausted messages to a dedicated DLQ. The scheduled trigger re-enqueues due `queued` or `failed` outbox records.

This creates two recovery views: Cloudflare Queue/DLQ for transport failures and D1 outbox rows for product-level status and operator context. Replaying either path must preserve the original idempotency key.

### Realtime Worker

Authenticated workspace routes refetch their event bootstrap on a bounded interval of about 25 seconds and when a visible tab regains focus. Polling pauses while the page is hidden, requests do not overlap, foreground mutations still update immediately, and unsaved form-builder edits are preserved during background hydration.

One SQLite-backed Durable Object class (`EventRealtime`) is deployed behind an App Worker service binding and supports event-scoped WebSocket fanout. Direct access requires a separate high-entropy `REALTIME_TOKEN`; it is not the user session secret. Application mutations do not yet publish events to it and clients do not yet subscribe, so Durable Object event broadcasting remains follow-up work rather than a realtime-collaboration claim.

Durable Object class migrations are Wrangler-owned because they ship with Worker code. Terraform does not manage Worker scripts or Durable Object migrations.

### Email and Accelevents

The jobs Worker sends authentication, communication, and RFC 5545 calendar messages through a Cloudflare Email binding. The configured sender must be authorized in Email Routing before deploy.

Email is deployment-opt-in. When `ENABLE_CLOUDFLARE_EMAIL` is false, the renderer removes the native binding so a demo/preview can deploy without Email Routing scope or an invented sender. Any real email job attempted in that state records a bounded failure in the D1 outbox and follows Queue retry/DLQ behavior; it is never reported as delivered.

Accelevents is optional and disabled by default. The connector can preflight credentials and event access, but remote speaker/session upserts remain deliberately unavailable until the customer’s Enterprise entitlement and object contract are confirmed. The controlled CSV/JSON export is the supported handoff; a preflight alone is never treated as a completed sync. See [infra/ACCELEVENTS.md](infra/ACCELEVENTS.md).

The App Worker receives only a non-secret `ACCELEVENTS_ENABLED` gate. The API key and event identifier are scoped to the Jobs Worker, which performs the remote call.

## Infrastructure ownership

| Concern | Owner | Reason |
| --- | --- | --- |
| D1, R2, queues, DLQ | Terraform | Long-lived resources need reviewed plans and destroy protection. |
| Optional preview Access | Terraform | Account policy should be declarative and independently reviewable. |
| Optional non-Worker DNS | Terraform | Avoid unmanaged general DNS records. |
| Worker code and bindings | Wrangler | Deployment versions and bindings move with application code. |
| Worker custom domain | Wrangler | One owner prevents Terraform/Workers route drift. |
| Durable Object migrations | Wrangler | Class migrations must be deployed with compatible code. |
| Secret values | GitHub Environments / Wrangler | Secrets do not enter Terraform configuration, plans, state, or source. |

The R2 Terraform backend uses one bucket with separate `staging.tfstate` and `production.tfstate` keys. Backend S3 credentials are dedicated R2 credentials, not the Cloudflare API token.

## Environment isolation

Names follow `conference-ops-<environment>-<component>`. Staging and production have separate:

- Terraform state keys
- D1 databases and R2 upload buckets
- jobs queues and DLQs
- App, Jobs, and Realtime Workers
- secrets and GitHub Environment approvals
- custom domains and optional Access policy

Cross-environment service bindings are not permitted. The renderer takes the D1 UUID from the matching Terraform output and fails if a deployment token remains unresolved.

Staging intentionally uses synthetic in-process demo data and persona switching for evaluator walkthroughs. Its mutations are non-persistent and it must never contain sensitive or production-derived data. Production disables demo mode and exercises Better Auth plus D1-backed workflows.

## Deployment sequence

1. Verify application, migration replay, seed integrity, Worker compilation, and Terraform syntax.
2. Lock the target environment through GitHub Actions concurrency.
3. Plan and apply stateful infrastructure.
4. Render environment-specific Wrangler files from non-secret outputs and variables.
5. Apply D1 migrations; Wrangler captures a backup before each remote migration.
6. Optionally seed staging only when explicitly requested.
7. Deploy Realtime, Jobs, then App so service dependencies exist before traffic reaches new code.
8. Call authenticated `/api/ready` through the public hostname, with Access service headers when configured. It validates runtime configuration, executes a D1 sentinel query, and traverses the Realtime service binding into its Durable Object. `/api/health` remains the dependency-free liveness check.

Production promotion is manual and protected. Migration compatibility should span one deployment: additive schema first, code adoption second, cleanup in a later release.

## Failure and recovery model

- App regression: roll back the App Worker version. If schema changed, verify the previous version remains compatible first.
- Jobs regression: stop or pause consumption, roll back Jobs, inspect DLQ/outbox, then replay with original idempotency keys.
- Realtime regression: roll back code only when the Durable Object storage migration is compatible; otherwise ship a forward fix.
- Bad D1 migration or data mutation: stop writers, identify the pre-change bookmark/backup, rehearse restore into staging, then restore production under an incident record.
- Accelevents outage or API mismatch: mark records `manual_action` and use the controlled CSV workflow. Local state remains authoritative.
- Terraform state loss: restore an encrypted state copy or import the existing resources. Never recreate stateful resources under new names as an improvised recovery.
