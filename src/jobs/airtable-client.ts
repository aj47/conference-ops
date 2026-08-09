export type AirtableFields = Record<string, unknown>;

export interface AirtableRecord {
  id: string;
  createdTime?: string;
  fields: AirtableFields;
}

export interface AirtableUpsertResponse {
  records: AirtableRecord[];
  createdRecords?: string[];
  updatedRecords?: string[];
}

export interface AirtableWebhookPayloadPage {
  cursor?: number;
  mightHaveMore?: boolean;
  payloads?: unknown[];
  [key: string]: unknown;
}

export class AirtableHttpError extends Error {
  readonly retryable: boolean;

  constructor(
    message: string,
    readonly status: number,
    retryable = status === 408 || status === 429 || status >= 500,
  ) {
    super(message);
    this.retryable = retryable;
  }
}

export class AirtableRateLimitError extends AirtableHttpError {
  readonly retryable = true;

  constructor(readonly retryAfterMs: number, readonly retryAt: number) {
    super("Airtable rate limit exceeded", 429, true);
  }
}

export interface AirtableClientOptions {
  token: string;
  baseId: string;
  fetch?: typeof fetch;
  requestsPerSecond?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

function retryAfterMilliseconds(response: Response, now: number) {
  const header = response.headers.get("retry-after")?.trim();
  if (!header) return 30_000;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.max(1_000, seconds * 1_000);
  const date = new Date(header).getTime();
  return Number.isFinite(date) ? Math.max(1_000, date - now) : 30_000;
}

export class AirtableClient {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly minimumIntervalMs: number;
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: AirtableClientOptions) {
    if (!options.token.trim()) throw new Error("AIRTABLE_TOKEN is required");
    if (!/^app[A-Za-z0-9]+$/.test(options.baseId)) throw new Error("AIRTABLE_BASE_ID is invalid");
    const requestsPerSecond = options.requestsPerSecond ?? 4;
    if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0 || requestsPerSecond > 4) {
      throw new Error("Airtable requestsPerSecond must be between 0 and 4");
    }
    this.fetcher = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
    this.wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.minimumIntervalMs = Math.ceil(1_000 / requestsPerSecond);
  }

  private async throttle() {
    const remaining = this.minimumIntervalMs - (this.now() - this.lastRequestAt);
    if (remaining > 0) await this.wait(remaining);
    this.lastRequestAt = this.now();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    await this.throttle();
    const response = await this.fetcher(`https://api.airtable.com/v0/${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.token}`,
        "content-type": "application/json",
        ...init?.headers,
      },
    });
    if (response.status === 429) {
      const retryAfterMs = retryAfterMilliseconds(response, this.now());
      throw new AirtableRateLimitError(retryAfterMs, this.now() + retryAfterMs);
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 2_000);
      throw new AirtableHttpError(`Airtable API ${response.status}: ${body || response.statusText}`, response.status);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async upsertRecords(tableId: string, records: Array<{ fields: AirtableFields }>, mergeField: string) {
    const responses: AirtableUpsertResponse[] = [];
    for (const batch of chunks(records, 10)) {
      responses.push(await this.request<AirtableUpsertResponse>(`${this.options.baseId}/${encodeURIComponent(tableId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          performUpsert: { fieldsToMergeOn: [mergeField] },
          records: batch,
          typecast: false,
          returnFieldsByFieldId: false,
        }),
      }));
    }
    return responses;
  }

  getRecord(tableId: string, recordId: string) {
    return this.request<AirtableRecord>(`${this.options.baseId}/${encodeURIComponent(tableId)}/${encodeURIComponent(recordId)}`);
  }

  updateRecord(tableId: string, recordId: string, fields: AirtableFields) {
    return this.request<AirtableRecord>(`${this.options.baseId}/${encodeURIComponent(tableId)}/${encodeURIComponent(recordId)}`, {
      method: "PATCH",
      body: JSON.stringify({ fields, typecast: false }),
    });
  }

  async listRecords(tableId: string, options: { filterByFormula?: string; offset?: string; pageSize?: number } = {}) {
    const records: AirtableRecord[] = [];
    let offset = options.offset;
    do {
      const query = new URLSearchParams({ pageSize: String(Math.min(options.pageSize ?? 100, 100)) });
      if (options.filterByFormula) query.set("filterByFormula", options.filterByFormula);
      if (offset) query.set("offset", offset);
      const page = await this.request<{ records: AirtableRecord[]; offset?: string }>(`${this.options.baseId}/${encodeURIComponent(tableId)}?${query}`);
      records.push(...page.records);
      offset = page.offset;
    } while (offset);
    return records;
  }

  listWebhookPayloads(webhookId: string, cursor?: number) {
    const query = new URLSearchParams();
    if (cursor !== undefined) query.set("cursor", String(cursor));
    return this.request<AirtableWebhookPayloadPage>(`bases/${this.options.baseId}/webhooks/${encodeURIComponent(webhookId)}/payloads${query.size ? `?${query}` : ""}`);
  }

  refreshWebhook(webhookId: string) {
    return this.request<{ expirationTime: string }>(`bases/${this.options.baseId}/webhooks/${encodeURIComponent(webhookId)}/refresh`, { method: "POST", body: "{}" });
  }
}

export function airtableRequestsPerSecond(value: string | undefined) {
  if (!value?.trim()) return 4;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 4) throw new Error("AIRTABLE_MAX_REQUESTS_PER_SECOND must be between 0 and 4");
  return parsed;
}
