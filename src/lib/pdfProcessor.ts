import {
  Timestamp,
  addDoc,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  startAfter,
  writeBatch,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type WriteBatch,
} from "firebase/firestore";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { db } from "@/lib/firebase";
import { isStaffRole } from "@/lib/authz";
import { normalizeClassIds } from "@/services/classTransferService";

const STORAGE_UPLOAD_TIMEOUT_MS = 60_000;
const PDFJS_VERSION = "4.10.38";
const PUBLISHED_REPORT_PAGE_SIZE = 100;
const PDF_PARSE_CONCURRENCY = 2;
const pdfFileBufferCache = new WeakMap<File, Promise<ArrayBuffer>>();

export const readPdfFileBuffer = (file: File): Promise<ArrayBuffer> => {
  const cached = pdfFileBufferCache.get(file);
  if (cached) return cached;

  const read = file.arrayBuffer().catch((error) => {
    pdfFileBufferCache.delete(file);
    throw error;
  });
  pdfFileBufferCache.set(file, read);
  return read;
};

export const releasePdfFileBuffer = (file: File): void => {
  pdfFileBufferCache.delete(file);
};

export type MatchStatus = "ready" | "unregistered";
export type JoinRequestStatus = "pending" | "approved" | "rejected";
export type ReportAssignmentStatus = "completed" | "duplicate_pending" | "unassigned_pending";

export type StudentLite = {
  /** Firestore users 문서의 실제 Document ID */
  docId: string;
  /** Firebase Auth UID */
  uid: string;
  name: string;
  email: string;
  /** @deprecated 하위 호환용. 신규 로직은 classIds 사용 */
  classId?: string | null;
  /** 다중 반 소속 배열. 기존 classId 없는 유저는 [] 로 정규화됨 */
  classIds: string[];
  className?: string | null;
  studentId?: string | null;
  phoneNumber?: string | null;
  phoneSuffix?: string | null;
  role?: string;
  rawClassIds?: string[];
  isEnrolled?: boolean | null;
  enrollmentStatus?: string | null;
};

export type ClassLite = {
  id: string;
  name: string;
};

const resolvePrimaryClassId = (student: Pick<StudentLite, "classIds">): string | null =>
  normalizeClassIds(student.classIds).at(0) ?? null;

export type ScoreBreakdown = {
  reading: number | null;
  comprehension: number | null;
  problemUnderstanding: number | null;
  organization: number | null;
  expression: number | null;
  total: number | null;
};

export type ScoreParseConfidence = "high" | "medium" | "low" | "manual";

export type ScoreParseMeta = {
  confidence: ScoreParseConfidence;
  method: "layout-columns" | "layout-order" | "text-fallback" | "manual";
  warnings: string[];
};

export type ParsedPdfData = {
  name: string;
  className: string;
  studentId: string;
  phoneSuffix: string;
  writtenAt: string;
  essayTopic: string;
  grade: string;
  reviewer: string;
  feedback: string;
  scores: ScoreBreakdown;
  averageScores: ScoreBreakdown;
  convertedScores: ScoreBreakdown;
  scoreParse?: ScoreParseMeta;
  rawText: string;
};

export type PersistedParsedPdfData = Omit<ParsedPdfData, "rawText"> & {
  /** 기존 문서 호환용. 신규 저장에서는 원문 중복본을 보관하지 않는다. */
  rawText?: string;
};

export const compactParsedPdfData = (parsed: ParsedPdfData): PersistedParsedPdfData => {
  const { rawText: _rawText, ...persisted } = parsed;
  return persisted;
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
  matchReason?: string;
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
  examDate: string;
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
  sourceStudentId?: string | null;
  sourcePhoneSuffix?: string | null;
  sourceClassName?: string | null;
  matchMethod?: string | null;
  matchReason?: string | null;
  writtenAt: string;
  reviewer: string;
  essayTopic: string;
  grade: string;
  feedback: string;
  scores: ScoreBreakdown;
  averageScores?: ScoreBreakdown;
  convertedScores?: ScoreBreakdown;
  parsedJson?: PersistedParsedPdfData;
  totalScore: number;
  isRead: boolean;
  fileUrl: string;
  fileName: string;
  createdAt: Timestamp | null;
};

