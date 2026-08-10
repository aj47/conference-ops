import {
  ArrowRight,
  BookOpen,
  Bot,
  Check,
  ClipboardList,
  Code2,
  Database,
  ExternalLink,
  Eye,
  Mail,
  MapPinned,
  Palette,
  Pencil,
  Plus,
  Save,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import type {
  CommunicationDelivery,
  FormField,
  MessageTemplateDefinition,
  ReadinessInsight,
  ReminderRule,
  ResourcePage,
  ReviewerGroupConfig,
  TaskTemplateDefinition,
} from "../../shared/domain";
import { submissionCategoryField } from "../../shared/form-fields";
import { CommunicationDeliveryHistory } from "../CommunicationDeliveryHistory";
import { AirtablePanel } from "../AirtableOperatorStatus";
import { BrandKitPanel } from "../BrandKitPanel";
import { EmbedStudioPanel } from "../EmbedStudioPanel";
import { EvaluationPlanStudio } from "../EvaluationPlanStudio";
import { conferenceApi, type ResourcePageDraft } from "../api";
import { EmptyState, Field, InlineAlert, PageHeader, StatusPill } from "../components";
import { useDialogA11y } from "../dialog-a11y";
import { privateEventPath } from "../private-routes";
import { useWorkspace } from "../workspace";

type SettingsSection = "brand" | "routing" | "onboarding" | "communications" | "resources" | "embeds" | "data" | "assistant";

const sections: Array<{ id: SettingsSection; label: string; detail: string; icon: typeof MapPinned }> = [
  { id: "brand", label: "Brand & previews", detail: "Identity across personas", icon: Palette },
  { id: "routing", label: "Review routing", detail: "Tracks → reviewers", icon: MapPinned },
  { id: "onboarding", label: "Onboarding plan", detail: "Forms, files, profile", icon: ClipboardList },
  { id: "communications", label: "Communications", detail: "Templates & reminders", icon: Mail },
  { id: "resources", label: "Participant resources", detail: "Guides & policies", icon: BookOpen },
  { id: "embeds", label: "Public widgets", detail: "Embeds, feeds & branding", icon: Code2 },
  { id: "data", label: "Airtable source", detail: "Authority & sync health", icon: Database },
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
  const [externalUrl, setExternalUrl] = useState(template?.externalUrl ?? "");
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
            await onSave({
              title,
              description,
              type,
              targetType,
              relativeDueDays,
              ...(["profile", "calendar"].includes(type) && externalUrl.trim() ? { externalUrl: externalUrl.trim() } : {}),
              ...(type === "form" ? { fields } : {}),
            });
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
          {["profile", "calendar"].includes(type) && <Field label="External action link" hint="Optional. Speakers open this HTTPS page, then separately mark the task complete."><input type="url" inputMode="url" placeholder="https://…" maxLength={2048} value={externalUrl} onChange={(event) => setExternalUrl(event.target.value)} /></Field>}
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
      <EvaluationPlanStudio />
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
            <div><strong>{template.title}</strong><p>{template.description}</p><small>{taskTypeLabels[template.type]} · {template.targetType === "submission" ? "Every accepted talk" : "Once per speaker"} · Due {template.relativeDueDays} days before event</small>{template.externalUrl && <a className="template-row__external" href={template.externalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> External action</a>}</div>
            <div className="template-row__actions"><button type="button" className="icon-button" aria-label={`Edit ${template.title}`} onClick={() => setEditing(template)}><Pencil size={15} /></button><button type="button" className="icon-button icon-button--danger" aria-label={`Remove ${template.title}`} onClick={() => void remove(template)}><Trash2 size={15} /></button></div>
          </article>
        ))}
        {!templates.length && <EmptyState title="No onboarding plan" detail="Create the hotel and flight forms first; then add profile, slides, calendar, or custom tasks." action={<button type="button" className="button button--primary" onClick={() => setEditing("new")}>Add first task</button>} />}
      </div>
      {editing && <TaskTemplateDialog template={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSave={save} />}
    </section>
  );
}

function resourceSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80);
}

function resourceDraft(resource?: ResourcePage): ResourcePageDraft {
  return resource
    ? { title: resource.title, slug: resource.slug, summary: resource.summary, body: resource.body, linkUrl: resource.linkUrl ?? "", status: resource.status }
    : { title: "", slug: "", summary: "", body: "", linkUrl: "", status: "draft" };
}

