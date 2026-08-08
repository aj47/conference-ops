import { privateEventPath } from "./private-routes";

export type InvitationRole = "organizer" | "reviewer";

export function invitationDestination(role: InvitationRole, eventId?: string | null) {
  return privateEventPath(role === "reviewer" ? "/reviews" : "/workspace", eventId, role);
}
