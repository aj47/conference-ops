import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleDot,
  Filter,
  MessageSquareQuote,
  Search,
  ShieldCheck,
  Star,
  UserRoundCheck,
} from "lucide-react";
import { useState } from "react";
import type { Proposal, ProposalStatus, ReviewAssignment } from "../../shared/domain";
import { evaluateReviewScores, ReviewRubricError } from "../../shared/review-rubric";
import { Avatar, EmptyState, Field, InlineAlert, PageHeader, SectionHeading, StatusPill } from "../components";
import { FormResponseList } from "../FormResponseList";
import { reviewerAssignmentQueue } from "../reviewer-queue";
import { useWorkspace } from "../workspace";

const statusOptions: Array<{ label: string; value: "all" | ProposalStatus }> = [
  { label: "All states", value: "all" },
  { label: "Needs review", value: "under_review" },
  { label: "Submitted", value: "submitted" },
  { label: "Accept queue", value: "accept_queue" },
  { label: "Accepted", value: "accepted" },
  { label: "Waitlisted", value: "waitlisted" },
  { label: "Decline queue", value: "decline_queue" },
  { label: "Rejected", value: "rejected" },
  { label: "Withdrawn", value: "withdrawn" },
  { label: "Draft", value: "draft" },
  { label: "Program session", value: "session" },
];

function ProposalFacts({ proposal }: { proposal: Proposal }) {
  return (
    <dl className="proposal-facts">
      <div><dt>Format</dt><dd>{proposal.format}</dd></div>
      <div><dt>Level</dt><dd>{proposal.level}</dd></div>
      <div><dt>Length</dt><dd>{proposal.durationMinutes} min</dd></div>
      <div><dt>Reviews</dt><dd>{proposal.reviewCount}</dd></div>
      <div><dt>Committee</dt><dd>{proposal.reviewerGroup}</dd></div>
      <div><dt>Average</dt><dd>{proposal.score ? `${proposal.score.toFixed(1)} / 5` : "—"}</dd></div>
    </dl>
  );
}

