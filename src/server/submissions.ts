export function verifiedPrimarySpeakerMatches(actorEmail: string, submittedEmail: string) {
  return actorEmail.trim().toLowerCase() === submittedEmail.trim().toLowerCase();
}
