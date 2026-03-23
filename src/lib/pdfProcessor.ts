import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  writeBatch,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

const STORAGE_UPLOAD_TIMEOUT_MS = 60_000;
const PDFJS_VERSION = "4.10.38";

export type MatchStatus = "ready" | "needs_selection" | "unregistered";
export type JoinRequestStatus = "pending" | "approved" | "rejected";
export type ReportAssignmentStatus = "completed" | "duplicate_pending" | "unassigned_pending";

export type StudentLite = {
  uid: string;
  name: string;
  email: string;
  classId?: string | null;
  className?: string | null;
  studentId?: string | null;
  phoneNumber?: string | null;
  phoneSuffix?: string | null;
};

export type ClassLite = {
  id: string;
  name: string;
};

export type UploadSession = {
  id: string;
  sessionNumber: number;
  testDate: string;
};

export type ScoreBreakdown = {
  reading: number | null;
  comprehension: number | null;
  problemUnderstanding: number | null;
  organization: number | null;
  expression: number | null;
  total: number | null;
};

export type ParsedPdfData = {
  name: string;
  className: string;
  writtenAt: string;
  essayTopic: string;
  grade: string;
  reviewer: string;
  feedback: string;
  scores: ScoreBreakdown;
  averageScores: ScoreBreakdown;
  convertedScores: ScoreBreakdown;
  rawText: string;
};

export type UploadCandidate = {
  id: string;
  file: File;
  fileHash?: string | null;
  sourcePage: number;
  sourcePageLabel: string;
  parsed: ParsedPdfData;
  status: MatchStatus;
  candidates: StudentLite[];
  selectedStudentUid: string | null;
  parseError?: string;
  sentReportId?: string;
  sent?: boolean;
  isRead?: boolean;
};

export type ReportRecord = {
  id: string;
  uid: string;
  classId: string | null;
  className: string | null;
  sessionId?: string | null;
  testSession?: number | null;
  testDate?: string | null;
  fileHash?: string | null;
  studentUid: string | null;
  studentId: string | null;
  studentName: string;
  assignmentStatus?: ReportAssignmentStatus;
  status?: "completed" | "pending";
  assignedAt?: Timestamp | null;
  sourcePage?: number;
  pageNumber?: number;
  sourceName: string;
  writtenAt: string;
  reviewer: string;
  essayTopic: string;
  grade: string;
  feedback: string;
  scores: ScoreBreakdown;
  averageScores?: ScoreBreakdown;
  convertedScores?: ScoreBreakdown;
  parsedJson?: ParsedPdfData;
  totalScore: number;
  isRead: boolean;
  fileUrl: string;
  fileName: string;
  createdAt: Timestamp | null;
};

export type ClassJoinRequestRecord = {
  id: string;
  studentUid: string;
  studentName: string;
  studentEmail: string;
  classId: string;
  className: string;
  status: JoinRequestStatus;
  createdAt: Timestamp | null;
  approvedAt?: Timestamp | null;
  approvedBy?: string | null;
};

const METRIC_LABELS = ["독해력", "내용 이해력", "문제 이해력", "구성력", "표현력"] as const;
const STUDENT_SECTION_MARKER = /김윤환\s*class\s*첨삭\s*채점표/i;
const REQUIRED_SCORE_KEYS: Array<keyof ScoreBreakdown> = [
  "reading",
  "comprehension",
  "problemUnderstanding",
  "organization",
  "expression",
];

type MetricLabel = (typeof METRIC_LABELS)[number];

const METRIC_ALIASES: Record<MetricLabel, string[]> = {
  독해력: ["독해력", "독해 력", "독 해력"],
  "내용 이해력": ["내용 이해력", "내용이해력", "내옹 이해력", "내요 이해력"],
  "문제 이해력": ["문제 이해력", "문제이해력", "문제 이해 력"],
  구성력: ["구성력", "구성 력"],
  표현력: ["표현력", "표현 력"],
};

const EMPTY_PARSED: ParsedPdfData = {
  name: "",
  className: "",
  writtenAt: "",
  essayTopic: "",
  grade: "",
  reviewer: "",
  feedback: "",
  scores: {
    reading: null,
    comprehension: null,
    problemUnderstanding: null,
    organization: null,
    expression: null,
    total: null,
  },
  averageScores: {
    reading: null,
    comprehension: null,
    problemUnderstanding: null,
    organization: null,
    expression: null,
    total: null,
  },
  convertedScores: {
    reading: null,
    comprehension: null,
    problemUnderstanding: null,
    organization: null,
    expression: null,
    total: null,
  },
  rawText: "",
};

const parseNumber = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
};

