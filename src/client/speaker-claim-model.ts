import { privateEventPath } from "./private-routes";

export function speakerPortalDestination(eventId?: string | null) {
  return privateEventPath("/portal/home", eventId, "speaker");
}

export function isSpeakerClaimEventId(value: string) {
  return value.length > 0
    && value.length <= 128
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value);
}

export function openSpeakerPortal(eventId?: string | null) {
  window.location.replace(speakerPortalDestination(eventId));
}
