import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import * as legacy from "./pdfProcessor";
import type {
  ClassLite,
  ParsedPdfData,
  ReportAssignmentStatus,
  ScoreBreakdown,
  StudentLite,
  UploadCandidate,
} from "./pdfProcessor";

export * from "./pdfProcessor";

const STORAGE_UPLOAD_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT_REPORT_UPLOADS = 3;
const REQUIRED_SCORE_KEYS: Array<Exclude<keyof ScoreBreakdown, "total">> = [
  "reading",
  "comprehension",
  "problemUnderstanding",
  "organization",
  "expression",
];

const emptyScores = (): ScoreBreakdown => ({
  reading: null,
  comprehension: null,
  problemUnderstanding: null,
  organization: null,
  expression: null,
  total: null,
});

const emptyParsed = (): ParsedPdfData => ({
  name: "",
  className: "",
  studentId: "",
  phoneSuffix: "",
  writtenAt: "",
  essayTopic: "",
  grade: "",
  reviewer: "",
  feedback: "",
  scores: emptyScores(),
  averageScores: emptyScores(),
  convertedScores: emptyScores(),
  rawText: "",
});

const createCandidateId = () =>
  globalThis.crypto?.randomUUID?.() ?? `pdf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`;

const hasScoreIntegrity = (scores: ScoreBreakdown) =>
  REQUIRED_SCORE_KEYS.every((key) => Number.isFinite(scores[key]) && (scores[key] ?? 0) >= 0);

const hasCompleteConvertedScores = (scores: ScoreBreakdown) =>
  REQUIRED_SCORE_KEYS.every((key) => Number.isFinite(scores[key]) && (scores[key] ?? 0) >= 0);

const sumScores = (scores: ScoreBreakdown) =>
  REQUIRED_SCORE_KEYS.reduce((sum, key) => sum + (scores[key] ?? 0), 0);

const weightedNormalizedTotal = (scores: ScoreBreakdown) =>
  (scores.reading ?? 0) * 0.2 +
  (scores.comprehension ?? 0) * 0.3 +
  (scores.problemUnderstanding ?? 0) * 0.2 +
  (scores.organization ?? 0) * 0.2 +
  (scores.expression ?? 0) * 0.1;

const looksLikeNormalizedScale = (scores: ScoreBreakdown) =>
  REQUIRED_SCORE_KEYS.some((key) => (scores[key] ?? 0) > 30);

const roundTenth = (value: number) => Math.round(value * 10) / 10;
const totalsMatch = (left: number, right: number) => Math.abs(left - right) <= 0.51;

const fallbackTotal = (scores: ScoreBreakdown) =>
  hasScoreIntegrity(scores) && looksLikeNormalizedScale(scores)
    ? roundTenth(weightedNormalizedTotal(scores))
    : sumScores(scores);

export const resolveParsedTotalScore = (
  parsed: Pick<ParsedPdfData, "scores" | "convertedScores">,
) => {
  if (Number.isFinite(parsed.scores.total) && (parsed.scores.total ?? 0) >= 0) {
    return parsed.scores.total as number;
  }
  if (hasScoreIntegrity(parsed.scores) && looksLikeNormalizedScale(parsed.scores)) {
    return fallbackTotal(parsed.scores);
  }
  if (hasCompleteConvertedScores(parsed.convertedScores)) {
    return sumScores(parsed.convertedScores);
  }
  return sumScores(parsed.scores);
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
  if (!Number.isFinite(total)) return null;
  if ((total ?? 0) < 0) return "총점은 0점 이상이어야 합니다.";

  const rawSum = sumScores(parsed.scores);
  const weightedTotal = looksLikeNormalizedScale(parsed.scores)
    ? roundTenth(weightedNormalizedTotal(parsed.scores))
    : null;
  const convertedSum = hasCompleteConvertedScores(parsed.convertedScores)
    ? sumScores(parsed.convertedScores)
    : null;

  const valid =
    (weightedTotal !== null && totalsMatch(total as number, weightedTotal)) ||
    totalsMatch(total as number, rawSum) ||
    (convertedSum !== null && totalsMatch(total as number, convertedSum));

  if (valid) return null;

  const expected = [
    weightedTotal !== null ? `가중 총점 ${weightedTotal}` : null,
    `항목 합계 ${rawSum}`,
    convertedSum !== null ? `환산점수 합계 ${convertedSum}` : null,
  ]
    .filter(Boolean)
    .join(" 또는 ");

  return `총점 ${total}점이 계산 결과(${expected})와 일치하지 않습니다.`;
};

