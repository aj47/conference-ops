import type { FormVersionSettings } from "./domain";

export const defaultFormVersionSettings: FormVersionSettings = {
  proposalSectionTitle: "Tell us about the work",
  proposalPageHeading: "Proposal",
  proposalInstructions:
    "Describe the practical problem, the approach you tried, and the evidence attendees will leave with.",
  participantSectionTitle: "Who will be on stage?",
  participantPageHeading: "Speakers",
  participantInstructions:
    "Add every presenter and a reachable primary contact. You can update public profile details later.",
  participantMin: 1,
  combinedCharacterLimit: 6200,
};

function stringSetting(
  value: unknown,
  fallback: string,
  maximumLength: number,
) {
  return typeof value === "string" && value.length <= maximumLength
    ? value
    : fallback;
}

function integerSetting(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  return typeof value === "number"
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum
    ? value
    : fallback;
}

export function normalizeFormVersionSettings(value: unknown): FormVersionSettings {
  const settings = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    proposalSectionTitle: stringSetting(
      settings.proposalSectionTitle,
      defaultFormVersionSettings.proposalSectionTitle,
      255,
    ),
    proposalPageHeading: stringSetting(
      settings.proposalPageHeading,
      defaultFormVersionSettings.proposalPageHeading,
      15,
    ),
    proposalInstructions: stringSetting(
      settings.proposalInstructions,
      defaultFormVersionSettings.proposalInstructions,
      20_000,
    ),
    participantSectionTitle: stringSetting(
      settings.participantSectionTitle,
      defaultFormVersionSettings.participantSectionTitle,
      255,
    ),
    participantPageHeading: stringSetting(
      settings.participantPageHeading,
      defaultFormVersionSettings.participantPageHeading,
      15,
    ),
    participantInstructions: stringSetting(
      settings.participantInstructions,
      defaultFormVersionSettings.participantInstructions,
      20_000,
    ),
    participantMin: integerSetting(
      settings.participantMin,
      defaultFormVersionSettings.participantMin,
      1,
      12,
    ),
    combinedCharacterLimit: integerSetting(
      settings.combinedCharacterLimit,
      defaultFormVersionSettings.combinedCharacterLimit,
      1000,
      100_000,
    ),
  };
}
