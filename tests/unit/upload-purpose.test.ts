import { describe, expect, it } from "vitest";
import { taskUploadPurpose } from "../../src/client/upload-purpose";

describe("task artifact upload purpose", () => {
  it.each([
    ["deck.pdf", "application/pdf"],
    ["deck.ppt", "application/vnd.ms-powerpoint"],
    ["deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["deck.PPT", "application/octet-stream"],
  ])("routes %s to the slide allowlist", (name, type) => {
    expect(taskUploadPurpose({ name, type })).toBe("slides");
  });

  it.each([
    ["notes.doc", "application/msword"],
    ["notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["notes.txt", "text/plain"],
  ])("routes %s to the supporting-document allowlist", (name, type) => {
    expect(taskUploadPurpose({ name, type })).toBe("supporting_document");
  });
});
