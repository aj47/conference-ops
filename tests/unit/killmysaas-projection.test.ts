import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type EvidenceBundle = { repoFiles: string[]; workspaceReceipts?: string[] };
type ProjectionItem = {
  id: string;
  weight: number;
  type: string;
  testability: "auto" | "auto-partial" | "manual";
  implementationVerdict: "pass" | "partial" | "fail" | "cannot_judge";
  evidence: string[];
};

type Projection = {
  assessment: {
    officialJudgeRun: boolean;
    officialScorePct: number | null;
    requiredImplementationScorePct: number;
    requiredItemsWithEvidence: number;
    requiredItemsTotal: number;
    rubricManualItemsVerified: number;
    rubricManualItemsPending: number;
  };
  evaluator: { requiredItemCount: number; optionalItemCount: number };
  areas: Array<{
    id: string;
    required: boolean;
    areaWeight: number;
    earned: number;
    judgeable: number;
    total: number;
    scorePct: number;
    contribution: number;
  }>;
  evidenceBundles: Record<string, EvidenceBundle>;
  manualVerification: {
    rubricManualItems: Array<{
      id: string;
      officialManualVerified: boolean;
      status: string;
      evidence: string[];
      versionedReceipt?: string;
      rawReceiptAvailability?: string;
    }>;
  };
  items: Record<string, ProjectionItem[]>;
  optionalCrm: {
    includedInRequiredScore: boolean;
    officiallyAssessed: boolean;
    scorePct: number | null;
    itemCount: number;
    totalWeight: number;
    itemIds: string[];
  };
};

const projection = JSON.parse(readFileSync(resolve("docs/killmysaas-projection.json"), "utf8")) as Projection;
const expectedAreas = new Map([
  ["cfp", { itemCount: 16, total: 34, areaWeight: 20 }],
  ["abstracts", { itemCount: 14, total: 28, areaWeight: 20 }],
  ["speakers", { itemCount: 16, total: 33, areaWeight: 15 }],
  ["content", { itemCount: 14, total: 31, areaWeight: 15 }],
  ["agenda", { itemCount: 8, total: 18, areaWeight: 10 }],
  ["widgets", { itemCount: 16, total: 34, areaWeight: 20 }],
]);

describe("KillMySaaS evidence projection", () => {
  it("matches the pinned 84-item required rubric and its area-weighted score math", () => {
    const requiredItems = Object.values(projection.items).flat();
    expect(projection.evaluator.requiredItemCount).toBe(84);
    expect(requiredItems).toHaveLength(84);
    expect(new Set(requiredItems.map((item) => item.id)).size).toBe(84);
    expect(requiredItems.reduce((sum, item) => sum + item.weight, 0)).toBe(178);
    expect(requiredItems.every((item) => item.implementationVerdict === "pass")).toBe(true);

    for (const area of projection.areas) {
      const expected = expectedAreas.get(area.id);
      expect(expected, `Unexpected required area ${area.id}`).toBeDefined();
      const items = projection.items[area.id];
      expect(items, `Missing items for ${area.id}`).toHaveLength(expected!.itemCount);
      const total = items.reduce((sum, item) => sum + item.weight, 0);
      expect(total).toBe(expected!.total);
      expect(area).toMatchObject({
        required: true,
        areaWeight: expected!.areaWeight,
        earned: total,
        judgeable: total,
        total,
        scorePct: 100,
        contribution: expected!.areaWeight,
      });
    }

    expect(projection.areas.reduce((sum, area) => sum + area.areaWeight, 0)).toBe(100);
    expect(projection.areas.reduce((sum, area) => sum + area.contribution, 0)).toBe(100);
    expect(projection.assessment.requiredImplementationScorePct).toBe(100);
    expect(projection.assessment.requiredItemsTotal).toBe(84);
    expect(projection.assessment.requiredItemsWithEvidence).toBe(84);
  });

  it("maps every required item to existing source and deterministic test evidence", () => {
    for (const item of Object.values(projection.items).flat()) {
      expect(item.evidence.length, `${item.id} has no evidence bundle`).toBeGreaterThan(0);
      const files = item.evidence.flatMap((bundleId) => {
        const bundle = projection.evidenceBundles[bundleId];
        expect(bundle, `${item.id} references missing bundle ${bundleId}`).toBeDefined();
        return bundle.repoFiles;
      });
      expect(files.some((file) => file.startsWith("tests/")), `${item.id} has no deterministic test evidence`).toBe(true);
      for (const file of files) expect(existsSync(resolve(file)), `${item.id} references missing ${file}`).toBe(true);
    }
  });

  it("keeps the official run and the outstanding manual receipt honest", () => {
    expect(projection.assessment.officialJudgeRun).toBe(false);
    expect(projection.assessment.officialScorePct).toBeNull();
    expect(projection.manualVerification.rubricManualItems.map((item) => item.id).sort()).toEqual(["CFP-08", "SPK-16"]);
    expect(projection.manualVerification.rubricManualItems.filter((item) => item.officialManualVerified)).toHaveLength(1);
    const confirmationReceipt = projection.manualVerification.rubricManualItems.find((item) => item.id === "CFP-08");
    expect(confirmationReceipt).toMatchObject({
      officialManualVerified: true,
      status: "verified",
      versionedReceipt: "docs/evidence/CFP-08-submission-confirmation-redacted.json",
      rawReceiptAvailability: "local_private_gitignored",
    });
    expect(existsSync(resolve(confirmationReceipt!.versionedReceipt!))).toBe(true);
    const redactedReceipt = JSON.parse(readFileSync(resolve(confirmationReceipt!.versionedReceipt!), "utf8")) as {
      requirement: string;
      evidenceType: string;
      observed: { outboxStatus: string; attempts: number; inboxReceived: boolean };
      privateSourceAvailability: string;
    };
    expect(redactedReceipt).toMatchObject({
      requirement: "CFP-08",
      evidenceType: "redacted-live-delivery-receipt",
      observed: { outboxStatus: "sent", attempts: 1, inboxReceived: true },
      privateSourceAvailability: "local_gitignored_not_in_repository",
    });
    expect(projection.manualVerification.rubricManualItems.find((item) => item.id === "SPK-16")).toMatchObject({
      officialManualVerified: false,
      status: "pending_live_receipt",
    });
    expect(projection.assessment.rubricManualItemsVerified).toBe(1);
    expect(projection.assessment.rubricManualItemsPending).toBe(1);
  });

  it("keeps optional CRM outside every required-score claim", () => {
    expect(projection.optionalCrm).toMatchObject({
      includedInRequiredScore: false,
      officiallyAssessed: false,
      scorePct: null,
      itemCount: 12,
      totalWeight: 19,
    });
    expect(projection.optionalCrm.itemIds).toHaveLength(projection.evaluator.optionalItemCount);
    expect(new Set(projection.optionalCrm.itemIds).size).toBe(12);
  });
});
