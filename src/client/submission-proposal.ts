import type { FormField, Proposal } from "../shared/domain";
import { blankApplicantSpeaker, withMinimumSpeakers } from "./submission-speakers";
import type { ApplicantSubmission } from "./workspace";

interface SubmissionFormShape {
  participantMin: number;
  proposalFields: FormField[];
}

interface VerifiedSubmissionOwner {
  name?: string | null;
  email: string;
}

function splitSpeakerName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts.at(-1) ?? "" };
}

/**
 * A participant-disabled form still needs one server-side speaker identity so
 * the verified proposal owner can move into the speaker lifecycle. Use the
 * authenticated account identity and discard any stale hidden roster entries;
 * participant-enabled forms retain their complete, user-entered roster.
 */
export function submissionForPersistence(
  submission: ApplicantSubmission,
  collectsParticipants: boolean,
  owner?: VerifiedSubmissionOwner,
): ApplicantSubmission {
  if (collectsParticipants || !owner) return submission;

  const accountName = owner.name?.trim() || "Speaker";
  const displayName = accountName.length >= 2 ? accountName : `${accountName} Speaker`;
  return {
    ...submission,
    speakers: [{
      ...blankApplicantSpeaker(),
      ...(submission.speakers[0] ?? {}),
      ...splitSpeakerName(displayName),
      email: owner.email.trim(),
    }],
  };
}

function responseForCanonicalField(
  responses: Record<string, unknown>,
  fields: FormField[],
  id: string,
) {
  const field = fields.find((candidate) => candidate.id === id);
  return field && typeof responses[field.id] === "string" ? String(responses[field.id]) : "";
}

export function proposalToApplicantSubmission(
  proposal: Proposal,
  form: SubmissionFormShape,
): ApplicantSubmission {
  const responses = { ...(proposal.responses ?? {}) };
  const speakers = proposal.speakers.map((speaker) => ({
    ...blankApplicantSpeaker(),
    ...splitSpeakerName(speaker.name),
    email: speaker.email,
    title: speaker.title,
    company: speaker.company,
    bio: speaker.bio,
  }));

  return {
    title: proposal.title,
    summary: proposal.summary,
    category: proposal.category,
    format: proposal.format,
    level: proposal.level,
    repoUrl: responseForCanonicalField(
      responses,
      form.proposalFields,
      "field-repo",
    ),
    workshopNeeds: responseForCanonicalField(
      responses,
      form.proposalFields,
      "field-workshop-needs",
    ),
    responses,
    speakers: withMinimumSpeakers(speakers, form.participantMin),
  };
}
