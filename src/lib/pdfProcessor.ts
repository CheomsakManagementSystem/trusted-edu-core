import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  orderBy,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { db, storage } from "@/lib/firebase";

const STORAGE_UPLOAD_TIMEOUT_MS = 60_000;
const PDFJS_VERSION = "4.10.38";

export type MatchStatus = "auto_matched" | "needs_selection" | "unregistered";
export type JoinRequestStatus = "pending" | "approved" | "rejected";

export type StudentLite = {
  uid: string;
  name: string;
  email: string;
  classId?: string | null;
  className?: string | null;
  studentId?: string | null;
};

export type ClassLite = {
  id: string;
  name: string;
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
  studentUid: string;
  studentId: string | null;
  studentName: string;
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

const sanitizeFeedback = (input: string): string => {
  return input
    .replace(/김윤환\s*class/gi, " ")
    .replace(/첨삭\s*채점표/gi, " ")
    .replace(/내용\s*형식/gi, " ")
    .replace(/작성일\s*[:：]?\s*[0-9./-]+/gi, " ")
    .replace(/수강반\s*[:：]?\s*[^\s]+/gi, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
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
  getDocument: (params: { data: ArrayBuffer }) => {
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getTextContent: () => Promise<{
          items: Array<{ str?: string }>;
        }>;
      }>;
    }>;
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

    const pdfjs = await loadPdfJs();

    const bytes = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = (content.items as Array<{ str?: string }>)
        .map((item) => item.str ?? "")
        .join(" ")
        .trim();
      pageTexts.push(text);
    }

    const parsed = parsePdfText(pageTexts.join("\n"));

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
  const classMatches = byName(classStudents, parsedName);

  if (classMatches.length === 1) {
    return {
      status: "auto_matched",
      candidates: classMatches,
      selectedStudentUid: classMatches[0].uid,
    };
  }

  if (classMatches.length > 1) {
    return {
      status: "needs_selection",
      candidates: classMatches,
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
    const base: UploadCandidate = {
      id: `${file.name}-${file.lastModified}`,
      file,
      parsed: { ...EMPTY_PARSED },
      status: "unregistered",
      candidates: allStudents,
      selectedStudentUid: null,
    };

    try {
      const parsed = await extractPdfData(file);
      const merged = {
        ...parsed,
        name: parsed.name || fileHint.name || "",
        scores: {
          ...parsed.scores,
          total: parsed.scores.total ?? parsed.convertedScores.total ?? fileHint.total ?? null,
        },
      };
      const match = resolveMatchStatus(merged.name, classStudents, allStudents);
      candidates.push({ ...base, parsed: merged, ...match });
    } catch (error) {
      candidates.push({
        ...base,
        parsed: {
          ...base.parsed,
          name: fileHint.name || "",
          scores: {
            ...base.parsed.scores,
            total: fileHint.total ?? null,
          },
        },
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
  allStudents: StudentLite[],
  uid: string,
  onOverallProgress?: (progress: number) => void,
): Promise<{
  successCount: number;
  failureCount: number;
  failures: string[];
  results: Array<{ candidateId: string; success: boolean; reportId?: string; error?: string }>;
}> => {
  if (!uploadRows.length) {
    return { successCount: 0, failureCount: 0, failures: [], results: [] };
  }

  let successCount = 0;
  const failures: string[] = [];
  const results: Array<{ candidateId: string; success: boolean; reportId?: string; error?: string }> = [];

  for (let i = 0; i < uploadRows.length; i += 1) {
    const row = uploadRows[i];

    try {
      if (!row.selectedStudentUid) {
        throw new Error("학생 매칭이 완료되지 않았습니다.");
      }

      if (row.parseError) {
        throw new Error(`파싱 실패: ${row.parseError}`);
      }

      if (!hasScoreIntegrity(row.parsed.scores)) {
        throw new Error(
          "파싱 실패: 점수 5개(독해력/내용 이해력/문제 이해력/구성력/표현력)를 모두 입력해주세요.",
        );
      }

      const student = allStudents.find((entry) => entry.uid === row.selectedStudentUid);
      if (!student) {
        throw new Error("매칭된 학생 정보를 찾을 수 없습니다.");
      }

      const url = await uploadPdfToStorage(student.uid, row.file, (fileProgress) => {
        const baseProgress = (i / uploadRows.length) * 100;
        onOverallProgress?.(baseProgress + fileProgress / uploadRows.length);
      });

      const totalScore = row.parsed.scores.total ?? sumRequiredScores(row.parsed.scores);

      const created = await addDoc(collection(db, "reports"), {
        uid,
        classId: selectedClass.id,
        className: selectedClass.name,
        studentUid: student.uid,
        studentId: student.studentId ?? null,
        studentName: student.name,
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
        createdAt: serverTimestamp(),
      });

      successCount += 1;
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
    failures,
    results,
  };
};

export const fetchStudents = async (): Promise<StudentLite[]> => {
  try {
    const snap = await getDocs(query(collection(db, "users"), where("role", "==", "student")));
    return snap.docs.map((docSnap) => {
      const data = docSnap.data() as {
        uid?: string;
        name?: string;
        email?: string;
        classId?: string;
        className?: string;
        studentId?: string;
      };
      return {
        uid: data.uid ?? docSnap.id,
        name: data.name ?? "이름없음",
        email: data.email ?? "",
        classId: data.classId ?? null,
        className: data.className ?? null,
        studentId: data.studentId ?? null,
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
  const pendingSnap = await getDocs(
    query(
      collection(db, "classJoinRequests"),
      where("studentUid", "==", student.uid),
      where("classId", "==", classInfo.id),
      where("status", "==", "pending"),
    ),
  );

  if (!pendingSnap.empty) {
    throw new Error("이미 해당 반에 가입 신청이 접수되어 있습니다.");
  }

  await addDoc(collection(db, "classJoinRequests"), {
    studentUid: student.uid,
    studentName: student.name,
    studentEmail: student.email,
    classId: classInfo.id,
    className: classInfo.name,
    status: "pending",
    createdAt: serverTimestamp(),
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
    const snapshot = await getDocs(
      query(reportsRef, where("studentUid", "==", studentUid), orderBy("createdAt", "desc")),
    );

    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Omit<ReportRecord, "id">;
      return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
    });
  } catch {
    const snapshot = await getDocs(query(reportsRef, where("studentUid", "==", studentUid)));

    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Omit<ReportRecord, "id">;
        return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
      })
      .sort((a, b) => {
        const aMs = a.createdAt?.toMillis() ?? 0;
        const bMs = b.createdAt?.toMillis() ?? 0;
        return bMs - aMs;
      });
  }
};

export const fetchReportsByClassId = async (classId: string): Promise<ReportRecord[]> => {
  const reportsRef = collection(db, "reports");

  try {
    const snapshot = await getDocs(
      query(reportsRef, where("classId", "==", classId), orderBy("createdAt", "desc")),
    );
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Omit<ReportRecord, "id">;
      return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
    });
  } catch {
    const snapshot = await getDocs(query(reportsRef, where("classId", "==", classId)));
    return snapshot.docs
      .map((docSnap) => {
        const data = docSnap.data() as Omit<ReportRecord, "id">;
        return { id: docSnap.id, ...data, isRead: Boolean(data.isRead) };
      })
      .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  }
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
