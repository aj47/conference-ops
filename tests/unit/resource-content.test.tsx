import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ResourceContent } from "../../src/client/ResourceContent";
import { publishedResources, safeResourceLinkUrl } from "../../src/client/resource-pages";
import type { ResourcePage } from "../../src/shared/domain";

function resource(patch: Partial<ResourcePage> = {}): ResourcePage {
  return {
    id: "resource-1",
    title: "Arrival guide",
    slug: "arrival-guide",
    status: "published",
    summary: "Day-of details.",
    body: "Arrive 45 minutes early.",
    updatedAt: "2026-08-08T12:00:00.000Z",
    ...patch,
  };
}

describe("participant resource presentation", () => {
  it("keeps drafts out of participant projections", () => {
    expect(publishedResources([resource(), resource({ id: "draft", status: "draft" })]).map((page) => page.id)).toEqual(["resource-1"]);
  });

  it("renders organizer copy as text instead of executable HTML", () => {
    const markup = renderToStaticMarkup(<ResourceContent resource={resource({ body: "<script>globalThis.pwned = true</script>\n\nUse the north entrance." })} />);

    expect(markup).toContain("&lt;script&gt;globalThis.pwned = true&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("Use the north entrance.");
  });

  it("allows only absolute HTTP(S) reference links at the rendering boundary", () => {
    expect(safeResourceLinkUrl("https://events.example.com/guide")).toBe("https://events.example.com/guide");
    expect(safeResourceLinkUrl("javascript:alert(1)")).toBeUndefined();
    expect(renderToStaticMarkup(<ResourceContent resource={resource({ linkUrl: "javascript:alert(1)" })} />)).not.toContain("href=");
  });
});
