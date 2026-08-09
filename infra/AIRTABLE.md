# Airtable canonical records

Conference Ops can make Airtable the canonical business-data system of record while retaining D1 as its transactional workflow mirror. The integration is disabled by default and does not change existing pilot behavior until both the Worker configuration and one `airtable_connections` row are enabled.

## Boundary

The `Conference Ops Records` table contains every registered event/business row as canonical JSON plus searchable identity fields. `Workflow Commands` is the only supported path for protected lifecycle changes such as decisions, review submission, publication, completion, and deletion.

Better Auth accounts/passwords, sessions, verification values, auth-email URLs, outbox leases, integration bookkeeping, and raw R2 bytes never enter Airtable. The `person` entity contains only the safe `user` profile fields.

## Airtable token

Create a Personal Access Token restricted to the selected base or workspace with:

- `data.records:read`
- `data.records:write`
- `schema.bases:read`
- `webhook:manage`

Add `schema.bases:write` only while `scripts/provision-airtable.mjs` must create the base or tables. Remove that scope after provisioning and confirm record access still succeeds before installing the token on the Jobs Worker. The token belongs only on the Jobs Worker. The webhook MAC secret belongs only on the App Worker.

## Provision

```bash
AIRTABLE_TOKEN=... \
AIRTABLE_WORKSPACE_ID=... \
PUBLIC_APP_URL=https://your-app.example \
node scripts/provision-airtable.mjs
```

For an existing base, set `AIRTABLE_BASE_ID` instead of `AIRTABLE_WORKSPACE_ID`. The command writes a mode-0600, gitignored artifact at `artifacts/airtable/provisioning.json`. It contains the webhook MAC secret and must not be committed or pasted into logs.

Provisioning is safe to rerun with the same artifact: it validates field types, adds missing required fields, and refreshes the recorded webhook instead of creating a duplicate. If the recorded webhook no longer exists, it creates a replacement and atomically overwrites the artifact. Standard output contains only non-secret IDs and the artifact path; the PAT is never persisted.

Insert one connection after applying migrations, substituting values from that artifact:

```sql
INSERT INTO airtable_connections
  (id, event_id, base_id, records_table_id, commands_table_id, authority, enabled, status,
   schema_version, webhook_id, webhook_cursor, webhook_expires_at, created_at, updated_at)
VALUES
  ('airtable-default', NULL, 'app...', 'tbl...', 'tbl...', 'd1', 1, 'syncing',
   1, 'ach...', 0, 0, unixepoch() * 1000, unixepoch() * 1000);
```

Set `webhook_expires_at` to the millisecond timestamp represented by `webhookExpirationTime` when convenient. A zero value is safe for initial setup because the Jobs Worker immediately refreshes it.

Start in `d1` authority. In `Workflow Commands`, create a row with `Command Type = full_reconcile`, a unique `Idempotency Key`, `Status = Pending`, and `{}` in `Parameters JSON`. Compare record counts and hashes before switching authority. To switch, use another Pending command with `Command Type = set_authority` and `Parameters JSON = {"authority":"airtable"}`.

Do not switch authority merely because provisioning succeeded. The callback must be reachable on the deployed App Worker, the Jobs Worker must be able to read and write the base with the down-scoped runtime PAT, the initial reconciliation queue must drain without dead changes, and `airtable_conflicts` must be empty.

The organizer status card is deliberately read-only. It reports authority, connection health, reconciliation timestamps, and webhook state, but does not expose environment-wide queue rows, conflict payloads, base IDs, or secrets. An organizer escalates an `Attention required` state; a platform operator owns the checks and recovery below.

Before promotion, the platform operator must verify the environment-wide connection directly in D1:

```sql
SELECT authority, enabled, status, last_reconciled_at, reconciliation_started_at
FROM airtable_connections WHERE id = 'airtable-default' AND event_id IS NULL;

SELECT status, COUNT(*) AS count
FROM airtable_change_queue WHERE connection_id = 'airtable-default'
GROUP BY status ORDER BY status;

SELECT status, COUNT(*) AS count
FROM airtable_conflicts WHERE connection_id = 'airtable-default'
GROUP BY status ORDER BY status;
```

Promotion is rejected server-side unless the connector is enabled and healthy, the webhook is current, a full reconciliation has completed, no reconciliation is running, queued/processing/failed/dead counts are zero, and open conflicts are zero. Repair the underlying Airtable or D1 record before resolving a conflict. Requeue a dead change only after the cause is fixed, preserving its connection/entity/local key; never delete evidence merely to make the status green.

## Required Worker configuration

Variables shared by App and Jobs Workers:

- `AIRTABLE_ENABLED=true`
- `AIRTABLE_BASE_ID=app...`
- `AIRTABLE_AUTHORITY_DEFAULT=d1`
- `AIRTABLE_MAX_REQUESTS_PER_SECOND=4`

Secrets:

- Jobs Worker: `AIRTABLE_TOKEN`
- App Worker: `AIRTABLE_WEBHOOK_MAC_SECRET`

The client batches at most 10 records and limits itself to four requests per second. A 429 stores Airtable's retry time on the D1 change rather than blocking a Worker for 30 seconds. Cron drains pending records and refreshes the seven-day webhook before expiry.

## Authority and conflicts

- `d1`: remote changes are restored from D1.
- `airtable`: valid edits to the registry's explicit descriptive fields update the D1 mirror.
- Protected fields, direct deletions, invalid JSON, unknown entities, or referential changes create an `airtable_conflicts` record and block the connection until reviewed.
- Hard deletes are represented as `Deleted` tombstones. Do not delete canonical Airtable rows.

The first command adapters are `full_reconcile` and `set_authority`. Other protected command types are retained and visibly rejected until a matching domain command adapter is implemented; they are never applied as raw SQL.

## Current scope

- One enabled base is supported per deployed environment. The optional connection `event_id` is reserved for future per-event routing; leave it `NULL`.
- Reconciliation enumerates every current registered D1 row. Deletes that happen while the connection is enabled are captured as tombstones; a stale remote row from before enablement must be reviewed manually.
- The webhook payload cursor is drained through every `mightHaveMore` page. If Airtable returns a non-advancing cursor, the job fails without committing the cursor so a later retry cannot skip changes.
- The provisioning and webhook contracts are covered by mocked tests but still require a live Airtable smoke test after the actual base, PAT, callback URL, and Worker secrets exist.
