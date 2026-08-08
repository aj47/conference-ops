import { betterAuth } from "better-auth";
import type { Bindings } from "./env";

async function queueAuthEmail(
  env: Bindings,
  kind: "verification" | "password_reset",
  email: string,
  url: string,
) {
  if (!env.JOBS_QUEUE) {
    console.info(JSON.stringify({ event: "auth_email.preview", kind, email, url }));
    return;
  }

  await env.JOBS_QUEUE.send({
    kind: "email",
    idempotencyKey: `${kind}:${email}:${new URL(url).searchParams.get("token") ?? crypto.randomUUID()}`,
    payload: { kind, recipient: email, url },
  });
}

export function createAuth(env: Bindings) {
  return betterAuth({
    appName: "Conference Ops",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.PUBLIC_APP_URL, env.BETTER_AUTH_URL].filter(Boolean),
    database: env.DB,
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
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      cookiePrefix: "conference_ops",
      useSecureCookies: env.ENVIRONMENT !== "local",
    },
  });
}
