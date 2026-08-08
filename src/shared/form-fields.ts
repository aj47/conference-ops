import type {
  FormField,
  FormFieldSection,
  FormResponseItem,
  FormResponseValue,
} from "./domain";

const proposalFieldIds = new Set([
  "field-title",
  "field-summary",
  "field-category",
  "field-format",
]);

const proposalFieldLabels = new Set([
  "title",
  "session title",
  "proposal title",
  "abstract",
  "proposal summary",
  "session summary",
  "category",
  "program category",
  "program lane",
  "format",
  "preferred format",
  "session format",
]);

const submissionCategoryFieldIds = new Set(["field-category"]);
const submissionCategoryFieldLabels = new Set([
  "category",
  "program category",
  "program lane",
]);

const participantFieldIds = new Set([
  "speaker-first",
  "speaker-last",
  "speaker-email",
  "speaker-bio",
  "speaker-title",
  "speaker-company",
]);

const participantFieldLabels = new Set([
  "first name",
  "last name",
  "email",
  "email address",
  "contact email",
  "speaker email",
  "biography",
  "bio",
  "speaker bio",
  "company",
  "company / affiliation",
  "affiliation",
  "organization",
  "role",
  "role or title",
  "job title",
  "speaker title",
]);

export function formFieldSection(field: FormField): FormFieldSection {
  if (field.section === "proposal" || field.section === "participant") return field.section;
  return field.id.startsWith("speaker-") ? "participant" : "proposal";
}

export function splitFormFields(fields: FormField[]) {
  const proposalFields: FormField[] = [];
  const participantFields: FormField[] = [];
  for (const field of fields) {
    (formFieldSection(field) === "participant" ? participantFields : proposalFields).push(field);
  }
  return { proposalFields, participantFields };
}

/**
 * Returns the versioned proposal field that owns program routing. The response
 * to this field is authoritative; callers must not route from a duplicate
 * top-level request property that can disagree with the published form.
 */
export function submissionCategoryFields(fields: FormField[]) {
  return fields.filter((field) => {
    if (formFieldSection(field) !== "proposal") return false;
    const label = field.label.trim().toLowerCase();
    return submissionCategoryFieldIds.has(field.id)
      || submissionCategoryFieldLabels.has(label);
  });
}

export function submissionCategoryField(fields: FormField[]) {
  return submissionCategoryFields(fields)[0];
}

export function sectionedFormFields(
  proposalFields: FormField[],
  participantFields: FormField[],
  collectParticipants = true,
) {
  return [
    ...proposalFields.map((field): FormField => ({ ...field, section: "proposal" })),
    ...(collectParticipants
      ? participantFields.map((field): FormField => ({ ...field, section: "participant" }))
      : []),
  ];
}

export function isCanonicalSubmissionField(
  field: FormField,
  section = formFieldSection(field),
) {
  const label = field.label.trim().toLowerCase();
  return section === "proposal"
    ? proposalFieldIds.has(field.id) || proposalFieldLabels.has(label)
    : participantFieldIds.has(field.id) || participantFieldLabels.has(label);
}

function responseValue(value: unknown): FormResponseValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (Array.isArray(value)) {
    const values = value.filter(
      (item): item is string | number | boolean =>
        typeof item === "string"
        || typeof item === "boolean"
        || (typeof item === "number" && Number.isFinite(item)),
    );
    return values.length === value.length ? values : undefined;
  }
  return undefined;
}

export function projectCustomFormResponses(
  fields: FormField[],
  responses: Record<string, unknown>,
): FormResponseItem[] {
  const projected: FormResponseItem[] = [];
  for (const field of fields) {
    const section = formFieldSection(field);
    if (isCanonicalSubmissionField(field, section)) continue;
    if (!Object.prototype.hasOwnProperty.call(responses, field.id)) continue;
    const value = responseValue(responses[field.id]);
    if (value === undefined) continue;
    projected.push({ fieldId: field.id, label: field.label, type: field.type, section, value });
  }
  return projected;
}

export function formatFormResponseValue(value: FormResponseValue) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not supplied";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value === null || value === "") return "Not supplied";
  return String(value);
}
