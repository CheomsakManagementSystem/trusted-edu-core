import { describe, expect, it } from "vitest";
import { detectRecentScoreTrend, resolveReportTotalScore } from "./reportScoreIntegrity";
import type { ScoreBreakdown } from "./pdfProcessor";

const scores = (
  reading: number | null,
  comprehension: number | null,
  problemUnderstanding: number | null,
  organization: number | null,
  expression: number | null,
  total: number | null = null,
): ScoreBreakdown => ({
  reading,
  comprehension,
  problemUnderstanding,
  organization,
  expression,
  total,
});

describe("report score integrity", () => {
  it("preserves an explicit stored total", () => {
    expect(resolveReportTotalScore(89, scores(90, 89, 88, 89, 89))).toBe(89);
  });

  it("recovers a missing normalized total with 20/30/20/20/10 weights", () => {
    expect(resolveReportTotalScore(undefined, scores(92, 92, 92, 94, 94))).toBe(92.6);
  });

  it("falls back to converted scores for legacy rows when needed", () => {
    expect(
      resolveReportTotalScore(
        undefined,
        scores(null, null, null, null, null),
        scores(18, 27, 18, 18, 9),
      ),
    ).toBe(90);
  });

  it("detects trend from the latest three reports in chronological direction", () => {
    expect(detectRecentScoreTrend([90, 80, 70, 20])).toBe("up");
    expect(detectRecentScoreTrend([70, 80, 90, 100])).toBe("down");
    expect(detectRecentScoreTrend([90, 80, 85, 10])).toBeNull();
  });
});
