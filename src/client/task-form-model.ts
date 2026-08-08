import type { FormField, FormResponseItem, FormResponseValue } from "../shared/domain";

export function isTaskFormFieldVisible(field: FormField, responses: Record<string, unknown>) {
  if (!field.condition) return true;
  const source = responses[field.condition.sourceFieldId];
  if (field.condition.operator === "equals") return String(source ?? "") === field.condition.value;
  if (Array.isArray(source)) return source.some((value) => String(value).includes(field.condition!.value));
  return String(source ?? "").includes(field.condition.value);
}

function hasAnswer(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return value !== undefined && value !== null;
}

export function validateTaskFormResponses(
  fields: FormField[],
  responses: Record<string, unknown>,
) {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!isTaskFormFieldVisible(field, responses)) continue;
    const value = responses[field.id];
    if (field.type === "file") {
      if (field.required) errors[field.id] = "This upload field is not supported in task forms yet. Contact the organizer.";
      continue;
    }
    if (field.required && !hasAnswer(value)) {
      errors[field.id] = `${field.label} is required.`;
      continue;
    }
    if (!hasAnswer(value)) continue;
    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
      errors[field.id] = "Enter a valid email address.";
    }
    if (field.type === "url") {
      try {
        const url = new URL(String(value));
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported protocol");
      } catch {
        errors[field.id] = "Enter a full http:// or https:// URL.";
      }
    }
    if ((field.type === "select" || field.type === "multi_select") && field.options) {
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      if (values.some((item) => !field.options!.includes(item))) {
        errors[field.id] = "Choose one of the available options.";
      }
    }
  }
  return errors;
}

function taskResponseValue(value: unknown): FormResponseValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (!Array.isArray(value)) return undefined;
  const items = value.filter(
    (item): item is string | number | boolean =>
      typeof item === "string"
      || typeof item === "boolean"
      || (typeof item === "number" && Number.isFinite(item)),
  );
  return items.length === value.length ? items : undefined;
}

export function taskFormResponseItems(
  fields: FormField[],
  responses: Record<string, unknown>,
): FormResponseItem[] {
  return fields.flatMap((field) => {
    if (!Object.prototype.hasOwnProperty.call(responses, field.id)) return [];
    const value = taskResponseValue(responses[field.id]);
    if (value === undefined) return [];
    return [{
      fieldId: field.id,
      label: field.label,
      type: field.type,
      section: field.section ?? "proposal",
      value,
    }];
  });
}
