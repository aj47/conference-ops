import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AirtableStatusCard } from "../../src/client/AirtableOperatorStatus";
import type { AirtableOperatorStatus } from "../../src/shared/domain";

const status: AirtableOperatorStatus = {
  enabled: true,
  configured: true,
  health: "healthy",
  authority: "airtable",
  connection: { scope: "environment", state: "healthy", schemaVersion: 1 },
  sync: {
    lastPushAt: "2026-08-08T17:58:00.000Z",
    lastPullAt: "2026-08-08T17:59:00.000Z",
    lastReconciledAt: "2026-08-08T17:50:00.000Z",
    webhook: "active",
    webhookExpiresAt: "2026-08-11T18:00:00.000Z",
  },
  workload: { scope: "unavailable", pending: null, dead: null, openConflicts: null },
  guidance: {
    mode: "operate",
    title: "Operate Airtable as the guarded source of truth",
    detail: "Allowed edits flow through validation.",
    steps: ["Use Records for descriptive edits.", "Use Workflow Commands for lifecycle changes."],
  },
  generatedAt: "2026-08-08T18:00:00.000Z",
};

describe("Airtable organizer status surface", () => {
  it("makes authority, sync evidence, escalation ownership, and the security boundary scannable", () => {
    const markup = renderToStaticMarkup(<AirtableStatusCard status={status} timezone="America/Los_Angeles" refreshing={false} onRefresh={vi.fn()} />);

    expect(markup).toContain("Airtable is the current source of truth");
    expect(markup).toContain("The guarded mirror is operating normally");
    expect(markup).toContain("D1 workflow store");
    expect(markup).toContain("Airtable records");
    expect(markup).toContain("Environment connector");
    expect(markup).toContain("Escalate an Attention required state to the platform operator");
    expect(markup).toContain("Refresh status");
    expect(markup).toContain("Tokens, webhook secrets, raw records, queue details, and cross-event totals are never returned");
    expect(markup).toContain("Event organizers escalate degraded states");
    expect(markup).not.toMatch(/input|token-private|base-private/);
  });

  it("explains why event counts are absent for an environment connector", () => {
    const markup = renderToStaticMarkup(<AirtableStatusCard
      status={status}
      timezone="UTC"
      refreshing
      onRefresh={vi.fn()}
    />);

    expect(markup).toContain("Environment-wide queue and conflict details are intentionally hidden");
    expect(markup).toContain("Environment connector");
    expect(markup).toContain("Refreshing…");
    expect(markup).toContain("aria-busy=\"true\"");
  });

  it("keeps the unconfigured state specific without implying a global connection exists", () => {
    const markup = renderToStaticMarkup(<AirtableStatusCard
      status={{ ...status, enabled: false, configured: false, health: "disabled", authority: "d1", connection: { scope: "none", state: "not_configured", schemaVersion: null }, workload: { scope: "unavailable", pending: null, dead: null, openConflicts: null } }}
      timezone="UTC"
      refreshing={false}
      onRefresh={vi.fn()}
    />);

    expect(markup).toContain("Queue and conflict details become available only to the platform operator");
    expect(markup).not.toContain("event-scoped connection");
  });
});
