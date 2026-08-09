import { CalendarRange, CopyPlus, EyeOff, Plus, Save, Trash2, UsersRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReviewPlanDefinition, ReviewRubricCriterion } from "../shared/domain";
import { abstractReviewApi, type ReviewPlanDraft } from "./abstract-review-api";
import { EmptyState, Field, InlineAlert, StatusPill } from "./components";
import { useWorkspace } from "./workspace";

function localDateTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function isoDateTime(value: string) {
  return value ? new Date(value).toISOString() : undefined;
}

function initialRubric(): ReviewRubricCriterion[] {
  return [
    { id: `criterion-${crypto.randomUUID()}`, label: "Originality", type: "numeric", description: "How distinctive and well-founded is the proposal?", weight: 2, maxScore: 5, required: true },
    { id: `criterion-${crypto.randomUUID()}`, label: "Relevance", type: "numeric", description: "How well does it serve this event's audience?", weight: 1, maxScore: 5, required: true },
    { id: `criterion-${crypto.randomUUID()}`, label: "Recommendation", type: "dropdown", description: "Your review signal for the committee.", weight: 1, maxScore: 5, options: ["Accept", "Maybe", "Reject"], required: true },
    { id: `criterion-${crypto.randomUUID()}`, label: "Comments", type: "text", description: "Specific evidence or requested changes.", weight: 1, maxScore: 5, required: true },
  ];
}

function newRound(existingCount: number): ReviewPlanDefinition {
  const final = existingCount > 0;
  return {
    id: `new-${crypto.randomUUID()}`,
    eventId: "",
    name: final ? `Final Review${existingCount > 1 ? ` ${existingCount}` : ""}` : "Initial Review",
    round: existingCount + 1,
    status: "draft",
    opensAt: final ? "2026-10-16T00:00:00.000Z" : "2026-08-01T00:00:00.000Z",
    closesAt: final ? "2026-11-30T23:59:00.000Z" : "2026-10-15T23:59:00.000Z",
    anonymized: !final,
    reviewerIds: [],
    reviewerCaps: {},
    rubric: final
      ? [
          { id: `criterion-${crypto.randomUUID()}`, label: "Final Score", type: "numeric", description: "Committee-ready program fit.", weight: 1, maxScore: 10, required: true },
          { id: `criterion-${crypto.randomUUID()}`, label: "Comments", type: "text", description: "Final committee context.", weight: 1, maxScore: 5, required: true },
        ]
      : initialRubric(),
    submittedReviews: 0,
    updatedAt: new Date().toISOString(),
  };
}

function planPayload(plan: ReviewPlanDefinition): ReviewPlanDraft {
  return {
    name: plan.name,
    status: plan.status,
    rubric: plan.rubric,
    opensAt: plan.opensAt,
    closesAt: plan.closesAt,
    anonymized: Boolean(plan.anonymized),
    reviewerIds: plan.reviewerIds ?? [],
    reviewerCaps: plan.reviewerCaps ?? {},
  };
}

