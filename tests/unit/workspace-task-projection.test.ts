import { describe, expect, it } from "vitest";
import { workspaceTaskFromRow } from "../../src/server/workspace";

const row = {
  id: "task-logistics", speaker_profile_id: "speaker-a", title: "Workshop logistics",
  description: "Tell production what you need.", due_at: 1787097540000, status: "in_progress", type: "form",
  target_type: "submission", completion_mode: "form", linked_form_version_id: "form-logistics-v2",
  linked_form_id: "form-logistics", linked_form_version: 2, linked_form_title: "Workshop production details",
  linked_form_description: "Help production prepare your room.",
  linked_form_fields: '[{"id":"layout","label":"Room layout","type":"select","required":true,"options":["Classroom","Pods"]}]',
  linked_form_event_id: "event-a", form_responses: '{"layout":"Classroom"}', form_response_status: "draft",
  artifact_upload_id: "raw-upload-id",
  authorized_artifact_upload_id: "upload-a",
  artifact_file_name: "../deck\u202e.pdf",
  artifact_content_type: "APPLICATION/PDF",
  authorized_proposal_id: "proposal-a",
  target_title: "Operating a reliable workshop",
};

describe("workspace task form projection", () => {
  it("includes the pinned definition and existing response", () => {
    expect(workspaceTaskFromRow(row, "event-a")).toMatchObject({
      completionMode: "form",
      proposalId: "proposal-a",
      targetTitle: "Operating a reliable workshop",
      form: { id: "form-logistics-v2", version: 2, response: { layout: "Classroom" }, responseStatus: "draft" },
    });
  });

  it("does not project an unverified proposal target", () => {
    expect(workspaceTaskFromRow({
      ...row,
      authorized_proposal_id: null,
    }, "event-a")).toMatchObject({ proposalId: undefined, targetTitle: undefined });
  });

  it("rejects a linked form from another event", () => {
    expect(workspaceTaskFromRow({ ...row, linked_form_event_id: "event-b" }, "event-a").form).toBeUndefined();
  });

  it("projects only an event-authorized artifact with safe display metadata", () => {
    expect(workspaceTaskFromRow(row, "event-a")).toMatchObject({
      artifactUploadId: "upload-a",
      artifactFileName: "deck.pdf",
      artifactContentType: "application/pdf",
    });
    expect(workspaceTaskFromRow({
      ...row,
      authorized_artifact_upload_id: null,
    }, "event-a")).toMatchObject({
      artifactUploadId: undefined,
      artifactFileName: undefined,
      artifactContentType: undefined,
    });
  });

  it("derives overdue work at read time without a cron-only status transition", () => {
    expect(workspaceTaskFromRow({ ...row, due_at: 1, status: "not_started" }, "event-a").status).toBe("overdue");
    expect(workspaceTaskFromRow({ ...row, due_at: 1, status: "waived" }, "event-a").status).toBe("waived");
  });
});
