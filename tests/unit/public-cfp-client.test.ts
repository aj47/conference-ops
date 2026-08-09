import { describe, expect, it } from "vitest";
import { publicEventApiPath } from "../../src/client/api";
import {
  configuredCategoryOptions,
  initialConfiguredCategory,
  publishedSubmissionDeadline,
} from "../../src/client/public-cfp";
import {
  DEFAULT_PUBLIC_EVENT_SLUG,
  canonicalPublicPath,
  draftSubmissionPreviewPath,
  privateDraftPreviewEventId,
  publicAgendaEmbedPath,
  publicAgendaPath,
  publicEventRouteFromPath,
  publicResourcesPath,
  publicSubmissionFormKey,
  publicSubmissionPath,
  publicSpeakersPath,
} from "../../src/client/public-routes";
import type { FormField } from "../../src/shared/domain";

describe("public CFP contract helpers", () => {
  const fields: FormField[] = [
    { id: "field-title", label: "Title", type: "short_text", required: true },
    { id: "field-category", label: "Program category", type: "select", required: true, options: [" General ", "Applied AI", "General"] },
  ];

  it("starts with the first configured category and never invents a seeded category", () => {
    expect(configuredCategoryOptions(fields)).toEqual(["General", "Applied AI"]);
    expect(initialConfiguredCategory(fields)).toBe("General");
    expect(initialConfiguredCategory(fields.slice(0, 1))).toBe("");
  });

  it("uses the published form deadline before the event-level fallback", () => {
    expect(publishedSubmissionDeadline(
      { closesAt: "2027-02-01T20:00:00.000Z" },
      { cfpClosesAt: "2027-03-01T20:00:00.000Z" },
    )).toBe("2027-02-01T20:00:00.000Z");
    expect(publishedSubmissionDeadline(
      {},
      { cfpClosesAt: "2027-03-01T20:00:00.000Z" },
    )).toBe("2027-03-01T20:00:00.000Z");
  });
});

describe("event-scoped public routes", () => {
  it("builds and parses canonical agenda, gallery, resource, embed, and CFP paths", () => {
    const slug = "field notes/2027";
    expect(publicAgendaPath(slug)).toBe("/events/field%20notes%2F2027/agenda");
    expect(publicSpeakersPath(slug)).toBe("/events/field%20notes%2F2027/speakers");
    expect(publicResourcesPath(slug)).toBe("/events/field%20notes%2F2027/resources");
    expect(publicAgendaEmbedPath(slug)).toBe("/events/field%20notes%2F2027/embed/agenda");
    expect(publicSubmissionPath(slug, "workshops/v2")).toBe("/submit/field%20notes%2F2027?form=workshops%2Fv2");
    expect(draftSubmissionPreviewPath(slug, "event secondary")).toBe(
      "/submit/field%20notes%2F2027?preview=draft&eventId=event+secondary",
    );
    expect(publicEventRouteFromPath("/events/practical-ai-2027/agenda")).toEqual({
      slug: "practical-ai-2027",
      section: "agenda",
      legacy: false,
    });
    expect(canonicalPublicPath({ slug: "practical-ai-2027", section: "embed", legacy: false }))
      .toBe("/events/practical-ai-2027/embed/agenda");
    expect(publicEventRouteFromPath("/events/practical-ai-2027/resources")).toEqual({
      slug: "practical-ai-2027",
      section: "resources",
      legacy: false,
    });
    expect(canonicalPublicPath({ slug: "practical-ai-2027", section: "resources", legacy: false }))
      .toBe("/events/practical-ai-2027/resources");
    expect(publicEventRouteFromPath("/submit/practical-ai-2027")).toEqual({
      slug: "practical-ai-2027",
      section: "cfp",
      legacy: false,
    });
  });

  it("recognizes only event-scoped private CFP previews", () => {
    const cfpRoute = publicEventRouteFromPath("/submit/practical-ai-2027");
    expect(publicSubmissionFormKey(cfpRoute, "?form=workshops-v2")).toBe("workshops-v2");
    expect(publicSubmissionFormKey(cfpRoute, "?form=")).toBeUndefined();
    expect(privateDraftPreviewEventId(cfpRoute, "?preview=draft&eventId=event-secondary")).toBe("event-secondary");
    expect(privateDraftPreviewEventId(cfpRoute, "?preview=draft")).toBeUndefined();
    expect(privateDraftPreviewEventId(cfpRoute, "?eventId=event-secondary")).toBeUndefined();
    expect(privateDraftPreviewEventId(publicEventRouteFromPath("/events/practical-ai-2027/agenda"), "?preview=draft&eventId=event-secondary")).toBeUndefined();
  });

  it("maps legacy program links to the seeded event without losing route identity", () => {
    expect(publicEventRouteFromPath("/agenda")).toEqual({
      slug: DEFAULT_PUBLIC_EVENT_SLUG,
      section: "agenda",
      legacy: true,
    });
    expect(publicEventRouteFromPath("/embed/agenda")?.section).toBe("embed");
  });

  it("encodes the public API slug as one path segment", () => {
    expect(publicEventApiPath("field notes/2027")).toBe("/api/v1/public/events/field%20notes%2F2027");
    expect(publicEventApiPath("field notes/2027", "workshops/v2")).toBe("/api/v1/public/events/field%20notes%2F2027?form=workshops%2Fv2");
  });
});
