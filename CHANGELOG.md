# Changelog

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
