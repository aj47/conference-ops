# Conference Ops 0.2.0 release audit

This is the durable handoff log for the Sessionboard-parity and Airtable release. It records what each persona can do, the controls exercised, the independent verification lanes, and the release gates. The three Sessionboard learning-center pages and the customer's clarified MVP answers are the acceptance authority; pixel-for-pixel imitation is not.

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
| Airtable operator | Provision restricted base; reconcile D1 mirror; inspect organizer-safe health; platform operator reviews dead work/conflicts; switch authority only through audited command | Stable canonical records, hashes, tombstones, webhook cursor, and guarded authority | Mocked integration tests, live base provisioning, operator UI, release runbook |

## Airtable source-of-truth boundary

The registered business entities include organizations, events, memberships and invitations, forms and versions, proposals and rosters, reviewer configuration and evidence, speaker profiles, tasks/forms/files/comments, rooms/tracks/sessions, resources/embeds, messages/reminder rules, and audit history. Airtable reflects these as canonical JSON records with stable external keys.

The following remain operational Cloudflare state and are intentionally not spreadsheet-controlled: passwords and Better Auth accounts/sessions/verifications, authorization policy, raw R2 file bytes, outbox/queue leases, Worker secrets, and connector bookkeeping. Protected lifecycle operations use validated app workflows or supported idempotent Workflow Commands; direct spreadsheet deletion or permission/decision mutation becomes a conflict instead of bypassing domain rules.

## Independent verification lanes

| Lane | Responsibility | Result |
| --- | --- | --- |
| Sessionboard visual analysis | Extract and inspect every tutorial image; map visible participant/organizer behavior to product source | 140/140 images analyzed; gaps drove this release |
| Schedule parity | List/day/week/conflict views, URL state, accessibility, desktop/mobile interaction | Passed focused unit and E2E checks |
| Resource workflow | Organizer CRUD/publish, participant and public views, safe rendering | Passed focused unit, build, and desktop/mobile E2E checks |
| Revision lifecycle | Applicant/organizer revisions, review revocation/history, authorization, migration | 59 focused tests; full suite green |
| Participant files/tasks | Version history, scoped downloads, comments, external actions, task snapshots | 27 focused tests; migration/type/build green |
| Communications | Sanitized delivery ledger and durable workflow kinds | 37 focused tests; desktop/mobile browser green |
| Airtable sync | Registry, triggers, client, webhook, reconciliation, conflicts, provisioning | Mocked integration and live provisioning checks green |
| Airtable operator UI | Organizer-only status, health/guidance, responsive/accessibility states | Final browser evidence recorded below |
| Security/tenant audit | Auth, event scope, secret boundaries, Airtable authority, migrations | Final finding recorded below |
| Final parity audit | Recheck firm clarified requirements against integrated product | Final finding recorded below |

## Integrated release gates

| Gate | Result |
| --- | --- |
| `git diff --check` | Pass |
| `pnpm lint` | Pass |
| `pnpm typecheck` | Pass |
| `pnpm test` | Pass — 93 files / 468 tests |
| `pnpm build` | Pass — production client and Worker bundles |
| `pnpm smoke:production-local` | Pass; real auth/D1 lifecycle, 0 foreign-key violations |
| `bash scripts/verify-migrations.sh` | Pass; migrations 0000–0010, double seed, 0 foreign-key violations |
| `pnpm db:generate` | Pass; no schema drift |
| `pnpm audit --prod --audit-level high` | Pass; no known vulnerabilities |
| Desktop/mobile browser | Pass — organizer, applicant, reviewer, speaker, and public surfaces at desktop and exact 375 px; no page overflow or blocking focus defect |
| `pnpm test:e2e` | Pass — 40 journeys / 6 intentional skips |
| Staged secret scan | Pass — Gitleaks scanned the intentional 1.30 MB staged source/PDF diff with zero findings; ignored local Airtable/Worker secret artifacts were not staged |
| GitHub CI | Pending push |

## Known boundaries

- Accelevents is explicitly excluded by the customer's clarification; controlled CSV/JSON export remains available.
- The read-only organizer assistant is deliberately small and cannot mutate or send.
- Visible workspaces refresh about every 25 seconds and on focus. WebSocket mutation fanout is not claimed.
- Airtable authority must not be switched merely because provisioning succeeded. Full reconciliation, zero dead changes, zero open conflicts, and a healthy webhook are mandatory.
- Rate limiting/bot protection and malware scanning remain prerequisites before broad, anonymous public launch; the current client evaluation is small, named, and monitored.
