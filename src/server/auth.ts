import { betterAuth } from "better-auth";
import type { Bindings } from "./env";
import { dispatchPersistedJobs, persistOutboxJobs, type OutboxJob } from "./outbox-producer";

/**
 * Better Auth's D1 adapter works with logical camelCase field names unless
 * they are mapped explicitly. Our Drizzle schema intentionally uses SQLite
 * snake_case columns, so keep this contract next to the auth configuration
 * and exercise it in the production-path smoke test.
 */
export const authDatabaseFieldMappings = {
  user: {
    name: "name",
    email: "email",
    emailVerified: "email_verified",
    image: "image",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  session: {
    expiresAt: "expires_at",
    token: "token",
    createdAt: "created_at",
    updatedAt: "updated_at",
    ipAddress: "ip_address",
    userAgent: "user_agent",
    userId: "user_id",
  },
  account: {
    accountId: "account_id",
    providerId: "provider_id",
    userId: "user_id",
    accessToken: "access_token",
    refreshToken: "refresh_token",
    idToken: "id_token",
    accessTokenExpiresAt: "access_token_expires_at",
    refreshTokenExpiresAt: "refresh_token_expires_at",
    scope: "scope",
    password: "password",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  verification: {
    identifier: "identifier",
    value: "value",
    expiresAt: "expires_at",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
} as const;

function redactEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!domain) return "redacted";
  return `${local.slice(0, 1) || "*"}***@${domain}`;
}

export async function queueAuthEmail(
  env: Bindings,
  kind: "verification" | "password_reset",
  email: string,
  url: string,
) {
  if (!env.JOBS_QUEUE) {
    if (env.ENVIRONMENT !== "local") {
      throw new Error("Authentication email delivery is not configured");
    }
    console.info(JSON.stringify({ event: "auth_email.local_preview", kind, email: redactEmail(email), url }));
    return;
  }

  const job: OutboxJob = {
    kind: "email",
    idempotencyKey: `${kind}:${email}:${new URL(url).searchParams.get("token") ?? crypto.randomUUID()}`,
    payload: { kind, recipient: email, url },
  };
  // The outbox row is authoritative. Queue transport is only the immediate
  // delivery path; Cron will recover a persisted verification/reset email if
  // the producer cannot reach Queues for a moment.
  await persistOutboxJobs(env.DB, [job]);
  await dispatchPersistedJobs(env.JOBS_QUEUE, [job], (_failedJob, error) => {
    console.error(JSON.stringify({
      event: "auth_email.queue_failed",
      kind,
      email: redactEmail(email),
      recovery: "scheduled_outbox",
      error: error instanceof Error ? error.message : String(error),
    }));
  });
}

export function createAuth(env: Bindings) {
  return betterAuth({
    appName: "Conference Ops",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.PUBLIC_APP_URL, env.BETTER_AUTH_URL].filter(Boolean),
    database: env.DB,
    user: { fields: authDatabaseFieldMappings.user },
    account: { fields: authDatabaseFieldMappings.account },
    verification: { fields: authDatabaseFieldMappings.verification },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await queueAuthEmail(env, "password_reset", user.email, url);
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60,
      async sendVerificationEmail({ user, url }) {
        await queueAuthEmail(env, "verification", user.email, url);
      },
    },
    session: {
      fields: authDatabaseFieldMappings.session,
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      cookiePrefix: "conference_ops",
      useSecureCookies: env.ENVIRONMENT !== "local",
    },
  });
}