export type ClassJoinRequestRecord = {
  id: string;
  studentDocId?: string | null;
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

export type ReportClaimTriageRecord = {
  id: string;
  reportId: string;
  studentUid: string;
  status: "open" | "resolved";
  createdAt: Timestamp | null;
  updatedAt?: Timestamp | null;
  resolvedAt?: Timestamp | null;
  resolvedBy?: string | null;
  report: ReportRecord | null;
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

const METRIC_SCORE_KEYS: Record<MetricLabel, Exclude<keyof ScoreBreakdown, "total">> = {
  독해력: "reading",
  "내용 이해력": "comprehension",
  "문제 이해력": "problemUnderstanding",
  구성력: "organization",
  표현력: "expression",
};

const EMPTY_PARSED: ParsedPdfData = {
  name: "",
  className: "",
  studentId: "",
  phoneSuffix: "",
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

const createUploadCandidateId = () => {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

export const formatExamDate = (value: string | null | undefined, fallback = "날짜 정보 없음"): string => {
  const normalized = normalizeDateString(value);
  if (!normalized) {
    return fallback;
  }

  const [year, month, day] = normalized.split("-");
  return `${year}.${month}.${day}`;
};

export const formatExamDateShort = (value: string | null | undefined, fallback = "-"): string => {
  const normalized = normalizeDateString(value);
  if (!normalized) {
    return fallback;
  }

  const [, month, day] = normalized.split("-");
  return `${month}.${day}`;
};

export const getReportSortTimestamp = (
  report: Pick<ReportRecord, "examDate" | "writtenAt" | "createdAt">,
) => {
  const normalized =
    normalizeDateString(report.examDate) ??
    normalizeDateString(report.writtenAt);
  if (normalized) {
    return new Date(`${normalized}T00:00:00`).getTime();
  }
  return report.createdAt?.toMillis() ?? 0;
};

export const compareReportsByExamDateDesc = (a: ReportRecord, b: ReportRecord) =>
  getReportSortTimestamp(b) - getReportSortTimestamp(a);

export const getReportExamTitle = (report: Pick<ReportRecord, "examDate">) =>
  `[${formatExamDate(report.examDate)}] 논술 리포트`;

export const hydrateReportRecord = (
  id: string,
  data: Omit<ReportRecord, "id" | "examDate"> & Record<string, unknown> & { examDate?: string | null },
): ReportRecord => {
  const legacyTestDate =
    typeof data.testDate === "string"
      ? data.testDate
      : data.testDate === null
        ? null
        : undefined;
  const writtenAt =
    typeof data.writtenAt === "string"
      ? data.writtenAt
      : data.writtenAt === null
        ? null
        : undefined;
  const examDate =
    normalizeDateString(data.examDate) ??
    normalizeDateString(legacyTestDate) ??
    normalizeDateString(writtenAt) ??
    "";

  const NULL_SCORES: ScoreBreakdown = {
    reading: null, comprehension: null, problemUnderstanding: null,
    organization: null, expression: null, total: null,
  };

  return {
    id,
    uid: typeof data.uid === "string" ? data.uid : "",
    classId: typeof data.classId === "string" ? data.classId : null,
    className: typeof data.className === "string" ? data.className : null,
    examDate,
    fileHash: typeof data.fileHash === "string" ? data.fileHash : null,
    studentUid: typeof data.studentUid === "string" ? data.studentUid : null,
    studentId: typeof data.studentId === "string" ? data.studentId : null,
    studentName: typeof data.studentName === "string" ? data.studentName : "",
    assignmentStatus: data.assignmentStatus as ReportAssignmentStatus | undefined,
    status: data.status as ReportRecord["status"],
    assignedAt: (data.assignedAt as Timestamp | null | undefined) ?? null,
    sourcePage: typeof data.sourcePage === "number" ? data.sourcePage : undefined,
    pageNumber: typeof data.pageNumber === "number" ? data.pageNumber : undefined,
    sourceName: typeof data.sourceName === "string" ? data.sourceName : "",
    sourceStudentId: typeof data.sourceStudentId === "string" ? data.sourceStudentId : null,
    sourcePhoneSuffix: typeof data.sourcePhoneSuffix === "string" ? data.sourcePhoneSuffix : null,
    sourceClassName: typeof data.sourceClassName === "string" ? data.sourceClassName : null,
    matchMethod: typeof data.matchMethod === "string" ? data.matchMethod : null,
    matchReason: typeof data.matchReason === "string" ? data.matchReason : null,
    writtenAt: typeof data.writtenAt === "string" ? data.writtenAt : "",
    reviewer: typeof data.reviewer === "string" ? data.reviewer : "",
    essayTopic: typeof data.essayTopic === "string" ? data.essayTopic : "",
    grade: typeof data.grade === "string" ? data.grade : "",
    feedback: typeof data.feedback === "string" ? data.feedback : "",
    isRead: Boolean(data.isRead),
    scores: ((data.scores as ScoreBreakdown | null | undefined) ?? NULL_SCORES),
    averageScores: ((data.averageScores as ScoreBreakdown | null | undefined) ?? NULL_SCORES),
    convertedScores: ((data.convertedScores as ScoreBreakdown | null | undefined) ?? NULL_SCORES),
    totalScore: (data.totalScore as number | null | undefined) ?? 0,
    fileUrl: typeof data.fileUrl === "string" ? data.fileUrl : "",
    fileName: typeof data.fileName === "string" ? data.fileName : "",
    createdAt: (data.createdAt as Timestamp | null | undefined) ?? null,
  };
};

type ReportDocumentLike = { id: string; data: () => unknown };

export const hydrateReportRecords = (
  docs: ReportDocumentLike[],
  include?: (report: ReportRecord) => boolean,
): ReportRecord[] => {
  const reports: ReportRecord[] = [];
  for (const docSnap of docs) {
    const report = hydrateReportRecord(
      docSnap.id,
      docSnap.data() as Omit<ReportRecord, "id">,
    );
    if (!include || include(report)) reports.push(report);
  }
  return reports.sort(compareReportsByExamDateDesc);
};

const parseFileNameHint = (
  fileName: string,
): { name?: string; total?: number | null; studentId?: string; phoneSuffix?: string } => {
  const base = fileName.replace(/\.pdf$/i, "");
  const nameMatch = base.match(/([가-힣]{2,5})/);
  const scoreMatch =
    base.match(/(?:총점|점수)\D*(\d+(?:\.\d+)?)\s*점?/i) ??
    base.match(/(?:^|[_\-\s])(\d+(?:\.\d+)?)\s*점(?:[_\-\s]|$)/i);
  const phoneSuffixMatch = base.match(/[가-힣]{2,5}\D*(\d{4})(?:\D|$)/);

  // 명시적 레이블(학생코드/학번/student_id) 우선
  const explicitIdMatch = base.match(
    /(?:학생코드|학번|student[_-\s]?id)\D*([A-Za-z0-9-]{4,})/i,
  );
  // 레이블 없이 단독으로 등장하는 6~8자 소문자+숫자 customId (예: 홍길동_dohyun17.pdf)
  // 순수 숫자(점수/날짜)와 한글 인접 문자는 제외
  const standaloneIdMatch = !explicitIdMatch
    ? base.match(/(?:^|[_\-\s])([a-z][a-z0-9]{5,7})(?:[_\-\s]|$)/i)
    : null;

  const studentId =
    (explicitIdMatch?.[1] ?? standaloneIdMatch?.[1])?.replace(/\s+/g, "").toLowerCase() || undefined;

  return {
    name: nameMatch?.[1]?.trim() || undefined,
    total: parseNumber(scoreMatch?.[1]),
    phoneSuffix: phoneSuffixMatch?.[1]?.trim() || undefined,
    studentId,
  };
};

const normalizeText = (text: string) =>
  text
    .split("\u0000").join("")
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

const normalizeMatchName = (name: string | null | undefined) =>
  (name ?? "").replace(/\s+/g, "").trim();

const normalizeIdentifier = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, "").trim().toLowerCase();

const normalizePhoneSuffix = (value: string | null | undefined) => {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
};

const normalizeClassToken = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, "").trim().toLowerCase();

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

const extractPhoneSuffixField = (text: string): string => {
  const direct =
    extractField(text, ["전화번호", "휴대폰", "핸드폰", "연락처", "휴대전화"]) ||
    text.match(/(?:전화번호|휴대폰|핸드폰|연락처|휴대전화)\s*[:：]?\s*([0-9\-\s]{8,})/i)?.[1] ||
    "";

  return normalizePhoneSuffix(direct);
};

const extractStudentIdField = (text: string): string => {
  const direct =
    extractField(text, ["학생코드", "학생 코드", "학번", "학생번호", "student id", "student_id"]) ||
    text.match(/(?:학생코드|학생\s*코드|학번|학생번호|student[_\s-]?id)\s*[:：]?\s*([A-Za-z0-9-]{4,})/i)?.[1] ||
    "";

  return direct.replace(/\s+/g, "").trim();
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
  const withoutMax = segment.replace(/\(?\s*-?\d+(?:\.\d+)?\s*점\s*만점\s*\)?/gi, " ");
  const values = (withoutMax.match(/-?\d+(?:\.\d+)?/g) ?? [])
    .map((value) => Number(value))
    .filter(Number.isFinite);
  if (values.length < 3) {
    return [null, null, null];
  }

  const firstThree = values.slice(0, 3);
  return [firstThree[0] ?? null, firstThree[1] ?? null, firstThree[2] ?? null];
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
  const convertedValues = [readingConverted, compConverted, problemConverted, orgConverted, expConverted];
  const totalByConverted = convertedValues.every(Number.isFinite)
    ? convertedValues.reduce((acc, value) => acc + (value ?? 0), 0)
    : 0;

  return {
    name: extractField(text, ["이름", "성명", "학생명"]),
    className: extractField(text, ["수강반", "반"]),
    studentId: extractStudentIdField(text),
    phoneSuffix: extractPhoneSuffixField(text),
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
    scoreParse: {
      confidence: "low",
      method: "text-fallback",
      warnings: ["PDF 좌표 정보를 사용하지 못해 텍스트 순서로 점수를 읽었습니다."],
    },
    rawText: text,
  };
};

type PdfJsModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (params: { data?: ArrayBuffer; url?: string }) => {
    promise: Promise<{
      numPages: number;
      destroy?: () => Promise<void>;
      getPage: (pageNumber: number) => Promise<{
        getViewport?: (params: { scale: number }) => { width: number; height: number };
        render?: (params: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => {
          promise: Promise<void>;
        };
        getTextContent: () => Promise<{
          items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }>;
        }>;
        cleanup?: () => void;
      }>;
    }>;
  };
};

export type PageToken = {
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

const compactTokenText = (value: string) =>
  value.normalize("NFKC").replace(/[\s:：|]/g, "").toLowerCase();

type TokenRange = {
  startX: number;
  endX: number;
};

type ScoreColumns = {
  mine: number;
  average: number;
  converted: number;
};

type NumericCandidate = {
  id: string;
  value: number;
  x: number;
  tokenIndex: number;
};

type MetricRowResult = {
  mine: number | null;
  average: number | null;
  converted: number | null;
  maximum: number | null;
  method: ScoreParseMeta["method"];
};

export type ParsedScoreTable = {
  scores: ScoreBreakdown;
  averageScores: ScoreBreakdown;
  convertedScores: ScoreBreakdown;
  meta: ScoreParseMeta;
};

const findPhraseRange = (line: PageToken[], aliases: string[]): TokenRange | null => {
  const sorted = line.slice().sort((a, b) => a.x - b.x);
  const compactAliases = aliases.map(compactTokenText);

  for (let start = 0; start < sorted.length; start += 1) {
    for (let end = start; end < Math.min(sorted.length, start + 5); end += 1) {
      const compact = compactTokenText(sorted.slice(start, end + 1).map((token) => token.text).join(""));
      if (compactAliases.includes(compact)) {
        return {
          startX: sorted[start].x,
          endX: sorted[end].x + sorted[end].width,
        };
      }
    }
  }

  return null;
};

const findScoreColumns = (tokens: PageToken[]): ScoreColumns | null => {
  const headerAliases = {
    mine: ["나의 점수", "나의점수", "내 점수"],
    average: ["전체 평균", "전체평균"],
    converted: ["환산 점수", "환산점수"],
  } as const;

  const candidates = groupTokensByLine(tokens, 11)
    .map((line) => {
      const ranges = {
        mine: findPhraseRange(line, [...headerAliases.mine]),
        average: findPhraseRange(line, [...headerAliases.average]),
        converted: findPhraseRange(line, [...headerAliases.converted]),
      };
      const count = Object.values(ranges).filter(Boolean).length;
      return { ranges, count };
    })
    .sort((a, b) => b.count - a.count);

  const best = candidates[0];
  if (!best || best.count < 3 || !best.ranges.mine || !best.ranges.average || !best.ranges.converted) {
    return null;
  }

  return {
    mine: (best.ranges.mine.startX + best.ranges.mine.endX) / 2,
    average: (best.ranges.average.startX + best.ranges.average.endX) / 2,
    converted: (best.ranges.converted.startX + best.ranges.converted.endX) / 2,
  };
};

const extractNumericCandidates = (line: PageToken[], labelEndX: number): NumericCandidate[] => {
  const sorted = line.slice().sort((a, b) => a.x - b.x);
  const maxMarkerIndex = sorted.findIndex((token) => /만점/i.test(token.text));

  return sorted.flatMap((token, tokenIndex) => {
    if (token.x + token.width / 2 <= labelEndX) {
      return [];
    }

    const matches = [...token.text.matchAll(/-?\d+(?:\.\d+)?/g)];
    return matches.flatMap((match, matchIndex) => {
      const value = Number(match[0]);
      if (!Number.isFinite(value)) {
        return [];
      }

      const belongsToMaximum =
        /만점/i.test(token.text) ||
        (maxMarkerIndex >= 0 && tokenIndex === maxMarkerIndex - 1 && token.x < sorted[maxMarkerIndex].x);
      if (belongsToMaximum) {
        return [];
      }

      const textLength = Math.max(token.text.length, 1);
      const matchCenter = (match.index ?? 0) + match[0].length / 2;
      return [{
        id: `${tokenIndex}-${matchIndex}`,
        value,
        x: token.x + token.width * (matchCenter / textLength),
        tokenIndex,
      }];
    });
  });
};

const selectColumnValues = (
  candidates: NumericCandidate[],
  columns: ScoreColumns,
): [number | null, number | null, number | null] => {
  const orderedColumns = [columns.mine, columns.average, columns.converted];
  const boundaries = [
    Number.NEGATIVE_INFINITY,
    (columns.mine + columns.average) / 2,
    (columns.average + columns.converted) / 2,
    Number.POSITIVE_INFINITY,
  ];

  const selected = orderedColumns.map((columnX, index) => {
    const inColumn = candidates
      .filter((candidate) => candidate.x >= boundaries[index] && candidate.x < boundaries[index + 1])
      .sort((a, b) => Math.abs(a.x - columnX) - Math.abs(b.x - columnX));
    return inColumn[0] ?? null;
  });

  if (selected.some((candidate) => candidate === null)) {
    return [null, null, null];
  }

  return [selected[0]!.value, selected[1]!.value, selected[2]!.value];
};

const extractMetricMaximum = (line: PageToken[]): number | null => {
  const match = toLineText(line).match(/\(?\s*(\d+(?:\.\d+)?)\s*점\s*만점\s*\)?/i);
  return match ? parseNumber(match[1]) : null;
};

const parseMetricRow = (
  lines: PageToken[][],
  label: MetricLabel,
  columns: ScoreColumns | null,
): MetricRowResult | null => {
  for (const line of lines) {
    const labelRange = findPhraseRange(line, METRIC_ALIASES[label]);
    if (!labelRange) {
      continue;
    }

    const candidates = extractNumericCandidates(line, labelRange.endX);
    const maximum = extractMetricMaximum(line);

    if (columns) {
      const [mine, average, converted] = selectColumnValues(candidates, columns);
      if ([mine, average, converted].every(Number.isFinite)) {
        return { mine, average, converted, maximum, method: "layout-columns" };
      }
    }

    const ordered = candidates.slice().sort((a, b) => a.x - b.x).slice(0, 3);
    if (ordered.length === 3) {
      return {
        mine: ordered[0].value,
        average: ordered[1].value,
        converted: ordered[2].value,
        maximum,
        method: "layout-order",
      };
    }

    return { mine: null, average: null, converted: null, maximum, method: "text-fallback" };
  }

  return null;
};

const normalizeMetricValue = (
  value: number | null,
  maximum: number | null,
): number | null => {
  if (!Number.isFinite(value) || (value ?? 0) < 0) {
    return null;
  }
  if (Number.isFinite(maximum) && (value ?? 0) > (maximum ?? 0) + 0.001) {
    return null;
  }
  return value;
};

export const parseScoreTableFromTokens = (
  tokens: PageToken[],
  normalizedText = "",
): ParsedScoreTable => {
  const columns = findScoreColumns(tokens);
  const lines = groupTokensByLine(tokens, 8);
  const scores: ScoreBreakdown = { ...EMPTY_PARSED.scores };
  const averageScores: ScoreBreakdown = { ...EMPTY_PARSED.averageScores };
  const convertedScores: ScoreBreakdown = { ...EMPTY_PARSED.convertedScores };
  const warnings: string[] = [];
  const methods: ScoreParseMeta["method"][] = [];

  for (const label of METRIC_LABELS) {
    const key = METRIC_SCORE_KEYS[label];
    const row = parseMetricRow(lines, label, columns);
    let mine = row?.mine ?? null;
    let average = row?.average ?? null;
    let converted = row?.converted ?? null;
    let method = row?.method ?? "text-fallback";

    if (![mine, average, converted].every(Number.isFinite)) {
      const [fallbackMine, fallbackAverage, fallbackConverted] = parseMetricTriple(
        getMetricSegment(normalizedText, label),
      );
      mine ??= fallbackMine;
      average ??= fallbackAverage;
      converted ??= fallbackConverted;
      method = "text-fallback";
    }

    const normalizedMine = normalizeMetricValue(mine, row?.maximum ?? null);
    if (Number.isFinite(mine) && normalizedMine === null) {
      warnings.push(`${label} 점수가 만점 범위를 벗어났습니다.`);
    }

    scores[key] = normalizedMine;
    averageScores[key] = Number.isFinite(average) && (average ?? 0) >= 0 ? average : null;
    convertedScores[key] = Number.isFinite(converted) && (converted ?? 0) >= 0 ? converted : null;
    methods.push(method);

    if (![scores[key], averageScores[key], convertedScores[key]].every(Number.isFinite)) {
      warnings.push(`${label} 점수 열을 완전히 읽지 못했습니다.`);
    }
  }

  const allMineScores = REQUIRED_SCORE_KEYS.every((key) => Number.isFinite(scores[key]));
  const confidence: ScoreParseConfidence =
    allMineScores && methods.every((method) => method === "layout-columns")
      ? "high"
      : allMineScores && methods.every((method) => method !== "text-fallback")
        ? "medium"
        : "low";

  return {
    scores,
    averageScores,
    convertedScores,
    meta: {
      confidence,
      method:
        confidence === "high"
          ? "layout-columns"
          : confidence === "medium"
            ? "layout-order"
            : "text-fallback",
      warnings: [...new Set(warnings)],
    },
  };
};

const extractTotalScoreFromScope = (scope: PageScope): number | null => {
  const columns = findScoreColumns(scope.tokens);
  const lines = groupTokensByLine(scope.tokens, 8);

  for (const line of lines) {
    const totalRange = findPhraseRange(line, ["총점", "총 점"]);
    if (!totalRange) {
      continue;
    }
    const candidates = extractNumericCandidates(line, totalRange.endX);
    if (columns) {
      const [mine] = selectColumnValues(candidates, columns);
      if (Number.isFinite(mine) && (mine ?? 0) >= 0) {
        return mine;
      }
    }
    const first = candidates.slice().sort((a, b) => a.x - b.x)[0]?.value ?? null;
    if (Number.isFinite(first) && (first ?? 0) >= 0) {
      return first;
    }
  }

  return null;
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
  const scoreTable = parseScoreTableFromTokens(scope.tokens, text);

  const totalByBox =
    extractTotalScoreFromScope(scope) ??
    parseNumber(
      extractBoxValueNearKeyword(scope, /총점/, /-?\d+(?:\.\d+)?/i) ||
        text.match(/총점\s*[:：]?\s*(-?\d+(?:\.\d+)?)/i)?.[1],
    );
  const gradeByBox =
    extractBoxValueNearKeyword(scope, /등급/, /[A-Za-z가-힣][A-Za-z0-9+\-가-힣]*/i) ||
    extractField(text, ["등급"]);

  const totalByConverted = REQUIRED_SCORE_KEYS.every((key) => Number.isFinite(scoreTable.convertedScores[key]))
    ? REQUIRED_SCORE_KEYS.reduce((acc, key) => acc + (scoreTable.convertedScores[key] ?? 0), 0)
    : 0;

  return {
    name,
    className,
    studentId: extractStudentIdField(text),
    phoneSuffix: extractPhoneSuffixField(text),
    writtenAt,
    essayTopic,
    grade: gradeByBox,
    reviewer,
    feedback,
    scores: {
      ...scoreTable.scores,
      total: totalByBox,
    },
    averageScores: scoreTable.averageScores,
    convertedScores: {
      ...scoreTable.convertedScores,
      total: totalByConverted > 0 ? totalByConverted : null,
    },
    scoreParse: scoreTable.meta,
    rawText: text,
  };
};

let pdfJsPromise: Promise<PdfJsModule> | null = null;

const loadPdfJs = (): Promise<PdfJsModule> => {
  if (pdfJsPromise) return pdfJsPromise;

  pdfJsPromise = (async () => {
    try {
      const mod = (await import("pdfjs-dist/build/pdf.mjs")) as unknown as PdfJsModule;
      mod.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return mod;
    } catch {
      // 배포 번들 손상 시에만 고정 버전 CDN으로 복구한다.
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
  })().catch((error) => {
    pdfJsPromise = null;
    throw error;
  });

  return pdfJsPromise;
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
  try {
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
  } finally {
    page.cleanup?.();
  }
};

const extractPdfDataByStudent = async (
  file: File,
): Promise<Array<{ parsed: ParsedPdfData; sourcePage: number }>> => {
  if (!/\.pdf$/i.test(file.name)) {
    throw new Error("PDF 파일이 아닙니다.");
  }

  const pdfjs = await loadPdfJs();
  const bytes = await readPdfFileBuffer(file);
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) }).promise;
  const markerResults: Array<{ parsed: ParsedPdfData; sourcePage: number }> = [];
  const fallbackResults: Array<{ parsed: ParsedPdfData; sourcePage: number }> = [];

  try {
    for (let pageIndex = 1; pageIndex <= pdf.numPages; pageIndex += 1) {
      const scope = await extractPageScope(pdf, pageIndex);

      if (STUDENT_SECTION_MARKER.test(scope.rawText)) {
        if (markerResults.length === 0) fallbackResults.length = 0;
        markerResults.push({ parsed: parsePdfPage(scope), sourcePage: scope.pageIndex });
      } else if (markerResults.length === 0 && scope.normalizedText) {
        fallbackResults.push({ parsed: parsePdfPage(scope), sourcePage: scope.pageIndex });
      }
    }

    return markerResults.length > 0 ? markerResults : fallbackResults;
  } finally {
    await pdf.destroy?.();
  }
};