function ProposalDetail({ proposal }: { proposal: Proposal }) {
  const { workspace, decideProposal, convertProposalToSession } = useWorkspace();
  const [decisionNote, setDecisionNote] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [stageChoice, setStageChoice] = useState<"accept_queue" | "decline_queue" | null>(null);
  const hasSession = workspace.sessions.some((session) => session.proposalId === proposal.id);

  const commitDecision = async (
    status: "accept_queue" | "accepted" | "decline_queue" | "rejected" | "waitlisted",
  ) => {
    setPending(status);
    try {
      await decideProposal(proposal.id, status, decisionNote.trim() || undefined);
      setStageChoice(null);
      setDecisionNote("");
    } finally {
      setPending(null);
    }
  };

  return (
    <aside className="proposal-detail" aria-label={`Details for ${proposal.title}`}>
      <div className="proposal-detail__head"><div><p className="eyebrow">{proposal.id.toUpperCase()}</p><h2>{proposal.title}</h2></div><StatusPill status={proposal.status} /></div>
      <div className="speaker-line">{proposal.speakers.map((speaker) => <span key={speaker.id}><Avatar name={speaker.name} size="sm" /><span><strong>{speaker.name}</strong><small>{speaker.title} · {speaker.company}</small></span></span>)}</div>
      <p className="proposal-summary">{proposal.summary}</p>
      <div className="tag-list">{proposal.tags.map((tag) => <span key={tag}>{tag}</span>)}<span>{proposal.category}</span></div>
      <FormResponseList responses={proposal.customResponses} />
      <ProposalFacts proposal={proposal} />
      <section className="evidence-note"><MessageSquareQuote size={18} /><div><strong>Program evidence</strong><p>{proposal.score && proposal.score >= 4.5 ? "Strong committee signal. Confirm that the promised artifact or demonstration is specific enough for the agenda copy." : "Reviewers need a concrete failure story, proof point, or demo before this is ready for a final decision."}</p></div></section>
      {workspace.actor.role === "organizer" ? (
        <div className="decision-block">
          {stageChoice ? (
            <div className="decision-stage-editor">
              <InlineAlert tone={stageChoice === "accept_queue" ? "info" : "warning"}>
                Stage for {stageChoice === "accept_queue" ? "acceptance" : "decline"}. This is an internal queue move, not the final applicant decision.
              </InlineAlert>
              <Field label="Queue note" hint="Internal and included in the audit log"><textarea rows={3} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="What should the final decision maker know?" /></Field>
              <div className="decision-actions">
                <button type="button" className="button button--quiet" disabled={Boolean(pending)} onClick={() => { setStageChoice(null); setDecisionNote(""); }}>Cancel</button>
                <button type="button" className="button button--primary" disabled={Boolean(pending)} onClick={() => void commitDecision(stageChoice)}><Check size={15} /> {pending ? "Saving…" : "Save queue move"}</button>
              </div>
            </div>
          ) : proposal.status === "accepted" || proposal.status === "session" ? (
            <div className="decision-stage-editor">
              <InlineAlert tone="info">The final acceptance is recorded. Create one unscheduled program session, then place it on the call sheet.</InlineAlert>
              <button type="button" className="button button--positive button--full" disabled={hasSession || proposal.status === "session" || Boolean(pending)} onClick={async () => { setPending("convert"); try { await convertProposalToSession(proposal.id); } finally { setPending(null); } }}><Check size={15} /> {hasSession || proposal.status === "session" ? "Program session created" : pending === "convert" ? "Creating…" : "Create program session"}</button>
            </div>
          ) : proposal.status === "accept_queue" ? (
            <div className="decision-stage-editor">
              <InlineAlert tone="info"><strong>Acceptance queue.</strong> Final approval creates the speaker onboarding tasks. Queue the acceptance email from Publish after reviewing the audience; creating the session remains a separate action.</InlineAlert>
              <Field label="Final decision note" hint="Internal audit context"><textarea rows={3} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} /></Field>
              <div className="decision-actions"><button type="button" className="button button--quiet" onClick={() => setStageChoice("decline_queue")}>Move to decline queue</button><button type="button" className="button button--positive" disabled={Boolean(pending)} onClick={() => void commitDecision("accepted")}><Check size={15} /> Confirm acceptance</button></div>
            </div>
          ) : proposal.status === "decline_queue" ? (
            <div className="decision-stage-editor">
              <InlineAlert tone="warning"><strong>Decline queue.</strong> Final rejection is distinct from this internal recommendation.</InlineAlert>
              <Field label="Final decision note" hint="Internal audit context"><textarea rows={3} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} /></Field>
              <div className="decision-actions"><button type="button" className="button button--quiet" onClick={() => setStageChoice("accept_queue")}>Move to accept queue</button><button type="button" className="button button--danger" disabled={Boolean(pending)} onClick={() => void commitDecision("rejected")}>Confirm decline</button></div>
            </div>
          ) : ["rejected", "withdrawn"].includes(proposal.status) ? (
            <InlineAlert tone="warning">This proposal is {proposal.status}. No queue action is available from this final state.</InlineAlert>
          ) : proposal.status === "draft" ? (
            <InlineAlert tone="info">This proposal is still an applicant draft. Decision actions become available only after submission.</InlineAlert>
          ) : proposal.status === "waitlisted" ? (
            <div className="decision-stage-editor">
              <p className="muted">This proposal remains pending. Move it into an acceptance or decline queue before recording a final decision.</p>
              <div className="decision-actions">
                <button type="button" className="button button--positive" disabled={Boolean(pending)} onClick={() => setStageChoice("accept_queue")}>Move to accept queue</button>
                <button type="button" className="button button--danger" disabled={Boolean(pending)} onClick={() => setStageChoice("decline_queue")}>Move to decline queue</button>
              </div>
            </div>
          ) : (
            <div className="decision-stage-editor">
              <p className="muted">Stage a recommendation for the final decision maker, or place the proposal on the waitlist now.</p>
              <div className="decision-actions">
                <button type="button" className="button button--positive" disabled={Boolean(pending)} onClick={() => setStageChoice("accept_queue")}>Move to accept queue</button>
                <button type="button" className="button button--quiet" disabled={Boolean(pending)} onClick={() => void commitDecision("waitlisted")}>Waitlist</button>
                <button type="button" className="button button--danger" disabled={Boolean(pending)} onClick={() => setStageChoice("decline_queue")}>Move to decline queue</button>
              </div>
            </div>
          )}
        </div>
      ) : <InlineAlert tone="info">Reviewer mode is intentionally decision-blind. Submit your rubric from the Review desk.</InlineAlert>}
    </aside>
  );
}