function ResourcesPanel() {
  const { workspace, setNotice, updateProgramConfiguration } = useWorkspace();
  const [resources, setResources] = useState(workspace.resources);
  const [draft, setDraft] = useState<ResourcePageDraft | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [slugEdited, setSlugEdited] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorTitleRef = useRef<HTMLInputElement>(null);
  const editorReturnFocusRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => setResources(workspace.resources), [workspace.resources]);

  const replaceResource = (saved: ResourcePage) => {
    const next = resources.some((resource) => resource.id === saved.id)
      ? resources.map((resource) => resource.id === saved.id ? saved : resource)
      : [saved, ...resources];
    setResources(next);
    updateProgramConfiguration({ resources: next });
  };

  const openEditor = (resource?: ResourcePage, opener?: HTMLButtonElement) => {
    editorReturnFocusRef.current = opener ?? null;
    setEditingId(resource?.id ?? null);
    setDraft(resourceDraft(resource));
    setSlugEdited(Boolean(resource));
    setError(null);
    requestAnimationFrame(() => editorTitleRef.current?.focus());
  };

  const closeEditor = () => {
    setDraft(null);
    setEditingId(null);
    requestAnimationFrame(() => editorReturnFocusRef.current?.focus());
  };

  const save = async () => {
    if (!draft) return;
    setWorkingId(editingId ?? "new");
    setError(null);
    const payload = { ...draft, title: draft.title.trim(), slug: draft.slug.trim(), summary: draft.summary.trim(), body: draft.body.trim(), linkUrl: draft.linkUrl?.trim() || undefined };
    try {
      const saved: ResourcePage = workspace.demoMode
        ? { id: editingId ?? `demo-resource-${crypto.randomUUID()}`, updatedAt: new Date().toISOString(), ...payload }
        : editingId
          ? await conferenceApi.updateResourcePage(workspace.actor.id, workspace.event.id, editingId, payload)
          : await conferenceApi.createResourcePage(workspace.actor.id, workspace.event.id, payload);
      replaceResource(saved);
      closeEditor();
      setNotice(`${saved.title} ${saved.status === "published" ? "is available in participant and public resources." : "saved as a private organizer draft."}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The participant resource could not be saved.");
    } finally {
      setWorkingId(null);
    }
  };

  const togglePublished = async (resource: ResourcePage) => {
    setWorkingId(resource.id);
    setError(null);
    try {
      const payload = { ...resourceDraft(resource), status: resource.status === "published" ? "draft" as const : "published" as const };
      const saved: ResourcePage = workspace.demoMode
        ? { ...resource, ...payload, updatedAt: new Date().toISOString() }
        : await conferenceApi.updateResourcePage(workspace.actor.id, workspace.event.id, resource.id, payload);
      replaceResource(saved);
      setNotice(`${saved.title} ${saved.status === "published" ? "published to participants." : "returned to organizer draft."}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The resource visibility could not be changed.");
    } finally {
      setWorkingId(null);
    }
  };

  const remove = async (resource: ResourcePage) => {
    if (!window.confirm(`Delete the draft “${resource.title}”? This cannot be undone.`)) return;
    setWorkingId(resource.id);
    setError(null);
    try {
      if (!workspace.demoMode) await conferenceApi.deleteResourcePage(workspace.actor.id, workspace.event.id, resource.id);
      const next = resources.filter((candidate) => candidate.id !== resource.id);
      setResources(next);
      updateProgramConfiguration({ resources: next });
      if (editingId === resource.id) closeEditor();
      setNotice(`${resource.title} deleted.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The participant resource could not be deleted.");
    } finally {
      setWorkingId(null);
    }
  };

  return (
    <section className="program-config-panel">
      <div className="program-config-panel__head"><div><p className="eyebrow">Self-service participant wiki</p><h2>Publish the answers speakers need without another email.</h2><p>Write travel instructions, production policies, FAQs, or day-of guides. Drafts stay organizer-only; published pages appear in the signed-in portal and public event resources.</p></div><button type="button" className="button button--primary" onClick={(event) => openEditor(undefined, event.currentTarget)}><Plus size={16} /> New resource</button></div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      <div className={`resource-admin-layout${draft ? " resource-admin-layout--editing" : ""}`}>
        <div className="resource-admin-list" aria-label="Participant resources">
          {resources.map((resource) => (
            <article key={resource.id}>
              <span className="resource-admin-list__mark"><BookOpen size={17} /></span>
              <div><span className="resource-admin-list__title"><strong>{resource.title}</strong><StatusPill status={resource.status} /></span><p>{resource.summary || "No summary yet."}</p><small>/{resource.slug} · Updated {new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(resource.updatedAt))}</small></div>
              <div className="resource-admin-list__actions">
                <button type="button" className="button button--quiet" disabled={workingId === resource.id} onClick={(event) => openEditor(resource, event.currentTarget)}><Pencil size={14} /> Edit</button>
                <button type="button" className="button button--quiet" disabled={workingId === resource.id || (resource.status === "draft" && !resource.body.trim())} title={resource.status === "draft" && !resource.body.trim() ? "Add page content before publishing" : undefined} onClick={() => void togglePublished(resource)}>{resource.status === "published" ? "Unpublish" : "Publish"}</button>
                {resource.status === "draft" && <button type="button" className="icon-button icon-button--danger" disabled={workingId === resource.id} aria-label={`Delete ${resource.title}`} onClick={() => void remove(resource)}><Trash2 size={15} /></button>}
              </div>
            </article>
          ))}
          {!resources.length && <EmptyState title="No participant resources" detail="Start with an arrival guide or speaker policy. You can keep the page private until its details are final." action={<button type="button" className="button button--primary" onClick={(event) => openEditor(undefined, event.currentTarget)}>Create first resource</button>} />}
        </div>
        {draft && (
          <form className="resource-editor" onSubmit={(event) => { event.preventDefault(); void save(); }}>
            <header><div><p className="eyebrow">{editingId ? "Edit resource" : "New resource"}</p><h3>{draft.title || "Untitled guide"}</h3></div><button type="button" className="icon-button" aria-label="Close resource editor" onClick={closeEditor}><X size={17} /></button></header>
            <Field label="Page title"><input ref={editorTitleRef} required maxLength={160} value={draft.title} onChange={(event) => { const title = event.target.value; setDraft({ ...draft, title, ...(!slugEdited ? { slug: resourceSlug(title) } : {}) }); }} /></Field>
            <div className="field-grid field-grid--2">
              <Field label="URL slug" hint="Lowercase letters, numbers, and hyphens"><input required maxLength={80} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={draft.slug} onChange={(event) => { setSlugEdited(true); setDraft({ ...draft, slug: resourceSlug(event.target.value) }); }} /></Field>
              <Field label="Visibility"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ResourcePage["status"] })}><option value="draft">Organizer draft</option><option value="published">Published</option></select></Field>
            </div>
            <Field label="Short summary" hint={`${draft.summary.length} / 500 characters`}><textarea required rows={3} maxLength={500} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></Field>
            <Field label="Page content" hint="Plain text only. Blank lines create separate paragraphs; HTML is shown as text, never executed."><textarea required={draft.status === "published"} rows={12} maxLength={50_000} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} /></Field>
            <Field label="Organizer reference link" hint="Optional · complete http:// or https:// URL"><input type="url" maxLength={2048} placeholder="https://…" value={draft.linkUrl ?? ""} onChange={(event) => setDraft({ ...draft, linkUrl: event.target.value })} /></Field>
            <footer><span>{draft.status === "published" ? "Saving will make this content immediately visible." : "Only organizers can see drafts."}</span><button type="submit" className="button button--primary" disabled={workingId !== null || !draft.title.trim() || !draft.slug.trim() || !draft.summary.trim() || (draft.status === "published" && !draft.body.trim())}><Save size={15} /> {workingId ? "Saving…" : draft.status === "published" ? "Save & publish" : "Save draft"}</button></footer>
          </form>
        )}
      </div>
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
  const [deliveries, setDeliveries] = useState<CommunicationDelivery[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const speakerSamples = useMemo(() => [...new Map(workspace.proposals.flatMap((proposal) => proposal.speakers).map((speaker) => [speaker.id, speaker])).values()], [workspace.proposals]);
  const [sampleSpeakerId, setSampleSpeakerId] = useState(() => speakerSamples[0]?.id ?? "");
  const [testSending, setTestSending] = useState(false);
  const sampleSpeaker = speakerSamples.find((speaker) => speaker.id === sampleSpeakerId) ?? speakerSamples[0];
  const sampleProposal = workspace.proposals.find((proposal) => proposal.speakers.some((speaker) => speaker.id === sampleSpeaker?.id));
  const sampleSession = workspace.sessions.find((session) => session.speakerIds.includes(sampleSpeaker?.id ?? ""));
  const sampleVariables: Record<string, string> = {
    "event.name": workspace.event.name,
    "speaker.name": sampleSpeaker?.name ?? workspace.actor.name,
    "proposal.title": sampleProposal?.title ?? "Example proposal",
    "decision.feedback": "Example decision feedback",
    "speaker.portal_url": `${window.location.origin}/portal/home?eventId=${encodeURIComponent(workspace.event.id)}`,
    "task.count": String(workspace.tasks.filter((task) => task.speakerId === sampleSpeaker?.id && ["not_started", "in_progress", "overdue"].includes(task.status)).length),
    "session.title": sampleSession?.title ?? sampleProposal?.title ?? "Example session",
    "session.room": workspace.rooms.find((room) => room.id === sampleSession?.roomId)?.name ?? "Room to be confirmed",
  };
  const renderPreview = (value: string) => value.replace(/{{\s*([\w.]+)\s*}}/g, (_match, key: string) => sampleVariables[key] ?? `{{${key}}}`);
  const historyRequest = useRef(0);
  const loadHistory = useCallback(async () => {
    const request = ++historyRequest.current;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const result = await conferenceApi.communicationHistory(workspace.actor.id, workspace.event.id);
      if (request === historyRequest.current) setDeliveries(result.deliveries);
    } catch (caught) {
      if (request === historyRequest.current) setHistoryError(caught instanceof Error ? caught.message : "The delivery history could not be loaded.");
    } finally {
      if (request === historyRequest.current) setHistoryLoading(false);
    }
  }, [workspace.actor.id, workspace.event.id]);
  useEffect(() => {
    void loadHistory();
    return () => { historyRequest.current += 1; };
  }, [loadHistory]);
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
  const sendTest = async () => {
    setTestSending(true); setError(null);
    try {
      const sent = await conferenceApi.sendCommunicationTest(workspace.actor.id, workspace.event.id, { kind, subject: draft.subject, text: draft.text, html: draft.html, ...(sampleSpeaker?.id ? { sampleSpeakerId: sampleSpeaker.id } : {}) });
      setNotice(`Test queued to ${sent.recipient}. The subject starts with [TEST].`);
      void loadHistory();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The test message could not be queued."); }
    finally { setTestSending(false); }
  };
  return (
    <section className="program-config-panel">
      <div className="program-config-panel__head"><div><p className="eyebrow">Cloudflare Email + durable outbox</p><h2>Write the messages the workflow actually sends.</h2><p>Submission confirmations, decisions, task reminders, and calendar REQUEST invites are persisted before queue delivery. Supported variables are shown beside the editor.</p></div><StatusPill status="durable queue" /></div>
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
      <section className="communication-proof" aria-labelledby="communication-proof-title">
        <div className="communication-proof__head"><div><p className="eyebrow">Recipient proof</p><h3 id="communication-proof-title">Preview one personalized message before it can send.</h3><p>Choose an event speaker to resolve merge fields. The test always goes to your signed-in organizer address, never the speaker.</p></div><label><span>Preview as recipient</span><select value={sampleSpeaker?.id ?? ""} onChange={(event) => setSampleSpeakerId(event.target.value)}>{speakerSamples.length ? speakerSamples.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name} · {speaker.email}</option>) : <option value="">Organizer sample</option>}</select></label></div>
        <div className="communication-proof__message"><div><Eye size={15} /><span><small>To</small><strong>{sampleSpeaker?.name ?? workspace.actor.name}</strong></span><span><small>Subject</small><strong>{renderPreview(draft.subject || "Add a subject to preview it")}</strong></span></div><pre>{renderPreview(draft.text || "Add a plain-text body to preview it here.")}</pre></div>
        <footer><span><strong>Test recipient:</strong> {workspace.actor.email}</span><button type="button" className="button button--dark" disabled={testSending || !draft.subject.trim() || !draft.text.trim() || !draft.html.trim()} onClick={() => void sendTest()}><Send size={15} />{testSending ? "Queueing test…" : "Send test to me"}</button></footer>
      </section>
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
      <CommunicationDeliveryHistory deliveries={deliveries} loading={historyLoading} error={historyError} timezone={workspace.event.timezone} onRefresh={() => void loadHistory()} />
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
  const [preview, setPreview] = useState<ReadinessInsight | null>(null);
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
      <div className="program-config-panel__head"><div><p className="eyebrow">Conference Ops Copilot · supervised</p><h2>Inspect, preview, then choose what happens.</h2><p>The copilot grounds every recommendation in current event state. It previews impact and reversibility first; sending, publishing, and final decisions always remain explicit organizer actions.</p></div><span className="assistant-sigil"><Sparkles size={22} /></span></div>
      <form className="assistant-ask" onSubmit={(event) => { event.preventDefault(); void ask(); }}><input aria-label="Ask the readiness assistant" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What needs attention before we publish?" /><button type="submit" className="button button--primary" disabled={loading || !question.trim()}>{loading ? "Inspecting…" : "Inspect event"}</button></form>
      <div className="assistant-prompts"><button type="button" onClick={() => { const prompt = "What review work is blocked?"; setQuestion(prompt); void ask(prompt); }}>Review bottlenecks</button><button type="button" onClick={() => { const prompt = "What needs attention before we publish?"; setQuestion(prompt); void ask(prompt); }}>Publish readiness</button><button type="button" onClick={() => { const prompt = "What should I do next?"; setQuestion(prompt); void ask(prompt); }}>Next best action</button></div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {answer && <div className="assistant-answer" aria-live="polite"><Bot size={19} /><p>{answer}</p></div>}
      <div className="assistant-insights">{insights.map((insight) => <article key={insight.id} data-priority={insight.priority}><span>{insight.priority}</span><div><strong>{insight.title}</strong><p>{insight.detail}</p></div><button type="button" className="button button--quiet" onClick={() => setPreview(insight)}>Preview action <ArrowRight size={14} /></button></article>)}</div>
      {preview && <div className="assistant-action-preview" role="region" aria-live="polite" aria-label={`Preview action: ${preview.actionLabel}`}>
        <div><p className="eyebrow">Supervised action preview</p><h3>{preview.actionLabel}</h3><p>{preview.effectSummary ?? preview.detail}</p></div>
        <dl><div><dt>Changes now</dt><dd>None</dd></div><div><dt>Reversible</dt><dd>{preview.reversible ? "Yes" : "Not after final confirmation"}</dd></div><div><dt>Human gate</dt><dd>{preview.requiresConfirmation === false ? "Not needed" : "Required"}</dd></div></dl>
        <footer><button type="button" className="button button--quiet" onClick={() => setPreview(null)}>Cancel</button><button type="button" className="button button--primary" onClick={() => {
          const target = new URL(preview.actionPath, window.location.origin);
          if (target.pathname === "/program-settings") { onOpenRouting(); setPreview(null); return; }
          navigate(`${target.pathname}${target.search}`);
        }}>Continue to workflow <ArrowRight size={14} /></button></footer>
      </div>}
      {!answer && !loading && <EmptyState title="Ready when you are" detail="Run a grounded inspection to see only the operational work supported by the current event snapshot." action={<button type="button" className="button button--dark" onClick={() => void ask()}><Bot size={15} /> Inspect now</button>} />}
    </section>
  );
}

export function ProgramSettings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("section") as SettingsSection | null;
  const [section, setSectionState] = useState<SettingsSection>(() => sections.some((item) => item.id === requested) ? requested! : "routing");
  const setSection = (next: SettingsSection) => {
    setSectionState(next);
    const query = new URLSearchParams(searchParams);
    query.set("section", next);
    setSearchParams(query, { replace: true });
  };
  return (
    <>
      <PageHeader eyebrow="Program operating system" title="Configure the workflow behind the forms." description="Map tracks to reviewers, define automatic speaker onboarding, write the emails that really send, and inspect readiness from one organizer workspace." />
      <div className="program-settings-layout">
        <aside className="program-settings-nav" aria-label="Program setup sections">{sections.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" className={section === item.id ? "active" : ""} aria-current={section === item.id ? "page" : undefined} onClick={() => setSection(item.id)}><Icon size={17} /><span><strong>{item.label}</strong><small>{item.detail}</small></span><ArrowRight size={14} /></button>; })}</aside>
        {section === "brand" && <BrandKitPanel />}
        {section === "routing" && <RoutingPanel />}
        {section === "onboarding" && <OnboardingPanel />}
        {section === "communications" && <CommunicationsPanel />}
        {section === "resources" && <ResourcesPanel />}
        {section === "embeds" && <EmbedStudioPanel />}
        {section === "data" && <AirtablePanel />}
        {section === "assistant" && <AssistantPanel onOpenRouting={() => setSection("routing")} />}
      </div>
    </>
  );
}