const byName = (students: StudentLite[], name: string) => {
  const normalized = normalizeMatchName(name);
  if (!normalized) {
    return [];
  }
  return students.filter((student) => normalizeMatchName(student.name) === normalized);
};

const uniqueStudents = (students: StudentLite[]) => {
  const seen = new Set<string>();
  return students.filter((student) => {
    if (seen.has(student.uid)) {
      return false;
    }
    seen.add(student.uid);
    return true;
  });
};

const matchStudentsByStudentId = (students: StudentLite[], studentId: string) => {
  const normalized = normalizeIdentifier(studentId);
  if (!normalized) {
    return [];
  }
  // null/undefined student.studentId 방어: normalizeIdentifier 내부에서 ?? "" 처리됨
  return students.filter(
    (student) => normalizeIdentifier(student.studentId ?? "") === normalized,
  );
};

/** 6~8자 alphanumeric 패턴 → 신형 customId 여부 판별 */
const isCustomIdFormat = (value: string) =>
  /^[a-z0-9]{6,8}$/.test(normalizeIdentifier(value));

const matchStudentsByPhoneSuffix = (students: StudentLite[], phoneSuffix: string) => {
  const normalized = normalizePhoneSuffix(phoneSuffix);
  if (!normalized) {
    return [];
  }

  return students.filter((student) => {
    return (
      normalizePhoneSuffix(student.phoneSuffix) === normalized ||
      normalizePhoneSuffix(student.phoneNumber) === normalized ||
      // 레거시 유저의 studentId = phoneSuffix (4자리) → 정합 허용
      // 신형 customId(6~8자)는 normalizePhoneSuffix 결과가 ""이므로 오매칭 없음
      normalizePhoneSuffix(student.studentId ?? "") === normalized
    );
  });
};

