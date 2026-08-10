import { describe, expect, it } from "vitest";
import { uploadContentTypeAllowed } from "../../src/server/upload-policy";

describe("upload policy", () => {
  it.each([
    ["slides", "application/vnd.ms-powerpoint", "deck.ppt"],
    ["slides", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "deck.pptx"],
    ["supporting_document", "application/msword", "speaker-notes.doc"],
    ["supporting_document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "speaker-notes.docx"],
  ] as const)("accepts advertised legacy and modern Office formats for %s", (purpose, type, name) => {
    expect(uploadContentTypeAllowed(purpose, type, name)).toBe(true);
  });

  it("uses an allowlisted extension only when the browser reports a generic binary MIME", () => {
    expect(uploadContentTypeAllowed("slides", "application/octet-stream", "deck.PPT")).toBe(true);
    expect(uploadContentTypeAllowed("slides", "application/octet-stream", "payload.exe")).toBe(false);
    expect(uploadContentTypeAllowed("slides", "application/x-msdownload", "deck.ppt")).toBe(false);
  });

  it("does not allow document types through the headshot purpose", () => {
    expect(uploadContentTypeAllowed("headshot", "application/msword", "portrait.doc")).toBe(false);
  });

  it("allows raster event logos but never executable SVG", () => {
    expect(uploadContentTypeAllowed("event_logo", "image/png", "event-logo.png")).toBe(true);
    expect(uploadContentTypeAllowed("event_logo", "image/svg+xml", "event-logo.svg")).toBe(false);
    expect(uploadContentTypeAllowed("event_logo", "application/octet-stream", "event-logo.webp")).toBe(true);
  });
});