export const normalizeDateString = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const direct = trimmed.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (direct) {
    const [, year, month, day] = direct;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const year = parsed.getFullYear();
  const month = `${parsed.getMonth() + 1}`.padStart(2, "0");
  const day = `${parsed.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const getReportSortTimestamp = (
  report: Pick<ReportRecord, "testDate" | "writtenAt" | "createdAt">,
) => {
  const normalized = normalizeDateString(report.testDate) ?? normalizeDateString(report.writtenAt);
  if (normalized) {
    return new Date(`${normalized}T00:00:00`).getTime();
  }
  return report.createdAt?.toMillis() ?? 0;
};

export const formatSessionLabel = (session: UploadSession) =>
  `${session.sessionNumber}회차 (${session.testDate})`;

const parseFileNameHint = (fileName: string): { name?: string; total?: number | null } => {
  const base = fileName.replace(/\.pdf$/i, "");
  const nameMatch = base.match(/([가-힣]{2,5})/);
  const scoreMatch = base.match(/(\d+(?:\.\d+)?)\s*점?/);

  return {
    name: nameMatch?.[1]?.trim() || undefined,
    total: parseNumber(scoreMatch?.[1]),
  };
};

const normalizeText = (text: string) =>
  text
    .replaceAll("\u0000", "")
    .replace(/\r/g, "\n")
    .replace(/김윤환\s*class/gi, " ")
    .replace(/첨삭\s*채점표/gi, " ")
    .replace(/내용\s*형식/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .replace(/\(\s*\d+(?:\.\d+)?\s*점\s*만점\s*\)/g, "")
    .replace(/내옹\s*이해력/g, "내용 이해력")
    .replace(/내요\s*이해력/g, "내용 이해력")
    .replace(/내용이해력/g, "내용 이해력")
    .replace(/문제이해력/g, "문제 이해력")
    .replace(/독\s*해력/g, "독해력")
    .replace(/\s+/g, " ")
    .trim();

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeName = (name: string) =>
  name
    .replace(/\s+/g, " ")
    .replace(/(?:학생|귀하|님)\s*$/g, "")
    .trim();

const sanitizeReviewerName = (value: string): string => {
  const compact = value
    .replace(/\s+/g, " ")
    .replace(/^[:：\-\s]+/, "")
    .replace(/[|]/g, " ")
    .trim();

  if (!compact) {
    return "";
  }

  // 총평 문장/메타가 섞인 경우 첨삭자 필드로 인정하지 않는다.
  if (/[.!?]/.test(compact) || compact.length > 32) {
    return "";
  }

  const chunks = compact.split(" ").filter(Boolean);
  if (chunks.length > 3) {
    return "";
  }

  if (/(작성일|수강반|논제|첨삭\s*총평|총평|독해력|내용\s*이해력|문제\s*이해력|구성력|표현력|총점|등급)/i.test(compact)) {
    return "";
  }

  return compact;
};

const extractReviewerFromRawText = (rawText: string): string => {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const match = line.match(/(?:첨삭자|채점자)\s*[:：]\s*(.+)$/i);
    if (!match?.[1]) {
      continue;
    }
    const reviewer = sanitizeReviewerName(match[1]);
    if (reviewer) {
      return reviewer;
    }
  }

  return "";
};

const extractReviewerFromFeedbackFirstLine = (rawText: string): string => {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const feedbackStart = lines.findIndex((line) => /(첨삭\s*총평|선생님\s*총평|총평)/i.test(line));
  if (feedbackStart < 0) {
    return "";
  }

  const firstFeedbackLine = lines
    .slice(feedbackStart + 1)
    .find((line) => line.length > 0);

  if (!firstFeedbackLine) {
    return "";
  }

  const match = firstFeedbackLine.match(/^(?:첨삭자|채점자)\s*[:：]\s*(.+)$/i);
  if (!match?.[1]) {
    return "";
  }

  return sanitizeReviewerName(match[1]);
};

const extractField = (text: string, labels: string[]): string => {
  const stopTokens = [
    "작성일",
    "수강반",
    "논제",
    "이름",
    "독해력",
    "내용 이해력",
    "문제 이해력",
    "구성력",
    "표현력",
    "총점",
    "등급",
    "첨삭 총평",
    "첨삭자",
  ];

  for (const label of labels) {
    const stopPattern = stopTokens.map((token) => escapeRegex(token)).join("|");
    const regex = new RegExp(
      `${escapeRegex(label)}\\s*[:：]?\\s*([^\\n]+?)\\s*(?=${stopPattern}|$)`,
      "i",
    );
    const matched = text.match(regex);
    if (matched?.[1]) {
      return matched[1].trim();
    }
  }

  return "";
};

const getMetricSegment = (text: string, label: MetricLabel) => {
  const aliases = METRIC_ALIASES[label];
  const matchedAlias = aliases.find((alias) => new RegExp(escapeRegex(alias), "i").test(text));
  if (!matchedAlias) {
    return "";
  }
  const start = text.search(new RegExp(escapeRegex(matchedAlias), "i"));
  if (start < 0) {
    return "";
  }

  const nextLabels = METRIC_LABELS.filter((current) => current !== label)
    .map((current) => {
      const currentAliases = METRIC_ALIASES[current];
      const slice = text.slice(start + matchedAlias.length);
      const aliasIndices = currentAliases
        .map((alias) => slice.search(new RegExp(escapeRegex(alias), "i")))
        .filter((idx) => idx >= 0);
      const idx = aliasIndices.length > 0 ? Math.min(...aliasIndices) : -1;
      if (idx < 0) {
        return Number.POSITIVE_INFINITY;
      }
      return start + matchedAlias.length + idx;
    })
    .filter(Number.isFinite);

  const nextTotalIdx = text.slice(start + matchedAlias.length).search(/총점\s*[:：]?/i);
  const totalIdx =
    nextTotalIdx < 0 ? Number.POSITIVE_INFINITY : start + matchedAlias.length + nextTotalIdx;
  const end = Math.min(...nextLabels, totalIdx, start + 220);

  return text.slice(start, end);
};

const parseMetricTriple = (segment: string): [number | null, number | null, number | null] => {
  const values = (segment.match(/-?\d+(?:\.\d+)?/g) ?? []).map((value) => Number(value));
  if (values.length < 3) {
    return [null, null, null];
  }

  const lastThree = values.slice(-3);
  return [
    Number.isFinite(lastThree[0]) ? lastThree[0] : null,
    Number.isFinite(lastThree[1]) ? lastThree[1] : null,
    Number.isFinite(lastThree[2]) ? lastThree[2] : null,
  ];
};

const sanitizeFeedback = (input: string, studentName = "", className = ""): string => {
  const classNamePattern = className ? new RegExp(escapeRegex(className), "gi") : null;
  const studentNamePattern = studentName ? new RegExp(`${escapeRegex(studentName)}\\s*$`, "i") : null;

  return input
    .replace(/김윤환\s*class/gi, " ")
    .replace(/첨삭\s*채점표/gi, " ")
    .replace(/내용\s*형식/gi, " ")
    .replace(/작성일\s*[:：]?\s*[0-9./-]+/gi, " ")
    .replace(/수강반\s*[:：]?\s*[^\s]+/gi, " ")
    .replace(/논제\s*[:：]?\s*[^\n]+/gi, " ")
    .replace(/(?:이름|성명|학생명)\s*[:：]?\s*[가-힣A-Za-z]{2,10}/gi, " ")
    .replace(/(?:독해력|내용\s*이해력|문제\s*이해력|구성력|표현력|총점)\s*[:：]?\s*-?\d+(?:\.\d+)?/gi, " ")
    .replace(/(?:독해력|내용\s*이해력|문제\s*이해력|구성력|표현력|총점|등급)\s*[:：]?/gi, " ")
    .replace(/(?:나의\s*점수|전체\s*평균|환산\s*점수)\s*[:：]?/gi, " ")
    .replace(/\b(?:50|60|70|80|90)\b(?:\s+\b(?:50|60|70|80|90)\b)+/g, " ")
    .replace(/\b-?\d+(?:\.\d+)?\b(?:\s+\b-?\d+(?:\.\d+)?\b){2,}/g, " ")
    .replace(/\d{4}\.\s?\d{1,2}\.\s?\d{1,2}/g, " ")
    .replace(/\b(?:19|20)\d{2}[./-]\d{1,2}[./-]\d{1,2}\b/g, " ")
    .replace(/\b\d{1,3}(?:\.\d+)?\s*점\b/g, " ")
    .replace(/\(\s*\d+\s*점\s*만점\s*\)/g, " ")
    .replace(/\b\d{1,3}\s*\/\s*\d{1,3}\b/g, " ")
    .replace(classNamePattern ?? /$^/, " ")
    .replace(/[|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim()
    .replace(studentNamePattern ?? /$^/, "")
    .trim();
};

const extractFeedback = (text: string): string => {
  const start = text.search(/(첨삭\s*총평|선생님\s*총평|총평)\s*[:：]?/i);
  if (start < 0) {
    return "";
  }

  const sliced = text
    .slice(start)
    .replace(/(첨삭\s*총평|선생님\s*총평|총평)\s*[:：]?/i, "")
    .trim();
  const stopLabels = [
    /\b작성일\b/i,
    /\b논제\b/i,
    /\b등급\b/i,
    /\b총점\b/i,
    /\b수강반\b/i,
    /\b이름\b/i,
    /\b성명\b/i,
    /\b학생명\b/i,
    /\b독해력\b/i,
    /\b내용\s*이해력\b/i,
    /\b문제\s*이해력\b/i,
    /\b구성력\b/i,
    /\b표현력\b/i,
    /\b내용\s*형식\b/i,
    /\d+\s*\/\s*\d+\s*페이지/i,
  ];

  let endIndex = sliced.length;
  for (const stop of stopLabels) {
    const index = sliced.search(stop);
    if (index >= 0) {
      endIndex = Math.min(endIndex, index);
    }
  }

  return sanitizeFeedback(sliced.slice(0, endIndex).trim());
};

const parsePdfText = (rawText: string): ParsedPdfData => {
  const text = normalizeText(rawText);

  const readingSegment = getMetricSegment(text, "독해력");
  const comprehensionSegment = getMetricSegment(text, "내용 이해력");
  const problemSegment = getMetricSegment(text, "문제 이해력");
  const organizationSegment = getMetricSegment(text, "구성력");
  const expressionSegment = getMetricSegment(text, "표현력");

  const [readingMine, readingAvg, readingConverted] = parseMetricTriple(readingSegment);
  const [compMine, compAvg, compConverted] = parseMetricTriple(comprehensionSegment);
  const [problemMine, problemAvg, problemConverted] = parseMetricTriple(problemSegment);
  const [orgMine, orgAvg, orgConverted] = parseMetricTriple(organizationSegment);
  const [expMine, expAvg, expConverted] = parseMetricTriple(expressionSegment);

  const totalByBox = parseNumber(text.match(/총점\s*[:：]?\s*(-?\d+(?:\.\d+)?)/i)?.[1]);
  const totalByConverted = [readingConverted, compConverted, problemConverted, orgConverted, expConverted]
    .filter((value): value is number => Number.isFinite(value))
    .reduce((acc, value) => acc + value, 0);

  return {
    name: extractField(text, ["이름", "성명", "학생명"]),
    className: extractField(text, ["수강반", "반"]),
    writtenAt: extractField(text, ["작성일", "작성 일자"]),
    essayTopic: extractField(text, ["논제", "주제"]),
    grade: extractField(text, ["등급"]),
    reviewer: extractField(text, ["첨삭자", "채점자"]),
    feedback: extractFeedback(text),
    scores: {
      reading: readingMine,
      comprehension: compMine,
      problemUnderstanding: problemMine,
      organization: orgMine,
      expression: expMine,
      total: totalByBox,
    },
    averageScores: {
      reading: readingAvg,
      comprehension: compAvg,
      problemUnderstanding: problemAvg,
      organization: orgAvg,
      expression: expAvg,
      total: null,
    },
    convertedScores: {
      reading: readingConverted,
      comprehension: compConverted,
      problemUnderstanding: problemConverted,
      organization: orgConverted,
      expression: expConverted,
      total: totalByConverted > 0 ? totalByConverted : null,
    },
    rawText: text,
  };
};

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (params: { data?: ArrayBuffer; url?: string }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getViewport?: (params: { scale: number }) => { width: number; height: number };
        render?: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
          promise: Promise<void>;
        };
        getTextContent: () => Promise<{
          items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }>;
        }>;
      }>;
    }>;
  };
};

type PageToken = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

type PageScope = {
  pageIndex: number;
  rawText: string;
  normalizedText: string;
  tokens: PageToken[];
};

const toLineText = (tokens: PageToken[]) =>
  tokens
    .slice()
    .sort((a, b) => a.x - b.x)
    .map((token) => token.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

const groupTokensByLine = (tokens: PageToken[], threshold = 7) => {
  const sorted = tokens
    .filter((token) => token.text.trim().length > 0)
    .slice()
    .sort((a, b) => (Math.abs(a.y - b.y) < 0.5 ? a.x - b.x : a.y - b.y));

  const lines: PageToken[][] = [];
  for (const token of sorted) {
    const last = lines[lines.length - 1];
    if (!last) {
      lines.push([token]);
      continue;
    }

    const baseline = last[0]?.y ?? token.y;
    if (Math.abs(baseline - token.y) <= threshold) {
      last.push(token);
    } else {
      lines.push([token]);
    }
  }

  return lines;
};

const parseTokenNumber = (tokenText: string): number | null => {
  const match = tokenText.match(/-?\d+(?:\.\d+)?/);
  return match ? parseNumber(match[0]) : null;
};

const findLabelToken = (tokens: PageToken[], labels: string[]) => {
  return tokens.find((token) =>
    labels.some((label) => new RegExp(`^${escapeRegex(label)}\\s*[:：]?$`, "i").test(token.text.trim())),
  );
};

const extractNameFromTokens = (scope: PageScope): string => {
  const labelToken = findLabelToken(scope.tokens, ["이름", "성명", "학생명"]);
  if (!labelToken) {
    return normalizeName(extractField(scope.normalizedText, ["이름", "성명", "학생명"]));
  }

  const sameLine = scope.tokens
    .filter((token) => Math.abs(token.y - labelToken.y) <= 7 && token.x > labelToken.x + labelToken.width)
    .sort((a, b) => a.x - b.x);

  if (sameLine.length === 0) {
    return normalizeName(extractField(scope.normalizedText, ["이름", "성명", "학생명"]));
  }

  const chunks: string[] = [];
  for (let i = 0; i < sameLine.length; i += 1) {
    const current = sameLine[i];
    const prev = sameLine[i - 1];
    if (prev) {
      const gap = current.x - (prev.x + prev.width);
      if (gap > 28) {
        break;
      }
    }
    chunks.push(current.text);
  }

  return normalizeName(chunks.join(" "));
};

const extractReviewerFromScope = (scope: PageScope): string => {
  const labelToken = findLabelToken(scope.tokens, ["첨삭자", "채점자"]);
  if (!labelToken) {
    return (
      extractReviewerFromRawText(scope.rawText) ||
      sanitizeReviewerName(extractField(scope.normalizedText, ["첨삭자", "채점자"]))
    );
  }

  const sameLine = scope.tokens
    .filter((token) => Math.abs(token.y - labelToken.y) <= 7 && token.x > labelToken.x + labelToken.width)
    .sort((a, b) => a.x - b.x);

  if (sameLine.length === 0) {
    return (
      extractReviewerFromRawText(scope.rawText) ||
      sanitizeReviewerName(extractField(scope.normalizedText, ["첨삭자", "채점자"]))
    );
  }

  const chunks: string[] = [];
  for (let i = 0; i < sameLine.length; i += 1) {
    const current = sameLine[i];
    const prev = sameLine[i - 1];
    if (prev) {
      const gap = current.x - (prev.x + prev.width);
      if (gap > 36) {
        break;
      }
    }

    if (/(작성일|수강반|논제|첨삭\s*총평|총평|독해력|내용\s*이해력|문제\s*이해력|구성력|표현력|총점|등급)/i.test(current.text)) {
      break;
    }

    chunks.push(current.text);
  }

  return sanitizeReviewerName(chunks.join(" ")) || extractReviewerFromRawText(scope.rawText);
};

const findScoreColumnX = (tokens: PageToken[]): number | null => {
  const rowToken = tokens.find((token) => /나의\s*점수/i.test(token.text));
  if (!rowToken) {
    return null;
  }
  return rowToken.x + rowToken.width / 2;
};

const getMetricMineScore = (
  scope: PageScope,
  label: MetricLabel,
  scoreColumnX: number | null,
): number | null => {
  const labelToken = scope.tokens.find((token) =>
    METRIC_ALIASES[label].some((alias) => new RegExp(`^${escapeRegex(alias)}\\s*$`, "i").test(token.text)),
  );

  if (!labelToken) {
    return null;
  }

  const rowCandidates = scope.tokens
    .filter(
      (token) =>
        Math.abs(token.y - labelToken.y) <= 8 &&
        token.x > labelToken.x &&
        /-?\d+(?:\.\d+)?/.test(token.text),
    )
    .map((token) => ({
      token,
      value: parseTokenNumber(token.text),
      distance:
        scoreColumnX === null
          ? token.x - labelToken.x
          : Math.abs(token.x + token.width / 2 - scoreColumnX),
    }))
    .filter((candidate) => Number.isFinite(candidate.value));

  if (rowCandidates.length === 0) {
    return null;
  }

  rowCandidates.sort((a, b) => a.distance - b.distance);
  return rowCandidates[0].value;
};

const extractBoxValueNearKeyword = (
  scope: PageScope,
  keyword: RegExp,
  valuePattern: RegExp,
): string => {
  const keywordToken = scope.tokens.find((token) => keyword.test(token.text));
  if (!keywordToken) {
    return "";
  }

  const candidates = scope.tokens
    .filter((token) => token !== keywordToken && valuePattern.test(token.text))
    .map((token) => {
      const dx = token.x - (keywordToken.x + keywordToken.width);
      const dy = Math.abs(token.y - keywordToken.y);
      const score = dy * 10 + Math.abs(dx);
      return { token, score, sameLine: dy <= 10 && dx >= -8 };
    })
    .filter((entry) => entry.sameLine || entry.token.y >= keywordToken.y - 6)
    .sort((a, b) => a.score - b.score);

  if (candidates.length === 0) {
    return "";
  }

  const matched = candidates[0].token.text.match(valuePattern);
  return matched?.[0]?.trim() ?? "";
};

const extractFeedbackFromScope = (scope: PageScope, studentName: string, className: string): string => {
  const startToken = scope.tokens.find((token) => /(첨삭\s*총평|선생님\s*총평|총평)/i.test(token.text));
  if (!startToken) {
    return sanitizeFeedback(extractFeedback(scope.normalizedText), studentName, className);
  }

  const stopPattern =
    /(작성일|수강반|독해력|내용\s*이해력|문제\s*이해력|구성력|표현력|총점|등급|\d+\s*\/\s*\d+\s*페이지|\d{4}\.\s?\d{1,2}\.\s?\d{1,2})/i;

  const lowerTokens = scope.tokens
    .filter((token) => token.y >= startToken.y - 2)
    .slice()
    .sort((a, b) => (Math.abs(a.y - b.y) < 0.5 ? a.x - b.x : a.y - b.y));

  const stopToken = lowerTokens.find(
    (token) => token !== startToken && token.y >= startToken.y + 16 && stopPattern.test(token.text),
  );

  const bottomY = stopToken ? stopToken.y : Number.POSITIVE_INFINITY;
  const feedbackTokens = lowerTokens.filter(
    (token) =>
      token !== startToken &&
      token.y >= startToken.y &&
      token.y < bottomY &&
      !/(첨삭\s*총평|선생님\s*총평|총평)/i.test(token.text),
  );

  const lines = groupTokensByLine(feedbackTokens);
  const textLines = lines.map(toLineText).filter(Boolean);
  if (/^(?:첨삭자|채점자)\s*[:：]\s*.+$/i.test(textLines[0] ?? "")) {
    textLines.shift();
  }
  const rawFeedback = textLines.join("\n").trim();
  return sanitizeFeedback(rawFeedback, studentName, className);
};

const parsePdfPage = (scope: PageScope): ParsedPdfData => {
  const text = scope.normalizedText;
  const name = extractNameFromTokens(scope);
  const className = extractField(text, ["수강반", "반"]);
  const writtenAt = extractField(text, ["작성일", "작성 일자"]);
  const essayTopic = extractField(text, ["논제", "주제"]);
  const feedback = extractFeedbackFromScope(scope, name, className);
  const reviewer =
    extractReviewerFromScope(scope) ||
    extractReviewerFromFeedbackFirstLine(scope.rawText) ||
    sanitizeReviewerName(extractField(text, ["첨삭자", "채점자"]));
  const scoreColumnX = findScoreColumnX(scope.tokens);

  const readingSegment = getMetricSegment(text, "독해력");
  const comprehensionSegment = getMetricSegment(text, "내용 이해력");
  const problemSegment = getMetricSegment(text, "문제 이해력");
  const organizationSegment = getMetricSegment(text, "구성력");
  const expressionSegment = getMetricSegment(text, "표현력");

  const [readingMineByText, readingAvg, readingConverted] = parseMetricTriple(readingSegment);
  const [compMineByText, compAvg, compConverted] = parseMetricTriple(comprehensionSegment);
  const [problemMineByText, problemAvg, problemConverted] = parseMetricTriple(problemSegment);
  const [orgMineByText, orgAvg, orgConverted] = parseMetricTriple(organizationSegment);
  const [expMineByText, expAvg, expConverted] = parseMetricTriple(expressionSegment);

  const readingMine = getMetricMineScore(scope, "독해력", scoreColumnX) ?? readingMineByText;
  const compMine = getMetricMineScore(scope, "내용 이해력", scoreColumnX) ?? compMineByText;
  const problemMine = getMetricMineScore(scope, "문제 이해력", scoreColumnX) ?? problemMineByText;
  const orgMine = getMetricMineScore(scope, "구성력", scoreColumnX) ?? orgMineByText;
  const expMine = getMetricMineScore(scope, "표현력", scoreColumnX) ?? expMineByText;

  const totalByBox = parseNumber(
    extractBoxValueNearKeyword(scope, /총점/, /-?\d+(?:\.\d+)?/i) ||
      text.match(/총점\s*[:：]?\s*(-?\d+(?:\.\d+)?)/i)?.[1],
  );
  const gradeByBox =
    extractBoxValueNearKeyword(scope, /등급/, /[A-Za-z가-힣][A-Za-z0-9+\-가-힣]*/i) ||
    extractField(text, ["등급"]);

  const totalByConverted = [readingConverted, compConverted, problemConverted, orgConverted, expConverted]
    .filter((value): value is number => Number.isFinite(value))
    .reduce((acc, value) => acc + value, 0);

  return {
    name,
    className,
    writtenAt,
    essayTopic,
    grade: gradeByBox,
    reviewer,
    feedback,
    scores: {
      reading: readingMine,
      comprehension: compMine,
      problemUnderstanding: problemMine,
      organization: orgMine,
      expression: expMine,
      total: totalByBox,
    },
    averageScores: {
      reading: readingAvg,
      comprehension: compAvg,
      problemUnderstanding: problemAvg,
      organization: orgAvg,
      expression: expAvg,
      total: null,
    },
    convertedScores: {
      reading: readingConverted,
      comprehension: compConverted,
      problemUnderstanding: problemConverted,
      organization: orgConverted,
      expression: expConverted,
      total: totalByConverted > 0 ? totalByConverted : null,
    },
    rawText: text,
  };
};

const loadPdfJs = async (): Promise<PdfJsModule> => {
  const packageCandidates = [
    {
      pdf: "pdfjs-dist/build/pdf.mjs",
      worker: "pdfjs-dist/build/pdf.worker.min.mjs",
    },
    {
      pdf: "pdfjs-dist/legacy/build/pdf.mjs",
      worker: "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    },
  ];

  for (const source of packageCandidates) {
    try {
      const mod = (await import(
        /* @vite-ignore */ source.pdf
      )) as unknown as PdfJsModule;
      mod.GlobalWorkerOptions.workerSrc = source.worker;
      return mod;
    } catch {
      // local dependency 미설치 시 CDN fallback 사용
    }
  }

  const cdnCandidates = [
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`,
    `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`,
  ];

  let lastError: unknown;
  for (const source of cdnCandidates) {
    try {
      const mod = (await import(
        /* @vite-ignore */ source
      )) as unknown as PdfJsModule;
      mod.GlobalWorkerOptions.workerSrc = source.replace("pdf.mjs", "pdf.worker.min.mjs");
      return mod;
    } catch (error) {
      lastError = error;
    }
  }

  throw new Error(
    `pdfjs-dist 모듈을 로드하지 못했습니다. ${
      lastError instanceof Error ? lastError.message : ""
    }`,
  );
};