export const resolveMatchStatus = (
  parsed: Pick<ParsedPdfData, "name" | "className" | "studentId" | "phoneSuffix">,
  classStudents: StudentLite[],
  allStudents: StudentLite[],
): Pick<UploadCandidate, "status" | "candidates" | "selectedStudentUid" | "matchReason"> => {
  // ─── [Stage 0] customId 직접 매칭 (6~8자 신형 ID 체계) ──────────────────────
  // parsed.studentId가 customId 형식이면 phoneSuffix/이름 매칭보다 우선 시도.
  // 레거시 phoneSuffix(4자리)는 isCustomIdFormat() === false → 이 블록을 건너뜀.
  const parsedCustomId = (parsed.studentId ?? "").replace(/\s+/g, "").toLowerCase();
  if (isCustomIdFormat(parsedCustomId)) {
    // 반 내에서 먼저 검색
    const inClassIdMatches = uniqueStudents(matchStudentsByStudentId(classStudents, parsedCustomId));
    if (inClassIdMatches.length === 1) {
      const resolved = inClassIdMatches[0];
      return {
        status: "ready",
        candidates: [resolved],
        selectedStudentUid: resolved.uid,
        matchReason: `학생 고유 ID(${parsedCustomId})가 반 내 단일 일치 → 자동 매칭.`,
      };
    }
    // 반 밖 전체에서 검색 (반 미배정 학생 포함)
    const globalIdMatches = uniqueStudents(matchStudentsByStudentId(allStudents, parsedCustomId));
    if (globalIdMatches.length === 1) {
      const resolved = globalIdMatches[0];
      return {
        status: "ready",
        candidates: [resolved],
        selectedStudentUid: resolved.uid,
        matchReason: `학생 고유 ID(${parsedCustomId}) 전체 단일 일치 → 자동 매칭.`,
      };
    }
    if (globalIdMatches.length > 1) {
      return {
        status: "unregistered",
        candidates: [],
        selectedStudentUid: null,
        matchReason: `학생 고유 ID(${parsedCustomId})가 여러 계정에 중복 존재 → 미연결 자동 처리됩니다.`,
      };
    }
  }

  // ─── [Stage 1] 이름 기반 반 내 매칭 ───────────────────────────────────────
  const parsedName = normalizeMatchName(parsed.name);

  if (!parsedName) {
    return {
      status: "unregistered",
      candidates: classStudents,
      selectedStudentUid: null,
      matchReason: "학생 이름을 확인할 수 없어 자동 매칭을 중단했습니다.",
    };
  }

  const classNameMatches = byName(classStudents, parsed.name);

  if (classNameMatches.length === 1) {
    const resolved = classNameMatches[0];
    return {
      status: "ready",
      candidates: [resolved],
      selectedStudentUid: resolved.uid,
      matchReason: "선택한 반 안에서 이름이 단일 일치해 자동 매칭했습니다.",
    };
  }

  if (classNameMatches.length > 1) {
    // ─── [Stage 2-A] 동명이인 → 신형 customId로 타이브레이크 ──────────────
    if (isCustomIdFormat(parsedCustomId)) {
      const idTieBreak = uniqueStudents(matchStudentsByStudentId(classNameMatches, parsedCustomId));
      if (idTieBreak.length === 1) {
        const resolved = idTieBreak[0];
        return {
          status: "ready",
          candidates: [resolved],
          selectedStudentUid: resolved.uid,
          matchReason: "동명이인 중 학생 고유 ID가 단일 일치해 자동 매칭했습니다.",
        };
      }
    }

    // ─── [Stage 2-B] 동명이인 → 레거시 phoneSuffix 타이브레이크 (하위 호환) ─
    const phoneMatches = matchStudentsByPhoneSuffix(
      classNameMatches,
      parsed.phoneSuffix || (isCustomIdFormat(parsedCustomId) ? "" : parsedCustomId),
    );
    if (phoneMatches.length === 1) {
      const resolved = phoneMatches[0];
      return {
        status: "ready",
        candidates: [resolved],
        selectedStudentUid: resolved.uid,
        matchReason: "선택한 반 안의 동명이인 중 전화번호 뒤 4자리가 단일 일치해 자동 매칭했습니다.",
      };
    }

    return {
      status: "unregistered",
      candidates: [],
      selectedStudentUid: null,
      matchReason: phoneMatches.length > 1
        ? "동명이인 중 번호 후보가 여럿 → 미연결 자동 처리됩니다."
        : "동명이인이 있어 특정 불가 → 미연결 자동 처리됩니다.",
    };
  }

  const globalNameMatches = byName(allStudents, parsed.name);

  if (globalNameMatches.length > 0) {
    return {
      status: "unregistered",
      candidates: [],
      selectedStudentUid: null,
      matchReason: "선택한 반 안에 일치하는 학생이 없습니다 → 미연결 자동 처리됩니다.",
    };
  }

  return {
    status: "unregistered",
    candidates: [],
    selectedStudentUid: null,
    matchReason: "선택한 반 안에 이름이 일치하는 가입 학생이 없습니다.",
  };
};

