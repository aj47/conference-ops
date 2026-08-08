import type { ApplicantSubmission } from "./workspace";

export const LEGACY_CFP_DRAFT_KEY = "conference-ops-cfp-draft";
const DRAFT_KEY_PREFIX = "conference-ops-cfp-draft:v2";
const LEGACY_DEMO_SCOPE = {
  eventSlug: "ai-engineer-summit-2026",
  formId: "form-main-cfp",
};

export interface SubmissionDraftScope {
  eventSlug: string;
  formId: string;
  formVersion: number;
  accountEmail?: string;
}

interface StoredSubmissionDraft {
  schemaVersion: 2;
  scope: Omit<SubmissionDraftScope, "accountEmail"> & { accountEmail?: string };
  submission: ApplicantSubmission;
}

function normalizedEmail(value?: string) {
  return value?.trim().toLowerCase() || undefined;
}

function encoded(value: string) {
  return encodeURIComponent(value);
}

export function submissionDraftStorageKey(scope: SubmissionDraftScope) {
  return [
    DRAFT_KEY_PREFIX,
    encoded(scope.eventSlug),
    encoded(scope.formId),
    `v${scope.formVersion}`,
    encoded(normalizedEmail(scope.accountEmail) ?? "browser"),
  ].join(":");
}

function browserScope(scope: SubmissionDraftScope): SubmissionDraftScope {
  const rest = { ...scope };
  delete rest.accountEmail;
  return rest;
}

function matchingScope(candidate: Partial<SubmissionDraftScope> | undefined, scope: SubmissionDraftScope) {
  return candidate?.eventSlug === scope.eventSlug
    && candidate.formId === scope.formId
    && candidate.formVersion === scope.formVersion
    && normalizedEmail(candidate.accountEmail) === normalizedEmail(scope.accountEmail);
}

function parseStored(value: string | null): StoredSubmissionDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as StoredSubmissionDraft;
    if (parsed?.schemaVersion !== 2 || !parsed.scope || !parsed.submission) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSubmissionBrowserDraft(
  storage: Pick<Storage, "setItem">,
  scope: SubmissionDraftScope,
  submission: ApplicantSubmission,
) {
  const normalizedScope = { ...scope, accountEmail: normalizedEmail(scope.accountEmail) };
  storage.setItem(submissionDraftStorageKey(normalizedScope), JSON.stringify({
    schemaVersion: 2,
    scope: normalizedScope,
    submission,
  } satisfies StoredSubmissionDraft));
}

export function removeSubmissionBrowserDraft(
  storage: Pick<Storage, "removeItem">,
  scope: SubmissionDraftScope,
) {
  storage.removeItem(submissionDraftStorageKey(scope));
  if (scope.accountEmail) storage.removeItem(submissionDraftStorageKey(browserScope(scope)));
}

function legacyDraftForScope(value: string | null, scope: SubmissionDraftScope): ApplicantSubmission | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as ApplicantSubmission & {
      scope?: Partial<SubmissionDraftScope>;
      submission?: ApplicantSubmission;
    };
    if (parsed.scope && parsed.submission) {
      const legacyAccount = normalizedEmail(parsed.scope.accountEmail);
      const requestedAccount = normalizedEmail(scope.accountEmail);
      return parsed.scope.eventSlug === scope.eventSlug
        && parsed.scope.formId === scope.formId
        && parsed.scope.formVersion === scope.formVersion
        && (!legacyAccount || legacyAccount === requestedAccount)
        ? parsed.submission
        : null;
    }

    // The historic plain payload carried no event identity. It is only safe to
    // migrate into the one form that originally created that key.
    if (scope.eventSlug !== LEGACY_DEMO_SCOPE.eventSlug || scope.formId !== LEGACY_DEMO_SCOPE.formId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadSubmissionBrowserDraft(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  scope: SubmissionDraftScope,
) {
  const exact = parseStored(storage.getItem(submissionDraftStorageKey(scope)));
  if (exact && matchingScope(exact.scope, { ...scope, accountEmail: normalizedEmail(scope.accountEmail) })) {
    return exact.submission;
  }

  if (scope.accountEmail) {
    const anonymousScope = browserScope(scope);
    const anonymous = parseStored(storage.getItem(submissionDraftStorageKey(anonymousScope)));
    if (anonymous && matchingScope(anonymous.scope, anonymousScope)) {
      saveSubmissionBrowserDraft(storage, scope, anonymous.submission);
      storage.removeItem(submissionDraftStorageKey(anonymousScope));
      return anonymous.submission;
    }
  }

  const legacy = legacyDraftForScope(storage.getItem(LEGACY_CFP_DRAFT_KEY), scope);
  if (!legacy) return null;
  saveSubmissionBrowserDraft(storage, scope, legacy);
  storage.removeItem(LEGACY_CFP_DRAFT_KEY);
  return legacy;
}
