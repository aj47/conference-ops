import { describe, expect, it } from "vitest";
import app from "../../src/server/index";
import type { Bindings } from "../../src/server/env";
import { isEventSlugConstraintError, normalizeEventSlug } from "../../src/server/event-setup";

const basePayload = {
  organizationName: "Program Guild",
  name: "Practical AI Summit 2027",
  shortName: "PAI 2027",
  slug: "practical-ai-summit-2027",
  description: "A practical event.",
  timezone: "America/Los_Angeles",
  startsAt: "2027-08-28T16:00:00.000Z",
  endsAt: "2027-08-29T01:00:00.000Z",
  cfpClosesAt: "2027-07-31T23:00:00.000Z",
  venue: "Fort Mason",
  websiteUrl: "https://example.com/summit",
  accent: "#2d6a6c",
};

function demoBindings(): Bindings {
  return {
    DB: {} as D1Database,
    UPLOADS: {} as R2Bucket,
    ENVIRONMENT: "local",
    DEMO_MODE: "true",
    PUBLIC_APP_URL: "http://localhost:5173",
    BETTER_AUTH_URL: "http://localhost:5173",
    BETTER_AUTH_SECRET: "test-secret-long-enough-for-demo-only",
    MAIL_FROM: "Conference Ops <program@example.test>",
    MAIL_REPLY_TO: "program@example.test",
  };
}

async function create(payload: typeof basePayload) {
  return app.request("http://localhost/api/v1/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-actor": "user-organizer" },
    body: JSON.stringify(payload),
  }, demoBindings());
}

describe("fresh event setup", () => {
  it("normalizes human names into bounded public slugs", () => {
    expect(normalizeEventSlug("  Practical AI / Summit 2027!  ")).toBe("practical-ai-summit-2027");
    expect(normalizeEventSlug("---")).toBe("");
    expect(normalizeEventSlug("A".repeat(100))).toHaveLength(80);
  });

  it("recognizes only the database slug constraint as a public-slug race", () => {
    expect(isEventSlugConstraintError(new Error("D1_ERROR: UNIQUE constraint failed: events.slug"))).toBe(true);
    expect(isEventSlugConstraintError(new Error("UNIQUE constraint failed: organizations.slug"))).toBe(false);
  });

  it("creates a private event workspace shell for an authenticated organizer", async () => {
    const response = await create(basePayload);
    const payload = await response.json() as { data: { id: string; slug: string; formId: string } };

    expect(response.status).toBe(201);
    expect(payload.data.slug).toBe(basePayload.slug);
    expect(payload.data.id).toMatch(/^event-|^[0-9a-f-]{36}$/i);
    expect(payload.data.formId).toBeTruthy();
  });

  it("rejects a CFP deadline that is not before the event", async () => {
    const response = await create({ ...basePayload, cfpClosesAt: basePayload.startsAt });
    const payload = await response.json() as { error: { code: string; fieldErrors: Record<string, string> } };

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe("INVALID_CFP_CLOSE");
    expect(payload.error.fieldErrors.cfpClosesAt).toBeTruthy();
  });
});
