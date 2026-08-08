import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BellRing,
  Braces,
  Check,
  ChevronRight,
  Clipboard,
  Eye,
  FileCheck2,
  FileText,
  GripVertical,
  Info,
  LockKeyhole,
  Mail,
  Plus,
  Pencil,
  Save,
  Send,
  Settings2,
  SlidersHorizontal,
  Trash2,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FormField, FormFieldType } from "../../shared/domain";
import { Field, InlineAlert, PageHeader, ProgressBar, StatusPill } from "../components";
import { useDialogA11y } from "../dialog-a11y";
import { requiredUnsupportedFileFields } from "../form-builder-validation";
import { draftSubmissionPreviewPath } from "../public-routes";
import { useWorkspace } from "../workspace";

const builderSteps = [
  { id: "setup", label: "Submission setup", summary: "Type and participants", icon: SlidersHorizontal },
  { id: "welcome", label: "Welcome screen", summary: "Message and terms", icon: WandSparkles },
  { id: "proposal", label: "Proposal information", summary: "Session questions", icon: FileText },
  { id: "participants", label: "Speaker information", summary: "Roles and contact fields", icon: Users },
  { id: "rules", label: "Deadline & limits", summary: "Capacity and draft policy", icon: Settings2 },
  { id: "confirmation", label: "After submission", summary: "Confirmation and redirect", icon: FileCheck2 },
  { id: "notifications", label: "Notify & publish", summary: "Email and release", icon: BellRing },
] as const;

type BuilderStepId = (typeof builderSteps)[number]["id"];

const fieldTypeNames: Record<FormFieldType, string> = {
  short_text: "Short text",
  long_text: "Long text",
  email: "Email",
  url: "URL",
  select: "Dropdown",
  multi_select: "Multi-select",
  checkbox: "Checkbox",
  file: "File upload",
};

