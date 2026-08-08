import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { auditProposalDecisionSql, updateProposalDecisionSql } from "../../src/server/mutations";

describe("proposal decision audit transaction", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE events (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL);
      CREATE TABLE proposals (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        status TEXT NOT NULL,
        decided_at INTEGER,
        updated_at INTEGER NOT NULL,
        version INTEGER NOT NULL
      );
      CREATE TABLE audit_logs (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        event_id TEXT,
        actor_user_id TEXT,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        metadata TEXT NOT NULL,
        request_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO events VALUES ('event-a', 'org-a'), ('event-b', 'org-b');
      INSERT INTO proposals VALUES
        ('proposal-a', 'event-a', 'under_review', NULL, 1, 1),
        ('proposal-withdrawn', 'event-a', 'withdrawn', NULL, 1, 1);
    `);
  });

  function decide(auditId: string, proposalId = "proposal-a", eventId = "event-a") {
    const update = db.prepare(updateProposalDecisionSql).run("accepted", 20, 20, proposalId, eventId);
    const audit = db.prepare(auditProposalDecisionSql).run(auditId, "actor-a", proposalId, "Proposal moved to accepted.", '{"status":"accepted"}', "request-a", 20, eventId, proposalId, "accepted");
    return { update, audit };
  }

  it("writes exactly one scoped audit row for a successful decision", () => {
    db.exec("BEGIN");
    const result = decide("audit-a");
    db.exec("COMMIT");

    expect(result.update.changes).toBe(1);
    expect(result.audit.changes).toBe(1);
    expect(db.prepare("SELECT status, decided_at, version FROM proposals WHERE id = 'proposal-a'").get()).toEqual({ status: "accepted", decided_at: 20, version: 2 });
    expect(db.prepare("SELECT organization_id, event_id, entity_id, action FROM audit_logs WHERE id = 'audit-a'").get()).toEqual({ organization_id: "org-a", event_id: "event-a", entity_id: "proposal-a", action: "proposal.decision_changed" });
  });

  it("does not mutate or audit a proposal from another event or a locked proposal", () => {
    expect(decide("audit-wrong-event", "proposal-a", "event-b").update.changes).toBe(0);
    expect(decide("audit-withdrawn", "proposal-withdrawn").update.changes).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
  });

  it("rolls the decision back when the audit insert fails inside the batch transaction", () => {
    db.prepare("INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("audit-collision", "org-a", "event-a", "actor-a", "existing", "proposal", "proposal-a", "Existing", "{}", "request-old", 1);

    db.exec("BEGIN");
    expect(() => decide("audit-collision")).toThrow();
    db.exec("ROLLBACK");

    expect(db.prepare("SELECT status, decided_at, version FROM proposals WHERE id = 'proposal-a'").get()).toEqual({ status: "under_review", decided_at: null, version: 1 });
  });
});