export const extractPdfData = async (file: File): Promise<ParsedPdfData> => {
  try {
    if (!/\.pdf$/i.test(file.name)) {
      throw new Error("PDF 파일이 아닙니다.");
    }

    const chunks = await extractPdfDataByStudent(file);
    const parsed = chunks[0]?.parsed;
    if (!parsed) {
      throw new Error("PDF에서 파싱 가능한 페이지를 찾지 못했습니다.");
    }

    if (!parsed.name && !parsed.essayTopic && !parsed.feedback) {
      throw new Error("양식에서 필요한 텍스트를 추출하지 못했습니다.");
    }

    return parsed;
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "PDF 파싱 중 오류가 발생했습니다.",
    );
  }
};

const extractPageScope = async (
  pdf: Awaited<ReturnType<PdfJsModule["getDocument"]>["promise"]>,
  pageIndex: number,
): Promise<PageScope> => {
  const page = await pdf.getPage(pageIndex);
  const viewport = page.getViewport?.({ scale: 1 });
  const pageHeight = viewport?.height ?? 0;
  const content = await page.getTextContent();

  const tokens = (content.items as Array<{ str?: string; transform?: number[]; width?: number; height?: number }>)
    .map((item) => {
      const text = (item.str ?? "").replace(/\s+/g, " ").trim();
      const transform = item.transform ?? [];
      const rawX = transform[4] ?? 0;
      const rawY = transform[5] ?? 0;
      const y = pageHeight > 0 ? pageHeight - rawY : rawY;
      return {
        text,
        x: rawX,
        y,
        width: item.width ?? 0,
        height: item.height ?? Math.abs(transform[3] ?? 0),
      };
    })
    .filter((token) => token.text.length > 0);

  const lines = groupTokensByLine(tokens);
  const rawText = lines.map(toLineText).join("\n").trim();

  return {
    pageIndex,
    rawText,
    normalizedText: normalizeText(rawText),
    tokens,
  };
};

