import { ArrowDownAZ, ArrowUpAZ, Bot, Download, Mail, Save, Sparkles, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { Proposal, ReviewPlanDefinition } from "../shared/domain";
import { abstractReviewApi, type AbstractReviewOverview, type AiProposalEvaluation } from "./abstract-review-api";
import { EmptyState, Field, InlineAlert, StatusPill } from "./components";
import { useWorkspace } from "./workspace";

type ScoreOrder = "desc" | "asc";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = fileName; anchor.click();
  URL.revokeObjectURL(url);
}

function AiEvaluationCard({ proposal, round, evaluation, onChanged }: { proposal: Proposal; round: ReviewPlanDefinition; evaluation?: AiProposalEvaluation; onChanged: (evaluation: AiProposalEvaluation) => void }) {
  const { workspace, setNotice } = useWorkspace();
  const [working, setWorking] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [score, setScore] = useState(evaluation?.effectiveScore ?? 3);
  const [reason, setReason] = useState("");
  useEffect(() => { if (evaluation) setScore(evaluation.effectiveScore); }, [evaluation]);
  const run = async () => {
    setWorking(true);
    try { const next = await abstractReviewApi.evaluate(workspace.actor.id, workspace.event.id, proposal.id, round.id); onChanged(next); setNotice(`Bounded AI triage created for ${proposal.title}. It remains separate from human reviews.`); }
    finally { setWorking(false); }
  };
  const override = async () => {
    if (!evaluation || reason.trim().length < 3) return;
    setWorking(true);
    try { const next = await abstractReviewApi.override(workspace.actor.id, workspace.event.id, evaluation.id, Number(score), reason.trim()); onChanged({ ...evaluation, ...next }); setOverrideOpen(false); setNotice(`Organizer override saved at ${Number(score).toFixed(1)}/5 with its reason.`); }
    finally { setWorking(false); }
  };
  return (
    <article className="ai-evaluation-card">
      <header><div><Bot size={17} /><span><strong>AI triage · human-controlled</strong><small>{evaluation?.modelLabel ?? "No first pass yet"}</small></span></div>{evaluation && <span className="ai-evaluation-card__score">{evaluation.effectiveScore.toFixed(1)}<small>/ 5</small></span>}</header>
      {evaluation ? <><p>{evaluation.rationale}</p>{evaluation.overriddenScore !== undefined && <InlineAlert tone="info"><strong>Organizer override: {evaluation.overriddenScore.toFixed(1)}/5.</strong> {evaluation.overrideReason}</InlineAlert>}<div className="ai-evaluation-card__actions"><button type="button" className="button button--quiet" disabled={working} onClick={() => void run()}><Sparkles size={14} /> Re-run bounded pass</button><button type="button" className="button button--quiet" onClick={() => setOverrideOpen(!overrideOpen)}>Override AI signal</button></div>{overrideOpen && <div className="ai-evaluation-card__override"><Field label="Human score"><input type="number" min={1} max={5} step={0.1} value={score} onChange={(event) => setScore(Number(event.target.value))} /></Field><Field label="Override reason"><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Specific organizer judgment" /></Field><button type="button" className="button button--primary" disabled={working || reason.trim().length < 3} onClick={() => void override()}>Save override</button></div>}</> : <><p>Run a bounded, proposal-grounded first pass. It cites the submission, never contacts a speaker, and cannot change a decision.</p><button type="button" className="button button--quiet" disabled={working} onClick={() => void run()}><Sparkles size={14} /> {working ? "Evaluating…" : "Run AI triage"}</button></>}
    </article>
  );
}

export function AbstractReviewControl() {
  const { workspace, setNotice } = useWorkspace();
  const [plans, setPlans] = useState<ReviewPlanDefinition[]>([]);
  const [overview, setOverview] = useState<AbstractReviewOverview>({ reviewers: [], assignments: [], aiEvaluations: [], results: [] });
  const [roundId, setRoundId] = useState("");
  const [reviewerId, setReviewerId] = useState("");
  const [category, setCategory] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [cap, setCap] = useState(25);
  const [reminderIds, setReminderIds] = useState<string[]>([]);
  const [scoreOrder, setScoreOrder] = useState<ScoreOrder>("desc");
  const [aiProposalId, setAiProposalId] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      const [{ plans: nextPlans }, nextOverview] = await Promise.all([
        abstractReviewApi.plans(workspace.actor.id, workspace.event.id),
        abstractReviewApi.overview(workspace.actor.id, workspace.event.id),
      ]);
      setPlans(nextPlans); setOverview(nextOverview);
      setRoundId((current) => current || nextPlans.find((plan) => plan.status === "active")?.id || nextPlans[0]?.id || "");
      setReviewerId((current) => current || nextOverview.reviewers[0]?.id || "");
      setAiProposalId((current) => current || workspace.proposals[0]?.id || "");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review operations could not be loaded."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [workspace.actor.id, workspace.event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const round = plans.find((plan) => plan.id === roundId);
  const reviewers = overview.reviewers.filter((reviewer) => round?.reviewerIds?.includes(reviewer.id));
  useEffect(() => {
    if (!roundId || !reviewerId) return;
    const assigned = overview.assignments.filter((assignment) => assignment.roundId === roundId && assignment.reviewerId === reviewerId && !assignment.recusedAt).map((assignment) => assignment.proposalId);
    setSelected(assigned);
    setCap(round?.reviewerCaps?.[reviewerId] ?? 25);
  }, [roundId, reviewerId, overview.assignments, round]);

  const reviewable = workspace.proposals.filter((proposal) => ["submitted", "under_review"].includes(proposal.status));
  const categories = [...new Set(reviewable.map((proposal) => proposal.category))];
  const visible = category === "all" ? reviewable : reviewable.filter((proposal) => proposal.category === category);
  const progress = reviewers.map((reviewer) => {
    const assignments = overview.assignments.filter((assignment) => assignment.roundId === roundId && assignment.reviewerId === reviewer.id && !assignment.recusedAt);
    return { reviewer, total: assignments.length, completed: assignments.filter((assignment) => assignment.status === "submitted").length, outstanding: assignments.filter((assignment) => assignment.status !== "submitted").length };
  });
  const resultByProposal = new Map(overview.results.filter((result) => result.roundId === roundId).map((result) => [result.proposalId, result]));
  const sorted = [...workspace.proposals].sort((left, right) => scoreOrder === "desc" ? (resultByProposal.get(right.id)?.aggregateScore ?? -1) - (resultByProposal.get(left.id)?.aggregateScore ?? -1) : (resultByProposal.get(left.id)?.aggregateScore ?? Number.MAX_SAFE_INTEGER) - (resultByProposal.get(right.id)?.aggregateScore ?? Number.MAX_SAFE_INTEGER));
  const aiProposal = workspace.proposals.find((proposal) => proposal.id === aiProposalId);
  const aiEvaluation = overview.aiEvaluations.find((evaluation) => evaluation.proposalId === aiProposalId && evaluation.roundId === roundId);
  const updateAiEvaluation = (next: AiProposalEvaluation) => setOverview((current) => ({
    ...current,
    aiEvaluations: [...current.aiEvaluations.filter((evaluation) => evaluation.id !== next.id && !(evaluation.proposalId === next.proposalId && evaluation.roundId === next.roundId)), next],
  }));

  const assign = async () => {
    if (!roundId || !reviewerId) return;
    setWorking(true); setError(null);
    try { const result = await abstractReviewApi.assign(workspace.actor.id, workspace.event.id, { roundId, reviewerId, proposalIds: selected, assignmentCap: cap }); await load(); setNotice(`${result.assigned} submissions assigned within a cap of ${result.assignmentCap}.`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Assignments could not be saved."); }
    finally { setWorking(false); }
  };
  const remind = async () => {
    if (!roundId || !reminderIds.length) return;
    setWorking(true); setError(null);
    try { const result = await abstractReviewApi.remind(workspace.actor.id, workspace.event.id, roundId, reminderIds); setReminderIds([]); setNotice(`${result.queued} reviewer reminder${result.queued === 1 ? "" : "s"} safely queued for delivery.`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Reminders could not be queued."); }
    finally { setWorking(false); }
  };
  const exportResults = async () => {
    setWorking(true); setError(null);
    try { const result = await abstractReviewApi.downloadReviews(workspace.actor.id, workspace.event.id); downloadBlob(result.blob, result.fileName); setNotice(`${result.fileName} downloaded with review statuses and criterion responses.`); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Review results could not be exported."); }
    finally { setWorking(false); }
  };

  if (loading) return <section className="abstract-review-control"><p className="muted">Loading assignment and progress controls…</p></section>;
  return (
    <section className="abstract-review-control" aria-labelledby="abstract-review-control-title">
      <div className="abstract-review-control__head"><div><p className="eyebrow">Review command center</p><h2 id="abstract-review-control-title">Assign, monitor, and compare the committee.</h2><p>Target exact submissions, keep per-round pools isolated, and act on live completion evidence.</p></div><button type="button" className="button button--quiet" disabled={working} onClick={() => void exportResults()}><Download size={16} /> Export review results CSV</button></div>
      {error && <InlineAlert tone="danger">{error}</InlineAlert>}
      {!plans.length ? <EmptyState title="No evaluation round" detail="Create a dated review round in Program settings before assigning submissions." /> : <>
        <div className="review-ops-switcher"><Field label="Review round"><select value={roundId} onChange={(event) => { setRoundId(event.target.value); setReviewerId(""); }} >{plans.map((plan) => <option key={plan.id} value={plan.id}>Round {plan.round} · {plan.name}</option>)}</select></Field><div className="review-ops-switcher__contract"><StatusPill status={round?.status ?? "draft"} /><span>{round?.anonymized ? "Blind reviewer view" : "Presenter identity visible"}</span><small>{round?.opensAt ? new Date(round.opensAt).toLocaleDateString() : "No open date"} – {round?.closesAt ? new Date(round.closesAt).toLocaleDateString() : "No close date"}</small></div></div>
        <div className="review-ops-grid">
          <section className="assignment-matrix" aria-labelledby="assignment-title"><div className="section-heading"><div><p className="eyebrow">Exact assignment</p><h3 id="assignment-title"><UsersRound size={18} /> Reviewer queue builder</h3></div><span>{selected.length}/{cap} selected</span></div>
            {reviewers.length ? <><div className="assignment-matrix__controls"><Field label="Reviewer"><select value={reviewerId} onChange={(event) => setReviewerId(event.target.value)}><option value="">Choose reviewer…</option>{reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.name}</option>)}</select></Field><Field label="Per-reviewer cap"><input type="number" min={1} max={500} value={cap} onChange={(event) => setCap(Number(event.target.value))} /></Field><Field label="Track filter"><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All tracks</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></Field><button type="button" className="button button--quiet" onClick={() => setSelected([...new Set([...selected, ...visible.map((proposal) => proposal.id)])].slice(0, cap))}>Select visible track</button></div>
              <div className="assignment-list">{visible.map((proposal) => <label key={proposal.id}><input type="checkbox" checked={selected.includes(proposal.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, proposal.id].slice(0, cap) : selected.filter((id) => id !== proposal.id))} /><span><strong>{proposal.title}</strong><small>{proposal.category} · {proposal.format}</small></span><StatusPill status={proposal.status} /></label>)}</div>
              <button type="button" className="button button--primary" disabled={working || !reviewerId || selected.length > cap} onClick={() => void assign()}><Save size={15} /> {working ? "Saving queue…" : `Save ${selected.length} assignments`}</button></> : <EmptyState title="This round has no reviewer pool" detail="Add reviewers to this specific round in Program settings." />}
          </section>
          <section className="review-progress" aria-labelledby="review-progress-title"><div className="section-heading"><div><p className="eyebrow">Live progress</p><h3 id="review-progress-title">Committee completion</h3></div><span>{progress.reduce((sum, item) => sum + item.completed, 0)}/{progress.reduce((sum, item) => sum + item.total, 0)} complete</span></div>
            {progress.length ? <><div className="review-progress__list">{progress.map((item) => { const percent = item.total ? Math.round((item.completed / item.total) * 100) : 0; return <article key={item.reviewer.id}><label><input type="checkbox" disabled={!item.outstanding} checked={reminderIds.includes(item.reviewer.id)} onChange={(event) => setReminderIds(event.target.checked ? [...reminderIds, item.reviewer.id] : reminderIds.filter((id) => id !== item.reviewer.id))} /><span><strong>{item.reviewer.name}</strong><small>{item.completed} of {item.total} complete · {item.outstanding} outstanding</small></span></label><div className="review-progress__meter"><span style={{ width: `${percent}%` }} /><em>{percent}%</em></div></article>; })}</div><button type="button" className="button button--quiet" disabled={working || !reminderIds.length} onClick={() => void remind()}><Mail size={15} /> Send reminder to {reminderIds.length || "selected"}</button></> : <p className="muted">Add reviewers and assignments to establish the completion baseline.</p>}
          </section>
        </div>
        <section className="review-results" aria-labelledby="review-results-title"><div className="section-heading"><div><p className="eyebrow">Decision evidence</p><h3 id="review-results-title">Aggregate results</h3><p>Weighted human averages drive this sortable table. AI triage stays separately attributed.</p></div><button type="button" className="button button--quiet" onClick={() => setScoreOrder(scoreOrder === "desc" ? "asc" : "desc")}>{scoreOrder === "desc" ? <ArrowDownAZ size={15} /> : <ArrowUpAZ size={15} />} Score {scoreOrder === "desc" ? "high to low" : "low to high"}</button></div>
          <div className="review-results__table"><table className="data-table"><thead><tr><th>Proposal</th><th>Track</th><th>Human aggregate</th><th>Reviews</th><th>State</th></tr></thead><tbody>{sorted.map((proposal) => { const result = resultByProposal.get(proposal.id); return <tr key={proposal.id}><td><strong>{proposal.title}</strong><small>{proposal.speakers.map((speaker) => `${speaker.name} · ${speaker.participantRole ?? "Presenter"}`).join(", ")}</small></td><td>{proposal.category}</td><td>{result === undefined ? "—" : <strong>{result.aggregateScore.toFixed(2)} / 5 <small>weighted · {round?.name}</small></strong>}</td><td>{result?.reviewCount ?? 0}</td><td><StatusPill status={proposal.status} /></td></tr>; })}</tbody></table></div>
        </section>
        {round && <section className="ai-triage" aria-labelledby="ai-triage-title"><div className="section-heading"><div><p className="eyebrow">Bounded proposal assistant</p><h3 id="ai-triage-title">Grounded first-pass triage</h3></div><Field label="Proposal"><select value={aiProposalId} onChange={(event) => setAiProposalId(event.target.value)}>{workspace.proposals.map((proposal) => <option key={proposal.id} value={proposal.id}>{proposal.title}</option>)}</select></Field></div>{aiProposal && <AiEvaluationCard proposal={aiProposal} round={round} evaluation={aiEvaluation} onChanged={updateAiEvaluation} />}</section>}
      </>}
    </section>
  );
}
