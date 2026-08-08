export type SubmissionSessionUser = {
  email?: string | null;
  emailVerified?: boolean | null;
};

export type SubmissionAccountState =
  | { kind: "demo" }
  | { kind: "checking" }
  | { kind: "anonymous" }
  | { kind: "unverified"; email: string }
  | { kind: "mismatch"; email: string; draftEmail: string }
  | { kind: "verified"; email: string };

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

export function submissionAccountState(
  source: "api" | "demo",
  sessionPending: boolean,
  user: SubmissionSessionUser | null | undefined,
  draftEmail: string,
): SubmissionAccountState {
  if (source === "demo") return { kind: "demo" };
  if (sessionPending) return { kind: "checking" };
  if (!user?.email) return { kind: "anonymous" };

  const email = user.email.trim();
  if (user.emailVerified !== true) return { kind: "unverified", email };
  if (normalizedEmail(email) !== normalizedEmail(draftEmail)) {
    return { kind: "mismatch", email, draftEmail: draftEmail.trim() };
  }
  return { kind: "verified", email };
}

export function submissionAccountError(state: SubmissionAccountState) {
  switch (state.kind) {
    case "demo":
    case "verified":
      return null;
    case "checking":
      return "Wait while we check your conference account.";
    case "anonymous":
      return "Save this browser draft, then sign in or create a verified account to continue.";
    case "unverified":
      return `Verify ${state.email} before continuing.`;
    case "mismatch":
      return state.draftEmail
        ? `This draft uses ${state.draftEmail}. Use your verified account email, ${state.email}, to continue.`
        : `Use your verified account email, ${state.email}, to continue.`;
  }
}
