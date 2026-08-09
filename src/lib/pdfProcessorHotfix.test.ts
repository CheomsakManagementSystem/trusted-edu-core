import { describe, expect, it } from "vitest";
import {
  getParsedScoreValidationError,
  resolveParsedTotalScore,
  type ScoreBreakdown,
} from "@/lib/pdfProcessor";

const converted = (values: [number, number, number, number, number]): ScoreBreakdown => ({
  reading: values[0],
  comprehension: values[1],
  problemUnderstanding: values[2],
  organization: values[3],
  expression: values[4],
  total: values.reduce((sum, value) => sum + value, 0),
});

describe("PDF hotfix score validation", () => {
  it("accepts a real weighted total when rounded converted scores differ by 0.6", () => {
    const scores: ScoreBreakdown = {
      reading: 92,
      comprehension: 92,
      problemUnderstanding: 92,
      organization: 94,
      expression: 94,
      total: 92.6,
    };

    expect(
      getParsedScoreValidationError({
        scores,
        convertedScores: converted([18, 28, 18, 19, 9]),
      }),
    ).toBeNull();
  });

  it("accepts a real weighted total when rounded converted scores differ by 1.0", () => {
    const scores: ScoreBreakdown = {
      reading: 90,
      comprehension: 89,
      problemUnderstanding: 88,
      organization: 89,
      expression: 89,
      total: 89,
    };

    expect(
      getParsedScoreValidationError({
        scores,
        convertedScores: converted([18, 27, 18, 18, 9]),
      }),
    ).toBeNull();
  });

  it("calculates the report total with 20/30/20/20/10 weights when total is missing", () => {
    const scores: ScoreBreakdown = {
      reading: 89,
      comprehension: 90,
      problemUnderstanding: 88,
      organization: 85,
      expression: 87,
      total: null,
    };

    expect(
      resolveParsedTotalScore({
        scores,
        convertedScores: converted([18, 27, 18, 17, 9]),
      }),
    ).toBe(88.1);
  });

  it("still rejects an actually inconsistent total", () => {
    const scores: ScoreBreakdown = {
      reading: 92,
      comprehension: 92,
      problemUnderstanding: 92,
      organization: 94,
      expression: 94,
      total: 99,
    };

    expect(
      getParsedScoreValidationError({
        scores,
        convertedScores: converted([18, 28, 18, 19, 9]),
      }),
    ).toContain("일치하지 않습니다");
  });
});
