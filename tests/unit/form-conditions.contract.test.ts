import { describe, expect, it } from "vitest";
import { defaultForm } from "../../src/shared/demo-data";
import {
  configuredSubmissionCategory,
  configuredSubmissionCategories,
  formAvailability,
  isFieldVisible,
  requiredFileField,
  submissionCombinedCharacterCount,
  validateFormResponses,
} from "../../src/server/forms";
import type { FormField } from "../../src/shared/domain";
import { defaultFormVersionSettings } from "../../src/shared/form-settings";

const formatField = defaultForm.fields.find((field) => field.id === "field-format")!;
const workshopNeedsField = defaultForm.fields.find((field) => field.id === "field-workshop-needs")!;

const validationFields: FormField[] = [
  { id: "email", label: "Contact email", type: "email", required: true },
  { id: "url", label: "Project URL", type: "url", required: false },
  { id: "category", label: "Category", type: "select", required: true, options: ["Agents", "Evaluation"] },
];

describe("conditional form rule contract", () => {
  it("identifies required upload fields that production publishing must reject", () => {
    expect(requiredFileField([
      { id: "optional-file", label: "Optional file", type: "file", required: false },
      { id: "required-file", label: "Required file", type: "file", required: true },
    ])?.id).toBe("required-file");
  });

  it("keeps every demo condition pointed at an existing field and valid option", () => {
    for (const field of defaultForm.fields) {
      if (!field.condition) continue;
      const source = defaultForm.fields.find((candidate) => candidate.id === field.condition?.sourceFieldId);

      expect(source, `${field.id} condition source`).toBeDefined();
      expect(source?.options, `${field.id} condition source options`).toContain(field.condition.value);
    }
  });

  it("evaluates equals against the controlling scalar answer", () => {
    expect(isFieldVisible(workshopNeedsField, { "field-format": "Workshop" })).toBe(true);
    expect(isFieldVisible(workshopNeedsField, { "field-format": "Talk" })).toBe(false);
    expect(isFieldVisible(workshopNeedsField, {})).toBe(false);
  });

  it("evaluates contains against text and multi-select answers", () => {
    const dependent: FormField = {
      id: "field-agent-detail",
      label: "Agent details",
      type: "long_text",
      required: false,
      condition: { sourceFieldId: "field-topics", operator: "contains", value: "Agent" },
    };

    expect(isFieldVisible(dependent, { "field-topics": "Production Agent systems" })).toBe(true);
    expect(isFieldVisible(dependent, { "field-topics": ["Evaluation", "Agent observability"] })).toBe(true);
    expect(isFieldVisible(dependent, { "field-topics": ["Evaluation", "Safety"] })).toBe(false);
    expect(isFieldVisible(dependent, {})).toBe(false);
  });

  it("ignores a hidden required field but validates it when shown", () => {
    expect(
      validateFormResponses([formatField, workshopNeedsField], { "field-format": "Talk" }),
    ).toEqual({});
    expect(
      validateFormResponses([formatField, workshopNeedsField], { "field-format": "Workshop" }),
    ).toEqual({ "field-workshop-needs": "Workshop setup requirements is required." });
  });
});

