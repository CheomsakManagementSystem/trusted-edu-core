import type { ScoreBreakdown } from "./pdfProcessor";

const SCORE_KEYS: Array<Exclude<keyof ScoreBreakdown, "total">> = [
  "reading",
  "comprehension",
  "problemUnderstanding",
  "organization",
  "expression",
];

const finiteNonNegative = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

const hasCompleteScores = (scores: ScoreBreakdown | null | undefined) =>
  Boolean(scores) && SCORE_KEYS.every((key) => finiteNonNegative(scores?.[key]) !== null);

const sumScores = (scores: ScoreBreakdown) =>
  SCORE_KEYS.reduce((sum, key) => sum + (finiteNonNegative(scores[key]) ?? 0), 0);

const roundTenth = (value: number) => Math.round(value * 10) / 10;

const normalizedWeightedTotal = (scores: ScoreBreakdown | null | undefined): number | null => {
  if (!scores || !hasCompleteScores(scores)) return null;
  if (!SCORE_KEYS.some((key) => (scores[key] ?? 0) > 30)) return null;

  return roundTenth(
    (scores.reading ?? 0) * 0.2 +
      (scores.comprehension ?? 0) * 0.3 +
      (scores.problemUnderstanding ?? 0) * 0.2 +
      (scores.organization ?? 0) * 0.2 +
      (scores.expression ?? 0) * 0.1,
  );
};

export const resolveReportTotalScore = (
  explicitTotal: unknown,
  scores: ScoreBreakdown | null | undefined,
  convertedScores?: ScoreBreakdown | null,
): number | null => {
  const direct = finiteNonNegative(explicitTotal);
  const embeddedTotal = finiteNonNegative(scores?.total);

  // Non-zero persisted totals are authoritative. A zero can be a legacy hydration
  // fallback, so score rows are checked before accepting zero as the final total.
  if (direct !== null && direct !== 0) return direct;
  if (embeddedTotal !== null && embeddedTotal !== 0) return embeddedTotal;

  const weightedTotal = normalizedWeightedTotal(scores);
  if (weightedTotal !== null) return weightedTotal;

  if (convertedScores && hasCompleteScores(convertedScores)) {
    return roundTenth(sumScores(convertedScores));
  }

  if (scores && hasCompleteScores(scores)) {
    return roundTenth(sumScores(scores));
  }

  return direct ?? embeddedTotal;
};

export type RecentScoreTrend = "up" | "down" | null;

export const detectRecentScoreTrend = (totalsNewestFirst: number[]): RecentScoreTrend => {
  if (totalsNewestFirst.length < 3) return null;

  const [oldest, middle, newest] = totalsNewestFirst.slice(0, 3).reverse();
  if (oldest < middle && middle < newest) return "up";
  if (oldest > middle && middle > newest) return "down";
  return null;
};
