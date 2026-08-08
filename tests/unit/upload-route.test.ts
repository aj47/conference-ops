import { describe, expect, it } from "vitest";
import app from "../../src/server/index";
import type { Bindings } from "../../src/server/env";

const bindings: Bindings = {
  DB: {} as D1Database,
  UPLOADS: {} as R2Bucket,
  ENVIRONMENT: "local",
  DEMO_MODE: "true",
  PUBLIC_APP_URL: "http://localhost:5173",
  BETTER_AUTH_URL: "http://localhost:5173",
  BETTER_AUTH_SECRET: "test-secret-long-enough-for-demo-only",
  MAIL_FROM: "Conference Ops <program@example.test>",
  MAIL_REPLY_TO: "program@example.test",
};

function upload(purpose: string, fileName: string, contentType: string) {
  const body = new Uint8Array([1, 2, 3, 4]);
  return app.request(`http://localhost/api/v1/events/event-a/uploads?purpose=${purpose}&filename=${encodeURIComponent(fileName)}`, {
    method: "POST",
    headers: {
      "content-length": String(body.byteLength),
      "content-type": contentType,
      "x-demo-actor": "user-speaker",
    },
    body,
  }, bindings);
}

describe("task artifact upload route policy", () => {
  it.each([
    ["slides", "deck.ppt", "application/vnd.ms-powerpoint"],
    ["slides", "deck.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
    ["supporting_document", "speaker-notes.doc", "application/msword"],
    ["supporting_document", "speaker-notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["slides", "deck.PPTX", "application/octet-stream"],
  ])("accepts %s upload %s advertised by the task picker", async (purpose, fileName, contentType) => {
    const response = await upload(purpose, fileName, contentType);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { fileName, purpose, status: "stored" } });
  });

  it("rejects a generic binary body whose extension is outside the selected purpose", async () => {
    const response = await upload("slides", "payload.exe", "application/octet-stream");

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "UPLOAD_TYPE_NOT_ALLOWED" } });
  });
});
