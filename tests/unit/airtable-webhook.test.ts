import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseAirtableWebhookSignal, verifyAirtableWebhookMac } from "../../src/server/airtable-webhook";

describe("Airtable webhook verification", () => {
  it("accepts the documented HMAC format and rejects body tampering", async () => {
    const secret = Buffer.from("synthetic-webhook-secret");
    const encodedSecret = secret.toString("base64");
    const body = JSON.stringify({ base: { id: "appTestBase123" }, webhook: { id: "achWebhook123" } });
    const signature = createHmac("sha256", secret).update(body).digest("hex");

    expect(await verifyAirtableWebhookMac(body, `hmac-sha256=${signature}`, encodedSecret)).toBe(true);
    expect(await verifyAirtableWebhookMac(body, `hmac-sha256=${signature.toUpperCase()}`, encodedSecret)).toBe(true);
    expect(await verifyAirtableWebhookMac(`${body} `, `hmac-sha256=${signature}`, encodedSecret)).toBe(false);
    expect(await verifyAirtableWebhookMac(body, `hmac-sha256=${Buffer.from(signature).toString("base64")}`, encodedSecret)).toBe(false);
    expect(parseAirtableWebhookSignal(body)).toEqual({ baseId: "appTestBase123", webhookId: "achWebhook123" });
  });

  it("fails closed for malformed notifications", async () => {
    expect(parseAirtableWebhookSignal("{}")).toBeNull();
    expect(await verifyAirtableWebhookMac("{}", undefined, "bad")).toBe(false);
  });
});