const extractPdfDataByStudent = async (
  file: File,
): Promise<Array<{ parsed: ParsedPdfData; sourcePage: number }>> => {
  if (!/\.pdf$/i.test(file.name)) {
    throw new Error("PDF 파일이 아닙니다.");
  }

  const pdfjs = await loadPdfJs();
  const bytes = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: bytes }).promise;
  const pageScopes = await Promise.all(
    Array.from({ length: pdf.numPages }, (_, index) => extractPageScope(pdf, index + 1)),
  );

  const markerPages = pageScopes.filter((scope) => STUDENT_SECTION_MARKER.test(scope.rawText));
  const targetPages = markerPages.length > 0 ? markerPages : pageScopes.filter((scope) => scope.normalizedText);

  return targetPages.map((scope) => ({
    parsed: parsePdfPage(scope),
    sourcePage: scope.pageIndex,
  }));
};

const byName = (students: StudentLite[], name: string) => {
  const normalized = name.trim();
  if (!normalized) {
    return [];
  }
  return students.filter((student) => student.name.trim() === normalized);
};

export const resolveMatchStatus = (
  parsedName: string,
  classStudents: StudentLite[],
  allStudents: StudentLite[],
): Pick<UploadCandidate, "status" | "candidates" | "selectedStudentUid"> => {
  const globalMatches = byName(allStudents, parsedName);
  void classStudents;

  if (globalMatches.length === 1) {
    return {
      status: "ready",
      candidates: globalMatches,
      selectedStudentUid: globalMatches[0].uid,
    };
  }

  if (globalMatches.length > 1) {
    return {
      status: "needs_selection",
      candidates: globalMatches,
      selectedStudentUid: null,
    };
  }

  if (!parsedName.trim()) {
    return {
      status: "unregistered",
      candidates: allStudents,
      selectedStudentUid: null,
    };
  }

  return {
    status: "unregistered",
    candidates: byName(allStudents, parsedName),
    selectedStudentUid: null,
  };
};

