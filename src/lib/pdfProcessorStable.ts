import * as hotfix from "./pdfProcessorHotfix";
import type {
  ParsedPdfData,
  ScoreBreakdown,
  StudentLite,
  UploadCandidate,
} from "./pdfProcessorHotfix";

export * from "./pdfProcessorHotfix";

const SCORE_ROWS: Array<{
  key: Exclude<keyof ScoreBreakdown, "total">;
  label: string;
  maximum: number;
}> = [
  { key: "reading", label: "독해력", maximum: 20 },
  { key: "comprehension", label: "내용 이해력", maximum: 30 },
  { key: "problemUnderstanding", label: "문제 이해력", maximum: 20 },
  { key: "organization", label: "구성력", maximum: 20 },
  { key: "expression", label: "표현력", maximum: 10 },
];

const emptyScores = (): ScoreBreakdown => ({
  reading: null,
  comprehension: null,
  problemUnderstanding: null,
  organization: null,
  expression: null,
  total: null,
});

const requiredKeys = SCORE_ROWS.map((row) => row.key);
const sumRequired = (scores: ScoreBreakdown) =>
  requiredKeys.reduce((sum, key) => sum + (scores[key] ?? 0), 0);

const parseScoreRows = (rawText: string) => {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return null;

  const scores = emptyScores();
  const averageScores = emptyScores();
  const convertedScores = emptyScores();

  for (let index = 0; index < SCORE_ROWS.length; index += 1) {
    const { key, label, maximum } = SCORE_ROWS[index];
    const start = text.indexOf(label);
    if (start < 0) return null;

    const nextLabel = SCORE_ROWS[index + 1]?.label;
    const nextLabelIndex = nextLabel ? text.indexOf(nextLabel, start + label.length) : -1;
    const totalIndex = text.indexOf("총점", start + label.length);
    const endCandidates = [nextLabelIndex, totalIndex].filter((value) => value > start);
    const end = endCandidates.length ? Math.min(...endCandidates) : text.length;

    const values = (
      text
        .slice(start + label.length, end)
        .replace(/\(?\s*\d+(?:\.\d+)?\s*점\s*만점\s*\)?/gi, " ")
        .match(/-?\d+(?:\.\d+)?/g) ?? []
    )
      .map(Number)
      .filter(Number.isFinite)
      .slice(0, 3);

    if (values.length !== 3) return null;

    const [mine, average, converted] = values;
    if (
      mine < 0 || mine > 100 ||
      average < 0 || average > 100 ||
      converted < 0 || converted > maximum
    ) {
      return null;
    }

    scores[key] = mine;
    averageScores[key] = average;
    convertedScores[key] = converted;
  }

  convertedScores.total = sumRequired(convertedScores);
  return { scores, averageScores, convertedScores };
};

export const stabilizeParsedScores = (parsed: ParsedPdfData): ParsedPdfData => {
  const recovered = parseScoreRows(parsed.rawText);
  if (!recovered) return parsed;

  const matches = requiredKeys.every(
    (key) =>
      parsed.scores[key] === recovered.scores[key] &&
      parsed.averageScores[key] === recovered.averageScores[key] &&
      parsed.convertedScores[key] === recovered.convertedScores[key],
  );

  if (matches && parsed.scoreParse?.confidence !== "low") return parsed;

  return {
    ...parsed,
    scores: { ...recovered.scores, total: parsed.scores.total },
    averageScores: recovered.averageScores,
    convertedScores: recovered.convertedScores,
    scoreParse: {
      confidence: "medium",
      method: "layout-order",
      warnings: [
        ...new Set([
          ...(parsed.scoreParse?.warnings ?? []),
          "원문 점수 행과 재대조해 나의 점수/평균/환산점수를 정규화했습니다.",
        ]),
      ],
    },
  };
};

export const prepareUploadCandidates = async (
  files: File[],
  classStudents: StudentLite[],
  allStudents: StudentLite[],
): Promise<UploadCandidate[]> => {
  const rows = await hotfix.prepareUploadCandidates(files, classStudents, allStudents);

  return rows.map((row) => {
    const parsed = stabilizeParsedScores(row.parsed);
    return {
      ...row,
      parsed: { ...parsed, rawText: "" },
      parseError: hotfix.getUploadCandidateValidationError(parsed) ?? undefined,
    };
  });
};
