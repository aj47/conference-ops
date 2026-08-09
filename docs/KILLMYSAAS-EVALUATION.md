# KillMySaaS SessionBoard evaluation

This report assesses the integrated Conference Ops release candidate against the
[KillMySaaS SessionBoard Eval Kit](https://forge.smol.ai/swyx/killmysaas-evals/blob/main/README.md)
at pinned revision `d99935c3e3c6c50c6b9292220260ccfe2df6d6d4`.

> **Status:** the required product surface has a **100.0% implementation
> projection**. This is not an official judge score. `officialJudgeRun` remains
> `false`, no paid model evaluation was run, and one required live manual receipt
> (`SPK-16`) is still pending after deployment.

The machine-readable evidence map is
[`docs/killmysaas-projection.json`](./killmysaas-projection.json). A focused test
checks the pinned counts, weights, area math, evidence references, official-run
disclaimer, manual status, and optional-CRM exclusion:

```sh
pnpm exec vitest run tests/unit/killmysaas-projection.test.ts
```

That gate currently passes all four assertions.

## Result

All 84 required rubric items map to implemented source and deterministic test
evidence. Under the evaluator's published pass `1`, partial `0.5`, fail `0`
math, that produces the following implementation projection:

| Required area | Projected earned / total | Implementation score | Area weight | Contribution |
| --- | ---: | ---: | ---: | ---: |
| Call for Papers | 34 / 34 | 100% | 20 | 20 / 20 |
| Abstract Management | 28 / 28 | 100% | 20 | 20 / 20 |
| Speaker Management | 33 / 33 | 100% | 15 | 15 / 15 |
| Content Management | 31 / 31 | 100% | 15 | 15 / 15 |
| AI Agenda | 18 / 18 | 100% | 10 | 10 / 10 |
| Public Widgets | 34 / 34 | 100% | 20 | 20 / 20 |
| **Required implementation projection** | **178 / 178** | **100.0%** | **100** | **100 / 100** |

The evaluator uses an area-weighted mean, not a raw 178-point percentage. Every
area is at 100%, so both calculations happen to produce the same result here.

The official score is deliberately recorded as `null`. The implementation
projection answers “does the integrated candidate contain and verify the required
behavior?” The official score answers “did the upstream paid browser judge and
its human checklist pass against a disposable deployment?” The latter has not
happened.

## Evidence standard

An item is projected pass only when its JSON entry references an evidence bundle
that contains:

- existing product source implementing the behavior; and
- at least one existing deterministic unit, API, component, or browser test.

The validation test fails if any required ID is missing, duplicated, has the
wrong aggregate weight, is not projected pass, names a missing evidence bundle,
references a missing repository file, or lacks deterministic test evidence.

Manual receipts are recorded separately from implementation evidence. This
prevents a working email pipeline from being mislabeled as a verified inbox
delivery and prevents a source projection from being presented as a paid judge
run. For `CFP-08`, the repository contains a deliberately redacted receipt
record; the underlying private artifacts remain outside version control.

## Required manual items

The pinned rubric contains exactly two `testability: manual` items.

| Item | Implementation | Official manual receipt | Evidence / next action |
| --- | --- | --- | --- |
| `CFP-08` submission confirmation email | Pass | **Verified** | The disposable pilot submission produced a retained inbox receipt, “We received your Conference Ops Final Audit proposal,” at 11:50 AM PDT, paired with an outbox row marked `sent` after one attempt. A safe versioned transcription is `docs/evidence/CFP-08-submission-confirmation-redacted.json`. The raw inbox observation and database backup are local/private and intentionally gitignored because they contain personal data and signed portal URLs. |
| `SPK-16` scheduled incomplete-task reminder | Pass | **Pending live receipt** | `scheduled-reminders.test.ts` proves the due-date scheduler selects an incomplete task, addresses the correct speaker, includes the task and due date, deduplicates the job, and records the rule run. After deployment, create an overdue task in a disposable event, run the scheduled handler, and retain the received inbox message with recipient, subject, task, and due date. |

Therefore, “100%” may be described only as an **implementation projection**.
It must not be described as 100% official/manual completion until the `SPK-16`
receipt exists and the official run completes.

## Supplemental human checklist

Several `auto-partial` items include manual observations beyond their automated
pass signal. They do not change the implementation projection, but an official
run must preserve them.

| Manual observation | Current evidence | Official-run status |
| --- | --- | --- |
| Decision-email delivery and personalization | A prior disposable acceptance email receipt is retained; durable decision jobs and history are tested | Recheck acceptance and rejection inboxes |
| Second-reviewer round isolation | Independent reviewer pools, exact assignments, blind projection, and role separation have API/browser tests | Re-run with two disposable reviewer identities |
| Review CSV and latest-file ZIP inspection | CSV escaping and ZIP bytes/paths are deterministic tests | Retain downloaded files from browser |
| Calendar interoperability | Valid iCal generation and a real browser download are verified | Import the file into an external calendar |
| Cross-origin widget rendering | `frame-ancestors *`, XFO removal, all five embed routes, and organizer preview are verified | Embed one generated iframe on a different origin |
| Delayed public propagation | Hosted widgets and feeds share one canonical approved-data query path | Edit a disposable record and retain a timed external refresh receipt |

## Required item accounting

Every required item below has `implementationVerdict: pass` in the JSON evidence
map. The grouping accounts for all 84 required IDs.

| Area | Required projected-pass IDs |
| --- | --- |
| Call for Papers | `CFP-01` through `CFP-16` |
| Abstract Management | `ABS-01` through `ABS-14` |
| Speaker Management | `SPK-01` through `SPK-16` |
| Content Management | `CNT-01` through `CNT-14` |
| AI Agenda | `AIA-01` through `AIA-08` |
| Public Widgets | `EMB-01` through `EMB-16` |

### Call for Papers evidence

- The form builder and public renderer support short text, long text, dropdowns,
  required flags, options, one-level conditions, and required-field validation.
- The anonymous portal exposes event branding, dates, tracks, formats, an open
  entry state, and an explicit closed state with no start/submit affordance.
- Applicant identity, browser/account drafts, submit, edit-before-close,
  organizer round trip, reviewer isolation, rubric evidence, accept/reject,
  applicant status propagation, edit lock, and automatic acceptance activation
  are persisted and tested.
- Confirmation and decision messages use durable idempotent outbox jobs and the
  organizer delivery ledger; the confirmation path also has the live receipt
  noted above.

Primary evidence bundles: `cfp-form`, `cfp-public-window`, `cfp-lifecycle`,
`cfp-review`, `cfp-email`, and `proposal-participants`.

### Abstract Management evidence

- Organizers can persist multiple independently dated rounds with distinct
  scorecards, reviewer pools, reviewer caps, and blind-review settings.
- Numeric, dropdown, and free-text responses persist; weighted scoring is
  server-computed.
- Exact assignment sets, track/cap distribution, round-specific progress,
  reminder queueing, blind identity redaction, co-presenters, and reviewer
  recusal have API or browser coverage.
- Aggregate result ordering, formula-safe CSV, bounded proposal-specific AI
  reasoning, and distinguishable human override are tested.

Primary evidence bundles: `abstract-plans`, `abstract-assignments`,
`abstract-privacy`, `abstract-results`, and `proposal-participants`.

### Speaker Management evidence

- The organizer roster supports search, workflow-status filtering, manual
  create/edit/delete, CSV import/merge, and persistent custom logistics data.
- Organizers can create dated tasks for multiple speakers, send invitations and
  bulk communications with merge fields, and inspect a per-speaker progress
  matrix and delivery log.
- The speaker portal is identity-scoped and supports profile, bio, social links,
  headshot, assigned sessions, due tasks, completion, and uploads that round-trip
  to the organizer.
- Scheduled incomplete-task reminder preparation is implemented and tested;
  only its fresh post-deploy inbox receipt remains pending.

Primary evidence bundles: `speaker-roster`, `speaker-portal`,
`speaker-tasks-mail`, `scheduled-reminders`, and `content-deliverables`.

### Content Management evidence

- File-request tasks expose due dates and constraints, accept scoped uploads,
  retain old versions, mark the latest version, and support attributed comments.
- The organizer has a filterable speaker/task matrix and central files library
  with session/speaker/date/version metadata plus latest-version, session-grouped
  ZIP generation.
- Central speaker and session editing persists. Session saves create attributed
  revision history; restoring a prior snapshot creates a new audit revision and
  advances calendar sequence when appropriate.
- Content status is independent of scheduling. Every public program, feed,
  speaker, and headshot query fails closed unless the related published session
  has an explicit `approved` status; the migration backfills already-published
  sessions.

Primary evidence bundles: `content-deliverables`, `content-editing`, and
`content-approval`.

### AI Agenda evidence

- The schedule builder exposes multi-day List/Day/Week/Conflict workflows with
  organizer-managed rooms and tracks.
- Placement and rescheduling persist and detect speaker, room, and track
  conflicts; resolution clears the conflict and is audited.
- Publishing hands scheduled sessions to the canonical public program.
- The one-action schedule assistant places unscheduled sessions only into safe,
  bounded slots, respects existing occupancy and shared speakers, and explains
  both placements and sessions it cannot place.

Primary evidence bundles: `agenda-builder` and `agenda-assist`.

### Public Widgets evidence

- Five distinct anonymous surfaces exist: Sessions List, Speakers List, Agenda,
  Schedule Itinerary, and Speaker Gallery.
- Sessions include complete anatomy, expansion, title/speaker search, result
  counts, and Track/Format/Location facets.
- Speaker directory and gallery are surname ordered, searchable, resilient to
  missing photos, and expose complete speaker/session detail with accessible
  modal close and focus restoration.
- Agenda is day-switchable and organized by time and room; itinerary is
  chronological, supports exact personal selections, survives reload, and
  downloads a valid `.ics` file.
- Organizer Embed Studio supports all five types; styled/basic HTML, JSON, XML,
  and iCal outputs; theme/accent; track/format/location filters; field selection;
  copyable iframe/feed output; share URLs; and live preview.
- Every hosted surface, embed, and feed reads the same published, explicitly
  approved canonical program. Worker/static framing rules permit third-party
  embedding while retaining the rest of the security policy.

Primary evidence bundles: `widgets-sessions`, `widgets-speakers`,
`widgets-agenda`, `widgets-itinerary`, `widgets-gallery`, `widgets-embed`, and
`widgets-canonical`.

## Optional Speaker CRM

`CRM-01` through `CRM-12` are optional in the pinned evaluator and are excluded
from the required headline by its own scoring rules. This audit does not infer a
CRM score from Conference Ops' event-scoped speaker records. The JSON records
the optional area separately as `officiallyAssessed: false` and `scorePct: null`.

## Safety and official-run boundary

The upstream harness remains unsafe to point unchanged at the client pilot or
canonical Airtable base:

- scenarios mutate product state and do not supply teardown;
- saved authentication does not cover every cross-persona transition;
- evidence transcripts can retain typed credentials;
- resume can treat blocked evidence as complete;
- iframe, download, delayed-propagation, and external-delivery checks still need
  deliberate human receipts; and
- a paid model key would send product screenshots and text to an external judge.

No live or paid evaluator was run for this update. An official run should use a
disposable Worker, fresh D1/R2 resources, a duplicated Airtable base, restricted
credentials, disposable persona accounts, controlled inboxes, explicit model
budget approval, and a clean reset before each scenario chain.

## Release-owner completion steps

1. Implementation is frozen at commit
   `1a077fa6d0a1ef66bbc5546dadc67aeb547bc2f6`; keep the evidence bundle tied
   to that source revision.
2. Deploy only to a disposable evaluation environment.
3. Capture the missing `SPK-16` scheduled-reminder inbox receipt.
4. Complete the supplemental external calendar, cross-origin iframe, file
   inspection, second-reviewer, and delayed-propagation checks.
5. If authorized, run the pinned paid judge and record its score separately;
   never overwrite this source/test projection with an unsupported official
   claim.