export const prepareUploadCandidates = async (
  files: File[],
  classStudents: StudentLite[],
  allStudents: StudentLite[],
): Promise<UploadCandidate[]> => {
  const candidates: UploadCandidate[] = [];

  for (const file of files) {
    const fileHint = parseFileNameHint(file.name);
    try {
      const chunks = await extractPdfDataByStudent(file);
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        const merged = {
          ...chunk.parsed,
          name: chunk.parsed.name || fileHint.name || "",
          scores: {
            ...chunk.parsed.scores,
            total: chunk.parsed.scores.total ?? chunk.parsed.convertedScores.total ?? fileHint.total ?? null,
          },
        };
        const match = resolveMatchStatus(merged.name, classStudents, allStudents);
        candidates.push({
          id: `${file.name}-${file.lastModified}-${chunk.sourcePage}-${chunkIndex}`,
          file,
          sourcePage: chunk.sourcePage,
          sourcePageLabel: `${chunk.sourcePage}p`,
          parsed: merged,
          ...match,
        });
      }
    } catch (error) {
      candidates.push({
        id: `${file.name}-${file.lastModified}-error`,
        file,
        sourcePage: 1,
        sourcePageLabel: "1p",
        parsed: {
          ...EMPTY_PARSED,
          name: fileHint.name || "",
          scores: {
            ...EMPTY_PARSED.scores,
            total: fileHint.total ?? null,
          },
        },
        status: "unregistered",
        candidates: allStudents,
        selectedStudentUid: null,
        parseError: error instanceof Error ? error.message : "파싱 오류가 발생했습니다.",
      });
    }
  }

  return candidates;
};

