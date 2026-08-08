# Accelevents integration and fallback

Conference Ops remains the source of truth. Accelevents is a downstream delivery target for approved speaker and session records. API availability, event-plan capabilities, and field behavior can vary, so the integration must fail visibly without blocking proposal review, speaker onboarding, or agenda work.

## Enablement gate

Do not enable automated sync until all of these pass in staging:

1. `ACCELEVENTS_ENABLED=true` is visible to the App Worker; `ACCELEVENTS_EVENT_URL` and `ACCELEVENTS_API_KEY` are available only to the Jobs Worker.
2. The connector preflight can read one speaker page.
3. A disposable speaker create/update succeeds.
4. A disposable session create/update succeeds with the expected time interpretation.
5. A read-back or organizer UI check confirms the returned remote ID and field values.
6. Repeating the same operation updates rather than duplicates the record.

The current client treats HTTP 429 and 5xx responses as retryable. Authentication, authorization, validation, and endpoint-shape errors require operator action rather than blind retries.

## Safe upsert contract

For each speaker or session:

1. Load authoritative local data and normalize whitespace, names, HTML/plain text, and ISO timestamps.
2. Compute a stable payload hash from only fields owned by Conference Ops.
3. Read `integration_sync_records` by provider, event, entity type, and local ID.
4. If the payload hash is unchanged and the record is `synced`, do nothing.
5. If a remote ID exists, update that exact record. Otherwise create once and capture the returned ID.
6. Read back or verify the organizer-visible record before setting `synced` and `synced_at`.
7. Store a bounded error message on failure. After a non-retryable/unsupported result, set `manual_action`.

Queue retries must retain the original idempotency key. Never search by display name alone; names and session titles are not stable identifiers.

## Ownership rules

Conference Ops may own these projected fields:

| Local entity | Projected fields |
| --- | --- |
| Speaker | first/last name, email, title, company, bio |
| Session | title, description, start/end time, in-person format |

Remote-only fields such as registration controls, streaming configuration, sponsors, venue-specific settings, or Accelevents merchandising must not be overwritten unless the mapping is explicitly expanded and tested.

Deletes do not propagate. A withdrawn proposal, unpublished session, or removed speaker becomes a reconciliation item. An organizer decides whether to hide, archive, detach, or delete the remote record and records that decision in the audit trail.

## Manual CSV fallback

Use fallback when API access is unavailable, the account plan does not expose the needed operation, validation behavior is undocumented, or repeated preflight/read-back fails.

1. Freeze the local agenda revision for the export window.
2. Export only records in `manual_action` or whose payload hash changed since the last successful sync.
3. Produce separate UTF-8 CSV files for speakers and sessions. Keep local IDs in a dedicated reference column if the importer permits; otherwise retain a private reconciliation copy.
4. Include at minimum:

   - speakers: local ID, first name, last name, email, title, company, bio
   - sessions: local ID, title, description, start, end, timezone, room/track notes, speaker email(s)

5. Have a second organizer review record counts, required columns, HTML/plain-text behavior, and timezone conversion.
6. Import a one-record sample through the Accelevents organizer UI and inspect it before importing the batch.
7. Import the batch without selecting any destructive “replace all” behavior.
8. Export/read the resulting Accelevents records, reconcile by local reference and email, then capture remote IDs where available.
9. Update each local sync record to `synced` with the payload hash and timestamp, or leave it `manual_action` with a precise remaining discrepancy.
10. Record the local agenda revision, file hashes, operator, import time, counts, and exceptions in the event audit/operations log.

CSV packages contain personal data. Store them in an approved encrypted location, restrict them to event operators, and delete them according to the event retention schedule. Do not attach API keys or raw error logs to the package.

## Reconciliation after either path

Compare local and remote totals plus a sample of changed records. Specifically verify:

- no duplicate speakers by email;
- every session speaker resolves to the intended remote person;
- session start/end values are correct in the event timezone and across daylight-saving boundaries;
- unpublished/unscheduled sessions are not accidentally public;
- descriptions did not lose required formatting;
- remote IDs and payload hashes are stored for the next upsert;
- every unresolved mismatch has an owner and `manual_action` explanation.

If Accelevents becomes unavailable close to the event, keep the Conference Ops public agenda/embed live and treat the Accelevents update as a parallel recovery task rather than delaying the authoritative schedule.
