# Sessionboard parity and product boundary

This audit was refreshed on 2026-08-08 against the current Sessionboard learning center:

- [Product video overview](https://learn.sessionboard.com/videos/overview)
- [Participant overview](https://learn.sessionboard.com/participants/overview)
- [Organizer overview](https://learn.sessionboard.com/get-started/overview)

The linked pages and their tutorial videos are reference implementations, not a request to clone Sessionboard pixel-for-pixel. Conference Ops follows the customer's clarified MVP contract first: useful organizer administration, basic conditional forms, multi-track routing, a simple decision flow, automatic acceptance activation, working email/calendar delivery, speaker onboarding, and a day/room scheduler with conflicts.

## Acceptance matrix

| Workflow | Conference Ops contract | Status |
| --- | --- | --- |
| CFP forms | Multiple independently versioned forms per event; basic one-level conditional logic; organizer-authored questions, labels, options, limits, and deadlines; form-specific links. | Implemented |
| Participant submissions | Browser and account drafts, multiple speakers, track selection, confirmation, withdrawal, applicant-initiated editing, and organizer-requested revisions before the pinned published form closes. | Implemented |
| Track routing | Proposals may select one or more configured tracks. Each track maps to one or more reviewer groups and reviewers; assignments are materialized without self-review. | Implemented |
| Reviews | Assignment queue, weighted rubric, saved partial review, immutable final evidence, and organizer decision states equivalent to approve / maybe / deny. | Implemented |
| Decisions | Organizer may request changes with an applicant edit link, stage a decision, or finalize it. Acceptance atomically activates speaker access, creates a linked session, creates configured onboarding work, records audit evidence, and queues the decision email. | Implemented |
| Speaker onboarding | Organizer-authored manual, external-link, form, profile, and file-request tasks. Fresh events include hotel-stay, flight-reimbursement, profile, slides, and calendar examples. | Implemented |
| Files and collaboration | Private task-scoped uploads, replace/version history, organizer/speaker comments, authorized download, and explicit file evidence in Speaker Ops. | Implemented |
| Resources / wiki | Organizer drafts and publishes plain-text guides with optional HTTPS references; published pages appear in the participant portal and public event resource index. | Implemented |
| Communications | Editable confirmation, decision, reminder, and calendar templates; scheduled reminders; durable outbox/retries; real Cloudflare Email and RFC 5545 `REQUEST` delivery; organizer delivery history. | Implemented when Email is configured |
| Scheduling | List, day/room, week, and conflict views; track filters; drag/drop and explicit placement controls; event-window and collision checks; audited conflict override; public agenda publication. | Implemented |
| Public experience | Event-scoped agenda, speaker gallery, resources, and frameable agenda embed with public-only projections. | Implemented |
| Organizer assistant | Read-only, event-grounded readiness recommendations and workflow deep links. It cannot send or mutate data. | Implemented |
| Airtable | Every registered business record is projected into a canonical Airtable record. Airtable authority may drive allowed descriptive edits into the D1 workflow mirror; protected transitions use audited Workflow Commands. | Implemented; environment cutover is explicit |

## Deliberate scope decisions

The following Sessionboard capabilities are not required by the clarified MVP and are not represented as complete:

- payments, ticketing, marketing CRM, multilingual portals, and AI-generated review decisions;
- arbitrary custom status builders, unlimited evaluation-plan orchestration, and pixel-identical Sessionboard screens;
- Accelevents synchronization (explicitly de-scoped; controlled CSV/JSON exports remain available);
- unrestricted spreadsheet edits of decisions, permissions, deletions, or other protected lifecycle state.

The application uses a bounded approximately 25-second visible-tab refresh plus focus refresh. The Durable Object WebSocket transport is healthy, but mutation broadcasting and client subscription remain future work; the product does not claim instantaneous multi-user collaboration.

## Verification expectations

A release is acceptable only when all of the following pass on the integrated tree:

1. lint, typecheck, unit tests, production build, migration replay, and the production-local smoke lifecycle;
2. desktop and 375 px browser journeys for organizer, applicant, reviewer, speaker, public program, and embed;
3. a production-path Airtable mocked contract suite plus a live provision/reconcile smoke before authority changes;
4. secret and staged-diff scans proving generated media, local Airtable credentials, Worker secret files, and audit exports are not committed;
5. CI on the pushed revision.

Visual evidence extracted from the reference tutorials is kept under the ignored `output/sessionboard-parity/` directory. It is audit input, not distributable product source.
