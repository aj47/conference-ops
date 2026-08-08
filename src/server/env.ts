export interface EmailBinding {
  send(message: unknown): Promise<void>;
}

export interface Bindings {
  DB: D1Database;
  UPLOADS: R2Bucket;
  JOBS_QUEUE?: Queue;
  REALTIME?: Fetcher;
  EMAIL?: EmailBinding;
  ASSETS?: Fetcher;
  ENVIRONMENT: "local" | "staging" | "production";
  DEMO_MODE: string;
  PUBLIC_APP_URL: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  MAIL_FROM: string;
  MAIL_REPLY_TO: string;
  BOOTSTRAP_TOKEN?: string;
  REALTIME_TOKEN?: string;
  ACCELEVENTS_ENABLED?: string;
  ACCELEVENTS_API_KEY?: string;
  ACCELEVENTS_EVENT_URL?: string;
}

export interface AuthActor {
  id: string;
  name: string;
  email: string;
  role: "organizer" | "reviewer" | "applicant" | "speaker";
  demo: boolean;
}

export type AppVariables = {
  requestId: string;
  actor?: AuthActor;
};

export type AppEnv = {
  Bindings: Bindings;
  Variables: AppVariables;
};
