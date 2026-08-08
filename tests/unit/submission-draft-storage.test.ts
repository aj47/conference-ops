import { describe, expect, it } from "vitest";
import {
  LEGACY_CFP_DRAFT_KEY,
  loadSubmissionBrowserDraft,
  saveSubmissionBrowserDraft,
  submissionDraftStorageKey,
  type SubmissionDraftScope,
} from "../../src/client/submission-draft-storage";
import type { ApplicantSubmission } from "../../src/client/workspace";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const draft: ApplicantSubmission = {
  title: "A scoped proposal",
  summary: "A browser draft that belongs to exactly one event form and immutable version.",
  category: "General",
  format: "talk",
  level: "intermediate",
  repoUrl: "",
  workshopNeeds: "",
  responses: {},
  speakers: [],
};

const scope: SubmissionDraftScope = {
  eventSlug: "practical-ai-2027",
  formId: "form-cfp",
  formVersion: 2,
};

describe("browser CFP draft isolation", () => {
  it("does not restore one event's draft into another event or form version", () => {
    const storage = new MemoryStorage();
    saveSubmissionBrowserDraft(storage, scope, draft);

    expect(loadSubmissionBrowserDraft(storage, { ...scope, eventSlug: "another-event" })).toBeNull();
    expect(loadSubmissionBrowserDraft(storage, { ...scope, formVersion: 3 })).toBeNull();
    expect(loadSubmissionBrowserDraft(storage, scope)).toEqual(draft);
  });

  it("moves an anonymous event-scoped draft into the verified account scope", () => {
    const storage = new MemoryStorage();
    saveSubmissionBrowserDraft(storage, scope, draft);
    const accountScope = { ...scope, accountEmail: "Speaker@Example.com" };

    expect(loadSubmissionBrowserDraft(storage, accountScope)).toEqual(draft);
    expect(storage.getItem(submissionDraftStorageKey(scope))).toBeNull();
    expect(loadSubmissionBrowserDraft(storage, { ...scope, accountEmail: "other@example.com" })).toBeNull();
  });

  it("only migrates an unscoped historic payload into the form that originally owned it", () => {
    const storage = new MemoryStorage();
    storage.setItem(LEGACY_CFP_DRAFT_KEY, JSON.stringify(draft));

    expect(loadSubmissionBrowserDraft(storage, scope)).toBeNull();
    expect(storage.getItem(LEGACY_CFP_DRAFT_KEY)).not.toBeNull();
    expect(loadSubmissionBrowserDraft(storage, {
      eventSlug: "ai-engineer-summit-2026",
      formId: "form-main-cfp",
      formVersion: 3,
    })).toEqual(draft);
    expect(storage.getItem(LEGACY_CFP_DRAFT_KEY)).toBeNull();
  });
});
