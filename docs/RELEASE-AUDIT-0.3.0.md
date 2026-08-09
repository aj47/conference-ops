# Conference Ops 0.3.0 release audit

This is the durable handoff record for the Conference Ops 0.3.0 release
candidate, prepared August 9, 2026. It covers the Sessionboard-aligned CFP,
abstract-review, speaker/content, agenda, public-widget, and Airtable work added
after the tagged 0.2.0 pilot release.

## Release status

| Item | Verified state |
| --- | --- |
| Version | `package.json` is 0.3.0 at source commit `1a077fa6d0a1ef66bbc5546dadc67aeb547bc2f6`. The release tag is recorded only after required CI completes. |
| Product status | Release candidate. This audit does not claim that the 0.3.0 code or migrations have been deployed to the existing pilot. |
| KillMySaaS | **100.0% required implementation projection** across 84 required items. This is not an official judge score. |
| Manual evidence | CFP confirmation delivery has a safe redacted receipt. The fresh post-deploy scheduled speaker-reminder inbox receipt (`SPK-16`) remains pending. |
| Official evaluation | Not run. `officialJudgeRun` and `officialScorePct` remain `false` and `null`; the upstream paid browser harness was not pointed at client or canonical data. |
| Database | Additive migrations 0000-0013; schema generation reports 48 tables and no drift. |
| Airtable | 38 registered business entity projections. New v0.3 entities are covered by registry entries and change-capture triggers, but require migration, full reconcile, and health checks in the target environment before Airtable authority is relied upon for them. |

The authoritative item-by-item evidence map is
[`killmysaas-projection.json`](./killmysaas-projection.json), with the readable
assessment in [`KILLMYSAAS-EVALUATION.md`](./KILLMYSAAS-EVALUATION.md).

## What 0.3.0 adds

| Required area | Current implemented scope | Evidence focus |
| --- | --- | --- |
| Call for Papers | Versioned forms, basic conditional logic, configured multi-track selection, authenticated drafts, submit/edit/resubmit/withdraw, explicit closed state, confirmation intent, reviewer isolation, request-changes, staged/final decisions, and acceptance activation. | Form/API contracts, role isolation, production-local lifecycle, desktop/mobile journeys. |
| Abstract Management | Independent dated rounds; per-round reviewer pools and caps; numeric, dropdown, and text criteria; weights; anonymized review; exact assignments; recusal; progress; reminders; aggregate sorting; formula-safe CSV; bounded AI triage with reasons and explicit human override. | Abstract API, UI, scoring, immutability, CSV, privacy, and browser tests. |
| Speaker Management | Searchable roster, manual CRUD, CSV import/merge, workflow status, bulk tasks, profile/social/headshot/session portal, identity scoping, invitations and communications, task progress, and scheduled reminder preparation. | Speaker/content API and UI tests, authorization regressions, production delivery pipeline evidence. |
| Content Management | Organizer speaker/session editing, independent content approval, immutable attributed revisions and restore, calendar-sequence updates, file requests, constraints, retained upload versions, comments, central file library, and latest-version ZIP grouped by session. | Content approval/public fail-closed tests, task/file authorization, version/ZIP tests, speaker-content E2E. |
| AI Agenda | Multi-day List/Day/Week/Conflict views, rooms/tracks, drag and explicit placement, event-window and room/track/speaker conflict checks, audited override, publish handoff, and a deterministic one-action safe auto-place assistant that never overrides conflicts. | Schedule units, audit/API tests, assisted-schedule desktop/mobile journey. |
| Public Widgets | Anonymous Sessions, Speakers, Agenda, Itinerary, and Gallery surfaces; search/facets/details; favorites and reload persistence; ICS; accessible detail dialog; organizer Embed Studio; iframe/share links; JSON/XML/iCal feeds; theme, filters, and field selection. | Canonical public projection, framing/feed tests, five-widget component/E2E coverage. |

Accelevents remains explicitly out of scope under the customer's clarification.
The optional CRM rubric is excluded from the required score by the evaluator's
published scoring rules and is not assigned an inferred score.

## Sessionboard and customer acceptance boundary

The release was rechecked against the current Sessionboard overview, participant,
and organizer learning pages plus the customer's clarified MVP answers. The
comparison is behavioral, not a pixel-for-pixel copy.

- Basic form conditional logic is sufficient for this MVP.
- Talks select one or more tracks; reviewers cover one or more explicit tracks.
- The minimum review outcome is unreviewed to Approve, Maybe, or Deny.
- Acceptance creates the speaker/session/onboarding handoff automatically.
- Hotel stay and flight reimbursement are required example tasks; profile,
  description, media, announcement, and colleague-invite tasks are supported.
- Email and calendar use durable, real MVP delivery paths rather than UI-only
  stubs, while actual inbox receipt remains a separate manual check.
- Day/room scheduling, drag-and-drop, and conflict detection are sufficient;
  the extra views and safe auto-place tool are additive.
- The agentic surface is deliberately small and read-only because organizer UI
  is the priority.

## Airtable source-of-truth boundary

Conference business records are projected to Airtable as canonical JSON with
stable external keys, identity, source versions, hashes, and tombstones. D1
remains the transactional workflow mirror that enforces relationships,
authorization, and protected state transitions.

The v0.3 registry adds change capture for:

- review-round reviewer membership and assignment caps;
- bounded AI review evaluations and human override evidence;
- speaker workflow operations;
- session content approval state;
- content revision history; and
- speaker communication logs.

Authentication records, passwords, sessions, authorization policy, Worker
secrets, raw R2 bytes, outbox leases/retries, and connector bookkeeping are not
Airtable-controlled. Direct spreadsheet edits cannot bypass decisions, review
finality, publication, permissions, task completion, or deletion workflows.

Before using v0.3 against an existing authoritative base, the operator must:

1. deploy/apply migrations 0012 and 0013 before dependent code;
2. confirm the restricted token and exact callback environment;
3. run a full reconcile and wait for all work to drain;
4. require zero dead changes and zero unresolved conflicts;
5. confirm maps, external keys, hashes, and tombstones for all registered
   entities; and
6. run and reverse one allowlisted descriptive-field round trip before relying
   on Airtable authority.

## Security and integrity remediations

- Acceptance session activation now uses D1-compatible category/track SQL; a
  production-local regression covers unmapped categories and automatic tasks.
- Every public session, speaker, headshot, widget, and feed fails closed unless
  a published session has explicit approved content.
- Legacy speaker profile publication is organizer-only in persistent and demo
  paths; a raw boolean binding that prevented real organizer publication was
  normalized for D1.
- Speaker snapshots do not disclose organizer-private travel notes, and
  non-organizer speaker edits preserve the stored private value.
- Social links require credential-free HTTPS URLs.
- Speaker communication records are backed by durable outbox/Queue delivery in
  non-demo mode; demo mode is visibly sandboxed.
- File uploads remain event/account/task scoped, old versions remain available,
  ZIP exports include only authorized current versions, and CSV cells neutralize
  spreadsheet formulas.
- Scheduled/published session content edits and restores advance calendar
  sequence atomically; rejected/no-op writes do not.

## Integrated release gates

| Gate | Result |
| --- | --- |
| `git diff --check` | Pass. |
| `pnpm verify` | Pass: lint, typecheck, **105 test files / 541 tests**, and production build. |
| Full Playwright | Pass: **52 journeys passed / 6 intentional viewport skips** at desktop 1440 px and mobile 375 px. |
| Former mobile-overflow regression | Pass: 3/3 sequential focused journeys. |
| `pnpm db:generate` | Pass: 48 tables; no schema changes; pre/post migration hashes unchanged. |
| Migration journal | Pass: sequential entries through 0012 and 0013; schema, SQL files, snapshots, and journal form one release unit. |
| Production-local smoke | Pass in the final audit: all 14 migrations, real Better Auth/D1 lifecycle, accepted-session/task/message activation, and zero foreign-key violations. |
| KillMySaaS projection test | Pass: pinned 84 required items, weights, evidence references, manual/official disclaimer, and optional-CRM exclusion. |
| Official paid browser judge | **Not run; no official score is claimed.** |
| Manual `CFP-08` receipt | Verified through a redacted repository record paired with private retained evidence. |
| Manual `SPK-16` receipt | **Pending after deployment.** Scheduler selection, personalization, deduplication, and durable intent are deterministic-test green. |

## Persona trial handoff

Use a distinct verified account for each persona and synthetic, non-sensitive
content.

1. Organizer creates an isolated event and reviews seeded forms, tasks, messages,
   reminders, room, and track.
2. Organizer publishes a CFP with a required track question and one conditional
   field, then copies the form-specific link.
3. A separate applicant submits a multi-track proposal; a separate reviewer
   completes an exact assignment and submits Approve, Maybe, or Deny evidence.
4. Organizer requests a revision or stages/finalizes a decision. Acceptance must
   create the session, speaker access, task plan, audit record, and message intent.
5. Speaker completes representative profile/forms/files/comments. Organizer
   checks private travel notes, versions, central files, content history, and
   approval.
6. Organizer uses safe auto-place or manual placement, deliberately tests a
   conflict, resolves or justifies it, and publishes.
7. From a signed-out window, testers inspect all five widget types, filters,
   details, itinerary persistence, ICS, embed, and feeds.
8. Operator performs the post-deploy Airtable migration/reconcile/health/round-
   trip sequence before declaring the new entity set authoritative.

## Known boundaries and post-deploy checks

- The 100% number is an implementation projection, not an official evaluator or
  fully manual score.
- The current pilot may remain on the tagged 0.2.0 deployment until a separately
  authorized v0.3 deploy. This document does not imply deployment.
- `SPK-16` requires a fresh controlled inbox receipt after deployment.
- Broad anonymous launch still needs rate limiting/bot protection, malware
  scanning/quarantine, formal retention/purge, and operational alerting.
- The scheduler assistant is deterministic and bounded; it does not make program
  decisions or override conflicts.
- The existing one-base Airtable topology remains environment-global. Per-event
  bases require a separate isolation design.

## Version-control handoff

Commit intentional source, tests, docs, public PDFs, migrations 0012/0013, both
snapshots, and the migration journal. Keep `.wrangler/`, `artifacts/`, `output/`,
`videos/`, `test-results/`, `playwright-report/`, secrets, state, backups, and raw
private evidence outside version control. The implementation commit is
`1a077fa6d0a1ef66bbc5546dadc67aeb547bc2f6`. Push and tag 0.3.0 only after
required CI is green.
