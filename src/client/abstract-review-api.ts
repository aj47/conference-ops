import type { Actor, ReviewPlanDefinition } from "../shared/domain";

export interface AbstractReviewAssignment {
  id: string;
  proposalId: string;
  roundId: string;
  reviewerId: string;
  reviewerName: string;
  status: "pending" | "in_progress" | "submitted";
  recusedAt?: string;
  recusalReason?: string;
}

export interface AiProposalEvaluation {
  id: string;
  proposalId: string;
  roundId: string;
  score: number;
  effectiveScore: number;
  rationale: string;
  modelLabel: string;
  overriddenScore?: number;
  overrideReason?: string;
  overriddenAt?: string;
}

export interface AbstractReviewOverview {
  reviewers: Actor[];
  assignments: AbstractReviewAssignment[];
  aiEvaluations: AiProposalEvaluation[];
  results: Array<{ proposalId: string; roundId: string; aggregateScore: number; reviewCount: number }>;
}

export type ReviewPlanDraft = Pick<ReviewPlanDefinition, "name" | "status" | "rubric" | "opensAt" | "closesAt" | "anonymized" | "reviewerIds" | "reviewerCaps">;

async function request<T>(path: string, actorId: string, role: Actor["role"], init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-demo-actor": actorId,
      "x-event-role": role,
      ...init?.headers,
    },
  });
  const payload = await response.json() as { data?: T; error?: { message?: string } };
  if (!response.ok || payload.error || payload.data === undefined) throw new Error(payload.error?.message ?? "The review workflow could not be updated.");
  return payload.data;
}

function eventPath(eventId: string, suffix: string) {
  return `/api/v1/events/${encodeURIComponent(eventId)}${suffix}`;
}

export const abstractReviewApi = {
  plans(actorId: string, eventId: string) {
    return request<{ plans: ReviewPlanDefinition[] }>(eventPath(eventId, "/review-plans"), actorId, "organizer");
  },
  createPlan(actorId: string, eventId: string, payload: ReviewPlanDraft) {
    return request<ReviewPlanDefinition>(eventPath(eventId, "/review-plans"), actorId, "organizer", { method: "POST", body: JSON.stringify(payload) });
  },
  updatePlan(actorId: string, eventId: string, planId: string, payload: ReviewPlanDraft) {
    return request<ReviewPlanDefinition>(eventPath(eventId, `/review-plans/${encodeURIComponent(planId)}`), actorId, "organizer", { method: "PUT", body: JSON.stringify(payload) });
  },
  deletePlan(actorId: string, eventId: string, planId: string) {
    return request<{ id: string; deleted: true }>(eventPath(eventId, `/review-plans/${encodeURIComponent(planId)}`), actorId, "organizer", { method: "DELETE" });
  },
  overview(actorId: string, eventId: string) {
    return request<AbstractReviewOverview>(eventPath(eventId, "/abstract-review"), actorId, "organizer");
  },
  assign(actorId: string, eventId: string, payload: { roundId: string; reviewerId: string; proposalIds: string[]; assignmentCap: number }) {
    return request<{ assigned: number; assignmentCap: number }>(eventPath(eventId, "/abstract-review/assignments"), actorId, "organizer", { method: "PUT", body: JSON.stringify(payload) });
  },
  remind(actorId: string, eventId: string, roundId: string, reviewerIds: string[]) {
    return request<{ queued: number; dispatched: number }>(eventPath(eventId, "/abstract-review/reminders"), actorId, "organizer", { method: "POST", body: JSON.stringify({ roundId, reviewerIds }) });
  },
  evaluate(actorId: string, eventId: string, proposalId: string, roundId: string) {
    return request<AiProposalEvaluation>(eventPath(eventId, `/proposals/${encodeURIComponent(proposalId)}/ai-evaluation`), actorId, "organizer", { method: "POST", body: JSON.stringify({ roundId }) });
  },
  override(actorId: string, eventId: string, evaluationId: string, score: number, reason: string) {
    return request<Partial<AiProposalEvaluation> & { id: string; effectiveScore: number }>(eventPath(eventId, `/ai-evaluations/${encodeURIComponent(evaluationId)}/override`), actorId, "organizer", { method: "PUT", body: JSON.stringify({ score, reason }) });
  },
  recuse(actorId: string, eventId: string, proposalId: string, reason: string) {
    return request<{ proposalId: string; recused: true; reason: string }>(eventPath(eventId, `/proposals/${encodeURIComponent(proposalId)}/review/recuse`), actorId, "reviewer", { method: "POST", body: JSON.stringify({ reason }) });
  },
  async downloadReviews(actorId: string, eventId: string) {
    const response = await fetch(eventPath(eventId, "/exports/reviews.csv"), { headers: { "x-demo-actor": actorId, "x-event-role": "organizer" } });
    if (!response.ok) throw new Error("The review results export could not be downloaded.");
    return { blob: await response.blob(), fileName: "review-results.csv" };
  },
};
