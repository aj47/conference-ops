import { describe, expect, it } from "vitest";
import { builderConfigFromForm, formDraftPayload } from "../../src/client/workspace";
import { createDemoWorkspace } from "../../src/shared/demo-data";
import type { FormField } from "../../src/shared/domain";
import { projectCustomFormResponses, sectionedFormFields, splitFormFields } from "../../src/shared/form-fields";
import { defaultFormVersionSettings, normalizeFormVersionSettings } from "../../src/shared/form-settings";

describe("form data round-trip", () => {
  it("preserves proposal and participant field sections through serialization and reload", () => {
    const proposal: FormField[] = [
      { id: "field-title", label: "Session title", type: "short_text", required: true },
      { id: "field-takeaways", label: "Three takeaways", type: "long_text", required: true },
    ];
    const participant: FormField[] = [
      { id: "speaker-email", label: "Email", type: "email", required: true },
      { id: "speaker-phone", label: "Mobile phone", type: "short_text", required: false },
    ];
    const stored = sectionedFormFields(proposal, participant);
    const restored = splitFormFields(JSON.parse(JSON.stringify(stored)) as FormField[]);

    expect(stored.map((field) => field.section)).toEqual(["proposal", "proposal", "participant", "participant"]);
    expect(restored.proposalFields.map((field) => field.id)).toEqual(["field-title", "field-takeaways"]);
    expect(restored.participantFields.map((field) => field.id)).toEqual(["speaker-email", "speaker-phone"]);
  });

  it("hydrates a current draft independently of its published version in the event timezone", () => {
    const workspace = createDemoWorkspace();
    const builder = builderConfigFromForm({
      ...workspace.forms[0],
      version: 4,
      publishedVersion: 3,
      status: "draft",
      fields: sectionedFormFields(
        [{ id: "field-title", label: "Title", type: "short_text", required: true }],
        [{ id: "speaker-email", label: "Email", type: "email", required: true }],
      ),
    }, workspace.event);

    expect(builder).toMatchObject({ version: 4, publishedVersion: 3, status: "draft", closeDate: "2026-08-12T22:00" });
    expect(builder.proposalFields.map((field) => field.id)).toEqual(["field-title"]);
    expect(builder.participantFields.map((field) => field.id)).toEqual(["speaker-email"]);
  });

  it("round-trips every editable version setting through the save payload and reload", () => {
    const workspace = createDemoWorkspace();
    const settings = {
      proposalSectionTitle: "Share the operating lesson",
      proposalPageHeading: "Your session",
      proposalInstructions: "Explain the decision, evidence, and reusable result.",
      participantSectionTitle: "Introduce the presenters",
      participantPageHeading: "Presenters",
      participantInstructions: "Add the people who will actually present this work.",
      participantMin: 2,
      combinedCharacterLimit: 7400,
    };
    const builder = builderConfigFromForm({ ...workspace.forms[0], settings }, workspace.event);
    const payload = formDraftPayload(builder, workspace.event.timezone);
    const reloaded = builderConfigFromForm({
      ...workspace.forms[0],
      ...payload,
      version: workspace.forms[0].version + 1,
      status: "draft",
      updatedAt: "2026-08-08T08:00:00.000Z",
    }, workspace.event);

    expect(payload.settings).toEqual(settings);
    expect(reloaded).toMatchObject(settings);
  });

  it("uses stable defaults for legacy form-version settings without discarding valid blank copy", () => {
    expect(normalizeFormVersionSettings({})).toEqual(defaultFormVersionSettings);
    expect(normalizeFormVersionSettings({ proposalInstructions: "" })).toMatchObject({
      proposalInstructions: "",
      participantMin: defaultFormVersionSettings.participantMin,
    });
  });

  it("exposes labeled custom values while excluding canonical and unknown response keys", () => {
    const fields = sectionedFormFields(
      [
        { id: "field-title", label: "Session title", type: "short_text", required: true },
        { id: "field-takeaways", label: "Three takeaways", type: "long_text", required: true },
        { id: "field-repo", label: "Relevant project or repository", type: "url", required: false },
      ],
      [
        { id: "speaker-email", label: "Email", type: "email", required: true },
        { id: "speaker-phone", label: "Mobile phone", type: "short_text", required: false },
      ],
    );

    expect(projectCustomFormResponses(fields, {
      "field-title": "A title",
      "field-takeaways": "Trace, test, release",
      "field-repo": "https://example.com/project",
      "speaker-email": "speaker@example.com",
      "speaker-phone": "+1 415 555 0100",
      unknown: "not projected",
    })).toEqual([
      expect.objectContaining({ fieldId: "field-takeaways", label: "Three takeaways", value: "Trace, test, release" }),
      expect.objectContaining({ fieldId: "field-repo", label: "Relevant project or repository", value: "https://example.com/project" }),
      expect.objectContaining({ fieldId: "speaker-phone", label: "Mobile phone", value: "+1 415 555 0100" }),
    ]);
  });
});
