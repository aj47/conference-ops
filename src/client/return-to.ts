const returnToBase = "https://conference-ops.invalid";

export function safeReturnTo(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const resolved = new URL(value, returnToBase);
    if (resolved.origin !== returnToBase) return "/";
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return "/";
  }
}

export function authPathFor(returnTo: string) {
  return `/auth?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`;
}
