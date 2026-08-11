import { describe, expect, it, vi } from "vitest";
import {
  getParsedScoreValidationError,
  compactParsedPdfData,
  hydrateReportRecord,
  parseScoreTableFromTokens,
  resolveMatchStatus,
  resolveParsedTotalScore,
  resolveReportAssignmentClass,
  readPdfFileBuffer,
  releasePdfFileBuffer,
  type PageToken,
  type ScoreBreakdown,
  type StudentLite,
} from "@/lib/pdfProcessor";

describe("PDF file buffer cache", () => {
  it("reads the same selected file only once", async () => {
    const buffer = new ArrayBuffer(8);
    const arrayBuffer = vi.fn().mockResolvedValue(buffer);
    const file = { arrayBuffer } as unknown as File;

    const [first, second] = await Promise.all([
      readPdfFileBuffer(file),
      readPdfFileBuffer(file),
    ]);

    expect(first).toBe(buffer);
    expect(second).toBe(buffer);
    expect(arrayBuffer).toHaveBeenCalledTimes(1);
  });

  it("releases a cached buffer after PDF processing", async () => {
    const arrayBuffer = vi.fn().mockResolvedValue(new ArrayBuffer(8));
    const file = { arrayBuffer } as unknown as File;

    await readPdfFileBuffer(file);
    releasePdfFileBuffer(file);
    await readPdfFileBuffer(file);

    expect(arrayBuffer).toHaveBeenCalledTimes(2);
  });
});

describe("report memory compaction", () => {
  it("does not persist duplicated PDF raw text", () => {
    const parsed = {
      name: "홍길동",
      className: "A반",
      studentId: "1234",
      phoneSuffix: "1234",
      writtenAt: "2026-08-11",
      essayTopic: "주제",
      grade: "A",
      reviewer: "첨삭자",
      feedback: "총평",
      scores: { reading: 20, comprehension: 30, problemUnderstanding: 20, organization: 20, expression: 10, total: 100 },
      averageScores: { reading: 20, comprehension: 30, problemUnderstanding: 20, organization: 20, expression: 10, total: 100 },
      convertedScores: { reading: 20, comprehension: 30, problemUnderstanding: 20, organization: 20, expression: 10, total: 100 },
      rawText: "매우 긴 PDF 원문",
    };

    expect(compactParsedPdfData(parsed)).not.toHaveProperty("rawText");
  });

  it("drops parsedJson from list records after hydration", () => {
    const report = hydrateReportRecord("report-1", {
      parsedJson: { rawText: "매우 긴 PDF 원문" },
      scores: null,
      averageScores: null,
      convertedScores: null,
    } as never);

    expect(report).not.toHaveProperty("parsedJson");
  });
});

const student = (overrides: Partial<StudentLite>): StudentLite => ({
  docId: overrides.docId ?? overrides.uid ?? "doc-id",
  uid: overrides.uid ?? "uid",
  name: overrides.name ?? "홍길동",
  email: overrides.email ?? "",
  classId: overrides.classId ?? "class-a",
  classIds: overrides.classIds ?? [overrides.classId ?? "class-a"],
  className: overrides.className ?? "A반",
  studentId: overrides.studentId ?? null,
  phoneNumber: overrides.phoneNumber ?? null,
  phoneSuffix: overrides.phoneSuffix ?? null,
});

describe("resolveMatchStatus", () => {
  it("does not auto-match by phone when the name differs", () => {
    const classStudents = [
      student({ uid: "a", name: "김철수", classId: "class-a", phoneSuffix: "1234" }),
    ];
    const allStudents = [
      ...classStudents,
      student({ uid: "b", name: "이영희", classId: "class-b", phoneSuffix: "1234" }),
    ];

    const result = resolveMatchStatus(
      { name: "이영희", className: "A반", studentId: "", phoneSuffix: "1234" },
      classStudents,
      allStudents,
    );

    expect(result.status).toBe("unregistered");
    expect(result.selectedStudentUid).toBeNull();
  });

  it("auto-matches one same-name student inside the selected class", () => {
    const classStudents = [
      student({ uid: "a", name: "김철수", classId: "class-a", phoneSuffix: "1234" }),
    ];

    const result = resolveMatchStatus(
      { name: "김 철수", className: "A반", studentId: "", phoneSuffix: "9999" },
      classStudents,
      classStudents,
    );

    expect(result.status).toBe("ready");
    expect(result.selectedStudentUid).toBe("a");
  });

  it("uses phone only as a tie-breaker among same-name students", () => {
    const classStudents = [
      student({ uid: "a", name: "김철수", classId: "class-a", phoneSuffix: "1234" }),
      student({ uid: "b", name: "김철수", classId: "class-a", phoneSuffix: "5678" }),
    ];

    const result = resolveMatchStatus(
      { name: "김철수", className: "A반", studentId: "", phoneSuffix: "5678" },
      classStudents,
      classStudents,
    );

    expect(result.status).toBe("ready");
    expect(result.selectedStudentUid).toBe("b");
  });
  it("keeps the report class when manually linking a student", () => {
    const target = student({
      docId: "custom-doc",
      uid: "auth-uid",
      classId: "student-primary",
      classIds: ["student-primary"],
      className: "학생 기존 반",
    });

    expect(
      resolveReportAssignmentClass(
        { classId: "report-class", className: "리포트 업로드 반" },
        target,
      ),
    ).toEqual({ classId: "report-class", className: "리포트 업로드 반" });
  });

});