const hasScoreIntegrity = (scores: ScoreBreakdown) =>
  REQUIRED_SCORE_KEYS.every((key) => Number.isFinite(scores[key]));

const sumRequiredScores = (scores: ScoreBreakdown) =>
  REQUIRED_SCORE_KEYS.reduce((acc, key) => acc + (scores[key] ?? 0), 0);

const isPermissionDeniedError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const lowered = message.toLowerCase();
  return (
    lowered.includes("permission_denied") ||
    lowered.includes("permission denied") ||
    lowered.includes("permission-denied") ||
    lowered.includes("storage/unauthorized") ||
    lowered.includes("storage/unauthenticated")
  );
};

const normalizePublishError = (error: unknown) => {
  const fallback = "배포 처리에 실패했습니다.";
  const reason = error instanceof Error ? error.message : fallback;
  const lowered = reason.toLowerCase();

  if (lowered.includes("unauthenticated")) {
    return "로그인이 필요합니다.";
  }

  if (isPermissionDeniedError(error)) {
    return `${reason}\nFirebase Storage 보안 규칙 확인이 필요합니다.`;
  }

  return reason;
};

const uploadPdfToStorage = async (
  userId: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<string> => {
  const storageRef = ref(storage, `reports/${userId}/${Date.now()}_${file.name}`);
  const task = uploadBytesResumable(storageRef, file);

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      task.cancel();
      reject(new Error("Storage 업로드 시간 초과(60초). 네트워크/권한을 확인하세요."));
    }, STORAGE_UPLOAD_TIMEOUT_MS);

    task.on(
      "state_changed",
      (snapshot) => {
        if (!onProgress || snapshot.totalBytes === 0) {
          return;
        }
        onProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      },
      () => {
        clearTimeout(timeoutId);
        resolve();
      },
    );
  });

  return getDownloadURL(storageRef);
};

export const publishReportBatch = async (
  uploadRows: UploadCandidate[],
  selectedClass: ClassLite,
  selectedSession: UploadSession,
  allStudents: StudentLite[],
  uid: string,
  onOverallProgress?: (progress: number) => void,
): Promise<{
  successCount: number;
  failureCount: number;
  pendingCount: number;
  autoAssignedNotices: string[];
  failures: string[];
  results: Array<{ candidateId: string; success: boolean; reportId?: string; error?: string }>;
}> => {
  if (!uploadRows.length) {
    return {
      successCount: 0,
      failureCount: 0,
      pendingCount: 0,
      autoAssignedNotices: [],
      failures: [],
      results: [],
    };
  }

  let successCount = 0;
  let pendingCount = 0;
  const autoAssignedNotices: string[] = [];
  const failures: string[] = [];
  const results: Array<{ candidateId: string; success: boolean; reportId?: string; error?: string }> = [];

  for (let i = 0; i < uploadRows.length; i += 1) {
    const row = uploadRows[i];

    try {
      if (!hasScoreIntegrity(row.parsed.scores)) {
        throw new Error(
          "파싱 실패: 점수 5개(독해력/내용 이해력/문제 이해력/구성력/표현력)를 모두 입력해주세요.",
        );
      }

      if (!row.parsed.feedback.trim()) {
        throw new Error("파싱 실패: 첨삭 총평이 비어 있습니다.");
      }

      const matched = row.parsed.name.trim()
        ? allStudents.filter((entry) => entry.name.trim() === row.parsed.name.trim())
        : [];

      const forcedStudent = row.selectedStudentUid
        ? allStudents.find((entry) => entry.uid === row.selectedStudentUid) ?? null
        : null;

      const completedStudent = forcedStudent ?? (matched.length === 1 ? matched[0] : null);
      const assignmentStatus: ReportAssignmentStatus = completedStudent
        ? "completed"
        : matched.length > 1
          ? "duplicate_pending"
          : "unassigned_pending";

      const storageOwnerUid = completedStudent?.uid ?? uid;

      const url = await uploadPdfToStorage(storageOwnerUid, row.file, (fileProgress) => {
        const baseProgress = (i / uploadRows.length) * 100;
        onOverallProgress?.(baseProgress + fileProgress / uploadRows.length);
      });

      const totalScore = row.parsed.scores.total ?? sumRequiredScores(row.parsed.scores);

      const created = await addDoc(collection(db, "reports"), {
        uid,
        classId: selectedClass.id,
        className: selectedClass.name,
        sessionId: selectedSession.id,
        testSession: selectedSession.sessionNumber,
        testDate: selectedSession.testDate,
        session_id: selectedSession.id,
        test_session: selectedSession.sessionNumber,
        test_date: selectedSession.testDate,
        fileHash: row.fileHash ?? null,
        studentUid: completedStudent?.uid ?? null,
        studentId: completedStudent?.studentId ?? null,
        studentName: completedStudent?.name ?? (row.parsed.name || ""),
        assignmentStatus,
        status: completedStudent ? "completed" : "pending",
        assignedAt: completedStudent ? serverTimestamp() : null,
        sourceName: row.parsed.name || "",
        writtenAt: row.parsed.writtenAt || "",
        reviewer: row.parsed.reviewer || "",
        essayTopic: row.parsed.essayTopic || "",
        grade: row.parsed.grade || "",
        feedback: row.parsed.feedback || "",
        scores: {
          ...row.parsed.scores,
          total: totalScore,
        },
        averageScores: row.parsed.averageScores,
        convertedScores: row.parsed.convertedScores,
        parsedJson: {
          ...row.parsed,
          scores: {
            ...row.parsed.scores,
            total: totalScore,
          },
        },
        totalScore,
        isRead: false,
        fileUrl: url,
        fileName: row.file.name,
        sourcePage: row.sourcePage,
        pageNumber: row.sourcePage,
        createdAt: serverTimestamp(),
      });

      if (assignmentStatus === "completed") {
        successCount += 1;
        if (!forcedStudent && matched.length === 1) {
          autoAssignedNotices.push(`[${completedStudent?.name}] 학생에게 리포트를 전달했습니다`);
        }
      } else {
        pendingCount += 1;
      }
      results.push({ candidateId: row.id, success: true, reportId: created.id });
      onOverallProgress?.(((i + 1) / uploadRows.length) * 100);
    } catch (error) {
      const reason = normalizePublishError(error);
      failures.push(`${row.file.name}: ${reason}`);
      results.push({ candidateId: row.id, success: false, error: reason });
    }
  }

  return {
    successCount,
    failureCount: failures.length,
    pendingCount,
    autoAssignedNotices,
    failures,
    results,
  };
};

