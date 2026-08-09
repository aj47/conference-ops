import type { ReviewRubricCriterion } from "../shared/domain";
import { spreadsheetSafeCsvCell } from "../shared/csv";

export interface BoundedEvaluationInput {
  title: string;
  summary: string;
  category: string;
  rubric: ReviewRubricCriterion[];
}

function contentTerms(value: string) {
  return [...new Set(value.toLocaleLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? [])]
    .filter((term) => !["that", "this", "with", "from", "into", "your", "will", "have", "more", "than"].includes(term));
}

/**
 * A deliberately bounded, explainable first pass. It never changes a human
 * review or disposition and cites only text in the proposal itself.
 */
export function boundedProposalEvaluation(input: BoundedEvaluationInput) {
  const summaryWords = input.summary.trim().split(/\s+/).filter(Boolean).length;
  const specificityTerms = contentTerms(`${input.title} ${input.summary}`).slice(0, 4);
  const numericCriteria = input.rubric.filter((criterion) => (criterion.type ?? "numeric") === "numeric");
  const completeness = Math.min(1, summaryWords / 80);
  const specificity = Math.min(1, specificityTerms.length / 4);
  const score = Math.max(1, Math.min(5, Math.round((2.3 + completeness * 1.4 + specificity * 1.3) * 10) / 10));
  const criterionNames = numericCriteria.slice(0, 3).map((criterion) => criterion.label).join(", ") || "the configured scorecard";
  const citedTerms = specificityTerms.length ? specificityTerms.join(", ") : input.category;
  return {
    score,
    rationale: `Bounded first-pass for ${input.category}: the abstract is ${summaryWords} words and gives concrete signals around ${citedTerms}. Against ${criterionNames}, it merits ${score.toFixed(1)}/5 as a triage proposal. A program chair must review the full submission and may override this signal; it never changes disposition automatically.`,
    modelLabel: "Conference Ops bounded evaluator v1",
  };
}

export interface ReviewExportRow {
  proposalId: string;
  title: string;
  category: string;
  round: string;
  reviewer: string;
  status: string;
  aggregateScore?: number;
  responses: Record<string, unknown>;
  recommendation?: string;
  notes?: string;
}

export function reviewResultsCsv(rows: ReviewExportRow[]) {
  const criterionIds = [...new Set(rows.flatMap((row) => Object.keys(row.responses)))].sort();
  const header = ["proposal_id", "title", "category", "round", "reviewer", "status", "aggregate_score", ...criterionIds, "recommendation", "notes"];
  return [
    header.map(spreadsheetSafeCsvCell).join(","),
    ...rows.map((row) => [
      row.proposalId,
      row.title,
      row.category,
      row.round,
      row.reviewer,
      row.status,
      row.aggregateScore,
      ...criterionIds.map((id) => row.responses[id]),
      row.recommendation,
      row.notes,
    ].map(spreadsheetSafeCsvCell).join(",")),
  ].join("\r\n");
}
