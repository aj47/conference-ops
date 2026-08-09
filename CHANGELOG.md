# Changelog

## 0.3.0 — 2026-08-09

KillMySaaS SessionBoard assessment parity release candidate.

### Review operations

- Multiple dated review rounds with independent reviewer pools, assignment caps,
  exact proposal assignments, blind-review controls, and reviewer recusal.
- Numeric, dropdown, and free-text scorecards with weighted aggregates,
  progress reminders, safe CSV export, and human-controlled AI triage.

### Speaker and content operations

- Searchable speaker roster, CSV merge, workflow tracking, logistics, custom
  tasks, scoped invitations, merge previews, and durable communication logs.
- Identity-scoped speaker portal for profile, social links, sessions, tasks,
  comments, and constrained versioned uploads.
- Central session content editing, revision restore, approval states, file
  library, and grouped latest-version ZIP export.

### Agenda and public widgets

- Explainable conflict-free auto-placement alongside the list, day, week, and
  conflict schedule views.
- Sessions, speakers, agenda, personal itinerary, and gallery widgets backed by
  one explicitly approved public-data projection.
- Organizer Embed Studio with theme, filters, field selection, iframe/share
  output, JSON/XML/iCal feeds, and third-party framing policy.

### Release safety

- Additive migrations `0012` and `0013` for review depth and speaker/content
  operations, including Airtable capture coverage.
- Fail-closed blind-data, reviewer-pool, speaker-private-field, public-content,
  CSV, and acceptance-path authorization/portability regressions.
- 100% implementation projection for all 84 required KillMySaaS rubric items;
  the paid upstream judge and the `SPK-16` live reminder receipt remain separate
  post-deployment verification steps.

## 0.2.0 — 2026-08-08

Sessionboard-parity and Airtable release candidate.

### Organizer workflows

- Multiple independently versioned CFPs with form-specific public links.
- Multi-track reviewer routing and organizer-configurable active scoring plan.
- Applicant and organizer controlled proposal revisions with immutable historical review evidence.
- Revision-aware review cycles that reassign every eligible reviewer after resubmission without overwriting prior final evidence.
- Persistent onboarding task, portal-form, file-request, resource, and external-link authoring.
- Communication delivery history plus durable email, reminder, and calendar workflows.
- List, day/room, week, and conflict schedule views with recoverable URL state.

### Participant workflows

- Applicant self-service editing before the pinned CFP closes.
- Speaker file replacement history, authorized prior-version download, and task comments.
- Published participant resources/files and safe public resource pages.

### Airtable

- Canonical business-record registry with stable external keys, hashes, and tombstones.
- D1 change capture, batched Jobs Worker synchronization, webhook reconciliation, conflict recording, and guarded authority changes.
- Generation-safe queue completion, identity-bound imports, strict domain validation, derived-field drift detection, and fail-closed promotion readiness.
- Base-scoped provisioning workflow and organizer-safe connection health surface.
- Authentication secrets, sessions, queue leases, and raw R2 bytes remain operational Cloudflare state.

### Release safety

- Additive migrations `0007` through `0010` for Airtable, revisions, file/task collaboration, and revision provenance.
- Expanded role, tenant, migration, production-path, responsive, and integration regression coverage.
