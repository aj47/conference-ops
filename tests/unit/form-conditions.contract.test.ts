import { describe, expect, it } from "vitest";
import { defaultForm } from "../../src/shared/demo-data";
import { formAvailability, isFieldVisible, validateFormResponses } from "../../src/server/forms";
import type { FormField } from "../../src/shared/domain";

const formatField = defaultForm.fields.find((field) => field.id === "field-format")!;
const workshopNeedsField = defaultForm.fields.find((field) => field.id === "field-workshop-needs")!;

const validationFields: FormField[] = [
  { id: "email", label: "Contact email", type: "email", required: true },
  { id: "url", label: "Project URL", type: "url", required: false },
  { id: "category", label: "Category", type: "select", required: true, options: ["Agents", "Evaluation"] },
];

describe("conditional form rule contract", () => {
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
