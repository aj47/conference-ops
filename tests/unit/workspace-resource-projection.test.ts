import { describe, expect, it } from "vitest";
import { workspaceResourceFromRow } from "../../src/server/workspace";

describe("workspace participant resource projection", () => {
  it("projects plain page content and the optional organizer link", () => {
    expect(workspaceResourceFromRow({
      id: "resource-a",
      title: "Arrival guide",
      slug: "arrival-guide",
      status: "published",
      summary: "Day-of logistics.",
      sanitized_html: "Use the north entrance.",
      embed_url: "https://events.example.com/arrival",
      updated_at: Date.UTC(2026, 7, 8, 12),
    })).toEqual({
      id: "resource-a",
      title: "Arrival guide",
      slug: "arrival-guide",
      status: "published",
      summary: "Day-of logistics.",
      body: "Use the north entrance.",
      linkUrl: "https://events.example.com/arrival",
      updatedAt: "2026-08-08T12:00:00.000Z",
    });
  });

  it("uses safe empty defaults for legacy rows", () => {
    expect(workspaceResourceFromRow({ id: "resource-b", title: "Policy", slug: "policy", status: "draft", updated_at: 0 })).toMatchObject({
      summary: "",
      body: "",
    });
  });
});
