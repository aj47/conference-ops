import type { Context, Next } from "hono";
import { createAuth } from "./auth";
import type { AppEnv, AuthActor } from "./env";
import { demoActors } from "../shared/demo-data";

export function jsonError(
  c: Context<AppEnv>,
  status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 503,
  code: string,
  message: string,
  fieldErrors?: Record<string, string>,
) {
  return c.json(
    {
      error: {
        code,
        message,
        ...(fieldErrors ? { fieldErrors } : {}),
        requestId: c.get("requestId"),
      },
    },
    status,
  );
}

export async function requestContext(c: Context<AppEnv>, next: Next) {
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  c.header("x-request-id", requestId);
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "strict-origin-when-cross-origin");
  c.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
  c.header("content-security-policy", "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:; frame-src https:; frame-ancestors 'self'");
  if (c.req.path.startsWith("/api/")) c.header("cache-control", "no-store");
  await next();
}

export async function requireActor(c: Context<AppEnv>, next: Next) {
  if (c.env.DEMO_MODE === "true") {
    const requestedId = c.req.header("x-demo-actor") ?? "user-organizer";
    const actor = demoActors.find((candidate) => candidate.id === requestedId) ?? demoActors[0];
    c.set("actor", { ...actor, demo: true });
    await next();
    return;
  }

  const auth = createAuth(c.env);
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return jsonError(c, 401, "AUTH_REQUIRED", "Sign in to continue.");
  }

  const eventId = c.req.param("eventId");
  let role: AuthActor["role"] = "applicant";
  if (eventId) {
    const requestedRole = c.req.header("x-event-role");
    const validRequestedRole = requestedRole && ["organizer", "reviewer", "applicant", "speaker"].includes(requestedRole) ? requestedRole as AuthActor["role"] : null;
    const membership = await c.env.DB.prepare(
      "SELECT role FROM event_memberships WHERE event_id = ? AND user_id = ? AND (? IS NULL OR role = ?) ORDER BY CASE role WHEN 'organizer' THEN 1 WHEN 'reviewer' THEN 2 WHEN 'speaker' THEN 3 ELSE 4 END LIMIT 1",
    )
      .bind(eventId, session.user.id, validRequestedRole, validRequestedRole)
      .first<{ role: AuthActor["role"] }>();
    if (!membership) {
      return jsonError(c, 403, "EVENT_ACCESS_DENIED", "You do not have access to this event.");
    }
    role = membership.role;
  }

  c.set("actor", {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    role,
    demo: false,
  });
  await next();
}

export function requireRole(c: Context<AppEnv>, roles: AuthActor["role"][]) {
  const actor = c.get("actor");
  if (!actor || !roles.includes(actor.role)) {
    return jsonError(c, 403, "ROLE_REQUIRED", `This action requires ${roles.join(" or ")} access.`);
  }
  return null;
}
