# Conference Ops 0.2.0 release audit

This is the durable handoff log for the Sessionboard-parity and Airtable release, updated August 9, 2026. It records what each persona can do, the controls exercised, the independent verification lanes, and the release gates. The three Sessionboard learning-center pages and the customer's clarified MVP answers are the acceptance authority; pixel-for-pixel imitation is not.

## Released pilot snapshot

| Item | Verified handoff state |
| --- | --- |
| Prospective-client pilot | <https://conference-ops-pilot-app.techfren.workers.dev> |
| Product/source | Conference Ops 0.2.0; PR #1 required GitHub CI checks were green at handoff. The approval-gated remote infrastructure plan is intentionally skipped. |
| Local verification | `pnpm verify` passed: 94 test files / 474 tests, plus lint, typecheck, and production build. |
| Database | Additive migrations 0000-0011 replayed and checked. |
| Browser journeys | Prior full E2E run: 40 passed / 6 intentional skips. |
| Jobs Worker | Deployed version `49e1d03d-313e-4179-8265-40bbe9e194ad`. The final App Worker version is intentionally recorded only after the post-PDF deploy. |
| Airtable authority | **LIVE and healthy with `airtable` authority.** The Program setup card visibly reports Healthy and "Airtable is the current source of truth," with both direction timestamps. |
| Airtable integrity | 140/140 registered business records have maps, unique external keys, and matching hashes; zero queued, failed, or dead changes; zero open conflicts. |
| Airtable round trip | Natural webhook processing is active. A synthetic Evaluation Sandbox event proved Airtable description to D1/app and organizer Event details UI to Airtable; the test value was restored. |

## Feature and control matrix

| Persona / surface | Workflow and controls | Expected durable result | Evidence |
| --- | --- | --- | --- |
| Organizer / Event setup | Create event; edit dates, timezone, venue, URL, accent; reject invalid CFP/event date ordering | Event-scoped workspace plus operational defaults | Unit/API, production-local smoke, browser |
| Organizer / Form builder | Create/switch/clone/close CFP; add/edit/reorder fields; configure basic conditions, options, participant rules, limits, deadline, confirmation; preview/save/publish/copy form-specific link | Independently versioned CFPs; immutable published version; pinned applicant drafts | Unit/API, migration replay, browser |
| Applicant / CFP | Sign in/verify; save browser/account draft; add distinct speakers; select one or more tracks; submit; reload; edit before close; resubmit; withdraw | Owner-scoped versioned proposal and routed assignments | Unit/API, production-local smoke, browser |
| Reviewer / Review desk | Open assignment; enter criterion scores and evidence; save draft; reload; choose approve/maybe/deny; submit final | Server-computed score and immutable final evidence | Unit/API, role/tenant regression, browser |
| Organizer / Proposals | Search/filter; inspect routing and current evidence; request changes with note; stage/finalize decision | Audited revision or decision; current assignments revoked/rebuilt correctly | Unit/API, production-local smoke, browser |
| Acceptance activation | Accept a proposal | Claimed speaker access, proposal-linked unscheduled session, configured tasks, audit log, and durable decision email intent in one guarded workflow | Transaction/API tests and production-local smoke |
| Organizer / Program setup | Map tracks to reviewers; edit scoring plan/rubric; author task templates, portal forms, file requests, external-link tasks, resources, messages, reminder rules; inspect delivery history and Airtable status | Event-scoped persistent configuration | Unit/API, responsive browser |
| Speaker / Portal | Edit profile/headshot; complete hotel/flight forms; open manual external actions; upload/replace task files; download earlier versions; comment; read resources; complete tasks | Account/event/task-scoped state with preserved evidence and chronological history | Unit/API, migration replay, responsive browser |
| Organizer / Speaker Ops | Select/deep-link speaker and task; inspect profile/task/file evidence; download current/prior versions; exchange comments; send reminders | Accepted-speaker-only operational view and durable communication intent | Unit/API, responsive browser |
| Organizer / Schedule | Create/edit rooms and tracks; switch List/Day/Week/Conflicts; filter; drag/place; resolve conflict with reason; reload URL state; publish | Event-window-safe placement, audited override, published public agenda | Unit/API/E2E and responsive browser |
| Organizer / Publish | Run readiness checks; publish additions; send scoped communications/calendar; download protected exports; copy public/embed links | Published-only public projections and durable outbox work | Unit/API, production-local smoke, browser |
| Public | Open event CFP, agenda, speakers, resources, and frameable agenda embed | Published-only allowlisted data with correct framing/security headers | Unit/E2E and browser |
| Airtable operator | Provision restricted base; reconcile D1 mirror; inspect organizer-safe health; platform operator reviews dead work/conflicts; switch authority only through audited command | Stable canonical records, hashes, tombstones, webhook cursor, and guarded authority | Mocked integration tests, live commissioning, natural webhook round trip, operator UI, release runbook |

## Airtable source-of-truth boundary