export const prepareUploadCandidates = async (
  files: File[],
  classStudents: StudentLite[],
  allStudents: StudentLite[],
): Promise<UploadCandidate[]> => {
  const results: UploadCandidate[][] = new Array(files.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(PDF_PARSE_CONCURRENCY, files.length) },
    async () => {
      while (nextIndex < files.length) {
        const index = nextIndex;
        nextIndex += 1;
        const file = files[index];
        const candidates: UploadCandidate[] = [];
        const fileHint = parseFileNameHint(file.name);

        try {
          const chunks = await extractPdfDataByStudent(file);
          for (const chunk of chunks) {
            const merged = {
              ...chunk.parsed,
              name: chunk.parsed.name || fileHint.name || "",
              studentId: chunk.parsed.studentId || fileHint.studentId || "",
              phoneSuffix: chunk.parsed.phoneSuffix || fileHint.phoneSuffix || "",
              scores: {
                ...chunk.parsed.scores,
                total:
                  chunk.parsed.scores.total ??
                  chunk.parsed.convertedScores.total ??
                  fileHint.total ??
                  null,
              },
            };
            const match = resolveMatchStatus(merged, classStudents, allStudents);
            const parseError = getUploadCandidateValidationError(merged) ?? undefined;
            candidates.push({
              id: createUploadCandidateId(),
              file,
              sourcePage: chunk.sourcePage,
              sourcePageLabel: `${chunk.sourcePage}p`,
              parsed: merged,
              ...match,
              parseError,
            });
          }
        } catch (error) {
          candidates.push({
            id: createUploadCandidateId(),
            file,
            sourcePage: 1,
            sourcePageLabel: "1p",
            parsed: {
              ...EMPTY_PARSED,
              name: fileHint.name || "",
              studentId: fileHint.studentId || "",
              phoneSuffix: fileHint.phoneSuffix || "",
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
        } finally {
          releasePdfFileBuffer(file);
        }
        results[index] = candidates;
      }
    },
  );
  await Promise.all(workers);

  return results.flat();
};

const hasScoreIntegrity = (scores: ScoreBreakdown) =>
  REQUIRED_SCORE_KEYS.every((key) => Number.isFinite(scores[key]) && (scores[key] ?? 0) >= 0);

const sumRequiredScores = (scores: ScoreBreakdown) =>
  REQUIRED_SCORE_KEYS.reduce((acc, key) => acc + (scores[key] ?? 0), 0);

const hasCompleteConvertedScores = (scores: ScoreBreakdown) =>
  REQUIRED_SCORE_KEYS.every((key) => Number.isFinite(scores[key]) && (scores[key] ?? 0) >= 0);

const totalsMatch = (left: number, right: number) => Math.abs(left - right) <= 0.51;

export const resolveParsedTotalScore = (parsed: Pick<ParsedPdfData, "scores" | "convertedScores">) => {
  if (Number.isFinite(parsed.scores.total) && (parsed.scores.total ?? 0) >= 0) {
    return parsed.scores.total as number;
  }
  if (hasCompleteConvertedScores(parsed.convertedScores)) {
    return sumRequiredScores(parsed.convertedScores);
  }
  return sumRequiredScores(parsed.scores);
};

export const getParsedScoreValidationError = (
  parsed: Pick<ParsedPdfData, "scores" | "convertedScores" | "scoreParse">,
): string | null => {
  if (!hasScoreIntegrity(parsed.scores)) {
    return "파싱 실패: 점수 5개(독해력/내용 이해력/문제 이해력/구성력/표현력)를 모두 확인해주세요.";
  }

  if (parsed.scoreParse?.confidence === "low") {
    return "점수표의 열 위치를 확실하게 식별하지 못했습니다. 점수 5개와 총점을 직접 확인해주세요.";
  }

  const total = parsed.scores.total;
  if (!Number.isFinite(total)) {
    return null;
  }
  if ((total ?? 0) < 0) {
    return "총점은 0점 이상이어야 합니다.";
  }

  const mineTotal = sumRequiredScores(parsed.scores);
  const convertedTotal = hasCompleteConvertedScores(parsed.convertedScores)
    ? sumRequiredScores(parsed.convertedScores)
    : null;
  const matchesMine = totalsMatch(total as number, mineTotal);
  const matchesConverted = convertedTotal !== null && totalsMatch(total as number, convertedTotal);

  if (!matchesMine && !matchesConverted) {
    const expected = convertedTotal === null
      ? `${mineTotal}`
      : `${mineTotal} 또는 환산점수 합계 ${convertedTotal}`;
    return `총점 ${total}점이 항목 합계(${expected})와 일치하지 않습니다.`;
  }

  return null;
};

export const getUploadCandidateValidationError = (
  parsed: Pick<ParsedPdfData, "scores" | "convertedScores" | "scoreParse" | "feedback">,
): string | null => {
  const scoreError = getParsedScoreValidationError(parsed);
  if (scoreError) {
    return scoreError;
  }
  if (!parsed.feedback.trim()) {
    return "파싱 실패: 첨삭 총평이 비어 있습니다.";
  }
  return null;
};

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
  const [{ getDownloadURL, ref, uploadBytesResumable }, { storage }] = await Promise.all([
    import("firebase/storage"),
    import("@/lib/firebaseStorage"),
  ]);
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

const MAX_CONCURRENT_REPORT_UPLOADS = 3;

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> => {
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await worker(items[index], index);
      }
    }),
  );
};

