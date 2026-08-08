import type { FormDefinition, FormField } from "../shared/domain";

function hasValue(value: unknown) {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "boolean") return value;
  return value !== null && value !== undefined;
}

export function isFieldVisible(field: FormField, responses: Record<string, unknown>) {
  if (!field.condition) return true;
  const source = responses[field.condition.sourceFieldId];
  if (field.condition.operator === "equals") return String(source ?? "") === field.condition.value;
  if (Array.isArray(source)) return source.some((value) => String(value).includes(field.condition!.value));
  return String(source ?? "").includes(field.condition.value);
}

export function validateFormResponses(fields: FormField[], responses: Record<string, unknown>) {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    if (!isFieldVisible(field, responses)) continue;
    const value = responses[field.id];
    if (field.required && !hasValue(value)) {
      errors[field.id] = `${field.label} is required.`;
      continue;
    }
    if (!hasValue(value)) continue;
    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) errors[field.id] = "Enter a valid email address.";
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
      if (values.some((item) => !field.options!.includes(item))) errors[field.id] = "Choose one of the available options.";
    }
  }
  return errors;
}

export function formAvailability(
  form: Pick<FormDefinition, "status" | "closesAt" | "maxSubmissionsPerUser" | "allowMultipleDrafts">,
  counts: { drafts: number; submitted: number },
  now = new Date(),
) {
  if (form.status !== "published") return { available: false, code: form.status === "closed" ? "FORM_CLOSED" : "FORM_NOT_PUBLISHED" } as const;
  if (form.closesAt && now.getTime() > new Date(form.closesAt).getTime()) return { available: false, code: "DEADLINE_PASSED" } as const;
  const used = counts.submitted + counts.drafts;
  if (form.maxSubmissionsPerUser && used >= form.maxSubmissionsPerUser) return { available: false, code: "SUBMISSION_LIMIT_REACHED" } as const;
  if (!form.allowMultipleDrafts && counts.drafts > 0) return { available: false, code: "DRAFT_ALREADY_EXISTS" } as const;
  return { available: true, code: "AVAILABLE" } as const;
}
