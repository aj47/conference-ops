export interface ApplicantSpeaker {
  firstName: string;
  lastName: string;
  email: string;
  title: string;
  company: string;
  bio: string;
}

type SpeakerField = keyof ApplicantSpeaker;

export function blankApplicantSpeaker(): ApplicantSpeaker {
  return {
    firstName: "",
    lastName: "",
    email: "",
    title: "",
    company: "",
    bio: "",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedSpeaker(value: unknown): ApplicantSpeaker {
  const speaker = isRecord(value) ? value : {};
  return {
    firstName: typeof speaker.firstName === "string" ? speaker.firstName : "",
    lastName: typeof speaker.lastName === "string" ? speaker.lastName : "",
    email: typeof speaker.email === "string" ? speaker.email : "",
    title: typeof speaker.title === "string" ? speaker.title : "",
    company: typeof speaker.company === "string" ? speaker.company : "",
    bio: typeof speaker.bio === "string" ? speaker.bio : "",
  };
}

export function withMinimumSpeakers(
  speakers: ApplicantSpeaker[],
  minimum: number,
): ApplicantSpeaker[] {
  const required = Math.max(1, Math.floor(minimum));
  if (speakers.length >= required) return speakers;
  return [
    ...speakers,
    ...Array.from({ length: required - speakers.length }, blankApplicantSpeaker),
  ];
}

export function restoreApplicantSpeakers(
  speakers: unknown,
  legacySpeaker: unknown,
  minimum: number,
): ApplicantSpeaker[] {
  const restored = Array.isArray(speakers)
    ? speakers.map(normalizedSpeaker)
    : legacySpeaker
      ? [normalizedSpeaker(legacySpeaker)]
      : [];
  return withMinimumSpeakers(restored, minimum);
}

export function speakerErrorKey(index: number, field: SpeakerField) {
  return `speakers.${index}.${field}`;
}

export function validateApplicantSpeakers(
  speakers: ApplicantSpeaker[],
  minimum: number,
  maximum: number,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const min = Math.max(1, Math.floor(minimum));
  const max = Math.max(1, Math.floor(maximum));

  if (speakers.length < min) {
    errors.participantCount = `Add ${min - speakers.length} more speaker${min - speakers.length === 1 ? "" : "s"}; this form requires at least ${min}.`;
  } else if (speakers.length > max) {
    errors.participantCount = `Remove ${speakers.length - max} speaker${speakers.length - max === 1 ? "" : "s"}; this form allows at most ${max}.`;
  }

  const emailIndexes = new Map<string, number[]>();
  for (const [index, speaker] of speakers.entries()) {
    if (!speaker.firstName.trim()) errors[speakerErrorKey(index, "firstName")] = "First name is required.";
    if (!speaker.lastName.trim()) errors[speakerErrorKey(index, "lastName")] = "Last name is required.";
    if (!speaker.title.trim()) errors[speakerErrorKey(index, "title")] = "Add a role or title for reviewer context.";
    if (!speaker.company.trim()) errors[speakerErrorKey(index, "company")] = "Add an organization or write Independent.";

    const email = speaker.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors[speakerErrorKey(index, "email")] = "Enter a valid email address.";
      continue;
    }
    emailIndexes.set(email, [...(emailIndexes.get(email) ?? []), index]);
  }

  for (const indexes of emailIndexes.values()) {
    if (indexes.length < 2) continue;
    for (const index of indexes) {
      errors[speakerErrorKey(index, "email")] = "Each speaker needs a distinct email address.";
    }
  }

  return errors;
}