export const publishReportBatch = async (
  uploadRows: UploadCandidate[],
  selectedClass: ClassLite,
  examDate: string,
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

  const results: Array<{ candidateId: string; success: boolean; reportId?: string; error?: string }> =
    new Array(uploadRows.length);
  const outcomes: Array<"completed" | "pending" | "failure"> = new Array(uploadRows.length);
  const notices: Array<string | undefined> = new Array(uploadRows.length);
  const failureMessages: Array<string | undefined> = new Array(uploadRows.length);
  const progressByIndex = new Array<number>(uploadRows.length).fill(0);

  const updateProgress = (index: number, progress: number) => {
    progressByIndex[index] = Math.max(progressByIndex[index], Math.min(100, progress));
    const overall = progressByIndex.reduce((sum, value) => sum + value, 0) / uploadRows.length;
    onOverallProgress?.(overall);
  };

  await runWithConcurrency(uploadRows, MAX_CONCURRENT_REPORT_UPLOADS, async (row, index) => {
    try {
      const validationError = getUploadCandidateValidationError(row.parsed);
      if (validationError) throw new Error(validationError);

      const resolvedStudent = row.selectedStudentUid
        ? allStudents.find((entry) => entry.uid === row.selectedStudentUid) ?? null
        : null;
      const assignmentStatus: ReportAssignmentStatus = resolvedStudent
        ? "completed"
        : "unassigned_pending";
      const storageOwnerUid = resolvedStudent?.uid ?? uid;

      const url = await uploadPdfToStorage(storageOwnerUid, row.file, (fileProgress) => {
        updateProgress(index, fileProgress);
      });
      const totalScore = resolveParsedTotalScore(row.parsed);

      const created = await addDoc(collection(db, "reports"), {
        uid,
        classId: selectedClass.id,
        className: selectedClass.name,
        examDate,
        fileHash: row.fileHash ?? null,
        studentUid: resolvedStudent?.uid ?? null,
        studentId: (resolvedStudent?.studentId ?? "").trim() || null,
        studentName: (resolvedStudent?.name ?? row.parsed.name ?? "").trim(),
        assignmentStatus,
        status: resolvedStudent ? "completed" : "pending",
        assignedAt: resolvedStudent ? serverTimestamp() : null,
        sourceName: row.parsed.name || "",
        sourceStudentId: row.parsed.studentId || null,
        sourcePhoneSuffix: row.parsed.phoneSuffix || null,
        sourceClassName: row.parsed.className || null,
        matchReason: row.matchReason ?? null,
        writtenAt: row.parsed.writtenAt || "",
        reviewer: row.parsed.reviewer || "",
        essayTopic: row.parsed.essayTopic || "",
        grade: row.parsed.grade || "",
        feedback: row.parsed.feedback || "",
        scores: { ...row.parsed.scores, total: totalScore },
        averageScores: row.parsed.averageScores,
        convertedScores: row.parsed.convertedScores,
        parsedJson: {
          ...compactParsedPdfData(row.parsed),
          scores: { ...row.parsed.scores, total: totalScore },
        },
        totalScore,
        isRead: false,
        fileUrl: url,
        fileName: row.file.name,
        sourcePage: row.sourcePage,
        pageNumber: row.sourcePage,
        createdAt: serverTimestamp(),
      });

      outcomes[index] = assignmentStatus === "completed" ? "completed" : "pending";
      results[index] = { candidateId: row.id, success: true, reportId: created.id };
      if (assignmentStatus === "completed" && row.status === "ready" && row.matchReason) {
        notices[index] = "[" + (resolvedStudent?.name ?? "") + "] 학생에게 리포트를 전달했습니다";
      }
    } catch (error) {
      const reason = normalizePublishError(error);
      outcomes[index] = "failure";
      failureMessages[index] = row.file.name + ": " + reason;
      results[index] = { candidateId: row.id, success: false, error: reason };
    } finally {
      updateProgress(index, 100);
    }
  });

  const successCount = outcomes.filter((status) => status === "completed").length;
  const pendingCount = outcomes.filter((status) => status === "pending").length;
  const failures = failureMessages.filter((message): message is string => Boolean(message));
  const autoAssignedNotices = notices.filter((message): message is string => Boolean(message));

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
  const snap = await getDocs(
    query(collection(db, "users"), where("role", "in", ["student", "STUDENT"])),
  );

  return snap.docs.map((docSnap) => {
    const data = docSnap.data() as {
      uid?: string;
      name?: string;
      email?: string;
      classId?: string;
      classIds?: unknown;
      className?: string;
      studentId?: string;
      phoneNumber?: string;
      phoneSuffix?: string;
      role?: string;
      isEnrolled?: boolean;
      enrollmentStatus?: string;
    };
    const phoneDigits = (data.phoneNumber ?? "").replace(/\D/g, "");
    const phoneLast4 = phoneDigits.length >= 4 ? phoneDigits.slice(-4) : null;
    const studentId = data.studentId ?? data.phoneSuffix ?? phoneLast4 ?? null;
    const classIds = normalizeClassIds(data.classIds, data.classId ?? null);

    return {
      docId: docSnap.id,
      uid: data.uid ?? docSnap.id,
      name: data.name ?? "이름없음",
      email: data.email ?? "",
      classId: data.classId ?? null,
      classIds,
      className: data.className ?? null,
      studentId,
      phoneNumber: data.phoneNumber ?? null,
      phoneSuffix: data.phoneSuffix ?? null,
      role: data.role ?? "STUDENT",
      rawClassIds: Array.isArray(data.classIds)
        ? data.classIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0)
        : [],
      isEnrolled: typeof data.isEnrolled === "boolean" ? data.isEnrolled : null,
      enrollmentStatus: data.enrollmentStatus ?? null,
    };
  });
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
  student: Pick<StudentLite, "docId" | "uid" | "name" | "email">,
  classInfo: ClassLite,
): Promise<void> => {
  const studentRef = doc(db, "users", student.docId);
  const studentSnap = await getDoc(studentRef);

  if (!studentSnap.exists()) {
    throw new Error("학생 계정 정보를 찾을 수 없습니다.");
  }

  const studentData = studentSnap.data() as {
    classId?: string | null;
    classIds?: unknown;
    className?: string | null;
  };

  if (normalizeClassIds(studentData.classIds, studentData.classId).includes(classInfo.id)) {
    throw new Error("이미 배정된 반입니다.");
  }

  await updateDoc(studentRef, {
    classId: classInfo.id,
    classIds: arrayUnion(classInfo.id),
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

const resolveStudentDocumentId = async (
  studentUid: string,
  preferredDocId?: string | null,
): Promise<string> => {
  const candidateIds = [...new Set([preferredDocId, studentUid].filter((value): value is string => Boolean(value)))];

  for (const candidateId of candidateIds) {
    const snapshot = await getDoc(doc(db, "users", candidateId));
    if (!snapshot.exists()) {
      continue;
    }
    const data = snapshot.data() as { uid?: string; role?: string };
    const resolvedUid = data.uid ?? snapshot.id;
    if (resolvedUid === studentUid && (data.role === "student" || data.role === "STUDENT")) {
      return snapshot.id;
    }
  }

  const snapshot = await getDocs(query(collection(db, "users"), where("uid", "==", studentUid)));
  const studentProfiles = snapshot.docs.filter((entry) => {
    const data = entry.data() as { role?: string };
    return data.role === "student" || data.role === "STUDENT";
  });

  if (studentProfiles.length === 1) {
    return studentProfiles[0].id;
  }
  if (studentProfiles.length > 1) {
    throw new Error("동일한 UID의 학생 문서가 여러 개여서 가입 승인을 처리할 수 없습니다.");
  }
  throw new Error("가입 신청 학생의 실제 프로필 문서를 찾을 수 없습니다.");
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

  const studentDocId = await resolveStudentDocumentId(
    requestData.studentUid,
    requestData.studentDocId,
  );
  const batch = writeBatch(db);

  batch.update(doc(db, "users", studentDocId), {
    classId: requestData.classId,
    classIds: arrayUnion(requestData.classId),
    className: requestData.className,
    isEnrolled: true,
    enrollmentStatus: "active",
    updatedAt: serverTimestamp(),
  });

  batch.update(requestRef, {
    studentDocId,
    status: "approved",
    approvedBy: adminUid,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
};

export const fetchReportsByStudentUid = async (studentUid: string): Promise<ReportRecord[]> => {
  const reportsRef = collection(db, "reports");
  const isPublished = (row: ReportRecord) =>
    row.assignmentStatus !== "duplicate_pending" && row.assignmentStatus !== "unassigned_pending";

  try {
    const snapshot = await getDocs(query(reportsRef, where("studentUid", "==", studentUid), orderBy("createdAt", "desc")));
    return hydrateReportRecords(snapshot.docs, isPublished);
  } catch {
    const snapshot = await getDocs(query(reportsRef, where("studentUid", "==", studentUid)));
    return hydrateReportRecords(snapshot.docs, isPublished);
  }
};

export const fetchPendingReports = async (): Promise<ReportRecord[]> => {
  const statuses: ReportAssignmentStatus[] = ["duplicate_pending", "unassigned_pending"];
  const snapshot = await getDocs(
    query(collection(db, "reports"), where("assignmentStatus", "in", statuses)),
  );

  return hydrateReportRecords(snapshot.docs);
};

export const subscribePendingReports = (
  onChange: (reports: ReportRecord[]) => void,
  onError?: (error: Error) => void,
) => {
  const reportsRef = collection(db, "reports");
  const statuses: ReportAssignmentStatus[] = ["duplicate_pending", "unassigned_pending"];
  const pendingQuery = query(reportsRef, where("assignmentStatus", "in", statuses));

  return onSnapshot(
    pendingQuery,
    (snapshot) => {
      onChange(hydrateReportRecords(snapshot.docs));
    },
    (error) => onError?.(error),
  );
};

type ReportAssignmentStudent = Pick<
  StudentLite,
  "docId" | "uid" | "name" | "studentId" | "classIds" | "className"
>;

export const resolveReportAssignmentClass = (
  report: Partial<ReportRecord>,
  student: ReportAssignmentStudent,
) => {
  const classId = report.classId ?? resolvePrimaryClassId(student);
  const className = report.className ?? (report.classId ? null : student.className ?? null);
  return { classId, className };
};

const queueMissingStudentClass = (
  batch: WriteBatch,
  student: ReportAssignmentStudent,
  classId: string | null,
  className: string | null,
): boolean => {
  if (!classId || normalizeClassIds(student.classIds).includes(classId)) {
    return false;
  }

  const hasExistingClass = normalizeClassIds(student.classIds).length > 0;
  batch.update(doc(db, "users", student.docId), {
    classIds: arrayUnion(classId),
    isEnrolled: true,
    enrollmentStatus: "active",
    updatedAt: serverTimestamp(),
    ...(hasExistingClass ? {} : { classId, className }),
  });
  return true;
};

const verifyStudentHasClass = async (
  student: ReportAssignmentStudent,
  classId: string | null,
): Promise<void> => {
  if (!classId) return;
  const snapshot = await getDocFromServer(doc(db, "users", student.docId));
  if (!snapshot.exists()) {
    throw new Error("연결 대상 학생 문서를 찾을 수 없습니다.");
  }
  const data = snapshot.data() as { classIds?: unknown; classId?: string | null };
  if (!normalizeClassIds(data.classIds, data.classId ?? null).includes(classId)) {
    throw new Error("리포트 연결 후 학생 반 배정 검증에 실패했습니다.");
  }
};

export const assignPendingReportToStudent = async (
  reportId: string,
  student: ReportAssignmentStudent,
): Promise<void> => {
  const reportRef = doc(db, "reports", reportId);
  const reportSnap = await getDocFromServer(reportRef);
  if (!reportSnap.exists()) {
    throw new Error("연결할 리포트를 찾을 수 없습니다.");
  }

  const previous = reportSnap.data() as Partial<ReportRecord>;
  const { classId, className } = resolveReportAssignmentClass(previous, student);
  const batch = writeBatch(db);
  const classAdded = queueMissingStudentClass(batch, student, classId, className);

  batch.update(reportRef, {
    studentUid: student.uid,
    studentId: (student.studentId ?? "").trim() || null,
    studentName: student.name ?? "",
    classId,
    className,
    assignmentStatus: "completed",
    status: "completed",
    assignedAt: serverTimestamp(),
    matchReason: classAdded
      ? "관리자가 학생을 반에 추가하고 리포트를 연결했습니다."
      : "관리자가 수동으로 학생을 연결했습니다.",
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  if (classAdded) await verifyStudentHasClass(student, classId);
};

export const assignReportToStudentOverride = async (
  reportId: string,
  student: ReportAssignmentStudent,
  actorRole?: string | null,
  actorUid?: string | null,
): Promise<void> => {
  if (!isStaffRole(actorRole)) {
    throw new Error("리포트 학생 변경 권한이 없습니다.");
  }

  const reportRef = doc(db, "reports", reportId);
  const reportSnap = await getDocFromServer(reportRef);
  if (!reportSnap.exists()) {
    throw new Error("연결할 리포트를 찾을 수 없습니다.");
  }

  const previous = reportSnap.data() as Partial<ReportRecord>;
  const claimRef = previous.studentUid ? doc(db, "report_claims", `${reportId}_${previous.studentUid}`) : null;
  const claimSnap = claimRef ? await getDoc(claimRef) : null;
  const { classId, className } = resolveReportAssignmentClass(previous, student);
  const batch = writeBatch(db);
  const classAdded = queueMissingStudentClass(batch, student, classId, className);

  batch.update(reportRef, {
    studentUid: student.uid,
    studentName: student.name ?? "",
    studentId: (student.studentId ?? "").trim() || null,
    classId,
    className,
    assignmentStatus: "completed",
    status: "completed",
    matchMethod: "admin_manual_override",
    matchReason: classAdded
      ? "관리자가 학생을 반에 추가하고 리포트를 변경했습니다."
      : "관리자가 수동으로 학생을 변경했습니다.",
    assignedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (claimRef && claimSnap?.exists()) {
    batch.update(claimRef, {
      status: "resolved",
      resolvedBy: actorUid ?? null,
      resolvedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
  if (classAdded) await verifyStudentHasClass(student, classId);
};

export const fixAndAssignPendingReport = async (
  reportId: string,
  student: ReportAssignmentStudent,
  source: {
    sourceName: string;
    sourceStudentId: string;
    sourcePhoneSuffix: string;
    examDate: string;
  },
  actorRole?: string | null,
  actorUid?: string | null,
): Promise<void> => {
  if (!isStaffRole(actorRole)) {
    throw new Error("리포트 수정 및 배정 권한이 없습니다.");
  }

  const reportRef = doc(db, "reports", reportId);
  const snap = await getDocFromServer(reportRef);
  if (!snap.exists()) {
    throw new Error("수정할 리포트를 찾을 수 없습니다.");
  }

  const prev = snap.data() as Partial<ReportRecord>;
  const parsedJson = prev.parsedJson
    ? {
        ...prev.parsedJson,
        name: source.sourceName.trim(),
        studentId: source.sourceStudentId.trim(),
        phoneSuffix: source.sourcePhoneSuffix.trim(),
        writtenAt: source.examDate.trim(),
      }
    : undefined;
  const { classId, className } = resolveReportAssignmentClass(prev, student);
  const batch = writeBatch(db);
  const classAdded = queueMissingStudentClass(batch, student, classId, className);

  batch.update(reportRef, {
    studentUid: student.uid,
    studentName: student.name ?? "",
    studentId: (student.studentId ?? "").trim() || null,
    classId,
    className,
    sourceName: source.sourceName.trim(),
    sourceStudentId: source.sourceStudentId.trim() || null,
    sourcePhoneSuffix: source.sourcePhoneSuffix.trim() || null,
    examDate: source.examDate.trim(),
    writtenAt: source.examDate.trim(),
    assignmentStatus: "completed",
    status: "completed",
    matchMethod: "admin_manual_fix",
    matchReason: classAdded
      ? "관리자가 원본 정보를 수정하고 학생을 반에 추가한 뒤 배정했습니다."
      : "관리자가 원본 정보를 수정하고 학생을 배정했습니다.",
    assignedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    fixedBy: actorUid ?? null,
    fixedAt: serverTimestamp(),
    ...(parsedJson ? { parsedJson } : {}),
  });

  await batch.commit();
  if (classAdded) await verifyStudentHasClass(student, classId);
};


const fetchReportRecordsByIds = async (reportIds: string[]): Promise<Map<string, ReportRecord>> => {
  const uniqueIds = Array.from(new Set(reportIds.filter(Boolean)));
  if (!uniqueIds.length) return new Map();

  const chunks: string[][] = [];
  for (let start = 0; start < uniqueIds.length; start += 30) {
    chunks.push(uniqueIds.slice(start, start + 30));
  }

  const snapshots = await Promise.all(
    chunks.map((ids) =>
      getDocs(query(collection(db, "reports"), where(documentId(), "in", ids))),
    ),
  );
  const reports = new Map<string, ReportRecord>();
  snapshots.forEach((snapshot) => {
    snapshot.docs.forEach((docSnap) => {
      reports.set(
        docSnap.id,
        hydrateReportRecord(docSnap.id, docSnap.data() as Omit<ReportRecord, "id">),
      );
    });
  });
  return reports;
};

export const subscribeOpenReportClaims = (
  onChange: (claims: ReportClaimTriageRecord[]) => void,
  onError?: (error: Error) => void,
) => {
  const claimsQuery = query(collection(db, "report_claims"), where("status", "==", "open"));
  let snapshotVersion = 0;

  return onSnapshot(
    claimsQuery,
    async (snapshot) => {
      const version = ++snapshotVersion;
      try {
        const rows = snapshot.docs.map((claimDoc) => {
          const data = claimDoc.data() as {
            reportId?: string;
            studentUid?: string;
            status?: "open" | "resolved";
            createdAt?: Timestamp | null;
            updatedAt?: Timestamp | null;
            resolvedAt?: Timestamp | null;
            resolvedBy?: string | null;
          };
          return {
            id: claimDoc.id,
            reportId: data.reportId ?? "",
            studentUid: data.studentUid ?? "",
            status: (data.status ?? "open") as "open" | "resolved",
            createdAt: data.createdAt ?? null,
            updatedAt: data.updatedAt ?? null,
            resolvedAt: data.resolvedAt ?? null,
            resolvedBy: data.resolvedBy ?? null,
          };
        });
        const reportsById = await fetchReportRecordsByIds(rows.map((row) => row.reportId));
        if (version !== snapshotVersion) return;

        onChange(
          rows
            .map((row) => ({ ...row, report: reportsById.get(row.reportId) ?? null }))
            .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
        );
      } catch (error) {
        if (version !== snapshotVersion) return;
        onError?.(error instanceof Error ? error : new Error("오배송 신고 리포트를 불러오지 못했습니다."));
      }
    },
    (error) => {
      snapshotVersion += 1;
      onError?.(error);
    },
  );
};

export const fetchReportsByClassId = async (classId: string): Promise<ReportRecord[]> => {
  const reportsRef = collection(db, "reports");

  try {
    const snapshot = await getDocs(
      query(reportsRef, where("classId", "==", classId), orderBy("createdAt", "desc")),
    );
    return hydrateReportRecords(snapshot.docs);
  } catch (error) {
    if (
      !error
      || typeof error !== "object"
      || !("code" in error)
      || error.code !== "failed-precondition"
    ) {
      throw error;
    }
    const snapshot = await getDocs(query(reportsRef, where("classId", "==", classId)));
    return hydrateReportRecords(snapshot.docs);
  }
};

export const fetchPublishedReports = async (
  onProgress?: (reports: ReportRecord[], pageCount: number) => void,
): Promise<ReportRecord[]> => {
  const reportsRef = collection(db, "reports");

  const loadPages = async (ordered: boolean) => {
    const reports: ReportRecord[] = [];
    let cursor: Awaited<ReturnType<typeof getDocs>>["docs"][number] | null = null;
    let pageCount = 0;

    while (true) {
      const constraints = [
        where("assignmentStatus", "==", "completed"),
        ...(ordered ? [orderBy("createdAt", "desc")] : []),
        ...(cursor ? [startAfter(cursor)] : []),
        limit(PUBLISHED_REPORT_PAGE_SIZE),
      ];
      const snapshot = await getDocs(query(reportsRef, ...constraints));
      for (const docSnap of snapshot.docs) {
        reports.push(
          hydrateReportRecord(docSnap.id, docSnap.data() as Omit<ReportRecord, "id">),
        );
      }
      pageCount += 1;

      if (pageCount === 1) {
        onProgress?.([...reports].sort(compareReportsByExamDateDesc), pageCount);
      }

      if (snapshot.docs.length < PUBLISHED_REPORT_PAGE_SIZE) {
        return reports.sort(compareReportsByExamDateDesc);
      }
      cursor = snapshot.docs.at(-1) ?? null;
    }
  };

  try {
    return await loadPages(true);
  } catch (error) {
    if (
      !error
      || typeof error !== "object"
      || !("code" in error)
      || error.code !== "failed-precondition"
    ) {
      throw error;
    }
    return loadPages(false);
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

export const movePublishedReportToPending = async (reportId: string): Promise<void> => {
  const reportRef = doc(db, "reports", reportId);
  const snap = await getDoc(reportRef);
  const data = (snap.data() ?? {}) as Partial<ReportRecord>;

  await updateDoc(reportRef, {
    studentUid: null,
    studentId: null,
    studentName: data.sourceName ?? data.studentName ?? "",
    assignmentStatus: "unassigned_pending",
    status: "pending",
    assignedAt: null,
    updatedAt: serverTimestamp(),
  });
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
