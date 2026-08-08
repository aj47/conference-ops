import type { SpeakerProfile } from "../shared/domain";

export function portalSpeakerForActor(speakers: SpeakerProfile[], actorEmail: string) {
  const normalizedEmail = actorEmail.trim().toLowerCase();
  return speakers.find((speaker) => speaker.email.trim().toLowerCase() === normalizedEmail);
}