export const getUploadCandidateValidationError = (
  parsed: Pick<ParsedPdfData, "scores" | "convertedScores" | "scoreParse" | "feedback">,
): string | null => {
  const scoreError = getParsedScoreValidationError(parsed);
  if (scoreError) return scoreError;
  if (!parsed.feedback.trim()) return "파싱 실패: 첨삭 총평이 비어 있습니다.";
  return null;
};

export const prepareUploadCandidates = async (
  files: File[],
  classStudents: StudentLite[],
  allStudents: StudentLite[],
): Promise<UploadCandidate[]> => {
  const rows = await legacy.prepareUploadCandidates(files, classStudents, allStudents);
  const seenFiles = new Set(rows.map((row) => fileKey(row.file)));

  const normalized = rows.map((row) => ({
    ...row,
    parseError: getUploadCandidateValidationError(row.parsed) ?? undefined,
  }));

  const missing = files
    .filter((file) => !seenFiles.has(fileKey(file)))
    .map<UploadCandidate>((file) => ({
      id: createCandidateId(),
      file,
      sourcePage: 1,
      sourcePageLabel: "1p",
      parsed: emptyParsed(),
      status: "unregistered",
      candidates: allStudents,
      selectedStudentUid: null,
      parseError: "[PDF_PARSE_EMPTY] PDF에서 읽을 수 있는 학생 리포트를 찾지 못했습니다. 텍스트 레이어 또는 PDF 양식을 확인해주세요.",
    }));

  return [...normalized, ...missing];
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
        if (onProgress && snapshot.totalBytes > 0) {
          onProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        }
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

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
) => {
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

const normalizePublishError = (error: unknown) =>
  error instanceof Error ? error.message : "배포 처리에 실패했습니다.";

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

  const results = new Array<{
    candidateId: string;
    success: boolean;
    reportId?: string;
    error?: string;
  }>(uploadRows.length);
  const outcomes = new Array<"completed" | "pending" | "failure">(uploadRows.length);
  const notices = new Array<string | undefined>(uploadRows.length);
  const failureMessages = new Array<string | undefined>(uploadRows.length);
  const progressByIndex = new Array<number>(uploadRows.length).fill(0);

  const updateProgress = (index: number, progress: number) => {
    progressByIndex[index] = Math.max(progressByIndex[index], Math.min(100, progress));
    onOverallProgress?.(
      progressByIndex.reduce((sum, value) => sum + value, 0) / uploadRows.length,
    );
  };

  await runWithConcurrency(uploadRows, MAX_CONCURRENT_REPORT_UPLOADS, async (row, index) => {
    try {
      const validationError = getUploadCandidateValidationError(row.parsed);
      if (validationError) throw new Error(validationError);

      const resolvedStudent = row.selectedStudentUid
        ? allStudents.find((student) => student.uid === row.selectedStudentUid) ?? null
        : null;
      const assignmentStatus: ReportAssignmentStatus = resolvedStudent
        ? "completed"
        : "unassigned_pending";
      const storageOwnerUid = resolvedStudent?.uid ?? uid;
      const url = await uploadPdfToStorage(storageOwnerUid, row.file, (progress) =>
        updateProgress(index, progress),
      );
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
          ...row.parsed,
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
        notices[index] = `[${resolvedStudent?.name ?? ""}] 학생에게 리포트를 전달했습니다`;
      }
    } catch (error) {
      const reason = normalizePublishError(error);
      outcomes[index] = "failure";
      failureMessages[index] = `${row.file.name}: ${reason}`;
      results[index] = { candidateId: row.id, success: false, error: reason };
    } finally {
      updateProgress(index, 100);
    }
  });

  const failures = failureMessages.filter((value): value is string => Boolean(value));
  return {
    successCount: outcomes.filter((value) => value === "completed").length,
    failureCount: failures.length,
    pendingCount: outcomes.filter((value) => value === "pending").length,
    autoAssignedNotices: notices.filter((value): value is string => Boolean(value)),
    failures,
    results,
  };
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
    total: payload.scores.total ?? fallbackTotal(payload.scores),
  };
  const reportRef = doc(db, "reports", reportId);
  const snapshot = await getDoc(reportRef);
  const previous = (snapshot.data() ?? {}) as { parsedJson?: ParsedPdfData };
  const updatePayload: Record<string, unknown> = {
    reviewer: payload.reviewer.trim(),
    feedback: payload.feedback.trim(),
    scores: normalizedScores,
    totalScore: normalizedScores.total ?? 0,
    updatedAt: serverTimestamp(),
  };

  if (previous.parsedJson) {
    updatePayload.parsedJson = {
      ...previous.parsedJson,
      reviewer: payload.reviewer.trim(),
      feedback: payload.feedback.trim(),
      scores: normalizedScores,
    };
  }

  await updateDoc(reportRef, updatePayload);
};
