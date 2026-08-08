import type { FormField } from "../shared/domain";

export function requiredUnsupportedFileFields(...fieldGroups: FormField[][]) {
  return fieldGroups.flat().filter((field) => field.type === "file" && field.required);
}