describe("validateFormResponses", () => {
  it("rejects invalid email, URL, and select values", () => {
    expect(
      validateFormResponses(validationFields, {
        email: "speaker-at-example.test",
        url: "ftp://example.test/slides",
        category: "Sales pitch",
      }),
    ).toEqual({
      email: "Enter a valid email address.",
      url: "Enter a full http:// or https:// URL.",
      category: "Choose one of the available options.",
    });
  });

  it("accepts a complete valid response set", () => {
    expect(
      validateFormResponses(validationFields, {
        email: "speaker@example.test",
        url: "https://example.test/project",
        category: "Agents",
      }),
    ).toEqual({});
  });

  it("rejects response IDs that are not present in the pinned form version", () => {
    expect(validateFormResponses(validationFields, {
      email: "speaker@example.test",
      category: "Agents",
      injected: { admin: true },
    })).toMatchObject({
      "responses.injected": "This response is not part of the published form.",
    });
  });

  it("allows partial drafts while still rejecting malformed supplied values", () => {
    const fields: FormField[] = [
      { id: "required", label: "Required answer", type: "short_text", required: true },
      { id: "consent", label: "Recording consent", type: "checkbox", required: false },
      { id: "topics", label: "Topics", type: "multi_select", required: false, options: ["Agents", "Evaluation"] },
    ];

    expect(validateFormResponses(fields, {}, { requireRequired: false })).toEqual({});
    expect(validateFormResponses(fields, {
      consent: "yes",
      topics: "Agents",
    }, { requireRequired: false })).toEqual({
      consent: "Choose yes or no.",
      topics: "Choose one or more of the available options.",
    });
  });

  it("enforces scalar, option, per-field, combined, and serialized-size limits", () => {
    const fields: FormField[] = [
      { id: "short", label: "Short answer", type: "short_text", required: false },
      { id: "long-a", label: "First detail", type: "long_text", required: false },
      { id: "long-b", label: "Second detail", type: "long_text", required: false },
      { id: "topics", label: "Topics", type: "multi_select", required: false, options: ["Agents", "Evaluation"] },
    ];
    const settings = { ...defaultFormVersionSettings, combinedCharacterLimit: 1_000 };

    expect(validateFormResponses(fields, {
      short: "x".repeat(1_001),
      "long-a": "a".repeat(600),
      "long-b": "b".repeat(401),
      topics: ["Agents", "Agents"],
    }, { settings })).toMatchObject({
      short: "Short answer must be 1,000 characters or fewer.",
      topics: "Choose each available option at most once.",
      responses: "Combined long-text answers must be 1,000 characters or fewer.",
    });

    expect(validateFormResponses(fields, {
      topics: ["Not configured"],
    }, { settings })).toMatchObject({
      topics: "Choose one of the available options.",
    });

    const manyShortFields = Array.from({ length: 70 }, (_, index): FormField => ({
      id: `short-${index}`,
      label: `Short ${index}`,
      type: "short_text",
      required: false,
    }));
    const manyShortResponses = Object.fromEntries(
      manyShortFields.map((field) => [field.id, "x".repeat(1_000)]),
    );
    expect(validateFormResponses(manyShortFields, manyShortResponses, { settings })).toMatchObject({
      responses: "The combined form response is too large.",
    });
  });

  it("derives fresh-event and seeded routing only from the configured category answer", () => {
    const freshFields: FormField[] = [
      { id: "field-category", label: "Program category", type: "select", required: true, options: ["General"] },
    ];
    expect(configuredSubmissionCategory(freshFields, { "field-category": "General" })).toBe("General");
    expect(configuredSubmissionCategory(defaultForm.fields, { "field-category": "Developer experience" })).toBe("Developer experience");
    expect(configuredSubmissionCategory(defaultForm.fields, { "field-category": "Unconfigured category" })).toBeUndefined();
    expect(configuredSubmissionCategory(defaultForm.fields, { category: "Developer experience" })).toBeUndefined();
  });

  it("derives a deduplicated multi-track routing set from the pinned multi-select", () => {
    const fields: FormField[] = [
      { id: "field-category", label: "Program lanes", type: "multi_select", required: true, options: ["Agents", "Evaluation", "Infrastructure"] },
    ];

    expect(configuredSubmissionCategories(fields, {
      "field-category": ["Agents", "Evaluation", "Agents", "Not configured"],
    })).toEqual(["Agents", "Evaluation"]);
    expect(configuredSubmissionCategories(fields, { "field-category": "Agents" })).toEqual(["Agents"]);
    expect(configuredSubmissionCategories(fields, {})).toEqual([]);
  });

  it("counts canonical long text once and counts forged duplicate text independently", () => {
    const fields: FormField[] = [
      { id: "field-summary", label: "Abstract", type: "long_text", required: true },
      { id: "speaker-bio", label: "Speaker bio", type: "long_text", required: true, section: "participant" },
      { id: "field-detail", label: "Implementation details", type: "long_text", required: false },
    ];
    const responses = {
      "field-summary": "Canonical summary",
      "speaker-bio": "Primary bio",
      "field-detail": "Extra detail",
    };

    expect(submissionCombinedCharacterCount(
      fields,
      responses,
      "Canonical summary",
      ["Primary bio", "Co-speaker bio"],
    )).toBe("Canonical summary".length + "Primary bio".length + "Extra detail".length + "Co-speaker bio".length);
    expect(submissionCombinedCharacterCount(
      fields,
      responses,
      "Different normalized summary",
      ["Different normalized bio"],
    )).toBe(Object.values(responses).join("").length + "Different normalized summary".length + "Different normalized bio".length);
  });
});

describe("formAvailability", () => {
  const now = new Date("2026-08-08T12:00:00.000Z");

  it.each([
    ["closed", "FORM_CLOSED"],
    ["draft", "FORM_NOT_PUBLISHED"],
  ] as const)("rejects a %s form", (status, code) => {
    expect(
      formAvailability(
        { status, allowMultipleDrafts: true },
        { drafts: 0, submitted: 0 },
        now,
      ),
    ).toEqual({ available: false, code });
  });

  it("rejects a published form after its deadline", () => {
    expect(
      formAvailability(
        { status: "published", closesAt: "2026-08-08T11:59:59.000Z", allowMultipleDrafts: true },
        { drafts: 0, submitted: 0 },
        now,
      ),
    ).toEqual({ available: false, code: "DEADLINE_PASSED" });
  });

  it("rejects another draft when multiple drafts are disabled", () => {
    expect(
      formAvailability(
        { status: "published", allowMultipleDrafts: false },
        { drafts: 1, submitted: 0 },
        now,
      ),
    ).toEqual({ available: false, code: "DRAFT_ALREADY_EXISTS" });
  });

  it("counts both drafts and submitted entries toward the submission limit", () => {
    expect(
      formAvailability(
        { status: "published", maxSubmissionsPerUser: 2, allowMultipleDrafts: true },
        { drafts: 1, submitted: 1 },
        now,
      ),
    ).toEqual({ available: false, code: "SUBMISSION_LIMIT_REACHED" });
  });

  it("allows a published form before its deadline and below its limit", () => {
    expect(
      formAvailability(
        {
          status: "published",
          closesAt: "2026-08-09T12:00:00.000Z",
          maxSubmissionsPerUser: 3,
          allowMultipleDrafts: true,
        },
        { drafts: 0, submitted: 1 },
        now,
      ),
    ).toEqual({ available: true, code: "AVAILABLE" });
  });
});
