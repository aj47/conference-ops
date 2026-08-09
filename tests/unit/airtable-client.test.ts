import { describe, expect, it, vi } from "vitest";
import { AirtableClient, AirtableRateLimitError } from "../../src/jobs/airtable-client";

describe("AirtableClient", () => {
  it("keeps the Workers fetch receiver when using the runtime global", async () => {
    const strictRuntimeFetch = vi.fn(function (this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(Response.json({ id: "recRecord123", fields: {} }));
    });
    vi.stubGlobal("fetch", strictRuntimeFetch);

    try {
      const client = new AirtableClient({ token: "pat-test", baseId: "appTestBase123" });

      await expect(client.getRecord("tblRecords123", "recRecord123")).resolves.toMatchObject({ id: "recRecord123" });
      expect(strictRuntimeFetch).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("batches upserts in groups of ten and stays under four requests per second", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    let recordNumber = 0;
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { records: Array<{ fields: Record<string, unknown> }> };
      bodies.push(body as unknown as Record<string, unknown>);
      return Response.json({ records: body.records.map((record) => ({ id: `rec${++recordNumber}`, fields: record.fields })) });
    });
    let now = 1_000;
    const waits: number[] = [];
    const client = new AirtableClient({
      token: "pat-test",
      baseId: "appTestBase123",
      fetch: fetcher as typeof fetch,
      now: () => now,
      wait: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; },
    });
    const records = Array.from({ length: 23 }, (_, index) => ({ fields: { "External Key": `track:["${index}"]` } }));

    const responses = await client.upsertRecords("tblRecords123", records, "External Key");

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(bodies.map((body) => (body.records as unknown[]).length)).toEqual([10, 10, 3]);
    expect(waits).toEqual([250, 250]);
    expect(responses.flatMap((response) => response.records)).toHaveLength(23);
  });

  it("returns retry metadata for a 429 instead of sleeping for thirty seconds", async () => {
    const wait = vi.fn(async () => undefined);
    const client = new AirtableClient({
      token: "pat-test",
      baseId: "appTestBase123",
      fetch: vi.fn(async () => new Response("limited", { status: 429, headers: { "retry-after": "30" } })) as typeof fetch,
      now: () => 5_000,
      wait,
    });

    const error = await client.getRecord("tblRecords123", "recRecord123").catch((caught) => caught);

    expect(error).toBeInstanceOf(AirtableRateLimitError);
    expect(error).toMatchObject({ retryAfterMs: 30_000, retryAt: 35_000, retryable: true });
    expect(wait).not.toHaveBeenCalled();
  });
});
