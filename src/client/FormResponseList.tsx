import type { FormResponseItem } from "../shared/domain";
import { formatFormResponseValue } from "../shared/form-fields";

export function FormResponseList({
  responses,
  title = "Additional form responses",
}: {
  responses?: FormResponseItem[];
  title?: string;
}) {
  if (!responses?.length) return null;
  return (
    <section className="form-response-list" aria-label={title}>
      <h3>{title}</h3>
      <dl>
        {responses.map((response) => (
          <div key={response.fieldId}>
            <dt>{response.label}</dt>
            <dd>{formatFormResponseValue(response.value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
