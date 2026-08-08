import type { FormVersionSettings } from "./domain";

export interface FormVersionControls {
  submissionType: "abstract" | "session";
  collectsParticipants: boolean;
  maxSubmissionsPerUser?: number;
  redirectToPortal: boolean;
  confirmationEmailEnabled: boolean;
  closesAt?: string;
}

const controlsKey = "submissionControls";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function validIsoInstant(value: unknown) {
  if (typeof value !== "string" || !value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

/**
 * Form-level submission controls historically lived only on submission_forms.
 * New versions also snapshot them inside the already-versioned settings JSON so
 * draft edits cannot change the live contract before publication. Legacy rows
 * transparently inherit their denormalized submission_forms values.
 */
export function formVersionControlsFromSettings(
  value: unknown,
  fallback: FormVersionControls,
): FormVersionControls {
  const settings = record(value);
  const hasVersionedControls = Object.prototype.hasOwnProperty.call(settings, controlsKey)
    && settings[controlsKey] !== null
    && typeof settings[controlsKey] === "object"
    && !Array.isArray(settings[controlsKey]);
  const controls = record(settings[controlsKey]);
  const hasVersionedLimit = Object.prototype.hasOwnProperty.call(controls, "maxSubmissionsPerUser");
  const storedLimit = typeof controls.maxSubmissionsPerUser === "number"
    && Number.isInteger(controls.maxSubmissionsPerUser)
    && controls.maxSubmissionsPerUser >= 1
    && controls.maxSubmissionsPerUser <= 100
    ? controls.maxSubmissionsPerUser
    : undefined;
  const maxSubmissionsPerUser = storedLimit
    ?? (hasVersionedControls && !hasVersionedLimit ? undefined : fallback.maxSubmissionsPerUser);
  const hasVersionedClose = Object.prototype.hasOwnProperty.call(controls, "closesAt");
  const closesAt = validIsoInstant(controls.closesAt)
    ?? (hasVersionedControls && !hasVersionedClose ? undefined : fallback.closesAt);
  return {
    submissionType: controls.submissionType === "abstract" || controls.submissionType === "session"
      ? controls.submissionType
      : fallback.submissionType,
    collectsParticipants: typeof controls.collectsParticipants === "boolean"
      ? controls.collectsParticipants
      : fallback.collectsParticipants,
    ...(maxSubmissionsPerUser === undefined ? {} : { maxSubmissionsPerUser }),
    redirectToPortal: typeof controls.redirectToPortal === "boolean"
      ? controls.redirectToPortal
      : fallback.redirectToPortal,
    confirmationEmailEnabled: typeof controls.confirmationEmailEnabled === "boolean"
      ? controls.confirmationEmailEnabled
      : fallback.confirmationEmailEnabled,
    ...(closesAt === undefined ? {} : { closesAt }),
  };
}

export function formVersionSettingsWithControls(
  settings: FormVersionSettings | Record<string, unknown>,
  controls: FormVersionControls,
) {
  return {
    ...settings,
    [controlsKey]: controls,
  };
}
