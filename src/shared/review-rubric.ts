import type { ReviewResponseValue, ReviewRubricCriterion } from "./domain";

export type { ReviewRubricCriterion } from "./domain";

export interface ReviewScoreEvaluation {
  scores: Record<string, ReviewResponseValue>;
  complete: boolean;
  totalScore?: number;
}

export class ReviewRubricError extends Error {
  code: "INVALID_RUBRIC" | "UNKNOWN_CRITERION" | "INVALID_SCORE" | "MISSING_SCORE";
  fieldErrors: Record<string, string>;

  constructor(
    code: ReviewRubricError["code"],
    message: string,
    fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = "ReviewRubricError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseReviewRubric(value: unknown): ReviewRubricCriterion[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      throw new ReviewRubricError("INVALID_RUBRIC", "The active review rubric is not valid JSON.");
    }
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ReviewRubricError("INVALID_RUBRIC", "The active review round needs at least one rubric criterion.");
  }

  const seen = new Set<string>();
  return parsed.map((candidate, index) => {
    if (!isPlainRecord(candidate)) {
      throw new ReviewRubricError("INVALID_RUBRIC", `Rubric criterion ${index + 1} is invalid.`);
    }
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const label = typeof candidate.label === "string" ? candidate.label.trim() : "";
    const configuredType = candidate.type === "numeric" || candidate.type === "dropdown" || candidate.type === "text" ? candidate.type : undefined;
    const type = configuredType ?? "numeric";
    const weight = Number(candidate.weight);
    const maxScore = type === "numeric" ? Number(candidate.maxScore) : Number(candidate.maxScore ?? 5);
    const options = type === "dropdown" && Array.isArray(candidate.options)
      ? candidate.options.filter((option): option is string => typeof option === "string").map((option) => option.trim()).filter(Boolean)
      : undefined;
    const configuredRequired = typeof candidate.required === "boolean" ? candidate.required : undefined;
    const required = configuredRequired !== false;
    const description = typeof candidate.description === "string" && candidate.description.trim()
      ? candidate.description.trim()
      : undefined;
    if (!id || !label || seen.has(id) || !Number.isFinite(weight) || weight <= 0
      || (type === "numeric" && (!Number.isInteger(maxScore) || maxScore < 2))
      || (type === "dropdown" && (!options || options.length < 2))) {
      throw new ReviewRubricError("INVALID_RUBRIC", `Rubric criterion ${index + 1} has invalid configuration.`);
    }
    seen.add(id);
    return { id, label, ...(configuredType ? { type } : {}), weight, maxScore, description, ...(options ? { options } : {}), ...(configuredRequired === undefined ? {} : { required }) };
  });
}

export function evaluateReviewScores(
  rubricInput: unknown,
  scoresInput: unknown,
  requireComplete: boolean,
): ReviewScoreEvaluation {
  const rubric = parseReviewRubric(rubricInput);
  if (!isPlainRecord(scoresInput)) {
    throw new ReviewRubricError("INVALID_SCORE", "Rubric scores must be provided by criterion.", {
      scores: "Choose a score for each rubric criterion.",
    });
  }

  const rubricById = new Map(rubric.map((criterion) => [criterion.id, criterion]));
  const scores: Record<string, ReviewResponseValue> = {};
  const fieldErrors: Record<string, string> = {};

  for (const [criterionId, rawScore] of Object.entries(scoresInput)) {
    const criterion = rubricById.get(criterionId);
    if (!criterion) {
      fieldErrors[`scores.${criterionId}`] = "This criterion is not part of the active review rubric.";
      continue;
    }
    if ((criterion.type ?? "numeric") === "numeric") {
      if (typeof rawScore !== "number" || !Number.isInteger(rawScore) || rawScore < 1 || rawScore > criterion.maxScore) {
        fieldErrors[`scores.${criterionId}`] = `Choose a whole-number score from 1 to ${criterion.maxScore}.`;
        continue;
      }
      scores[criterionId] = rawScore;
    } else if (criterion.type === "dropdown") {
      if (typeof rawScore !== "string" || !criterion.options?.includes(rawScore)) {
        fieldErrors[`scores.${criterionId}`] = "Choose one of the configured options.";
        continue;
      }
      scores[criterionId] = rawScore;
    } else {
      if (typeof rawScore !== "string" || !rawScore.trim()) {
        fieldErrors[`scores.${criterionId}`] = "Add a written response.";
        continue;
      }
      scores[criterionId] = rawScore.trim();
    }
  }

  if (Object.keys(fieldErrors).length) {
    const hasUnknown = Object.keys(fieldErrors).some((key) => !rubricById.has(key.slice("scores.".length)));
    throw new ReviewRubricError(
      hasUnknown ? "UNKNOWN_CRITERION" : "INVALID_SCORE",
      hasUnknown ? "The review contains a criterion outside the active rubric." : "One or more rubric scores are outside the allowed range.",
      fieldErrors,
    );
  }

  const missing = rubric.filter((criterion) => criterion.required !== false && scores[criterion.id] === undefined);
  if (requireComplete && missing.length) {
    throw new ReviewRubricError(
      "MISSING_SCORE",
      "Score every rubric criterion before submitting the review.",
      Object.fromEntries(missing.map((criterion) => [`scores.${criterion.id}`, "Choose a score before submitting."])),
    );
  }

  const complete = missing.length === 0;
  if (!complete) return { scores, complete };

  const numericCriteria = rubric.filter((criterion) => (criterion.type ?? "numeric") === "numeric");
  if (!numericCriteria.length) return { scores, complete };
  const totalWeight = numericCriteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const normalized = numericCriteria.reduce(
    (sum, criterion) => sum + (1 + (((scores[criterion.id] as number) - 1) / (criterion.maxScore - 1)) * 4) * criterion.weight,
    0,
  ) / totalWeight;
  return {
    scores,
    complete,
    totalScore: Math.round(normalized * 100) / 100,
  };
}
