import type { FormDefinition, FormField, FormVersionSettings } from "../shared/domain";
import {
  formFieldSection,
  isCanonicalSubmissionField,
  submissionCategoryField,
} from "../shared/form-fields";
import { defaultFormVersionSettings, normalizeFormVersionSettings } from "../shared/form-settings";

const responseCharacterLimits = {
  short_text: 1_000,
  email: 320,
  url: 2_048,
  select: 255,
  multi_select: 255,
  file: 2_048,
} as const;

export interface FormResponseValidationOptions {
  /** Drafts may omit required answers, but supplied values still have to be safe. */
  requireRequired?: boolean;
  settings?: FormVersionSettings;
  /** Allows submission callers to account for canonical text stored outside responses. */
  combinedCharacterCount?: number;
}

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

function textLimit(field: FormField, settings: FormVersionSettings) {
  return field.type === "long_text"
    ? settings.combinedCharacterLimit
    : responseCharacterLimits[field.type as keyof typeof responseCharacterLimits];
}

function responseTypeError(field: FormField, value: unknown) {
  if (field.type === "checkbox") return typeof value === "boolean" ? undefined : "Choose yes or no.";
  if (field.type === "multi_select") {
    return Array.isArray(value) && value.every((item) => typeof item === "string")
      ? undefined
      : "Choose one or more of the available options.";
  }
  return typeof value === "string" ? undefined : "Enter a text value.";
}

function responsePayloadByteLimit(settings: FormVersionSettings) {
  // Four bytes covers the largest UTF-8 representation of each configured
  // character. A small envelope leaves room for field IDs and selections.
  return Math.max(64_000, settings.combinedCharacterLimit * 4 + 32_000);
}

function longTextResponseCharacters(fields: FormField[], responses: Record<string, unknown>) {
  return fields.reduce((total, field) => {
    if (field.type !== "long_text") return total;
    const value = responses[field.id];
    return total + (typeof value === "string" ? value.length : 0);
  }, 0);
}

export function validateFormResponses(
  fields: FormField[],
  responses: Record<string, unknown>,
  options: FormResponseValidationOptions = {},
) {
  const errors: Record<string, string> = {};
  const settings = normalizeFormVersionSettings(options.settings ?? defaultFormVersionSettings);
  const configuredIds = new Set(fields.map((field) => field.id));
  for (const responseId of Object.keys(responses)) {
    if (!configuredIds.has(responseId)) {
      errors[`responses.${responseId}`] = "This response is not part of the published form.";
    }
  }

  for (const field of fields) {
    const value = responses[field.id];
    const visible = isFieldVisible(field, responses);
    if (visible && (options.requireRequired ?? true) && field.required && !hasValue(value)) {
      errors[field.id] = `${field.label} is required.`;
      continue;
    }
    if (!hasValue(value)) continue;

    const typeError = responseTypeError(field, value);
    if (typeError) {
      errors[field.id] = typeError;
      continue;
    }

    if (field.type === "multi_select") {
      const values = value as string[];
      if (values.length > 100 || new Set(values).size !== values.length) {
        errors[field.id] = "Choose each available option at most once.";
        continue;
      }
      if (values.some((item) => item.length > responseCharacterLimits.multi_select)) {
        errors[field.id] = `Each selection must be ${responseCharacterLimits.multi_select.toLocaleString()} characters or fewer.`;
        continue;
      }
    } else if (typeof value === "string") {
      const limit = textLimit(field, settings);
      if (limit && value.length > limit) {
        errors[field.id] = `${field.label} must be ${limit.toLocaleString()} characters or fewer.`;
        continue;
      }
    }

    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value as string)) errors[field.id] = "Enter a valid email address.";
    if (field.type === "url") {
      try {
        const url = new URL(value as string);
        if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported protocol");
      } catch {
        errors[field.id] = "Enter a full http:// or https:// URL.";
      }
    }
    if ((field.type === "select" || field.type === "multi_select") && !field.options?.length) {
      errors[field.id] = "This field has no configured options.";
      continue;
    }
    if ((field.type === "select" || field.type === "multi_select") && field.options) {
      const values = Array.isArray(value) ? value : [value as string];
      if (values.some((item) => !field.options!.includes(item))) errors[field.id] = "Choose one of the available options.";
    }
  }

  const combinedCharacterCount = options.combinedCharacterCount
    ?? longTextResponseCharacters(fields, responses);
  if (combinedCharacterCount > settings.combinedCharacterLimit) {
    errors.responses = `Combined long-text answers must be ${settings.combinedCharacterLimit.toLocaleString()} characters or fewer.`;
  }
  if (new TextEncoder().encode(JSON.stringify(responses)).byteLength > responsePayloadByteLimit(settings)) {
    errors.responses = "The combined form response is too large.";
  }
  return errors;
}

export function configuredSubmissionCategory(
  fields: FormField[],
  responses: Record<string, unknown>,
) {
  const field = submissionCategoryField(fields);
  if (!field || field.type !== "select") return undefined;
  const value = responses[field.id];
  return typeof value === "string" && field.options?.includes(value)
    ? value
    : undefined;
}

/**
 * Counts canonical proposal text once even though the API also persists it in
 * normalized columns. Mismatched duplicate values are counted independently,
 * so a forged response cannot create an unbounded second copy.
 */
export function submissionCombinedCharacterCount(
  fields: FormField[],
  responses: Record<string, unknown>,
  summary: string,
  speakerBios: string[],
) {
  let total = longTextResponseCharacters(fields, responses);
  const canonicalLongTextValues = fields.flatMap((field) => {
    if (field.type !== "long_text" || !isCanonicalSubmissionField(field, formFieldSection(field))) return [];
    const value = responses[field.id];
    return typeof value === "string" ? [value] : [];
  });
  if (!canonicalLongTextValues.includes(summary)) total += summary.length;
  for (const [index, bio] of speakerBios.entries()) {
    if (index === 0 && canonicalLongTextValues.includes(bio)) continue;
    total += bio.length;
  }
  return total;
}

export function requiredFileField(fields: FormField[]) {
  return fields.find((field) => field.type === "file" && field.required);
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
