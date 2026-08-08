import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bindings } from "../../src/server/env";
import { authDatabaseFieldMappings, queueAuthEmail } from "../../src/server/auth";

function bindings(environment: string) {
  return { ENVIRONMENT: environment } as Bindings;
}

describe("authentication email fallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps Better Auth fields to the migrated D1 snake_case columns", () => {
    expect(authDatabaseFieldMappings.account.userId).toBe("user_id");
    expect(authDatabaseFieldMappings.account.providerId).toBe("provider_id");
    expect(authDatabaseFieldMappings.session.userId).toBe("user_id");
    expect(authDatabaseFieldMappings.session.expiresAt).toBe("expires_at");
    expect(authDatabaseFieldMappings.user.emailVerified).toBe("email_verified");
    expect(authDatabaseFieldMappings.verification.expiresAt).toBe("expires_at");
  });

  it("fails closed outside local development when the queue binding is missing", async () => {
    await expect(queueAuthEmail(bindings("production"), "verification", "person@example.com", "https://app.example.com/verify?token=secret"))
      .rejects.toThrow("Authentication email delivery is not configured");
  });

  it("keeps local preview links usable while redacting the recipient", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await queueAuthEmail(bindings("local"), "password_reset", "person@example.com", "http://localhost/reset?token=local-secret");
    expect(info).toHaveBeenCalledOnce();
    expect(String(info.mock.calls[0][0])).toContain('"email":"p***@example.com"');
    expect(String(info.mock.calls[0][0])).not.toContain("person@example.com");
  });

  it("persists auth email intent before treating Queue as a best-effort fast path", async () => {
    const statement = { bind: vi.fn() } as unknown as D1PreparedStatement;
    (statement.bind as unknown as ReturnType<typeof vi.fn>).mockReturnValue(statement);
    const batch = vi.fn().mockResolvedValue([]);
    const send = vi.fn().mockRejectedValue(new Error("temporary queue outage"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = {
      ENVIRONMENT: "production",
      DB: { prepare: vi.fn(() => statement), batch },
      JOBS_QUEUE: { send },
    } as unknown as Bindings;

    await expect(queueAuthEmail(
      env,
      "verification",
      "person@example.com",
      "https://app.example.com/verify?token=secret",
    )).resolves.toBeUndefined();

    expect(batch).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"recovery":"scheduled_outbox"'));
  });
});
