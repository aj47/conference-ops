# KillMySaaS SessionBoard evaluation

This assessment was completed on August 9, 2026 against the
[KillMySaaS SessionBoard Eval Kit](https://forge.smol.ai/swyx/killmysaas-evals/blob/main/README.md)
at pinned source revision `d99935c3e3c6c50c6b9292220260ccfe2df6d6d4`.

It is an evidence-backed projection, not a claim that the paid Anthropic browser
judge ran against the live client pilot. The upstream harness was installed and
validated in a disposable directory, and its typecheck, local browser smoke,
rubric listing, and required-area dry run passed. No model call or live pilot
mutation was made.

## Result

Conference Ops projects to **64.0% at 99.0% area-weighted coverage** on the
required rubric. The optional Speaker CRM area projects to **2.6%** and is not
included in the headline score by the evaluator's own scoring rules.

| Required area | Earned / judgeable / total points | Score | Coverage | Weighted contribution |
| --- | ---: | ---: | ---: | ---: |
| Call for Papers | 31 / 33 / 34 | 93.9% | 97.1% | 18.78 / 20 |
| Abstract Management | 10 / 28 / 28 | 35.7% | 100% | 7.14 / 20 |
| Speaker Management | 19.5 / 32 / 33 | 60.9% | 97.0% | 9.14 / 15 |
| Content Management | 18.5 / 31 / 31 | 59.7% | 100% | 8.96 / 15 |
| AI Agenda | 17 / 18 / 18 | 94.4% | 100% | 9.44 / 10 |
| Public Widgets | 18 / 34 / 34 | 52.9% | 100% | 10.58 / 20 |
| **Required overall** |  | **64.0%** | **99.0%** | **64.0 / 100** |

The projection used the published math: pass `1`, partial `0.5`, fail or
not-found `0`, and cannot-judge excluded from that area's score denominator.
The overall is an area-weighted mean, not a raw sum of all item weights.

Focused source-backed verification passed **14 test files / 106 tests** across
forms, conditional validation, proposal round trips, track routing, review and
decision lifecycles, acceptance activation, speaker tasks, files and comments,
communications, reminders, scheduling, publishing, and public projections.

## What the score means

The evaluator is intentionally broader than the customer's clarified MVP. It
requires or rewards capabilities such as independently configured multi-round
review plans, typed rubric questions, blind review and recusal, manual speaker
creation and CSV import, a central content library with ZIP export and revision
restore, five separate public widget products, a configurable embed generator,
and automatic schedule assistance. Its optional CRM suite describes an
organization-wide sourcing product.

Those are useful parity targets, but they are not all Conference Ops release
requirements. The customer's accepted scope explicitly says:

- basic conditional logic is enough;
- talks select one or more tracks and reviewers cover one or more tracks;
- the minimum decision path is unreviewed to approve / maybe / deny;
- acceptance automatically creates the speaker, session, and tasks;
- hotel, flight, profile, description, announcement, and invitation work are
  representative onboarding tasks;
- email and calendar delivery must work;
- Accelevents may be skipped;
- day/room scheduling, drag-and-drop, and conflict detection are enough; and
- a small useful agent is sufficient because the organizer UI is the priority.

Conference Ops implements those commitments. The projected 64.0% therefore
measures adversarial SessionBoard breadth, not a failure of the clarified MVP.

## Priority decision

### Product-quality follow-ups worth doing

These would improve prospect usability and raise the evaluator score without
changing the product into a different category:

1. Add organizer editing for accepted-session title/abstract and accepted
   speaker profile data (`CNT-09`, `CNT-10`).
2. Expose a clear session-assignment section in both Speaker Ops and the speaker
   portal (`SPK-11`).
3. Add a filterable deliverables matrix and central files library, followed by
   latest-file ZIP export (`CNT-07`, `CNT-13`, `CNT-14`).
4. Improve public discovery with title/speaker search, richer session details,
   and a speaker detail surface (`EMB-02`, `EMB-05`, `EMB-08`, `EMB-13`).
5. Render an explicit closed-CFP shell before an anonymous visitor enters the
   wizard (`CFP-04`).

None was classified as a new P0/P1 blocker for the named client trial. They are
the recommended next product-depth tranche.

### New evaluator scope, not a current commitment

- multi-round dated evaluation plans and per-round reviewer pools (`ABS-01`,
  `ABS-02`);
- typed numeric/dropdown/free-text rubric criteria (`ABS-03`);
- blind review, recusal, AI proposal evaluation, and reviewer reminder tooling
  (`ABS-07`, `ABS-09`, `ABS-12`, `ABS-14`);
- speaker roster CRUD, CSV import, and custom workflow statuses (`SPK-02` through
  `SPK-04`);
- attributed content revision history/restore and a separate content-approval
  gate (`CNT-11`, `CNT-12`);
- automatic schedule placement (`AIA-08`);
- five separately configurable public widgets, attendee itinerary/calendar
  export, and a per-widget snippet builder (`EMB-01` through `EMB-16` where the
  existing agenda/gallery/embed only partially satisfy the broader model); and
- organization-wide Speaker CRM (`CRM-01` through `CRM-12`), which the evaluator
  itself excludes from the headline score.

These should be scheduled only if a prospect makes SessionBoard feature breadth
an explicit commercial requirement.

## Item-level projection

The lists below account for all 96 rubric items. The score inputs and item
verdicts are also stored in machine-readable form in
`docs/killmysaas-projection.json`; the evidence basis and gap decisions are
documented in this report.

| Area | Pass | Partial | Fail | Cannot judge |
| --- | --- | --- | --- | --- |
| CFP | CFP-01, 02, 03, 05, 06, 07, 09, 10, 11, 12, 13, 14, 16 | CFP-04, 15 | — | CFP-08 |
| Abstracts | ABS-04, 06 | ABS-01, 03, 05, 10, 11 | ABS-02, 07, 08, 09, 12, 13, 14 | — |
| Speakers | SPK-01, 06, 07, 09, 10, 13, 14, 15 | SPK-05, 08, 12 | SPK-02, 03, 04, 11 | SPK-16 |
| Content | CNT-01, 02, 03, 04, 05, 08 | CNT-06, 07, 12 | CNT-09, 10, 11, 13, 14 | — |
| Agenda | AIA-01, 02, 03, 04, 05, 06, 07 | — | AIA-08 | — |
| Widgets | EMB-06, 07 | EMB-01, 03, 04, 05, 08, 09, 10, 11, 12, 14, 15, 16 | EMB-02, 13 | — |
| Optional CRM | — | CRM-11 | CRM-01, 02, 03, 04, 05, 06, 07, 08, 09, 10, 12 | — |

## Required manual follow-ups

The upstream framework has 68 required auto items, 14 required auto-partial
items, and 2 required manual items. Its human checklist includes real email
receipt, second-reviewer isolation, exports/downloaded-file inspection,
automatic reminders, calendar import, cross-origin embed rendering, and delayed
public propagation. A future official run must preserve these manual checks even
when the browser agent reports success.

Conference Ops already has separate audited evidence for real email/calendar
delivery and cross-role scoping, but that evidence does not replace an official
evaluator receipt.

## Harness safety and validity findings

The upstream harness is not safe to run unchanged against the existing pilot or
its canonical Airtable base:

- every supplied scenario can mutate product state; there is no read-only mode
  or teardown;
- even the lowest-risk public-widget scenario may sign in and approve sessions;
- confirmation dialogs are automatically accepted and same-origin mutation
  requests are not blocked;
- no scenario declares required credentials, so missing sessions can trigger
  placeholder account signups;
- saved authentication applies only to the starting persona, while several
  scenarios switch roles;
- it has no reload tool despite persistence criteria, and no reliable iframe,
  download, console, or network inspection;
- typed passwords are retained in evidence transcripts and sent to the judge;
- fixture identities disagree between YAML, JSON, and CSV;
- resume treats any evidence file as complete, including blocked/turn-limit
  outcomes; and
- scenario-filter dry runs do not reliably expose invalid or unresolved IDs.

The README also describes `31% / 50% / 19%` as weight distribution, but those
are item-count shares. Actual required weighted-point shares for weight-3,
weight-2, and weight-1 items are `43.8% / 47.2% / 9.0%`.

## Safe official-run plan

An official judge run should happen only after all of the following exist:

1. a separate Worker deployment with fresh D1 and R2 resources;
2. a duplicated Airtable base, webhook, and restricted credentials;
3. disposable same-origin password accounts for every persona and controlled
   test mailboxes;
4. a patched evaluator copy with identity consistency, credential redaction,
   reload support, retry-safe resume, strict scenario validation, and explicit
   non-applicable handling;
5. a clean environment reset before every scenario chain;
6. explicit model-budget approval and an exported `ANTHROPIC_API_KEY`; and
7. human review of every fail, partial, not-found, and manual follow-up.

Until then, the source/test projection in this document is the reproducible,
non-destructive assessment. It must not be presented as a paid official judge
run.
