const privateWorkspaceRoutes = new Set([
  "/workspace",
  "/forms",
  "/program-settings",
  "/proposals",
  "/reviews",
  "/schedule",
  "/speaker-ops",
  "/publish",
  "/portal",
  "/portal/home",
  "/portal/submissions",
  "/portal/tasks",
  "/portal/resources",
  "/portal/profile",
]);

export type PrivateWorkspaceRole = "organizer" | "reviewer" | "speaker" | "applicant";

export function isPrivateWorkspaceRole(value: string | null | undefined): value is PrivateWorkspaceRole {
  return value === "organizer" || value === "reviewer" || value === "speaker" || value === "applicant";
}

function currentPrivateWorkspaceRole() {
  if (typeof window === "undefined") return undefined;
  const role = new URLSearchParams(window.location.search).get("role");
  return isPrivateWorkspaceRole(role) ? role : undefined;
}

/**
 * Pin authenticated navigation to the event that produced the current
 * workspace snapshot. Public and identity-handoff routes are intentionally
 * left untouched.
 */
export function privateEventPath(path: string, eventId?: string | null, role?: PrivateWorkspaceRole | null) {
  if (!path.startsWith("/")) return path;
  const url = new URL(path, "https://conference-ops.invalid");
  if (url.origin !== "https://conference-ops.invalid" || !privateWorkspaceRoutes.has(url.pathname)) {
    return path;
  }
  if (eventId) url.searchParams.set("eventId", eventId);
  const pathRole = url.searchParams.get("role");
  const activeRole = role ?? (isPrivateWorkspaceRole(pathRole) ? pathRole : currentPrivateWorkspaceRole());
  if (activeRole) url.searchParams.set("role", activeRole);
  else url.searchParams.delete("role");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function eventRoleLandingPath(
  role: "organizer" | "reviewer" | "speaker" | "applicant",
  eventId: string | null | undefined,
  eventSlug: string,
) {
  if (role === "organizer") return privateEventPath("/workspace", eventId, role);
  if (role === "reviewer") return privateEventPath("/reviews", eventId, role);
  if (role === "speaker") return privateEventPath("/portal/home", eventId, role);
  return `/submit/${encodeURIComponent(eventSlug)}`;
}
