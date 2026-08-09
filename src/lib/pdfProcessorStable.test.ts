import { describe, expect, it } from "vitest";
import { stabilizeParsedScores, type ParsedPdfData, type ScoreBreakdown } from "./pdfProcessorStable";

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

describe("stable PDF score recovery", () => {
  it("repairs partially mixed rubric maximums and normalized scores", () => {
    const parsed: ParsedPdfData = {
      name: "방승혁",
      className: "분당 수6",
      studentId: "",
      phoneSuffix: "",
      writtenAt: "2026.07.15",
      essayTopic: "성균관대 불평등",
      grade: "B+",
      reviewer: "최지영T",
      feedback: "자료 분석을 다시할 필요가 있습니다.",
      scores: scores(20, 88, 89, 20, 86, 88.2),
      averageScores: scores(89, 86, 86, 88, 87),
      convertedScores: scores(87, 26, 18, 85, 9),
      scoreParse: { confidence: "medium", method: "layout-order", warnings: [] },
      rawText: "독해력 제시문 내용에 대한 독해 능력 (20점 만점) 89 87 18 내용 이해력 문제에 따른 핵심 내용 이해력 (30점 만점) 88 86 26 문제 이해력 문제 요구조건 이해 능력 (20점 만점) 89 86 18 구성력 글 전체 구조의 구성 능력 (20점 만점) 88 85 18 표현력 맞춤법 주술 호응 등 표현력 (10점 만점) 86 87 9 총점 88.2 등급 B+",
    };

    const repaired = stabilizeParsedScores(parsed);

    expect(repaired.scores).toEqual(scores(89, 88, 89, 88, 86, 88.2));
    expect(repaired.averageScores).toEqual(scores(87, 86, 86, 85, 87));
    expect(repaired.convertedScores).toEqual(scores(18, 26, 18, 18, 9, 89));
    expect(repaired.scoreParse?.confidence).toBe("medium");
  });

  it("keeps a matching parsed row unchanged", () => {
    const parsed: ParsedPdfData = {
      name: "박도현",
      className: "분당 수6",
      studentId: "",
      phoneSuffix: "",
      writtenAt: "2026.07.15",
      essayTopic: "성균관대 불평등",
      grade: "B+",
      reviewer: "최지영T",
      feedback: "논리적인 흐름을 고려해야 합니다.",
      scores: scores(90, 89, 88, 89, 89, 89),
      averageScores: scores(87, 86, 86, 85, 87),
      convertedScores: scores(18, 27, 18, 18, 9, 90),
      scoreParse: { confidence: "high", method: "layout-columns", warnings: [] },
      rawText: "독해력 제시문 내용에 대한 독해 능력 (20점 만점) 90 87 18 내용 이해력 문제에 따른 핵심 내용 이해력 (30점 만점) 89 86 27 문제 이해력 문제 요구조건 이해 능력 (20점 만점) 88 86 18 구성력 글 전체 구조의 구성 능력 (20점 만점) 89 85 18 표현력 맞춤법 주술 호응 등 표현력 (10점 만점) 89 87 9 총점 89 등급 B+",
    };

    expect(stabilizeParsedScores(parsed)).toBe(parsed);
  });
});
