import {
  ArrowRight,
  Bot,
  Check,
  ClipboardList,
  Mail,
  MapPinned,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type {
  FormField,
  MessageTemplateDefinition,
  ReadinessInsight,
  ReminderRule,
  ReviewerGroupConfig,
  TaskTemplateDefinition,
} from "../../shared/domain";
import { submissionCategoryField } from "../../shared/form-fields";
import { conferenceApi } from "../api";
import { EmptyState, Field, InlineAlert, PageHeader, StatusPill } from "../components";
import { useDialogA11y } from "../dialog-a11y";
import { privateEventPath } from "../private-routes";
import { useWorkspace } from "../workspace";

type SettingsSection = "routing" | "onboarding" | "communications" | "assistant";

const sections: Array<{ id: SettingsSection; label: string; detail: string; icon: typeof MapPinned }> = [
  { id: "routing", label: "Review routing", detail: "Tracks → reviewers", icon: MapPinned },
  { id: "onboarding", label: "Onboarding plan", detail: "Forms, files, profile", icon: ClipboardList },
  { id: "communications", label: "Communications", detail: "Templates & reminders", icon: Mail },
  { id: "assistant", label: "Readiness assistant", detail: "Grounded next actions", icon: Bot },
];

const taskTypeLabels: Record<TaskTemplateDefinition["type"], string> = {
  profile: "Profile confirmation",
  upload: "File request",
  form: "Questionnaire",
  calendar: "Calendar acknowledgement",
};

const messageKindLabels: Record<MessageTemplateDefinition["kind"], string> = {
  submission_confirmation: "Submission confirmation",
  acceptance: "Acceptance decision",
  rejection: "Decline decision",
  reminder: "Task reminder",
  calendar: "Calendar invitation",
};

function categoriesForWorkspace(builderFields: FormField[], groups: ReviewerGroupConfig[]) {
  const configured = submissionCategoryField(builderFields)?.options ?? [];
  return [...new Set([...configured, ...groups.map((group) => group.category)].map((value) => value.trim()).filter(Boolean))];
}

function initialRouting(categories: string[], groups: ReviewerGroupConfig[]) {
  return categories.map((category) => {
    const existing = groups.find((group) => group.category.toLocaleLowerCase() === category.toLocaleLowerCase());
    return existing ?? { id: `new-${crypto.randomUUID()}`, name: `${category} committee`, category, reviewerIds: [] };
  });
}

function TaskTemplateDialog({
  template,
  onClose,
  onSave,
}: {
  template?: TaskTemplateDefinition;
  onClose: () => void;
  onSave: (payload: Omit<TaskTemplateDefinition, "id" | "completionMode" | "formId" | "fileRequestId" | "formFields"> & { fields?: FormField[] }) => Promise<void>;
}) {
  const dialogRef = useDialogA11y<HTMLFormElement>(onClose);
  const [title, setTitle] = useState(template?.title ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [type, setType] = useState<TaskTemplateDefinition["type"]>(template?.type ?? "form");
  const [targetType, setTargetType] = useState<TaskTemplateDefinition["targetType"]>(template?.targetType ?? "contact");
  const [relativeDueDays, setRelativeDueDays] = useState(template?.relativeDueDays ?? 14);
  const [fields, setFields] = useState<FormField[]>(template?.formFields ?? [
    { id: `field-${crypto.randomUUID()}`, label: "Your answer", type: "long_text", required: true, section: "proposal" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        ref={dialogRef}
        className="drawer drawer--wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-template-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          setError(null);
          try {
            await onSave({ title, description, type, targetType, relativeDueDays, ...(type === "form" ? { fields } : {}) });
            onClose();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "The task template could not be saved.");
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="drawer__head">
          <div><p className="eyebrow">Future accepted speakers</p><h2 id="task-template-title">{template ? "Edit onboarding task" : "Add onboarding task"}</h2></div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="drawer__body form-stack">
          {error && <InlineAlert tone="danger">{error}</InlineAlert>}
          <Field label="Task name"><input data-dialog-initial-focus required maxLength={255} value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <Field label="Speaker instructions"><textarea required rows={4} maxLength={5000} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
          <div className="field-grid field-grid--2">
            <Field label="Task type"><select value={type} onChange={(event) => setType(event.target.value as TaskTemplateDefinition["type"])}>{Object.entries(taskTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
            <Field label="Applies to"><select value={targetType} onChange={(event) => setTargetType(event.target.value as TaskTemplateDefinition["targetType"])}><option value="contact">Speaker once per event</option><option value="submission">Speaker for every accepted talk</option></select></Field>
          </div>
          <Field label="Due before event" hint="Days before the event starts"><input type="number" min={0} max={365} value={relativeDueDays} onChange={(event) => setRelativeDueDays(Number(event.target.value))} /></Field>
          {type === "form" && (
            <section className="program-config__questions" aria-labelledby="task-question-heading">
              <div className="section-heading"><div><p className="eyebrow">Linked portal form</p><h3 id="task-question-heading">Questions speakers will answer</h3></div><button type="button" className="button button--quiet" onClick={() => setFields((current) => [...current, { id: `field-${crypto.randomUUID()}`, label: "", type: "short_text", required: true, section: "proposal" }])}><Plus size={15} /> Add question</button></div>
              {fields.map((field, index) => (
                <div className="program-question-row" key={field.id}>
                  <input aria-label={`Question ${index + 1} label`} required placeholder="Question label" value={field.label} onChange={(event) => setFields((current) => current.map((candidate) => candidate.id === field.id ? { ...candidate, label: event.target.value } : candidate))} />
                  <select
                    aria-label={`Question ${index + 1} type`}
                    value={field.type}
                    onChange={(event) => setFields((current) => current.map((candidate) => candidate.id === field.id
                      ? {
                          ...candidate,
                          type: event.target.value as FormField["type"],
                          ...(event.target.value === "select" && !candidate.options?.length ? { options: ["Option one", "Option two"] } : {}),
                        }
                      : candidate))}
                  ><option value="short_text">Short text</option><option value="long_text">Long text</option><option value="select">Dropdown</option><option value="checkbox">Checkbox</option><option value="url">URL</option></select>
                  {field.type === "select" && (
                    <input
                      className="program-question-row__options"
                      aria-label={`Question ${index + 1} options`}
                      required
                      placeholder="Option one, Option two"
                      value={(field.options ?? []).join(", ")}
                      onChange={(event) => setFields((current) => current.map((candidate) => candidate.id === field.id
                        ? { ...candidate, options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) }
                        : candidate))}
                    />
                  )}
                  <label className="program-question-row__required"><input type="checkbox" checked={field.required} onChange={(event) => setFields((current) => current.map((candidate) => candidate.id === field.id ? { ...candidate, required: event.target.checked } : candidate))} /> Required</label>
                  <button type="button" className="icon-button icon-button--danger" disabled={fields.length === 1} aria-label={`Remove ${field.label || `question ${index + 1}`}`} onClick={() => setFields((current) => current.filter((candidate) => candidate.id !== field.id))}><Trash2 size={15} /></button>
                </div>
              ))}
              <p className="form-hint">Question labels, required answers, and dropdown choices are saved with this task. CFP conditional logic remains in the CFP builder.</p>
            </section>
          )}
        </div>
        <div className="drawer__foot"><button type="button" className="button button--quiet" onClick={onClose}>Cancel</button><button type="submit" className="button button--primary" disabled={saving}>{saving ? "Saving…" : <><Save size={15} /> Save task</>}</button></div>
      </form>
    </div>
  );
}

function RoutingPanel() {
  const { workspace, builder, setNotice, updateProgramConfiguration } = useWorkspace();
  const reviewers = workspace.actors.filter((actor) => actor.role === "reviewer");
  const originalGroups = useMemo(() => workspace.reviewerGroups ?? [], [workspace.reviewerGroups]);
  const categories = useMemo(() => categoriesForWorkspace(builder.proposalFields, originalGroups), [builder.proposalFields, originalGroups]);
  const [groups, setGroups] = useState(() => initialRouting(categories, originalGroups));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = groups.filter((group) => group.reviewerIds.length).length;
  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const result = await conferenceApi.saveReviewerRouting(workspace.actor.id, workspace.event.id, groups.map((group) => ({
        ...(group.id.startsWith("new-") ? {} : { id: group.id }),
        name: group.name,
        category: group.category,
        reviewerIds: group.reviewerIds,
      })));
      setGroups(result.groups);
      updateProgramConfiguration({ reviewerGroups: result.groups });
      setNotice(`Reviewer routing saved for ${result.groups.length} program ${result.groups.length === 1 ? "lane" : "lanes"}; active queues were rebuilt.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Reviewer routing could not be saved.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="program-config-panel">
      <div className="program-config-panel__head"><div><p className="eyebrow">Automatic assignment</p><h2>Route each submitted track to its reviewers.</h2><p>Applicants may choose one or more tracks. Reviewers receive the union of the tracks they cover; owners and claimed co-speakers are excluded.</p></div><div className="program-config-score"><strong>{configured}/{groups.length}</strong><span>lanes covered</span></div></div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {!categories.length && <EmptyState title="No CFP tracks yet" detail="Add choices to the required Category or Program lane field in the CFP builder, then return here to assign reviewers." action={<button type="button" className="button button--quiet" onClick={() => window.location.assign(privateEventPath("/forms", workspace.event.id))}>Open CFP builder</button>} />}
      {categories.length > 0 && reviewers.length === 0 && <InlineAlert tone="warning"><strong>No accepted reviewers yet.</strong> Invite reviewer accounts from the Control Room. You can still save the lanes now and assign people after they accept.</InlineAlert>}
      <div className="routing-grid">
        {groups.map((group) => (
          <article className="routing-card" key={group.category}>
            <header><span className="routing-card__marker" aria-hidden="true" /><div><strong>{group.category}</strong><small>{group.reviewerIds.length ? `${group.reviewerIds.length} reviewer${group.reviewerIds.length === 1 ? "" : "s"}` : "Needs coverage"}</small></div><StatusPill status={group.reviewerIds.length ? "assigned" : "unassigned"} /></header>
            <Field label="Committee name"><input value={group.name} onChange={(event) => setGroups((current) => current.map((candidate) => candidate.id === group.id ? { ...candidate, name: event.target.value } : candidate))} /></Field>
            <fieldset className="reviewer-checklist"><legend>Reviewers covering this track</legend>{reviewers.map((reviewer) => <label key={`${reviewer.id}-${reviewer.role}`}><input type="checkbox" checked={group.reviewerIds.includes(reviewer.id)} onChange={(event) => setGroups((current) => current.map((candidate) => candidate.id !== group.id ? candidate : { ...candidate, reviewerIds: event.target.checked ? [...candidate.reviewerIds, reviewer.id] : candidate.reviewerIds.filter((id) => id !== reviewer.id) }))} /><span><strong>{reviewer.name}</strong><small>{reviewer.email}</small></span></label>)}{!reviewers.length && <p className="muted">Reviewer invitations appear here after acceptance.</p>}</fieldset>
          </article>
        ))}
      </div>
      {categories.length > 0 && <div className="program-config-actions"><p>Saving replaces pending/in-progress assignments with this mapping. Submitted review evidence is preserved.</p><button type="button" className="button button--primary" disabled={saving} onClick={() => void save()}><Save size={16} /> {saving ? "Saving routing…" : "Save routing"}</button></div>}
    </section>
  );
}

function OnboardingPanel() {
  const { workspace, setNotice, updateProgramConfiguration } = useWorkspace();
  const [templates, setTemplates] = useState<TaskTemplateDefinition[]>(workspace.taskTemplates ?? []);
  const [editing, setEditing] = useState<TaskTemplateDefinition | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async (payload: Omit<TaskTemplateDefinition, "id" | "completionMode" | "formId" | "fileRequestId" | "formFields"> & { fields?: FormField[] }) => {
    const saved = editing && editing !== "new"
      ? await conferenceApi.updateTaskTemplate(workspace.actor.id, workspace.event.id, editing.id, payload)
      : await conferenceApi.createTaskTemplate(workspace.actor.id, workspace.event.id, payload);
    const normalized: TaskTemplateDefinition = {
      ...saved,
      ...(editing && editing !== "new" && !saved.formId && editing.formId ? { formId: editing.formId } : {}),
      ...(editing && editing !== "new" && !saved.fileRequestId && editing.fileRequestId ? { fileRequestId: editing.fileRequestId } : {}),
      formFields: payload.fields,
    };
    const nextTemplates = editing && editing !== "new" ? templates.map((template) => template.id === editing.id ? normalized : template) : [...templates, normalized];
    setTemplates(nextTemplates);
    updateProgramConfiguration({ taskTemplates: nextTemplates });
    setNotice(`${saved.title} will be assigned automatically on future acceptances.`);
  };
  const remove = async (template: TaskTemplateDefinition) => {
    if (!window.confirm(`Remove “${template.title}” from future acceptance plans? Templates already assigned to speakers are retained for audit history and cannot be deleted.`)) return;
    setError(null);
    try {
      await conferenceApi.deleteTaskTemplate(workspace.actor.id, workspace.event.id, template.id);
      const nextTemplates = templates.filter((candidate) => candidate.id !== template.id);
      setTemplates(nextTemplates);
      updateProgramConfiguration({ taskTemplates: nextTemplates });
      setNotice(`${template.title} removed from future onboarding plans.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The template could not be removed.");
    }
  };
  const requiredReady = ["hotel", "flight"].every((needle) => templates.some((template) => template.title.toLocaleLowerCase().includes(needle)));
  return (
    <section className="program-config-panel">
      <div className="program-config-panel__head"><div><p className="eyebrow">Acceptance activation</p><h2>Define the work every accepted speaker receives.</h2><p>Acceptance creates the session, activates claimed speaker access, and instantiates this task plan. Contact tasks run once per speaker; submission tasks run for every accepted talk.</p></div><button type="button" className="button button--primary" onClick={() => setEditing("new")}><Plus size={16} /> Add task</button></div>
      <InlineAlert tone={requiredReady ? "info" : "warning"}>{requiredReady ? <><Check size={15} /> Hotel-stay and flight-reimbursement forms are in the plan.</> : "Add both the hotel-stay requirements form and flight-reimbursement form before opening decisions."}</InlineAlert>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <div className="template-list">
        {templates.map((template) => (
          <article className="template-row" key={template.id}>
            <span className="template-row__icon"><ClipboardList size={18} /></span>
            <div><strong>{template.title}</strong><p>{template.description}</p><small>{taskTypeLabels[template.type]} · {template.targetType === "submission" ? "Every accepted talk" : "Once per speaker"} · Due {template.relativeDueDays} days before event</small></div>
            <div className="template-row__actions"><button type="button" className="icon-button" aria-label={`Edit ${template.title}`} onClick={() => setEditing(template)}><Pencil size={15} /></button><button type="button" className="icon-button icon-button--danger" aria-label={`Remove ${template.title}`} onClick={() => void remove(template)}><Trash2 size={15} /></button></div>
          </article>
        ))}
        {!templates.length && <EmptyState title="No onboarding plan" detail="Create the hotel and flight forms first; then add profile, slides, calendar, or custom tasks." action={<button type="button" className="button button--primary" onClick={() => setEditing("new")}>Add first task</button>} />}
      </div>
      {editing && <TaskTemplateDialog template={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSave={save} />}
    </section>
  );
}

function CommunicationsPanel() {
  const { workspace, setNotice, updateProgramConfiguration } = useWorkspace();
  const [templates, setTemplates] = useState<MessageTemplateDefinition[]>(workspace.messageTemplates ?? []);
  const [kind, setKind] = useState<MessageTemplateDefinition["kind"]>("acceptance");
  const selected = templates.find((template) => template.kind === kind);
  const [drafts, setDrafts] = useState<Partial<Record<MessageTemplateDefinition["kind"], Pick<MessageTemplateDefinition, "name" | "subject" | "text" | "html">>>>(() => Object.fromEntries((workspace.messageTemplates ?? []).map((template) => [template.kind, { name: template.name, subject: template.subject, text: template.text, html: template.html }])))
  const draft = drafts[kind] ?? { name: messageKindLabels[kind], subject: "", text: "", html: "" };
  const [rules, setRules] = useState<ReminderRule[]>(workspace.reminderRules ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patchDraft = (patch: Partial<typeof draft>) => setDrafts((current) => ({ ...current, [kind]: { ...draft, ...patch } }));
  const saveTemplate = async () => {
    setSaving(true); setError(null);
    try {
      const saved = await conferenceApi.saveMessageTemplate(workspace.actor.id, workspace.event.id, kind, draft);
      const nextTemplates = [...templates.filter((template) => template.kind !== kind), saved];
      setTemplates(nextTemplates);
      updateProgramConfiguration({ messageTemplates: nextTemplates });
      setNotice(`${messageKindLabels[kind]} template saved and will be used by the delivery queue.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The template could not be saved.");
    } finally { setSaving(false); }
  };
  const saveRule = async (rule: ReminderRule) => {
    setError(null);
    try {
      const saved = await conferenceApi.saveReminderRule(workspace.actor.id, workspace.event.id, rule.kind, { enabled: rule.enabled, offsetDays: rule.offsetDays });
      const nextRules = rules.map((candidate) => candidate.kind === saved.kind ? saved : candidate);
      setRules(nextRules);
      updateProgramConfiguration({ reminderRules: nextRules });
      setNotice(`${rule.kind === "task_overdue" ? "Overdue task" : "Unfinished draft"} reminder rule saved.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The reminder rule could not be saved."); }
  };
  return (
    <section className="program-config-panel">
      <div className="program-config-panel__head"><div><p className="eyebrow">Cloudflare Email + durable outbox</p><h2>Write the messages the workflow actually sends.</h2><p>Submission confirmations, decisions, task reminders, and calendar REQUEST invites are persisted before queue delivery. Supported variables are shown beside the editor.</p></div><StatusPill status="delivery active" /></div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <div className="communications-layout">
        <nav className="communications-kinds" aria-label="Communication templates">{(Object.keys(messageKindLabels) as MessageTemplateDefinition["kind"][]).map((item) => <button type="button" key={item} className={kind === item ? "active" : ""} onClick={() => setKind(item)}><span>{messageKindLabels[item]}</span><small>{templates.some((template) => template.kind === item) ? "Configured" : "Uses fallback"}</small></button>)}</nav>
        <div className="communications-editor">
          <div className="field-grid field-grid--2"><Field label="Template name"><input value={draft.name} onChange={(event) => patchDraft({ name: event.target.value })} /></Field><Field label="Email subject"><input value={draft.subject} onChange={(event) => patchDraft({ subject: event.target.value })} /></Field></div>
          <Field label="Plain-text body"><textarea rows={9} value={draft.text} onChange={(event) => patchDraft({ text: event.target.value })} /></Field>
          <details className="html-editor"><summary>Edit HTML body</summary><Field label="HTML"><textarea rows={8} value={draft.html} onChange={(event) => patchDraft({ html: event.target.value })} /></Field></details>
          <div className="template-variables"><strong>Variables</strong><code>{"{{event.name}}"}</code><code>{"{{speaker.name}}"}</code><code>{"{{proposal.title}}"}</code><code>{"{{decision.feedback}}"}</code><code>{"{{speaker.portal_url}}"}</code><code>{"{{task.count}}"}</code><code>{"{{session.title}}"}</code><code>{"{{session.room}}"}</code></div>
          <div className="program-config-actions"><p>{selected ? `Last saved ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(selected.updatedAt))}` : "No saved template yet; the server fallback remains available."}</p><button type="button" className="button button--primary" onClick={() => void saveTemplate()} disabled={saving || !draft.subject.trim() || !draft.text.trim() || !draft.html.trim()}><Save size={16} /> {saving ? "Saving…" : "Save template"}</button></div>
        </div>
      </div>
      <div className="reminder-rules">
        <div className="section-heading"><div><p className="eyebrow">Scheduled automation</p><h3>Reminder rules</h3></div></div>
        {rules.map((rule) => (
          <article key={rule.kind}>
            <div><strong>{rule.kind === "task_overdue" ? "Overdue speaker tasks" : "Unfinished CFP drafts"}</strong><p>{rule.kind === "task_overdue" ? "Send one deduplicated reminder per speaker/day after tasks age past the selected threshold." : "Send one reminder per draft when its published CFP enters the selected deadline window."}</p></div>
            <label className="toggle"><input type="checkbox" checked={rule.enabled} onChange={(event) => setRules((current) => current.map((candidate) => candidate.kind === rule.kind ? { ...candidate, enabled: event.target.checked } : candidate))} /><span className="toggle__track" aria-hidden="true"><span /></span><span>{rule.enabled ? "Enabled" : "Paused"}</span></label>
            <label className="compact-number"><span>{rule.kind === "task_overdue" ? "Days overdue" : "Days before close"}</span><input type="number" min={0} max={60} value={rule.offsetDays} onChange={(event) => setRules((current) => current.map((candidate) => candidate.kind === rule.kind ? { ...candidate, offsetDays: Number(event.target.value) } : candidate))} /></label>
            <button type="button" className="button button--quiet" onClick={() => void saveRule(rule)}>Save rule</button>
          </article>
        ))}
        {!rules.length && <EmptyState title="No scheduled reminder rules" detail="Fresh events include overdue-task and unfinished-draft rules. Re-run setup defaults or create the missing rules through the API." />}
      </div>
    </section>
  );
}

function AssistantPanel({ onOpenRouting }: { onOpenRouting: () => void }) {
  const { workspace } = useWorkspace();
  const navigate = useNavigate();
  const [question, setQuestion] = useState("What needs attention before we publish?");
  const [answer, setAnswer] = useState<string | null>(null);
  const [insights, setInsights] = useState<ReadinessInsight[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (nextQuestion = question) => {
    setLoading(true); setError(null);
    try {
      const result = await conferenceApi.askReadinessAssistant(workspace.actor.id, workspace.event.id, nextQuestion);
      setAnswer(result.answer); setInsights(result.insights);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The readiness assistant could not inspect this event."); }
    finally { setLoading(false); }
  };
  return (
    <section className="program-config-panel assistant-panel">
      <div className="program-config-panel__head"><div><p className="eyebrow">Small, useful agent · read-only</p><h2>Ask what the program needs next.</h2><p>The assistant uses the event’s actual proposal, review, session, and task state. It recommends a workflow and deep-links you there; it never sends or changes data on its own.</p></div><span className="assistant-sigil"><Sparkles size={22} /></span></div>
      <form className="assistant-ask" onSubmit={(event) => { event.preventDefault(); void ask(); }}><input aria-label="Ask the readiness assistant" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What needs attention before we publish?" /><button type="submit" className="button button--primary" disabled={loading || !question.trim()}>{loading ? "Inspecting…" : "Inspect event"}</button></form>
      <div className="assistant-prompts"><button type="button" onClick={() => { const prompt = "What review work is blocked?"; setQuestion(prompt); void ask(prompt); }}>Review bottlenecks</button><button type="button" onClick={() => { const prompt = "What needs attention before we publish?"; setQuestion(prompt); void ask(prompt); }}>Publish readiness</button><button type="button" onClick={() => { const prompt = "What should I do next?"; setQuestion(prompt); void ask(prompt); }}>Next best action</button></div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {answer && <div className="assistant-answer" aria-live="polite"><Bot size={19} /><p>{answer}</p></div>}
      <div className="assistant-insights">{insights.map((insight) => <article key={insight.id} data-priority={insight.priority}><span>{insight.priority}</span><div><strong>{insight.title}</strong><p>{insight.detail}</p></div><button type="button" className="button button--quiet" onClick={() => {
        const target = new URL(insight.actionPath, window.location.origin);
        if (target.pathname === "/program-settings") {
          onOpenRouting();
          return;
        }
        navigate(privateEventPath(insight.actionPath, workspace.event.id, workspace.actor.role));
      }}>{insight.actionLabel} <ArrowRight size={14} /></button></article>)}</div>
      {!answer && !loading && <EmptyState title="Ready when you are" detail="Run a grounded inspection to see only the operational work supported by the current event snapshot." action={<button type="button" className="button button--dark" onClick={() => void ask()}><Bot size={15} /> Inspect now</button>} />}
    </section>
  );
}

export function ProgramSettings() {
  const [section, setSection] = useState<SettingsSection>("routing");
  return (
    <>
      <PageHeader eyebrow="Program operating system" title="Configure the workflow behind the forms." description="Map tracks to reviewers, define automatic speaker onboarding, write the emails that really send, and inspect readiness from one organizer workspace." />
      <div className="program-settings-layout">
        <aside className="program-settings-nav" aria-label="Program setup sections">{sections.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}><Icon size={17} /><span><strong>{item.label}</strong><small>{item.detail}</small></span><ArrowRight size={14} /></button>; })}</aside>
        {section === "routing" && <RoutingPanel />}
        {section === "onboarding" && <OnboardingPanel />}
        {section === "communications" && <CommunicationsPanel />}
        {section === "assistant" && <AssistantPanel onOpenRouting={() => setSection("routing")} />}
      </div>
    </>
  );
}
