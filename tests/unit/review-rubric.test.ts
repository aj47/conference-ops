import { describe, expect, it } from "vitest";
import {
  evaluateReviewScores,
  parseReviewRubric,
  ReviewRubricError,
} from "../../src/shared/review-rubric";

const rubric = [
  { id: "relevance", label: "Audience relevance", weight: 2, maxScore: 5 },
  { id: "evidence", label: "Evidence", weight: 3, maxScore: 10 },
  { id: "delivery", label: "Delivery", weight: 1, maxScore: 4 },
];

describe("review rubric scoring", () => {
  it("computes a weighted total normalized to the shared 1–5 scale", () => {
    expect(evaluateReviewScores(rubric, {
      relevance: 5,
      evidence: 5,
      delivery: 2,
    }, true)).toEqual({
      scores: { relevance: 5, evidence: 5, delivery: 2 },
      complete: true,
      totalScore: 3.44,
    });
  });

  it("allows an incomplete draft without inventing a total", () => {
    expect(evaluateReviewScores(rubric, { relevance: 4 }, false)).toEqual({
      scores: { relevance: 4 },
      complete: false,
    });
  });

  it("rejects missing submitted scores with criterion field errors", () => {
    expect(() => evaluateReviewScores(rubric, { relevance: 4 }, true)).toThrowError(
      expect.objectContaining<Partial<ReviewRubricError>>({
        code: "MISSING_SCORE",
        fieldErrors: {
          "scores.evidence": "Choose a score before submitting.",
          "scores.delivery": "Choose a score before submitting.",
        },
      }),
    );
  });

  it("rejects unknown criteria and values outside each configured range", () => {
    expect(() => evaluateReviewScores(rubric, { relevance: 6, mystery: 2 }, false)).toThrowError(
      expect.objectContaining<Partial<ReviewRubricError>>({
        code: "UNKNOWN_CRITERION",
        fieldErrors: {
          "scores.relevance": "Choose a whole-number score from 1 to 5.",
          "scores.mystery": "This criterion is not part of the active review rubric.",
        },
      }),
    );
  });

  it("rejects malformed or duplicate rubric configuration", () => {
    expect(() => parseReviewRubric([{ id: "fit", label: "Fit", weight: 1, maxScore: 5 }, { id: "fit", label: "Again", weight: 1, maxScore: 5 }])).toThrowError(
      expect.objectContaining<Partial<ReviewRubricError>>({ code: "INVALID_RUBRIC" }),
    );
  });
});