function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={`toggle${disabled ? " toggle--disabled" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />
      <span className="toggle__track" aria-hidden="true"><span /></span>
      <span>{label}</span>
    </label>
  );
}

function LongTextField({ value, onChange, label, hint }: { value: string; onChange: (value: string) => void; label: string; hint?: string }) {
  return (
    <Field label={label} hint={hint ?? "Plain text; paragraph breaks are preserved."}>
      <div className="rich-field rich-field--plain">
        <textarea rows={6} value={value} onChange={(event) => onChange(event.target.value)} />
      </div>
    </Field>
  );
}

function FieldDialog({ sourceFields, field, onSave, onClose }: { sourceFields: FormField[]; field?: FormField; onSave: (field: FormField) => void; onClose: () => void }) {
  const dialogRef = useDialogA11y<HTMLFormElement>(onClose);
  const [label, setLabel] = useState(field?.label ?? "");
  const [type, setType] = useState<FormFieldType>(field?.type ?? "short_text");
  const [required, setRequired] = useState(field?.required ?? false);
  const [options, setOptions] = useState(field?.options?.join("\n") ?? "Option one\nOption two");
  const eligibleSources = sourceFields.filter((candidate) => candidate.id !== field?.id && candidate.type !== "file" && !candidate.condition);
  const [conditionEnabled, setConditionEnabled] = useState(Boolean(field?.condition));
  const [conditionSourceId, setConditionSourceId] = useState(field?.condition?.sourceFieldId ?? eligibleSources[0]?.id ?? "");
  const [conditionOperator, setConditionOperator] = useState<"equals" | "contains">(field?.condition?.operator ?? "equals");
  const conditionSource = eligibleSources.find((field) => field.id === conditionSourceId);
  const [conditionValue, setConditionValue] = useState(field?.condition?.value ?? conditionSource?.options?.[0] ?? "");
  const selectable = type === "select" || type === "multi_select";
  const categoryField = field?.id === "field-category" || ["category", "program category", "program lane"].includes(field?.label.trim().toLowerCase() ?? "");
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        ref={dialogRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-field-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!label.trim()) return;
          onSave({
            id: field?.id ?? `field-${crypto.randomUUID()}`,
            label: categoryField ? field!.label : label.trim(),
            ...(field?.description ? { description: field.description } : {}),
            type,
            required: categoryField ? true : type === "file" ? false : required,
            ...(selectable ? { options: options.split("\n").map((option) => option.trim()).filter(Boolean) } : {}),
            ...(!categoryField && conditionEnabled && conditionSourceId && conditionValue.trim()
              ? { condition: { sourceFieldId: conditionSourceId, operator: conditionOperator, value: conditionValue.trim() } }
              : {}),
          });
          onClose();
        }}
      >
        <div className="drawer__head"><div><p className="eyebrow">{field ? "Published form contract" : "Custom question"}</p><h2 id="new-field-title">{field ? `Edit ${field.label}` : "Add a form field"}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="drawer__body form-stack">
          <Field label="Question label" hint={categoryField ? "The canonical program-lane label stays stable so routing remains reliable." : undefined}><input data-dialog-initial-focus required value={label} readOnly={categoryField} onChange={(event) => setLabel(event.target.value)} placeholder="What should reviewers know?" /></Field>
          <Field label="Answer type" hint={categoryField ? "Use Dropdown for one track or Multi-select for one or more tracks." : "Secure file uploads are not available yet."}><select value={type} onChange={(event) => setType(event.target.value as FormFieldType)}>{Object.entries(fieldTypeNames).filter(([value]) => value !== "file" && (!categoryField || value === "select" || value === "multi_select")).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></Field>
          {selectable && <Field label="Choices" hint="One option per line"><textarea required rows={5} value={options} onChange={(event) => setOptions(event.target.value)} /></Field>}
          <Toggle checked={categoryField || required} onChange={setRequired} label="Require an answer" disabled={categoryField} />
          {!categoryField && eligibleSources.length ? (
            <>
              <Toggle checked={conditionEnabled} onChange={setConditionEnabled} label="Show this field conditionally" />
              {conditionEnabled && <div className="field-grid field-grid--2">
                <Field label="Source question"><select value={conditionSourceId} onChange={(event) => { const sourceId = event.target.value; const source = eligibleSources.find((field) => field.id === sourceId); setConditionSourceId(sourceId); setConditionValue(source?.options?.[0] ?? ""); }}>{eligibleSources.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></Field>
                <Field label="Rule"><select value={conditionOperator} onChange={(event) => setConditionOperator(event.target.value as "equals" | "contains")}><option value="equals">Equals</option><option value="contains">Contains</option></select></Field>
                <Field label="Value" hint="One-level show/hide rule">
                  {conditionSource?.options?.length
                    ? <select value={conditionValue} onChange={(event) => setConditionValue(event.target.value)}>{conditionSource.options.map((option) => <option key={option}>{option}</option>)}</select>
                    : <input required value={conditionValue} onChange={(event) => setConditionValue(event.target.value)} placeholder="Value that reveals this field" />}
                </Field>
              </div>}
            </>
          ) : !categoryField ? <InlineAlert tone="info">Add an unconditional question first if this field should depend on another answer.</InlineAlert> : null}
        </div>
        <div className="drawer__foot"><button type="button" className="button button--quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button--primary">{field ? <><Save size={15} /> Save changes</> : <><Plus size={15} /> Add field</>}</button></div>
      </form>
    </div>
  );
}

function FieldRows({ fields, onChange, participant = false }: { fields: FormField[]; onChange: (fields: FormField[]) => void; participant?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<FormField | null>(null);
  const identityLockedIds = new Set(["field-title", "speaker-first", "speaker-last", "speaker-email"]);
  const move = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= fields.length) return;
    const next = [...fields];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    onChange(next);
  };

  return (
    <section className="builder-section">
      <div className="builder-section__head">
        <div><h3>Form questions</h3><p>{participant ? "Collected for every participant and primary contact." : "Shown in this order on the proposal step."}</p></div>
        <button type="button" className="button button--quiet" onClick={() => setAdding(true)}><Plus size={15} /> Add field</button>
      </div>
      <div className="field-rows">
        {fields.map((field, index) => {
          const identityLocked = identityLockedIds.has(field.id);
          const routingContract = field.id === "field-category" || ["category", "program category", "program lane"].includes(field.label.trim().toLowerCase());
          const requiredContract = identityLocked || routingContract;
          return (
            <article className="field-row" key={field.id}>
              <GripVertical size={16} className="field-row__grip" aria-hidden="true" />
              <div className="field-row__main">
                <div className="field-row__title"><strong>{field.label}</strong>{identityLocked && <span className="locked-badge"><LockKeyhole size={11} /> Locked</span>}{routingContract && <span className="locked-badge"><Braces size={11} /> Routing contract</span>}</div>
                <div className="field-row__meta"><span>{fieldTypeNames[field.type]}</span>{field.type === "long_text" && <span>Max 5,000</span>}{field.condition && <span className="condition-badge"><Braces size={11} /> When {fields.find((candidate) => candidate.id === field.condition?.sourceFieldId)?.label ?? "source"} {field.condition.operator === "equals" ? "is" : "contains"} {field.condition.value}</span>}</div>
              </div>
              <Toggle
                checked={field.required}
                disabled={requiredContract || (field.type === "file" && !field.required)}
                label={field.type === "file" ? field.required ? "Required — turn off to publish" : "Optional only" : "Required"}
                onChange={(required) => onChange(fields.map((item) => item.id === field.id ? { ...item, required: item.type === "file" ? false : required } : item))}
              />
              <div className="field-row__actions">
                <button type="button" className="icon-button" disabled={identityLocked} onClick={() => setEditing(field)} aria-label={`Edit ${field.label}`}><Pencil size={15} /></button>
                <button type="button" className="icon-button" onClick={() => move(index, -1)} disabled={index === 0} aria-label={`Move ${field.label} up`}><ArrowUp size={15} /></button>
                <button type="button" className="icon-button" onClick={() => move(index, 1)} disabled={index === fields.length - 1} aria-label={`Move ${field.label} down`}><ArrowDown size={15} /></button>
                <button type="button" className="icon-button icon-button--danger" disabled={requiredContract} onClick={() => onChange(fields.filter((item) => item.id !== field.id))} aria-label={`Delete ${field.label}`}><Trash2 size={15} /></button>
              </div>
            </article>
          );
        })}
      </div>
      {adding && <FieldDialog sourceFields={fields} onClose={() => setAdding(false)} onSave={(field) => onChange([...fields, field])} />}
      {editing && <FieldDialog sourceFields={fields} field={editing} onClose={() => setEditing(null)} onSave={(field) => onChange(fields.map((candidate) => candidate.id === field.id ? field : candidate))} />}
    </section>
  );
}

export function FormBuilder() {
  const { workspace, builder, updateBuilder, replaceBuilderFields, saveBuilder, publishBuilder, setNotice } = useWorkspace();
  const navigate = useNavigate();
  const [step, setStep] = useState<BuilderStepId>("setup");
  const [publishing, setPublishing] = useState(false);
  const currentIndex = builderSteps.findIndex((item) => item.id === step);
  const requiredFileFields = requiredUnsupportedFileFields(builder.proposalFields, builder.participantFields);

  const completed = useMemo(() => ({
    setup: Boolean(builder.submissionKind),
    welcome: Boolean(builder.internalName && builder.externalTitle && builder.pageHeading && builder.welcomeMessage),
    proposal: builder.proposalFields.filter((field) => field.required).length >= 3,
    participants: !builder.collectParticipants || builder.participantFields.length >= 3,
    rules: Boolean(builder.closeDate && builder.submissionLimit > 0),
    confirmation: Boolean(builder.successMessage && builder.confirmationEnabled),
    notifications: builder.confirmationEnabled,
  }), [builder]);

  const next = () => currentIndex < builderSteps.length - 1 && setStep(builderSteps[currentIndex + 1].id);
  const previous = () => currentIndex > 0 && setStep(builderSteps[currentIndex - 1].id);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/submit/${encodeURIComponent(workspace.event.slug)}`);
      setNotice("Public submission link copied.");
    } catch {
      setNotice("Could not copy the submission link. Open Preview draft and copy the address from your browser.");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow={`Call for speakers · Version ${builder.version}`}
        title="Build a form people can finish."
        description="The public flow is generated from these decisions. Locked fields preserve identity; everything else should earn its place."
        actions={
          <>
            <button type="button" className="button button--quiet" onClick={() => navigate(draftSubmissionPreviewPath(workspace.event.slug, workspace.event.id))}><Eye size={16} /> Preview draft</button>
            <button type="button" className="button button--quiet" onClick={copyLink}><Clipboard size={16} /> Copy link</button>
            <button type="button" className="button button--dark" onClick={() => void saveBuilder()} disabled={!builder.dirty}><Save size={16} /> Save draft</button>
          </>
        }
      />

      <div className="builder-statusbar">
        <span><StatusPill status={builder.status} />{builder.dirty ? <b className="unsaved-mark">Unpublished changes</b> : <span>Saved {new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(builder.lastSavedAt))}</span>}</span>
        <ProgressBar label="Setup complete" value={Object.values(completed).filter(Boolean).length} max={builderSteps.length} />
      </div>

      <div className="builder-layout">
        <aside className="builder-steps" aria-label="Form setup steps">
          <div className="builder-steps__head"><span>FORM SETUP</span><small>Payments intentionally omitted</small></div>
          {builderSteps.map((item, index) => {
            const Icon = item.icon;
            return (
              <button type="button" key={item.id} onClick={() => setStep(item.id)} className={step === item.id ? "builder-step builder-step--active" : "builder-step"} aria-current={step === item.id ? "step" : undefined}>
                <span className="builder-step__index">{completed[item.id] && item.id !== step ? <Check size={14} /> : <Icon size={15} />}</span>
                <span><strong>{index + 1}. {item.label}</strong><small>{item.summary}</small></span>
                <ChevronRight size={14} />
              </button>
            );
          })}
        </aside>

        <div className="builder-workspace">
          {builder.dirty && builder.status === "published" && <InlineAlert tone="info"><strong>Live version protected.</strong> These edits remain a draft until you publish a new immutable version.</InlineAlert>}

          {step === "setup" && (
            <div className="builder-panel">
              <div className="builder-panel__title"><span>01</span><div><h2>What are you collecting?</h2><p>This choice shapes review records and the language applicants see.</p></div></div>
              <div className="choice-grid">
                <button type="button" className={builder.submissionKind === "abstracts" ? "choice-card choice-card--selected" : "choice-card"} onClick={() => updateBuilder({ submissionKind: "abstracts" })}><FileText size={24} /><strong>Abstracts</strong><span>Review the idea before the final session is shaped.</span><b>{builder.submissionKind === "abstracts" ? "Selected" : "Choose"}</b></button>
                <button type="button" className={builder.submissionKind === "sessions" ? "choice-card choice-card--selected" : "choice-card"} onClick={() => updateBuilder({ submissionKind: "sessions" })}><FileCheck2 size={24} /><strong>Sessions</strong><span>Collect a complete session proposal ready for the program.</span><b>{builder.submissionKind === "sessions" ? "Selected" : "Choose"}</b></button>
              </div>
              <div className="setting-row"><div><Users size={20} /><span><strong>Collect participant details</strong><small>Add a dedicated speaker step with role and contact requirements.</small></span></div><Toggle checked={builder.collectParticipants} onChange={(collectParticipants) => updateBuilder({ collectParticipants })} label={builder.collectParticipants ? "Included" : "Skipped"} /></div>
              <InlineAlert tone="info"><Info size={15} /> Applicants can browse the welcome screen before signing in. Account creation happens before any draft is stored.</InlineAlert>
            </div>
          )}

          {step === "welcome" && (
            <div className="builder-panel">
              <div className="builder-panel__title"><span>02</span><div><h2>Set the invitation.</h2><p>The first screen should answer “is this for me?” before asking for work.</p></div></div>
              <div className="field-grid field-grid--2">
                <Field label="Internal form name" hint={`${builder.internalName.length} / 255`}><input maxLength={255} value={builder.internalName} onChange={(event) => updateBuilder({ internalName: event.target.value })} /></Field>
                <Field label="External form title" hint={`${builder.externalTitle.length} / 255`}><input maxLength={255} value={builder.externalTitle} onChange={(event) => updateBuilder({ externalTitle: event.target.value })} /></Field>
              </div>
              <Field label="Page heading" hint={`${builder.pageHeading.length} / 15`}><input maxLength={15} value={builder.pageHeading} onChange={(event) => updateBuilder({ pageHeading: event.target.value })} /></Field>
              <LongTextField label="Welcome message" value={builder.welcomeMessage} onChange={(welcomeMessage) => updateBuilder({ welcomeMessage })} hint="Plain text shown before account verification; paragraph breaks are preserved." />
            </div>
          )}

          {step === "proposal" && (
            <div className="builder-panel">
              <div className="builder-panel__title"><span>03</span><div><h2>Ask for signal, not paperwork.</h2><p>Every question should help a reviewer understand the promise and evidence.</p></div></div>
              <div className="field-grid field-grid--2">
                <Field label="Section title" hint={`${builder.proposalSectionTitle.length} / 255`}><input value={builder.proposalSectionTitle} onChange={(event) => updateBuilder({ proposalSectionTitle: event.target.value })} /></Field>
                <Field label="Page heading" hint="15 characters max"><input maxLength={15} value={builder.proposalPageHeading} onChange={(event) => updateBuilder({ proposalPageHeading: event.target.value })} /></Field>
              </div>
              <LongTextField label="Description & instructions" value={builder.proposalInstructions} onChange={(proposalInstructions) => updateBuilder({ proposalInstructions })} />
              <FieldRows fields={builder.proposalFields} onChange={(fields) => replaceBuilderFields("proposal", fields)} />
            </div>
          )}

          {step === "participants" && (
            <div className="builder-panel">
              <div className="builder-panel__title"><span>04</span><div><h2>Know who will be on stage.</h2><p>Identity fields stay locked; organizers decide what else is necessary.</p></div></div>
              {!builder.collectParticipants ? <InlineAlert tone="warning">Participant collection is disabled in Submission setup. This public step will be removed.</InlineAlert> : <>
                <div className="field-grid field-grid--2">
                  <Field label="Section title" hint={`${builder.participantSectionTitle.length} / 255`}><input value={builder.participantSectionTitle} onChange={(event) => updateBuilder({ participantSectionTitle: event.target.value })} /></Field>
                  <Field label="Page heading" hint="15 characters max"><input maxLength={15} value={builder.participantPageHeading} onChange={(event) => updateBuilder({ participantPageHeading: event.target.value })} /></Field>
                </div>
                <LongTextField label="Description & instructions" value={builder.participantInstructions} onChange={(participantInstructions) => updateBuilder({ participantInstructions })} />
                <section className="role-limit"><div><Users size={18} /><span><strong>Speaker</strong><small>Participant role</small></span></div><Field label="Minimum"><input type="number" min={1} max={builder.participantMax} value={builder.participantMin} onChange={(event) => updateBuilder({ participantMin: Number(event.target.value) })} /></Field><Field label="Maximum"><input type="number" min={builder.participantMin} max={12} value={builder.participantMax} onChange={(event) => updateBuilder({ participantMax: Number(event.target.value) })} /></Field></section>
                <FieldRows participant fields={builder.participantFields} onChange={(fields) => replaceBuilderFields("participant", fields)} />
              </>}
            </div>
          )}

          {step === "rules" && (
            <div className="builder-panel">
              <div className="builder-panel__title"><span>05</span><div><h2>Make the boundary legible.</h2><p>Deadline and capacity are enforced by the server, not just displayed as copy.</p></div></div>
              <section className="builder-section compact-section">
                <div className="builder-section__head"><div><h3>Deadline</h3><p>New and updated submissions close at the same instant.</p></div><span className="priority-note">Important</span></div>
                <Field label="Close date and time" hint="Applicants cannot submit after this deadline."><input type="datetime-local" value={builder.closeDate} onChange={(event) => updateBuilder({ closeDate: event.target.value })} /></Field>
              </section>
              <section className="builder-section compact-section">
                <div className="builder-section__head"><div><h3>Submission capacity</h3><p>Saved drafts and submitted sessions both count toward this limit.</p></div></div>
                <div className="field-grid field-grid--2"><Field label="Per-person limit" hint="Event fallback is 3"><input type="number" min={1} max={20} value={builder.submissionLimit} onChange={(event) => updateBuilder({ submissionLimit: Number(event.target.value) })} /></Field><div className="toggle-field"><Toggle checked={builder.allowMultipleDrafts} onChange={(allowMultipleDrafts) => updateBuilder({ allowMultipleDrafts })} label="Allow multiple saved drafts" /></div></div>
              </section>
              <section className="builder-section compact-section"><div className="builder-section__head"><div><h3>Combined character rule</h3><p>Applicants see a live counter across selected long-text answers.</p></div></div><Field label="Combined maximum"><input type="number" min={1000} step={100} value={builder.combinedCharacterLimit} onChange={(event) => updateBuilder({ combinedCharacterLimit: Number(event.target.value) })} /></Field></section>
            </div>
          )}

          {step === "confirmation" && (
            <div className="builder-panel">
              <div className="builder-panel__title"><span>06</span><div><h2>Finish the handoff.</h2><p>The confirmation page bridges applicant anxiety into useful portal work.</p></div></div>
              <div className="setting-row setting-row--emphasis"><div><ArrowRight size={20} /><span><strong>Auto-redirect to speaker portal</strong><small>After 10 seconds. A visible Continue button remains available.</small></span></div><Toggle checked={builder.autoRedirect} onChange={(autoRedirect) => updateBuilder({ autoRedirect })} label={builder.autoRedirect ? "On" : "Off"} /></div>
              <LongTextField label="Success page message" value={builder.successMessage} onChange={(successMessage) => updateBuilder({ successMessage })} hint="Shown after the submission transaction and confirmation email job are created." />
              <div className="confirmation-preview"><span className="confirmation-preview__check"><Check size={28} /></span><p className="eyebrow">Submission S-1086 received</p><h3>You’re in the review queue.</h3><p>{builder.successMessage}</p><button type="button" className="button button--primary" disabled title="This button is disabled in the confirmation preview.">Continue to portal <ArrowRight size={15} /></button><small>Preview only. The published confirmation will {builder.autoRedirect ? "also continue automatically after 10 seconds." : "wait for the applicant to continue."}</small></div>
            </div>
          )}

          {step === "notifications" && (
            <div className="builder-panel">
              <div className="builder-panel__title"><span>07</span><div><h2>Notify, verify, publish.</h2><p>Submission confirmation is the only configured email path.</p></div></div>
              <section className="notification-row notification-row--must"><div><Mail size={20} /><span><strong>Submission confirmation</strong><small>Email the submitter after the write succeeds.</small></span></div><span className="priority-note priority-note--must">Must have</span><Toggle checked={builder.confirmationEnabled} onChange={(confirmationEnabled) => updateBuilder({ confirmationEnabled })} label={builder.confirmationEnabled ? "Enabled" : "Disabled"} /></section>
              <section className="notification-row" aria-label="Organizer alerts unavailable"><div><BellRing size={20} /><span><strong>Organizer alerts</strong><small>Unavailable until durable recipient routing is configured.</small></span></div><span className="priority-note">Unavailable</span></section>
              {!builder.confirmationEnabled && <InlineAlert tone="danger"><strong>Publication blocked.</strong> Every successful submission needs a durable confirmation path.</InlineAlert>}
              {requiredFileFields.length > 0 && <InlineAlert tone="danger"><strong>Publication blocked.</strong> Required file uploads are not supported yet. Make {requiredFileFields.map((field) => `“${field.label}”`).join(", ")} optional or delete the field.</InlineAlert>}
              <div className="publish-proof">
                <div><span>VERSION</span><strong>V{builder.dirty && builder.version === builder.publishedVersion ? builder.version + 1 : builder.version}</strong></div>
                <div><span>DEADLINE</span><strong>{builder.closeDate ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(builder.closeDate)) : "Not set"}</strong></div>
                <div><span>CAP</span><strong>{builder.submissionLimit} / person</strong></div>
              </div>
              <button
                type="button"
                className="button button--primary button--large button--full"
                disabled={!Object.values(completed).every(Boolean) || requiredFileFields.length > 0 || publishing}
                onClick={async () => {
                  if (requiredFileFields.length > 0) {
                    setNotice("Publication blocked until required file upload questions are made optional or removed.");
                    return;
                  }
                  setPublishing(true);
                  try {
                    await publishBuilder();
                  } finally {
                    setPublishing(false);
                  }
                }}
              >
                <Send size={17} /> {publishing ? "Publishing…" : builder.version === builder.publishedVersion && !builder.dirty ? `Version ${builder.version} is live` : `Publish version ${builder.dirty && builder.version === builder.publishedVersion ? builder.version + 1 : builder.version}`}
              </button>
            </div>
          )}

          <div className="builder-footer">
            <button type="button" className="button button--quiet" onClick={previous} disabled={currentIndex === 0}><ArrowLeft size={15} /> Back</button>
            <span>Step {currentIndex + 1} of {builderSteps.length}</span>
            <button type="button" className="button button--primary" onClick={next} disabled={currentIndex === builderSteps.length - 1}>Next <ArrowRight size={15} /></button>
          </div>
        </div>
      </div>
    </>
  );
}
