import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import type { ProposalStatus } from "../../src/shared/domain";
import {
  auditProposalDecisionBindings,
  auditProposalDecisionSql,
  proposalDecisionTransitionAllowed,
  type ProposalDecisionStatus,
  updateProposalDecisionBindings,
  updateProposalDecisionSql,
} from "../../src/server/mutations";

const targets: ProposalDecisionStatus[] = ["accept_queue", "accepted", "decline_queue", "rejected", "waitlisted"];
const sources: ProposalStatus[] = ["draft", "changes_requested", "revision_open", "submitted", "under_review", "accept_queue", "waitlisted", "accepted", "decline_queue", "rejected", "withdrawn", "session"];

const allowed: Record<ProposalDecisionStatus, ProposalStatus[]> = {
  accept_queue: ["submitted", "under_review", "waitlisted", "decline_queue"],
  accepted: ["accept_queue"],
  decline_queue: ["submitted", "under_review", "accept_queue", "waitlisted"],
  rejected: ["decline_queue"],
  waitlisted: ["submitted", "under_review", "accept_queue", "decline_queue"],
};

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

  function decide(target: ProposalDecisionStatus, auditId: string, proposalId = "proposal-a", eventId = "event-a", now = 20) {
    const audit = db.prepare(auditProposalDecisionSql).run(...auditProposalDecisionBindings({
      auditId,
      actorUserId: "actor-a",
      proposalId,
      eventId,
      target,
      summary: `Proposal moved to ${target}.`,
      metadata: JSON.stringify({ status: target }),
      requestId: `request-${auditId}`,
      now,
    }));
    const update = db.prepare(updateProposalDecisionSql).run(...updateProposalDecisionBindings({
      target,
      decidedAt: target === "accepted" || target === "rejected" ? now : null,
      now,
      proposalId,
      eventId,
    }));
    return { audit, update };
  }

  it("enforces the complete staged transition matrix in both TypeScript and SQLite", () => {
    for (const source of sources) {
      for (const target of targets) {
        db.prepare("UPDATE proposals SET status = ?, decided_at = NULL, updated_at = 1, version = 1 WHERE id = 'proposal-a'").run(source);
        const result = db.prepare(updateProposalDecisionSql).run(...updateProposalDecisionBindings({
          target,
          decidedAt: target === "accepted" || target === "rejected" ? 20 : null,
          now: 20,
          proposalId: "proposal-a",
          eventId: "event-a",
        }));
        const expected = allowed[target].includes(source);

        expect(proposalDecisionTransitionAllowed(source, target), `${source} -> ${target} helper`).toBe(expected);
        expect(result.changes, `${source} -> ${target} SQL`).toBe(expected ? 1 : 0);
      }
    }
  });

  it("records the staged move and final acceptance as separate audited transitions", () => {
    db.exec("BEGIN");
    const staged = decide("accept_queue", "audit-stage", "proposal-a", "event-a", 20);
    db.exec("COMMIT");
    db.exec("BEGIN");
    const accepted = decide("accepted", "audit-final", "proposal-a", "event-a", 30);
    db.exec("COMMIT");

    expect(staged.audit.changes).toBe(1);
    expect(staged.update.changes).toBe(1);
    expect(accepted.audit.changes).toBe(1);
    expect(accepted.update.changes).toBe(1);
    expect(db.prepare("SELECT status, decided_at, version FROM proposals WHERE id = 'proposal-a'").get()).toEqual({ status: "accepted", decided_at: 30, version: 3 });
    expect(db.prepare("SELECT action, COUNT(*) AS count FROM audit_logs GROUP BY action").get()).toEqual({ action: "proposal.decision_changed", count: 2 });
  });

  it("does not mutate or audit cross-event, draft, or final proposals", () => {
    expect(decide("accept_queue", "audit-wrong-event", "proposal-a", "event-b").update.changes).toBe(0);
    expect(decide("accept_queue", "audit-withdrawn", "proposal-withdrawn").update.changes).toBe(0);
    db.prepare("UPDATE proposals SET status = 'draft' WHERE id = 'proposal-a'").run();
    expect(decide("accept_queue", "audit-draft").update.changes).toBe(0);
    db.prepare("UPDATE proposals SET status = 'accepted' WHERE id = 'proposal-a'").run();
    expect(decide("rejected", "audit-redecision").update.changes).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_logs").get()).toEqual({ count: 0 });
  });

  it("rolls the final decision back when its audit insert fails", () => {
    db.prepare("UPDATE proposals SET status = 'accept_queue' WHERE id = 'proposal-a'").run();
    db.prepare("INSERT INTO audit_logs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run("audit-collision", "org-a", "event-a", "actor-a", "existing", "proposal", "proposal-a", "Existing", "{}", "request-old", 1);

    db.exec("BEGIN");
    expect(() => decide("accepted", "audit-collision")).toThrow();
    db.exec("ROLLBACK");

    expect(db.prepare("SELECT status, decided_at, version FROM proposals WHERE id = 'proposal-a'").get()).toEqual({ status: "accept_queue", decided_at: null, version: 1 });
  });
});
