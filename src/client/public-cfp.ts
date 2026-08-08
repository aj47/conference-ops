import type { EventRecord, FormDefinition, FormField } from "../shared/domain";

const categoryLabels = new Set(["category", "program category", "program lane"]);

export function configuredCategoryOptions(fields: FormField[]) {
  const categoryField = fields.find((field) =>
    field.id === "field-category" || categoryLabels.has(field.label.trim().toLowerCase()),
  );
  return [...new Set((categoryField?.options ?? []).map((option) => option.trim()).filter(Boolean))];
}

export function initialConfiguredCategory(fields: FormField[]) {
  return configuredCategoryOptions(fields)[0] ?? "";
}

/** The published form owns its deadline. Older contracts without one use the event fallback. */
export function publishedSubmissionDeadline(
  form: Pick<FormDefinition, "closesAt">,
  event: Pick<EventRecord, "cfpClosesAt">,
) {
  return form.closesAt ?? event.cfpClosesAt;
}