export const fetchStudents = async (): Promise<StudentLite[]> => {
  try {
    const snap = await getDocs(query(collection(db, "users"), where("role", "in", ["student", "STUDENT"])));
    return snap.docs.map((docSnap) => {
      const data = docSnap.data() as {
        uid?: string;
        name?: string;
        email?: string;
        classId?: string;
        className?: string;
        studentId?: string;
        phoneNumber?: string;
        phoneSuffix?: string;
      };
      const phoneDigits = (data.phoneNumber ?? "").replace(/\D/g, "");
      const phoneLast4 = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : null;
      const studentId = data.studentId ?? data.phoneSuffix ?? phoneLast4 ?? null;
      return {
        uid: data.uid ?? docSnap.id,
        name: data.name ?? "이름없음",
        email: data.email ?? "",
        classId: data.classId ?? null,
        className: data.className ?? null,
        studentId,
        phoneNumber: data.phoneNumber ?? null,
        phoneSuffix: data.phoneSuffix ?? null,
      };
    });
  } catch {
    return [];
  }
};

export const fetchClasses = async (): Promise<ClassLite[]> => {
  try {
    const snap = await getDocs(query(collection(db, "classes"), orderBy("createdAt", "desc")));
    return snap.docs.map((docSnap) => {
      const data = docSnap.data() as { name?: string };
      return { id: docSnap.id, name: data.name ?? "이름 없는 반" };
    });
  } catch {
    return [];
  }
};

export const submitClassJoinRequest = async (
  student: Pick<StudentLite, "uid" | "name" | "email">,
  classInfo: ClassLite,
): Promise<void> => {
  const studentRef = doc(db, "users", student.uid);
  const studentSnap = await getDoc(studentRef);

  if (!studentSnap.exists()) {
    throw new Error("학생 계정 정보를 찾을 수 없습니다.");
  }

  const studentData = studentSnap.data() as {
    classId?: string | null;
    className?: string | null;
  };

  if (studentData.classId === classInfo.id) {
    throw new Error("이미 배정된 반입니다.");
  }

  await updateDoc(studentRef, {
    classId: classInfo.id,
    className: classInfo.name,
    isEnrolled: true,
    enrollmentStatus: "active",
    updatedAt: serverTimestamp(),
  });
};

export const fetchMyClassJoinRequests = async (
  studentUid: string,
): Promise<ClassJoinRequestRecord[]> => {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, "classJoinRequests"),
        where("studentUid", "==", studentUid),
        orderBy("createdAt", "desc"),
      ),
    );

    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Omit<ClassJoinRequestRecord, "id">;
      return { id: docSnap.id, ...data };
    });
  } catch {
    const snapshot = await getDocs(
      query(collection(db, "classJoinRequests"), where("studentUid", "==", studentUid)),
    );

    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Omit<ClassJoinRequestRecord, "id">;
        return { id: docSnap.id, ...data };
      })
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  }
};

export const fetchPendingClassJoinRequests = async (): Promise<ClassJoinRequestRecord[]> => {
  try {
    const snapshot = await getDocs(
      query(
        collection(db, "classJoinRequests"),
        where("status", "==", "pending"),
        orderBy("createdAt", "asc"),
      ),
    );

    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Omit<ClassJoinRequestRecord, "id">;
      return { id: docSnap.id, ...data };
    });
  } catch {
    const snapshot = await getDocs(query(collection(db, "classJoinRequests"), where("status", "==", "pending")));
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Omit<ClassJoinRequestRecord, "id">;
      return { id: docSnap.id, ...data };
    });
  }
};