export function EvaluationPlanStudio() {
  const { workspace, setNotice } = useWorkspace();
  const [plans, setPlans] = useState<ReviewPlanDefinition[]>([]);
  const [reviewers, setReviewers] = useState<Array<{ id: string; name: string; email: string }>>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<ReviewPlanDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [{ plans: nextPlans }, overview] = await Promise.all([
        abstractReviewApi.plans(workspace.actor.id, workspace.event.id),
        abstractReviewApi.overview(workspace.actor.id, workspace.event.id),
      ]);
      setPlans(nextPlans);
      setReviewers(overview.reviewers);
      const selected = nextPlans.find((plan) => plan.id === selectedId) ?? nextPlans[0] ?? null;
      setSelectedId(selected?.id ?? "");
      setDraft(selected);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Evaluation plans could not be loaded.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [workspace.actor.id, workspace.event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectPlan = (plan: ReviewPlanDefinition) => { setSelectedId(plan.id); setDraft(plan); setError(null); };
  const totalWeight = useMemo(() => draft?.rubric.filter((criterion) => (criterion.type ?? "numeric") === "numeric").reduce((sum, criterion) => sum + criterion.weight, 0) ?? 0, [draft]);
  const locked = Boolean(draft?.submittedReviews);

  const updateCriterion = (criterionId: string, patch: Partial<ReviewRubricCriterion>) => {
    setDraft((current) => current ? { ...current, rubric: current.rubric.map((criterion) => criterion.id === criterionId ? { ...criterion, ...patch } : criterion) } : current);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null);
    try {
      const saved = draft.id.startsWith("new-")
        ? await abstractReviewApi.createPlan(workspace.actor.id, workspace.event.id, planPayload(draft))
        : await abstractReviewApi.updatePlan(workspace.actor.id, workspace.event.id, draft.id, planPayload(draft));
      const nextPlans = draft.id.startsWith("new-") ? [...plans, saved] : plans.map((plan) => plan.id === saved.id ? saved : plan);
      setPlans(nextPlans);
      setSelectedId(saved.id);
      setDraft(saved);
      setNotice(`${saved.name} saved with its own dates, scorecard, privacy, and reviewer pool.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The round could not be saved."); }
    finally { setSaving(false); }
  };

  const remove = async () => {
    if (!draft || draft.id.startsWith("new-")) { setDraft(plans[0] ?? null); return; }
    if (!window.confirm(`Delete “${draft.name}”? Submitted reviews are protected and will block deletion.`)) return;
    setSaving(true); setError(null);
    try {
      await abstractReviewApi.deletePlan(workspace.actor.id, workspace.event.id, draft.id);
      const next = plans.filter((plan) => plan.id !== draft.id);
      setPlans(next); setDraft(next[0] ?? null); setSelectedId(next[0]?.id ?? "");
      setNotice(`${draft.name} deleted. Submitted-review rounds remain immutable.`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The round could not be deleted."); }
    finally { setSaving(false); }
  };

  return (
    <section className="evaluation-studio" aria-labelledby="evaluation-studio-title">
      <div className="evaluation-studio__head">
        <div><p className="eyebrow">Multi-round evaluation plan</p><h3 id="evaluation-studio-title">Give every stage its own contract.</h3><p>Dates, blind-review policy, reviewer pool, and scorecard stay scoped to one round. Final reviews lock that round's scoring evidence.</p></div>
        <button type="button" className="button button--dark" onClick={() => { const next = newRound(plans.length); setDraft(next); setSelectedId(next.id); }}><CopyPlus size={16} /> Add review round</button>
      </div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {loading && <p className="muted">Loading evaluation rounds…</p>}
      {!loading && !plans.length && !draft && <EmptyState title="No evaluation rounds" detail="Create Initial Review, then add a distinct final committee round." action={<button type="button" className="button button--primary" onClick={() => { const next = newRound(0); setDraft(next); setSelectedId(next.id); }}>Create Initial Review</button>} />}
      {!!plans.length && (
        <div className="evaluation-round-strip" role="tablist" aria-label="Evaluation rounds">
          {plans.map((plan) => <button key={plan.id} role="tab" aria-selected={selectedId === plan.id} type="button" onClick={() => selectPlan(plan)}><span>Round {plan.round}</span><strong>{plan.name}</strong><small><CalendarRange size={13} /> {plan.opensAt ? new Date(plan.opensAt).toLocaleDateString() : "No open date"} – {plan.closesAt ? new Date(plan.closesAt).toLocaleDateString() : "No close date"}</small><em>{plan.rubric.map((criterion) => criterion.label).join(" · ")}</em></button>)}
        </div>
      )}
      {draft && (
        <div className="evaluation-studio__editor">
          <div className="evaluation-studio__title-row"><div><span>Round {draft.round}</span><h4>{draft.name || "Untitled round"}</h4></div><StatusPill status={draft.status} /></div>
          <div className="field-grid field-grid--2">
            <Field label="Round name"><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></Field>
            <Field label="Review availability"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as ReviewPlanDefinition["status"] })}><option value="draft">Draft · configuring</option><option value="active">Open for review</option><option value="closed">Closed</option></select></Field>
            <Field label="Opens"><input type="datetime-local" value={localDateTime(draft.opensAt)} onChange={(event) => setDraft({ ...draft, opensAt: isoDateTime(event.target.value) })} /></Field>
            <Field label="Closes"><input type="datetime-local" value={localDateTime(draft.closesAt)} onChange={(event) => setDraft({ ...draft, closesAt: isoDateTime(event.target.value) })} /></Field>
          </div>
          <label className="blind-review-switch"><input type="checkbox" checked={Boolean(draft.anonymized)} onChange={(event) => setDraft({ ...draft, anonymized: event.target.checked })} /><EyeOff size={18} /><span><strong>Blind reviewer view</strong><small>Hide presenter names, companies, bios, and headshots from reviewers in this round. Organizers retain full identity context.</small></span></label>
          {locked && <InlineAlert tone="info"><strong>Submitted evidence is locked.</strong> {draft.submittedReviews} final review{draft.submittedReviews === 1 ? "" : "s"} use this scorecard. Dates, availability, and pool can still be managed without rewriting those responses.</InlineAlert>}
          <section className="evaluation-scorecard" aria-labelledby="scorecard-title">
            <div className="section-heading"><div><p className="eyebrow">Typed scorecard</p><h4 id="scorecard-title">What reviewers must answer</h4></div><span>{totalWeight} numeric weight</span></div>
            {draft.rubric.map((criterion, index) => (
              <article key={criterion.id}>
                <span className="evaluation-scorecard__index">{String(index + 1).padStart(2, "0")}</span>
                <div className="evaluation-scorecard__copy"><input disabled={locked} aria-label={`Criterion ${index + 1} name`} value={criterion.label} onChange={(event) => updateCriterion(criterion.id, { label: event.target.value })} /><input disabled={locked} aria-label={`${criterion.label} guidance`} placeholder="Reviewer guidance" value={criterion.description ?? ""} onChange={(event) => updateCriterion(criterion.id, { description: event.target.value })} /></div>
                <label><span>Answer type</span><select disabled={locked} value={criterion.type ?? "numeric"} onChange={(event) => updateCriterion(criterion.id, { type: event.target.value as ReviewRubricCriterion["type"], ...(event.target.value === "dropdown" && !criterion.options?.length ? { options: ["Accept", "Maybe", "Reject"] } : {}) })}><option value="numeric">Numeric rating</option><option value="dropdown">Dropdown</option><option value="text">Long text</option></select></label>
                {(criterion.type ?? "numeric") === "numeric" && <><label><span>Weight</span><input disabled={locked} type="number" min={1} max={1000} value={criterion.weight} onChange={(event) => updateCriterion(criterion.id, { weight: Number(event.target.value) })} /></label><label><span>Scale</span><select disabled={locked} value={criterion.maxScore} onChange={(event) => updateCriterion(criterion.id, { maxScore: Number(event.target.value) })}>{[3, 5, 10, 20].map((value) => <option key={value} value={value}>1–{value}</option>)}</select></label></>}
                {criterion.type === "dropdown" && <label className="evaluation-scorecard__options"><span>Options</span><input disabled={locked} value={(criterion.options ?? []).join(", ")} onChange={(event) => updateCriterion(criterion.id, { options: event.target.value.split(",").map((option) => option.trim()).filter(Boolean) })} /></label>}
                <button type="button" className="icon-button icon-button--danger" disabled={locked || draft.rubric.length === 1} aria-label={`Remove ${criterion.label}`} onClick={() => setDraft({ ...draft, rubric: draft.rubric.filter((candidate) => candidate.id !== criterion.id) })}><Trash2 size={15} /></button>
              </article>
            ))}
            <button type="button" className="button button--quiet" disabled={locked || draft.rubric.length >= 12} onClick={() => setDraft({ ...draft, rubric: [...draft.rubric, { id: `criterion-${crypto.randomUUID()}`, label: "New criterion", type: "numeric", description: "", weight: 1, maxScore: 5, required: true }] })}><Plus size={15} /> Add criterion</button>
          </section>
          <section className="evaluation-pool" aria-labelledby="reviewer-pool-title">
            <div className="section-heading"><div><p className="eyebrow">Round-specific pool</p><h4 id="reviewer-pool-title"><UsersRound size={18} /> Reviewers and caps</h4><p>Membership here applies only to {draft.name || "this round"}. Add different people to later rounds.</p></div><span>{draft.reviewerIds?.length ?? 0} in pool</span></div>
            {reviewers.length ? reviewers.map((reviewer) => {
              const selected = draft.reviewerIds?.includes(reviewer.id) ?? false;
              return <div className="evaluation-pool__reviewer" key={reviewer.id}><label><input type="checkbox" checked={selected} onChange={(event) => setDraft({ ...draft, reviewerIds: event.target.checked ? [...(draft.reviewerIds ?? []), reviewer.id] : (draft.reviewerIds ?? []).filter((id) => id !== reviewer.id) })} /><span><strong>{reviewer.name}</strong><small>{reviewer.email}</small></span></label><Field label="Assignment cap"><input type="number" min={1} max={500} disabled={!selected} value={draft.reviewerCaps?.[reviewer.id] ?? 25} onChange={(event) => setDraft({ ...draft, reviewerCaps: { ...(draft.reviewerCaps ?? {}), [reviewer.id]: Number(event.target.value) } })} /></Field></div>;
            }) : <p className="muted">Accepted reviewer invitations will appear here. Invite reviewers from the Control Room first.</p>}
          </section>
          <div className="evaluation-studio__actions"><p>Saving this round does not auto-decide any proposal. Human scores and organizer dispositions remain separate.</p><span><button type="button" className="button button--quiet" disabled={saving || locked} onClick={() => void remove()}><Trash2 size={15} /> {draft.id.startsWith("new-") ? "Discard" : "Delete round"}</button><button type="button" className="button button--primary" disabled={saving || !draft.name.trim() || draft.rubric.some((criterion) => !criterion.label.trim() || (criterion.type === "dropdown" && (criterion.options?.length ?? 0) < 2))} onClick={() => void save()}><Save size={15} /> {saving ? "Saving round…" : "Save review round"}</button></span></div>
        </div>
      )}
    </section>
  );
}