The registered business entities include organizations, events, memberships and invitations, forms and versions, proposals and rosters, reviewer configuration and evidence, speaker profiles, tasks/forms/files/comments, rooms/tracks/sessions, resources/embeds, messages/reminder rules, and audit history. Airtable reflects these as canonical JSON records with stable external keys.

The following remain operational Cloudflare state and are intentionally not spreadsheet-controlled: passwords and Better Auth accounts/sessions/verifications, authorization policy, raw R2 file bytes, outbox/queue leases, Worker secrets, and connector bookkeeping. Protected lifecycle operations use validated app workflows or supported idempotent Workflow Commands; direct spreadsheet deletion or permission/decision mutation becomes a conflict instead of bypassing domain rules.

The commissioned pilot now uses Airtable authority for business records. This does not move authentication, authorization, private bytes, delivery mechanics, or connector state into Airtable, and it does not permit spreadsheet edits to protected lifecycle fields.

## Independent verification lanes

| Lane | Responsibility | Result |
| --- | --- | --- |
| Sessionboard visual analysis | Extract and inspect every tutorial image; map visible participant/organizer behavior to product source | 140/140 images analyzed; gaps drove this release |
| Schedule parity | List/day/week/conflict views, URL state, accessibility, desktop/mobile interaction | Passed focused unit and E2E checks |
| Resource workflow | Organizer CRUD/publish, participant and public views, safe rendering | Passed focused unit, build, and desktop/mobile E2E checks |
| Revision lifecycle | Applicant/organizer revisions, review revocation/history, authorization, migration | 59 focused tests; full suite green |
| Participant files/tasks | Version history, scoped downloads, comments, external actions, task snapshots | 27 focused tests; migration/type/build green |
| Communications | Sanitized delivery ledger and durable workflow kinds | 37 focused tests; desktop/mobile browser green |
| Airtable sync | Registry, triggers, client, webhook, reconciliation, conflicts, provisioning, and authority cutover | Mocked integration plus live 140/140 reconcile and two-way round trip green |
| Airtable operator UI | Organizer-only status, health/guidance, responsive/accessibility states | Live Program setup card shows Healthy, current Airtable authority, and both sync directions |
| Security/tenant audit | Auth, event scope, secret boundaries, Airtable authority, migrations | Final finding recorded below |
| Final parity audit | Recheck firm clarified requirements against integrated product | Final finding recorded below |

## Integrated release gates

| Gate | Result |
| --- | --- |
| `git diff --check` | Pass |
| `pnpm verify` | Pass - lint, typecheck, 94 test files / 474 tests, and production build |
| `pnpm smoke:production-local` | Pass; real auth/D1 lifecycle, 0 foreign-key violations |
| `bash scripts/verify-migrations.sh` | Pass; migrations 0000-0011, double seed, 0 foreign-key violations |
| `pnpm db:generate` | Pass; no schema drift |
| `pnpm audit --prod --audit-level high` | Pass; no known vulnerabilities |
| Desktop/mobile browser | Pass — organizer, applicant, reviewer, speaker, and public surfaces at desktop and exact 375 px; no page overflow or blocking focus defect |
| Prior full `pnpm test:e2e` | Pass - 40 journeys / 6 intentional skips |
| Client packet privacy/secret scan | Pass - extracted PDF text, links, object structure, and source copy contain no personal email, local path, Airtable base/webhook/D1 ID, secret value, or private runtime identifier; the documented Jobs version is the only UUID in the PDFs |
| GitHub CI | Pass on PR #1 at handoff; required Application/D1, Terraform validation, secretless plan, and environment-selection checks green; approval-gated remote plan intentionally skipped |
| Live Airtable | Pass - authority `airtable`, status healthy, 140/140 records/maps, matching unique keys and hashes, natural webhook, empty queued/failed/dead work, zero open conflicts, and restored two-way Evaluation Sandbox proof |

## Remediated and regression-tested release issues

- Scheduled reminder preparation previously used the wrong auth table reference and could stop the scheduled handler before Airtable/outbox work. The query was corrected, the failure boundary now preserves later scheduled work, and deterministic tests cover both the successful and isolated-failure paths.
- A reconciliation self/no-op echo could advance `map.last_synced_at` without rewriting Airtable's informational Last Synced At field, causing a later valid descriptive edit to be misclassified as protected drift. The fix preserves `map.last_synced_at` on self/no-op echoes so it stays aligned with Airtable, and the reconcile -> self-echo -> valid remote edit sequence is regression-tested.

## Known boundaries

- Accelevents is explicitly excluded by the customer's clarification; controlled CSV/JSON export remains available.
- The read-only organizer assistant is deliberately small and cannot mutate or send.
- Visible workspaces refresh about every 25 seconds and on focus. WebSocket mutation fanout is not claimed.
- The pilot is already commissioned with healthy Airtable authority. If health, webhook, queue, hash, or conflict evidence degrades, pause spreadsheet edits and use the guarded rollback/reconcile runbook; never force the connection row.
- Rate limiting/bot protection and malware scanning remain prerequisites before broad, anonymous public launch; the current client evaluation is small, named, and monitored.