export const approveClassJoinRequest = async (
  requestId: string,
  adminUid: string,
): Promise<void> => {
  const requestRef = doc(db, "classJoinRequests", requestId);
  const requestSnap = await getDoc(requestRef);

  if (!requestSnap.exists()) {
    throw new Error("가입 신청 문서를 찾을 수 없습니다.");
  }

  const requestData = requestSnap.data() as ClassJoinRequestRecord;
  if (requestData.status !== "pending") {
    throw new Error("이미 처리된 신청입니다.");
  }

  await updateDoc(doc(db, "users", requestData.studentUid), {
    classId: requestData.classId,
    className: requestData.className,
    updatedAt: serverTimestamp(),
  });

  await updateDoc(requestRef, {
    status: "approved",
    approvedBy: adminUid,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const fetchReportsByStudentUid = async (studentUid: string): Promise<ReportRecord[]> => {
  const reportsRef = collection(db, "reports");

  try {
    const snapshot = await getDocs(query(reportsRef, where("studentUid", "==", studentUid), orderBy("createdAt", "desc")));

    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Omit<ReportRecord, "id">;
        return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
      })
      .filter((row) => row.assignmentStatus !== "duplicate_pending" && row.assignmentStatus !== "unassigned_pending")
      .sort((a, b) => getReportSortTimestamp(b) - getReportSortTimestamp(a));
  } catch {
    const snapshot = await getDocs(query(reportsRef, where("studentUid", "==", studentUid)));

    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Omit<ReportRecord, "id">;
        return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
      })
      .filter((row) => row.assignmentStatus !== "duplicate_pending" && row.assignmentStatus !== "unassigned_pending")
      .sort((a, b) => getReportSortTimestamp(b) - getReportSortTimestamp(a));
  }
};

export const fetchPendingReports = async (): Promise<ReportRecord[]> => {
  const reportsRef = collection(db, "reports");
  const statuses: ReportAssignmentStatus[] = ["duplicate_pending", "unassigned_pending"];

  const fetchByStatus = async (status: ReportAssignmentStatus) => {
    try {
      const snapshot = await getDocs(
        query(reportsRef, where("assignmentStatus", "==", status), orderBy("createdAt", "desc")),
      );
      return snapshot.docs
        .map((docSnap) => {
          const data = docSnap.data() as Omit<ReportRecord, "id">;
          return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
        })
        .sort((a, b) => getReportSortTimestamp(b) - getReportSortTimestamp(a));
    } catch {
      const snapshot = await getDocs(query(reportsRef, where("assignmentStatus", "==", status)));
      return snapshot.docs.map((docSnap) => {
        const data = docSnap.data() as Omit<ReportRecord, "id">;
        return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
      });
    }
  };

  const rows = (await Promise.all(statuses.map((status) => fetchByStatus(status)))).flat();
  return rows.sort((a, b) => getReportSortTimestamp(b) - getReportSortTimestamp(a));
};

export const assignPendingReportToStudent = async (
  reportId: string,
  student: Pick<StudentLite, "uid" | "name" | "studentId">,
): Promise<void> => {
  await updateDoc(doc(db, "reports", reportId), {
    studentUid: student.uid,
    studentId: student.studentId ?? null,
    studentName: student.name,
    assignmentStatus: "completed",
    status: "completed",
    assignedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
};

export const fetchReportsByClassId = async (classId: string): Promise<ReportRecord[]> => {
  const reportsRef = collection(db, "reports");

  try {
    const snapshot = await getDocs(
      query(reportsRef, where("classId", "==", classId), orderBy("createdAt", "desc")),
    );
    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Omit<ReportRecord, "id">;
        return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
      })
      .sort((a, b) => getReportSortTimestamp(b) - getReportSortTimestamp(a));
  } catch {
    const snapshot = await getDocs(query(reportsRef, where("classId", "==", classId)));
    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Omit<ReportRecord, "id">;
        return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
      })
      .sort((a, b) => getReportSortTimestamp(b) - getReportSortTimestamp(a));
  }
};

export const fetchPublishedReports = async (): Promise<ReportRecord[]> => {
  const reportsRef = collection(db, "reports");

  try {
    const snapshot = await getDocs(
      query(
        reportsRef,
        where("assignmentStatus", "==", "completed"),
        orderBy("createdAt", "desc"),
      ),
    );
    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Omit<ReportRecord, "id">;
        return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
      })
      .sort((a, b) => getReportSortTimestamp(b) - getReportSortTimestamp(a));
  } catch {
    const snapshot = await getDocs(
      query(reportsRef, where("assignmentStatus", "==", "completed")),
    );
    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Omit<ReportRecord, "id">;
        return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
      })
      .sort((a, b) => getReportSortTimestamp(b) - getReportSortTimestamp(a));
  }
};

export const updatePublishedReport = async (
  reportId: string,
  payload: {
    reviewer: string;
    feedback: string;
    scores: ScoreBreakdown;
  },
): Promise<void> => {
  const normalizedScores = {
    ...payload.scores,
    total: payload.scores.total ?? sumRequiredScores(payload.scores),
  };
  const nextTotal = normalizedScores.total ?? 0;
  const reportRef = doc(db, "reports", reportId);
  const snap = await getDoc(reportRef);
  const prev = (snap.data() ?? {}) as {
    parsedJson?: ParsedPdfData;
  };
  const updatePayload: {
    reviewer: string;
    feedback: string;
    scores: ScoreBreakdown;
    totalScore: number;
    parsedJson?: ParsedPdfData;
    updatedAt: ReturnType<typeof serverTimestamp>;
  } = {
    reviewer: payload.reviewer.trim(),
    feedback: payload.feedback.trim(),
    scores: normalizedScores,
    totalScore: nextTotal,
    updatedAt: serverTimestamp(),
  };

  if (prev.parsedJson) {
    updatePayload.parsedJson = {
      ...prev.parsedJson,
      reviewer: payload.reviewer.trim(),
      feedback: payload.feedback.trim(),
      scores: normalizedScores,
    };
  }

  await updateDoc(reportRef, updatePayload);
};

export const deletePublishedReport = async (reportId: string): Promise<void> => {
  await deleteDoc(doc(db, "reports", reportId));
};

export const deleteReportRecord = async (reportId: string): Promise<void> => {
  await deleteDoc(doc(db, "reports", reportId));
};

export const markReportAsRead = async (reportId: string): Promise<void> => {
  try {
    await updateDoc(doc(db, "reports", reportId), {
      isRead: true,
      readAt: serverTimestamp(),
    });
  } catch {
    // 읽음 처리 실패가 사용자 동작을 막지 않도록 무시
  }
};

const chunkBy = <T>(rows: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
};

export const isolateStudentReports = async (studentUid: string): Promise<void> => {
  const reportsRef = collection(db, "reports");
  const snapshot = await getDocs(query(reportsRef, where("studentUid", "==", studentUid)));
  const docs = snapshot.docs;

  for (const batchDocs of chunkBy(docs, 400)) {
    const batch = writeBatch(db);
    for (const reportDoc of batchDocs) {
      batch.update(reportDoc.ref, {
        studentUid: null,
        studentId: null,
        studentName: reportDoc.data().sourceName ?? "",
        assignmentStatus: "unassigned_pending",
        status: "pending",
        assignedAt: null,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
};

export const deleteStudentAccountData = async (studentUid: string): Promise<void> => {
  await isolateStudentReports(studentUid);
  await deleteDoc(doc(db, "users", studentUid));
};
