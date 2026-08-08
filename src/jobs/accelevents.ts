export interface AcceleventsEnv {
  ACCELEVENTS_API_KEY?: string;
  ACCELEVENTS_EVENT_URL?: string;
}

export interface AcceleventsSpeaker {
  localId: string;
  firstName: string;
  lastName: string;
  email: string;
  title?: string;
  company?: string;
  bio?: string;
}

export interface AcceleventsSession {
  localId: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
}

export class AcceleventsClient {
  constructor(private readonly env: AcceleventsEnv) {}

  private get baseUrl() {
    if (!this.env.ACCELEVENTS_EVENT_URL) throw new Error("Accelevents event URL is not configured");
    return `https://api.accelevents.com/rest/host/event/${encodeURIComponent(this.env.ACCELEVENTS_EVENT_URL)}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    if (!this.env.ACCELEVENTS_API_KEY) throw new Error("Accelevents API key is not configured");
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        Key: this.env.ACCELEVENTS_API_KEY,
        ...init?.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`Accelevents ${response.status}: ${detail.slice(0, 500)}`);
      Object.assign(error, { status: response.status, retryable: response.status === 429 || response.status >= 500 });
      throw error;
    }
    return response.json() as Promise<T>;
  }

  async preflight() {
    return this.request<unknown>("/speakers?pageNo=0&pageSize=1");
  }

  async createSpeaker(speaker: AcceleventsSpeaker) {
    return this.request<{ id?: string }>("/speaker", {
      method: "POST",
      body: JSON.stringify({ firstName: speaker.firstName, lastName: speaker.lastName, email: speaker.email, title: speaker.title, company: speaker.company, bio: speaker.bio }),
    });
  }

  async updateSpeaker(remoteId: string, speaker: AcceleventsSpeaker) {
    return this.request<{ id?: string }>(`/speaker/${encodeURIComponent(remoteId)}`, {
      method: "PUT",
      body: JSON.stringify({ firstName: speaker.firstName, lastName: speaker.lastName, email: speaker.email, title: speaker.title, company: speaker.company, bio: speaker.bio }),
    });
  }

  async createSession(session: AcceleventsSession) {
    return this.request<{ id?: string }>("/session", {
      method: "POST",
      body: JSON.stringify({ title: session.title, description: session.description, startTime: session.startsAt, endTime: session.endsAt, sessionTypeFormat: "IN_PERSON" }),
    });
  }

  async updateSession(remoteId: string, session: AcceleventsSession) {
    return this.request<{ id?: string }>(`/session/${encodeURIComponent(remoteId)}`, {
      method: "PUT",
      body: JSON.stringify({ title: session.title, description: session.description, startTime: session.startsAt, endTime: session.endsAt, sessionTypeFormat: "IN_PERSON" }),
    });
  }
}
