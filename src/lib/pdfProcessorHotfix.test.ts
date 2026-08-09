import { describe, expect, it } from "vitest";
import {
  getParsedScoreValidationError,
  repairParsedScores,
  resolveParsedTotalScore,
  type ParsedPdfData,
  type ScoreBreakdown,
} from "./pdfProcessorHotfix";

const converted = (values: [number, number, number, number, number]): ScoreBreakdown => ({
  reading: values[0],
  comprehension: values[1],
  problemUnderstanding: values[2],
  organization: values[3],
  expression: values[4],
  total: values.reduce((sum, value) => sum + value, 0),
});

const nullScores = (): ScoreBreakdown => ({
  reading: null,
  comprehension: null,
  problemUnderstanding: null,
  organization: null,
  expression: null,
  total: null,
});

describe("PDF hotfix score validation", () => {
  it("recovers the real 0-100 / average / converted columns from report text", () => {
    const parsed: ParsedPdfData = {
      name: "어윤서",
      className: "분당 일9",
      studentId: "",
      phoneSuffix: "",
      writtenAt: "2026.07.19",
      essayTopic: "성균관대 불평등",
      grade: "A-",
      reviewer: "최지영T",
      feedback: "전반적으로 문장이 안정적입니다.",
      scores: { ...nullScores(), total: 92.6 },
      averageScores: nullScores(),
      convertedScores: nullScores(),
      scoreParse: { confidence: "low", method: "text-fallback", warnings: [] },
      rawText: "독해력 제시문 내용에 대한 독해 능력 (20점 만점) 92 87 18 내용 이해력 문제에 따른 핵심 내용 이해력 (30점 만점) 92 86 28 문제 이해력 문제 요구조건 이해 능력 (20점 만점) 92 86 18 구성력 글 전체 구조의 구성 능력 (20점 만점) 94 85 19 표현력 맞춤법 주술 호응 등 표현력 (10점 만점) 94 87 9 총점 92.6 등급 A-",
    };

    const repaired = repairParsedScores(parsed);

    expect(repaired.scores).toMatchObject({
      reading: 92,
      comprehension: 92,
      problemUnderstanding: 92,
      organization: 94,
      expression: 94,
      total: 92.6,
    });
    expect(repaired.averageScores).toMatchObject({
      reading: 87,
      comprehension: 86,
      problemUnderstanding: 86,
      organization: 85,
      expression: 87,
    });
    expect(repaired.convertedScores).toMatchObject({
      reading: 18,
      comprehension: 28,
      problemUnderstanding: 18,
      organization: 19,
      expression: 9,
      total: 92,
    });
    expect(repaired.scoreParse?.confidence).toBe("medium");
    expect(getParsedScoreValidationError(repaired)).toBeNull();
  });

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
