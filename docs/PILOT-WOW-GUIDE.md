# Pilot experience guide

This guide covers the organizer-facing experience layer added to Conference Ops
0.3.0 for prospective-client trials. It is designed to make a new event feel
usable without an engineer sitting beside the organizer, while keeping sends,
decisions, publication, and source-of-truth changes under explicit human
control.

This document describes the source candidate. Do not assume a feature is live
in the persistent pilot until the target Worker version, migrations, and
post-deploy checks have been verified.

## Start a real event without starting from a blank page

Choose **Create event workspace** and select one of three starting sources:

- **Starter blueprint** creates a complete operating baseline from a guided
  template.
- **CSV structure** accepts a bounded `type,name,capacity,color` file for rooms
  and tracks, previews valid rows, and blocks invalid or ambiguous input before
  creation.
- **Airtable preparation** explains the protected operator handoff. It never
  asks an organizer to paste a token into the browser or silently changes
  source-of-truth authority.

The four starter blueprints are Conference, Workshop, Internal summit, and
Technical multi-track. Each preview states the rooms, tracks, and workflows it
will initialize. Multi-track templates create matching review lanes and a
multi-select track question; single-track templates keep the simpler dropdown.

After creation, reload Event details and Program setup. Confirm the selected
timezone, dates, accent, tracks, rooms, forms, reviewer groups, task plan,
messages, and reminders before inviting anyone.

## Make the event look like the client's event

Open **Program setup → Brand & previews**.

1. Choose an event accent with the semantic color controls.
2. Upload an event logo as JPEG, PNG, or WebP, up to 5 MB. SVG is deliberately
   excluded from this public-image boundary.
3. Review the public program preview and copy the event-scoped CFP/program
   links.
4. Remove or replace the logo without changing the rest of the event.

The brand follows the private organizer shell and public event header. The app
keeps a readable Conference Ops identity when no event logo is present.

## Preview each persona safely

Use **Preview as…** in the organizer top bar. Applicant, reviewer, speaker, and
public tabs show a read-only summary and the exact event-scoped route that the
persona will use.

Preview does not switch the signed-in identity, create assignments, send mail,
or mutate data. Use distinct verified accounts when testing permissions and
actual cross-role workflows; self-review protection remains active.

The demo-only role switcher is labeled **Test role** visually while retaining a
stable accessible name for automation and assistive technology. It must not be
presented as a production identity model.

## Follow the guided organizer loop

Select **Guided tour** to open the six-step event loop:

1. establish the event and brand;
2. publish the CFP and route tracks;
3. collect and review submissions;
4. accept and complete speaker work;
5. draft and resolve the schedule; and
6. publish and verify the public experience.

Checks are stored locally per event and may be reset with **Reset guide**.
Resetting the guide never resets event data.

The Control Room complements the tour with a **Now / Next / Proof** cockpit and
a client activity timeline. Use Now for the immediate exception, Next for the
next safe workflow, and Proof for the latest persisted evidence or Airtable
health.

## Use the supervised copilot

Open **Program setup → Readiness assistant** and ask a grounded question such
as “What needs attention before we publish?”

Every recommendation follows the same contract:

- **Preview action** shows expected impact;
- **Changes now** must read `None`;
- **Reversible** explains whether the later workflow can be undone;
- **Human gate** identifies the required confirmation; and
- **Continue to workflow** deep-links to the event-scoped page where the
  organizer makes the decision.

The copilot does not send messages, publish, accept/decline, alter Airtable
authority, or silently schedule sessions.

## Draft a schedule and undo it

On Schedule, select **Draft my schedule**. The accessible action remains
described as auto-placing safe sessions because it considers only
conflict-free candidates. Inspect the preview, then apply it once.

Conference Ops records the sessions placed by that action and exposes **Undo
draft placements**. Undo returns those sessions to Ready to place. Published
sessions remain locked; conflicts and manual overrides still require an
organizer decision and durable reason.

## Prove communications before sending to participants

Open **Program setup → Communications**.

1. Choose a message kind and event speaker sample.
2. Inspect the resolved subject and plain-text body.
3. Confirm the displayed test recipient is the signed-in organizer.
4. Choose **Send test to me**.
5. Check the delivery ledger; a test subject is prefixed `[TEST]`.

The test endpoint never sends the preview to the selected speaker. Production
persists the message through the durable outbox/Queue path; demo mode returns a
clearly sandboxed receipt. A queued or sent ledger status is operational proof,
not by itself proof of mailbox receipt.

## Read Airtable status without exposing connector internals

Open **Program setup → Airtable source**. The organizer-first panel answers:

- Is the connection **Connected and current**?
- Which system is the current business-record source?
- When did app → Airtable and Airtable → app last move?

Base IDs, record IDs, payloads, hashes, tokens, webhook secrets, and connector
errors are not shown. **Platform diagnostics** contains the redacted technical
state needed for escalation. Authority changes, reconciliation, dead work, and
conflict resolution remain platform-operator responsibilities under
`infra/AIRTABLE.md`.

## Give speakers one obvious next step

The speaker portal now leads with one dominant next action: an overdue or next
task, a proposal revision, an incomplete profile, or a clear completion state.
It links directly to the relevant task, submission, or profile surface. The
existing task list, file history, comments, resources, and session assignments
remain available as supporting detail.

## Client acceptance checklist

- Launch from each source option; use CSV only with synthetic structure data.
- Confirm template-created rooms, tracks, routing groups, forms, and tasks.
- Apply a logo and accent; inspect the private and public headers.
- Open and close Preview as… and Guided tour with keyboard and Escape; verify
  focus returns to the opener.
- Run a copilot inspection and verify preview → explicit continuation.
- Draft a schedule, apply it, undo it, then perform one manual placement.
- Preview a personalized message and send one test only to the organizer.
- Confirm the Airtable card is client-readable and diagnostics remain redacted.
- Sign in as a distinct speaker and confirm the next-action card points to the
  correct work.
- Check Control Room Now / Next / Proof and the client activity timeline.
- Repeat the core surfaces at 1440 px, about 900 px, and 375 px with reduced
  motion; report any horizontal overflow, focus loss, console error, or failed
  request.

Use synthetic or representative data. Never include passwords, verification or
reset links, invitation tokens, private travel details, real client files,
Airtable credentials, webhook secrets, or Cloudflare resource identifiers in a
screenshot or feedback report.
