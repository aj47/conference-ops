import type { ResourcePage } from "../shared/domain";

export function publishedResources(resources: ResourcePage[]) {
  return resources.filter((resource) => resource.status === "published");
}

export function safeResourceLinkUrl(value: string | undefined) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}
