export const agendaEmbedContentSecurityPolicy = "default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' wss:; frame-src https:; frame-ancestors *; form-action 'self'; upgrade-insecure-requests";
export const agendaEmbedLocalContentSecurityPolicy = agendaEmbedContentSecurityPolicy
  .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
  .replace("; upgrade-insecure-requests", "");

export function agendaEmbedContentSecurityPolicyForEnvironment(environment: string) {
  return environment === "local" ? agendaEmbedLocalContentSecurityPolicy : agendaEmbedContentSecurityPolicy;
}

export function agendaEmbedAssetRequest(request: Request) {
  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/";
  return new Request(assetUrl, request);
}

export function withAgendaEmbedFramingPolicy(assetResponse: Response, contentSecurityPolicy = agendaEmbedContentSecurityPolicy) {
  const headers = new Headers(assetResponse.headers);
  headers.delete("x-frame-options");
  headers.set("content-security-policy", contentSecurityPolicy);

  return new Response(assetResponse.body, {
    status: assetResponse.status,
    statusText: assetResponse.statusText,
    headers,
  });
}