export function ProposalBoard() {
  const { workspace } = useWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ProposalStatus>("all");
  const [category, setCategory] = useState("all");
  const [selectedId, setSelectedId] = useState(workspace.proposals[0]?.id ?? "");
  const categories = [...new Set(workspace.proposals.map((proposal) => proposal.category))];
  const filtered = workspace.proposals.filter((proposal) => {
    const haystack = `${proposal.title} ${proposal.summary} ${proposal.speakers.map((speaker) => speaker.name).join(" ")} ${proposal.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) && (status === "all" || proposal.status === status) && (category === "all" || proposal.category === category);
  });
  const selected = workspace.proposals.find((proposal) => proposal.id === selectedId) ?? filtered[0];

  return (
    <>
      <PageHeader eyebrow="Program intake · Decision authority" title="Build a queue you can reason about." description="Search the promise, compare the evidence, then leave a decision another organizer can audit." actions={<button type="button" className="button button--quiet" disabled title="Assignment management is not available yet; reviewer groups assign new submissions automatically."><UserRoundCheck size={16} /> Assignments managed by groups</button>} />
      <div className="queue-toolbar">
        <label className="search-control"><Search size={16} /><input aria-label="Search proposals" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, speaker, or tag…" /></label>
        <label className="select-control"><Filter size={15} /><select aria-label="Filter proposals by status" value={status} onChange={(event) => setStatus(event.target.value as "all" | ProposalStatus)}>{statusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="select-control"><ChevronDown size={15} /><select aria-label="Filter proposals by category" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">All categories</option>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <span className="queue-toolbar__result">{filtered.length} of {workspace.proposals.length}</span>
      </div>
      <div className="proposal-layout">
        <section className="proposal-table-wrap" aria-label="Proposal queue">
          {filtered.length ? (
            <table className="data-table proposal-table">
              <thead><tr><th>Proposal</th><th>Lane</th><th>Signal</th><th>State</th></tr></thead>
              <tbody>{filtered.map((proposal) => (
                <tr key={proposal.id} className={selected?.id === proposal.id ? "selected" : ""}>
                  <td><button type="button" className="row-select" onClick={() => setSelectedId(proposal.id)}><span><strong>{proposal.title}</strong><small>{proposal.speakers.map((speaker) => speaker.name).join(", ")} · {proposal.format} · {proposal.durationMinutes}m</small></span><ArrowRight size={15} /></button></td>
                  <td><span className="table-category">{proposal.category}</span><small>{proposal.reviewerGroup}</small></td>
                  <td>{proposal.score ? <span className="score-cell"><Star size={14} /> {proposal.score.toFixed(1)}<small>{proposal.reviewCount} reviews</small></span> : <span className="muted">No signal</span>}</td>
                  <td><StatusPill status={proposal.status} /></td>
                </tr>
              ))}</tbody>
            </table>
          ) : <EmptyState title="No proposals match" detail="Clear one of the filters or search for a broader term." action={<button type="button" className="button button--quiet" onClick={() => { setQuery(""); setStatus("all"); setCategory("all"); }}>Clear filters</button>} />}
        </section>
        {selected && <ProposalDetail proposal={selected} />}
      </div>
    </>
  );
}

interface RubricState {
  scores: Record<string, number>;
  recommendation: "strong_yes" | "yes" | "maybe" | "no";
  notes: string;
}

function scorePreview(assignment: ReviewAssignment, scores: Record<string, number>) {
  try {
    return evaluateReviewScores(assignment.rubric, scores, false).totalScore;
  } catch {
    return undefined;
  }
}

function ReviewEditor({
  proposal,
  existing,
  onSaved,
}: {
  proposal: Proposal;
  existing: ReviewAssignment;
  onSaved: (proposalId: string, final: boolean) => Promise<void>;
}) {
  const [rubric, setRubric] = useState<RubricState>({
    scores: existing.scores,
    recommendation: existing.recommendation ?? "yes",
    notes: existing.notes ?? "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const { saveReview } = useWorkspace();
  const preview = scorePreview(existing, rubric.scores);
  const locked = existing.status === "submitted";

  const submit = async (final: boolean) => {
    if (locked) return;
    if (rubric.notes.trim().length < 10) { setError("Add at least 10 characters of evidence so the committee can use this review."); return; }
    try {
      evaluateReviewScores(existing.rubric, rubric.scores, final);
    } catch (reviewError) {
      setError(reviewError instanceof ReviewRubricError ? reviewError.message : "Review the rubric scores before saving.");
      return;
    }
    setSaving(true);
    try {
      await saveReview(proposal.id, { scores: rubric.scores, recommendation: rubric.recommendation, notes: rubric.notes.trim(), submit: final });
      await onSaved(proposal.id, final);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="review-canvas">
          <article className="review-brief">
            <div className="review-brief__meta"><span>{proposal.format} · {proposal.durationMinutes} min</span><span>{proposal.level}</span><span>{proposal.category}</span></div>
            <h2>{proposal.title}</h2>
            <p>{proposal.summary}</p>
            <div className="tag-list">{proposal.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
            <FormResponseList responses={proposal.customResponses} />
            <details><summary>Speaker context <ChevronDown size={15} /></summary>{proposal.speakers.map((speaker) => <div className="speaker-context" key={speaker.id}><Avatar name={speaker.name} /><div><strong>{speaker.name}</strong><span>{speaker.title} · {speaker.company}</span><p>{speaker.bio}</p></div></div>)}</details>
          </article>
          <form className="rubric" onSubmit={(event) => { event.preventDefault(); if (!locked) void submit(true); }}>
            <div className="rubric__head"><div><p className="eyebrow">{existing.roundName} · Round {existing.round}</p><h2>Your recommendation</h2></div><div className="rubric__score"><strong>{preview === undefined ? "—" : preview.toFixed(1)}</strong><span>/ 5</span></div></div>
            {locked && <InlineAlert tone="info">This review is submitted and read-only, so its evidence can no longer change.</InlineAlert>}
            {existing.rubric.length ? existing.rubric.map((criterion) => (
              <label className="rubric-row" key={criterion.id}>
                <span><strong>{criterion.label}</strong><small>{criterion.description ?? `Weight ${criterion.weight}`}</small></span>
                <select
                  aria-label={`${criterion.label} score`}
                  disabled={locked}
                  value={rubric.scores[criterion.id] ?? ""}
                  onChange={(event) => {
                    const scores = { ...rubric.scores };
                    if (event.target.value) scores[criterion.id] = Number(event.target.value);
                    else delete scores[criterion.id];
                    setRubric({ ...rubric, scores });
                    setError("");
                  }}
                >
                  <option value="">Choose…</option>
                  {Array.from({ length: criterion.maxScore }, (_, index) => index + 1).map((score) => <option key={score} value={score}>{score} / {criterion.maxScore}</option>)}
                </select>
              </label>
            )) : <InlineAlert tone="warning">This review round has no valid rubric. Ask an organizer to repair the round configuration before scoring.</InlineAlert>}
            <Field label="Recommendation"><select disabled={locked} value={rubric.recommendation} onChange={(event) => setRubric({ ...rubric, recommendation: event.target.value as RubricState["recommendation"] })}><option value="strong_yes">Strong yes</option><option value="yes">Yes</option><option value="maybe">Maybe</option><option value="no">No</option></select></Field>
            <Field label="Evidence note" error={error} hint="Private to the review committee"><textarea rows={6} readOnly={locked} value={rubric.notes} onChange={(event) => { setRubric({ ...rubric, notes: event.target.value }); setError(""); }} placeholder="Point to the specific promise, risk, or missing proof that shaped your score." /></Field>
            <div className="rubric__actions"><button type="button" className="button button--quiet" disabled={locked || saving || !existing.rubric.length} onClick={() => void submit(false)}>Save draft</button><button type="submit" className="button button--primary" disabled={locked || saving || !existing.rubric.length}><CircleDot size={15} /> {locked ? "Review submitted" : saving ? "Submitting…" : "Submit review"}</button></div>
          </form>
    </div>
  );
}

export function ReviewDesk() {
  const { workspace } = useWorkspace();
  const assignments = reviewerAssignmentQueue(workspace.proposals, workspace.reviews, workspace.actor.id);
  const [selectedId, setSelectedId] = useState(assignments[0]?.proposal.id ?? "");
  const selected = assignments.find((item) => item.proposal.id === selectedId) ?? assignments[0];

  const advanceAfterSave = async (proposalId: string, final: boolean) => {
    if (!final) return;
    const index = assignments.findIndex((item) => item.proposal.id === proposalId);
    const next = assignments.slice(index + 1).find((item) => item.review.status !== "submitted")
      ?? assignments.find((item) => item.proposal.id !== proposalId && item.review.status !== "submitted");
    if (next) setSelectedId(next.proposal.id);
  };

  const activeRound = selected?.review ?? assignments[0]?.review;

  return (
    <>
      <PageHeader eyebrow={activeRound ? `${activeRound.roundName} · Independent review` : "Independent review"} title="Score the evidence, not the résumé." description="Assignments stay scoped to your review lane. Organizer decisions remain separate from reviewer recommendations." actions={activeRound ? <div className="calibration-chip"><ShieldCheck size={15} /> Configured rubric · R{activeRound.round}</div> : undefined} />
      <div className="review-layout">
        <aside className="review-queue">
          <SectionHeading title="Your queue" description={`${assignments.length} assigned proposals`} />
          {assignments.map(({ proposal, review }, index) => <button type="button" key={review.id} onClick={() => setSelectedId(proposal.id)} className={selected?.proposal.id === proposal.id ? "review-queue__item selected" : "review-queue__item"}><span className="review-queue__number">{String(index + 1).padStart(2, "0")}</span><span><strong>{proposal.title}</strong><small>{proposal.category} · {proposal.format}</small></span><StatusPill status={review.status} /></button>)}
        </aside>
        {selected ? <ReviewEditor key={`${selected.review.id}:${selected.review.status}`} proposal={selected.proposal} existing={selected.review} onSaved={advanceAfterSave} /> : <EmptyState title="Your queue is clear" detail="New assignments will appear when an organizer opens the next review round." />}
      </div>
    </>
  );
}