const token = (text: string, x: number, y: number, width = 24): PageToken => ({
  text,
  x,
  y,
  width,
  height: 10,
});

const metricRow = (
  labelTokens: Array<[string, number, number?]>,
  y: number,
  mine: number,
  average: number,
  converted: number,
  maximum = 20,
): PageToken[] => [
  ...labelTokens.map(([text, x, width]) => token(text, x, y, width ?? 24)),
  token(`(${maximum}점 만점)`, 105, y, 65),
  token(String(mine), 198, y, 18),
  token(String(average), 293, y, 28),
  token(String(converted), 398, y, 18),
  token("2026", 510, y, 30),
];

const completeLayoutTokens = (readingMine = 15): PageToken[] => [
  token("나의", 180, 10, 28),
  token("점수", 210, 10, 28),
  token("전체", 275, 10, 28),
  token("평균", 305, 10, 28),
  token("환산", 380, 10, 28),
  token("점수", 410, 10, 28),
  ...metricRow([["독", 10], ["해력", 36]], 30, readingMine, 12.5, 15),
  ...metricRow([["내용", 10], ["이해력", 42]], 50, 14, 11.5, 14),
  ...metricRow([["문제", 10], ["이해", 42], ["력", 68]], 70, 13, 10.5, 13),
  ...metricRow([["구성", 10], ["력", 42]], 90, 12, 9.5, 12),
  ...metricRow([["표현", 10], ["력", 42]], 110, 11, 8.5, 11),
];

describe("PDF score table parsing", () => {
  it("reads split headers and split metric labels by column position", () => {
    const result = parseScoreTableFromTokens(completeLayoutTokens());

    expect(result.meta.confidence).toBe("high");
    expect(result.scores).toMatchObject({
      reading: 15,
      comprehension: 14,
      problemUnderstanding: 13,
      organization: 12,
      expression: 11,
    });
    expect(result.averageScores.reading).toBe(12.5);
    expect(result.convertedScores.expression).toBe(11);
  });

  it("ignores maximum labels and trailing unrelated numbers", () => {
    const result = parseScoreTableFromTokens(completeLayoutTokens());

    expect(result.scores.reading).toBe(15);
    expect(result.averageScores.reading).toBe(12.5);
    expect(result.convertedScores.reading).toBe(15);
  });

  it("rejects a score that exceeds the row maximum", () => {
    const result = parseScoreTableFromTokens(completeLayoutTokens(25));

    expect(result.scores.reading).toBeNull();
    expect(result.meta.confidence).toBe("low");
    expect(result.meta.warnings).toContain("독해력 점수가 만점 범위를 벗어났습니다.");
  });

  it("uses the first three ordered values when headers are unavailable", () => {
    const rows = [
      ...metricRow([["독해력", 10]], 30, 15, 12.5, 15),
      ...metricRow([["내용 이해력", 10, 70]], 50, 14, 11.5, 14),
      ...metricRow([["문제 이해력", 10, 70]], 70, 13, 10.5, 13),
      ...metricRow([["구성력", 10]], 90, 12, 9.5, 12),
      ...metricRow([["표현력", 10]], 110, 11, 8.5, 11),
    ];
    const result = parseScoreTableFromTokens(rows);

    expect(result.meta.confidence).toBe("medium");
    expect(result.scores.reading).toBe(15);
    expect(result.averageScores.reading).toBe(12.5);
    expect(result.convertedScores.reading).toBe(15);
  });
});

describe("score validation", () => {
  const scores: ScoreBreakdown = {
    reading: 15,
    comprehension: 14,
    problemUnderstanding: 13,
    organization: 12,
    expression: 11,
    total: 65,
  };
  const convertedScores: ScoreBreakdown = {
    reading: 15,
    comprehension: 14,
    problemUnderstanding: 13,
    organization: 12,
    expression: 11,
    total: 65,
  };

  it("accepts a total matching either the raw or converted score sum", () => {
    expect(getParsedScoreValidationError({ scores, convertedScores })).toBeNull();
    expect(resolveParsedTotalScore({ scores, convertedScores })).toBe(65);
  });

  it("rejects a total that matches neither score sum", () => {
    expect(
      getParsedScoreValidationError({
        scores: { ...scores, total: 99 },
        convertedScores,
      }),
    ).toContain("일치하지 않습니다");
  });

  it("requires manual review for low-confidence automatic parsing", () => {
    expect(
      getParsedScoreValidationError({
        scores,
        convertedScores,
        scoreParse: { confidence: "low", method: "text-fallback", warnings: [] },
      }),
    ).toContain("직접 확인");
  });
});
