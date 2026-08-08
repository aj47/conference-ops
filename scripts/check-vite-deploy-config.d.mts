export interface GeneratedViteConfig {
  name?: string;
  main?: string;
  vars?: { ENVIRONMENT?: string; DEMO_MODE?: string; PUBLIC_APP_URL?: string; BETTER_AUTH_URL?: string };
  d1_databases?: Array<{ binding?: string; database_name?: string }>;
  r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
  queues?: { producers?: Array<{ binding?: string; queue?: string }> };
  services?: Array<{ binding?: string; service?: string }>;
  assets?: { directory?: string; binding?: string; not_found_handling?: string; run_worker_first?: string[] };
  [key: string]: unknown;
}

export function validateGeneratedViteConfig(
  config: GeneratedViteConfig,
  environment: "pilot" | "staging" | "production",
): {
  name: string;
  database: string;
  bucket: string;
  queue: string;
  realtime: string;
};

export function validateStaticAssetHeaders(source: string): true;

export function checkViteDeployConfig(
  environment: "pilot" | "staging" | "production",
  rootDirectory?: string,
): Promise<{
  environment: string;
  configPath: string;
  worker: string;
  assets: string;
  valid: true;
}>;
