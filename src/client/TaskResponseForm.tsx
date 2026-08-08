import { useState } from "react";
import type { FormField, OnboardingTask } from "../shared/domain";
import { Field, InlineAlert, SectionHeading } from "./components";
import { isTaskFormFieldVisible, validateTaskFormResponses } from "./task-form-model";

function TaskField({
  field,
  value,
  error,
  onChange,
}: {
  field: FormField;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
}) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  const hint = field.description
    || (field.type === "multi_select" ? "Use Command or Control to select more than one option." : undefined);
  if (field.type === "checkbox") {
    return (
      <label className={`check-row${error ? " check-row--error" : ""}`}>
        <input
          type="checkbox"
          checked={value === true}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          <strong>{label}</strong>
          {field.description && <small>{field.description}</small>}
          {error && <b>{error}</b>}
        </span>
      </label>
    );
  }
  if (field.type === "file") {
    return (
      <Field
        label={label}
        hint={[field.description, "Use a separate file-request task for uploads."].filter(Boolean).join(" ")}
        error={error}
      >
        <input type="file" disabled aria-label={`${field.label} unavailable`} />
      </Field>
    );
  }
  if (field.type === "long_text") {
    return (
      <Field label={label} hint={hint} error={error}>
        <textarea rows={5} value={typeof value === "string" ? value : ""} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)} />
      </Field>
    );
  }
  if (field.type === "select") {
    return (
      <Field label={label} hint={hint} error={error}>
        <select value={typeof value === "string" ? value : ""} aria-invalid={Boolean(error)} onChange={(event) => onChange(event.target.value)}>
          <option value="">Select an option</option>
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </Field>
    );
  }
  if (field.type === "multi_select") {
    const selected = Array.isArray(value) ? value.map(String) : [];
    return (
      <Field label={label} hint={hint} error={error}>
        <select
          multiple
          size={Math.min(5, Math.max(2, field.options?.length ?? 2))}
          value={selected}
          aria-invalid={Boolean(error)}
          onChange={(event) => onChange(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}
        >
          {(field.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </Field>
    );
  }
  return (
    <Field label={label} hint={hint} error={error}>
      <input
        type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
        value={typeof value === "string" ? value : ""}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function TaskResponseForm({
  task,
  onClose,
  onSubmit,
}: {
  task: OnboardingTask;
  onClose: () => void;
  onSubmit: (taskId: string, responses: Record<string, unknown>) => Promise<void>;
}) {
  const [responses, setResponses] = useState<Record<string, unknown>>(() => ({ ...task.form?.response }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const form = task.form;

  if (!form) {
    return (
      <section className="task-response-panel">
        <SectionHeading title={task.title} description="The organizer has not attached a usable form definition to this task." />
        <InlineAlert tone="danger">This task cannot be completed yet. Ask the organizer to relink and republish its form.</InlineAlert>
        <div className="button-row"><button type="button" className="button button--quiet" onClick={onClose}>Close</button></div>
      </section>
    );
  }

  const visibleFields = form.fields.filter((field) => isTaskFormFieldVisible(field, responses));
  const updateResponse = (fieldId: string, value: unknown) => {
    setResponses((current) => ({ ...current, [fieldId]: value }));
    setErrors((current) => {
      if (!current[fieldId]) return current;
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
    setSubmitError("");
  };

  return (
    <form
      className="task-response-panel"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        const nextErrors = validateTaskFormResponses(form.fields, responses);
        setErrors(nextErrors);
        setSubmitError("");
        if (Object.keys(nextErrors).length) {
          setSubmitError("Review the highlighted fields before submitting.");
          return;
        }
        setSubmitting(true);
        try {
          await onSubmit(task.id, responses);
          onClose();
        } catch (reason) {
          setSubmitError(reason instanceof Error ? reason.message : "The linked form could not be submitted.");
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <SectionHeading
        title={form.title || task.title}
        description={form.description || "Complete every required field to finish this task."}
        action={<span className="folio">Form v{form.version}</span>}
      />
      {form.responseStatus === "draft" && <InlineAlert tone="info">Your existing draft response has been restored.</InlineAlert>}
      {submitError && <InlineAlert tone="danger">{submitError}</InlineAlert>}
      <div className="task-response-fields">
        {visibleFields.map((field) => (
          <TaskField
            key={field.id}
            field={field}
            value={responses[field.id]}
            error={errors[field.id]}
            onChange={(value) => updateResponse(field.id, value)}
          />
        ))}
      </div>
      {!form.fields.length && <InlineAlert tone="danger">This form has no fields. Ask the organizer to publish a complete version.</InlineAlert>}
      <div className="button-row task-response-actions">
        <button type="button" className="button button--quiet" disabled={submitting} onClick={onClose}>Close</button>
        <button type="submit" className="button button--primary" disabled={submitting || !form.fields.length}>
          {submitting ? "Submitting…" : "Submit required form"}
        </button>
      </div>
    </form>
  );
}
