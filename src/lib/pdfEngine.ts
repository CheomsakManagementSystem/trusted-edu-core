import {
  Timestamp,
  addDoc,
  collection,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { db, storage } from "@/lib/firebase";

export const reportFileNamePattern = /([가-힣]+)(\d{4})_(\d+)점/;

export interface ParsedPdfMeta {
  studentName: string;
  studentId: string;
  score: number;
}

export interface ValidatedPdfFile {
  file: File;
  parsed: ParsedPdfMeta;
}

export interface InvalidPdfFile {
  file: File;
  reason: string;
}

export interface ReportRecord {
  id: string;
  uid: string;
  studentId: string;
  studentName: string;
  score: number;
  examDate: string;
  examLabel?: string | null;
  testDate?: string | null;
  fileUrl?: string;
  fileName: string;
  createdAt: Timestamp | null;
  feedback?: string;
  reviewer?: string;
  writtenAt?: string;
  className?: string | null;
  essayTopic?: string;
  grade?: string;
  totalScore?: number;
  scores?: {
    reading?: number | null;
    comprehension?: number | null;
    problemUnderstanding?: number | null;
    organization?: number | null;
    expression?: number | null;
    total?: number | null;
  };
  averageScores?: {
    reading?: number | null;
    comprehension?: number | null;
    problemUnderstanding?: number | null;
    organization?: number | null;
    expression?: number | null;
    total?: number | null;
  };
}

export interface UploadFailure {
  file: File;
  reason: string;
}

export interface UploadBatchResult {
  successCount: number;
  failureCount: number;
  failures: UploadFailure[];
}

const normalizeDateString = (value: string | null | undefined): string | null => {
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

export const formatExamDateShort = (value: string | null | undefined, fallback = "-"): string => {
  const normalized = normalizeDateString(value);
  if (!normalized) {
    return fallback;
  }

  const [, month, day] = normalized.split("-");
  return `${month}.${day}`;
};

export const formatExamDate = (value: string | null | undefined, fallback = "날짜 정보 없음"): string => {
  const normalized = normalizeDateString(value);
  if (!normalized) {
    return fallback;
  }

  const [year, month, day] = normalized.split("-");
  return `${year}.${month}.${day}`;
};

const getReportSortTimestamp = (report: Pick<ReportRecord, "examDate" | "testDate" | "createdAt" | "writtenAt">) => {
  const normalized =
    normalizeDateString(report.examDate) ??
    normalizeDateString(report.testDate) ??
    normalizeDateString(report.writtenAt);
  if (normalized) {
    return new Date(`${normalized}T00:00:00`).getTime();
  }
  return report.createdAt?.toMillis() ?? 0;
};

const hydrateReportRecord = (
  id: string,
  data: Omit<ReportRecord, "id" | "examDate"> & { examDate?: string | null },
): ReportRecord => ({
  id,
  ...data,
  examDate:
    normalizeDateString(data.examDate) ??
    normalizeDateString(data.testDate) ??
    normalizeDateString(data.writtenAt) ??
    "",
  examLabel: data.examLabel?.trim() || null,
});

export const parseReportFileName = (fileName: string): ParsedPdfMeta | null => {
  const baseName = fileName.replace(/\.pdf$/i, "");
  const matched = baseName.match(reportFileNamePattern);
  if (!matched) {
    return null;
  }

  const score = Number(matched[3]);
  if (!Number.isFinite(score)) {
    return null;
  }

  return {
    studentName: matched[1],
    studentId: matched[2],
    score,
  };
};

export const validatePdfFile = (file: File): ValidatedPdfFile | InvalidPdfFile => {
  if (!/\.pdf$/i.test(file.name)) {
    return { file, reason: "PDF 파일만 업로드할 수 있습니다." };
  }

  const parsed = parseReportFileName(file.name);
  if (!parsed) {
    return {
      file,
      reason: "파일명 형식 오류 (예: 홍길동1234_95점.pdf)",
    };
  }

  return { file, parsed };
};

export const classifyPdfFiles = (files: File[]) => {
  const validFiles: ValidatedPdfFile[] = [];
  const invalidFiles: InvalidPdfFile[] = [];

  files.forEach((file) => {
    const result = validatePdfFile(file);
    if ("parsed" in result) {
      validFiles.push(result);
      return;
    }
    invalidFiles.push(result);
  });

  return { validFiles, invalidFiles };
};

const normalizeUploadError = (error: unknown) => {
  const fallback = "업로드 또는 DB 동기화에 실패했습니다.";
  const reason = error instanceof Error ? error.message : fallback;
  const lowered = reason.toLowerCase();

  if (lowered.includes("unauthenticated")) {
    return "로그인이 필요합니다.";
  }

  if (
    lowered.includes("permission denied") ||
    lowered.includes("permission-denied") ||
    lowered.includes("permission_denied") ||
    lowered.includes("storage/unauthorized")
  ) {
    return `${reason}\nFirebase Storage 보안 규칙 확인이 필요합니다.`;
  }

  return reason;
};

const uploadSingleReport = async (
  validFile: ValidatedPdfFile,
  uid: string,
  onFileProgress?: (progress: number) => void,
) => {
  const { file, parsed } = validFile;
  const storageRef = ref(storage, `reports/${parsed.studentId}/${Date.now()}_${file.name}`);
  const task = uploadBytesResumable(storageRef, file);

  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        if (!onFileProgress || snapshot.totalBytes === 0) {
          return;
        }

        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        onFileProgress(progress);
      },
      (error) => reject(error),
      () => resolve(),
    );
  });

  const fileUrl = await getDownloadURL(storageRef);

  await addDoc(collection(db, "reports"), {
    uid,
    studentId: parsed.studentId,
    studentName: parsed.studentName,
    score: parsed.score,
    fileUrl,
    fileName: file.name,
    createdAt: serverTimestamp(),
  });
};

export const uploadValidatedReportsBatch = async (
  validFiles: ValidatedPdfFile[],
  uid: string,
  onOverallProgress?: (progress: number) => void,
): Promise<UploadBatchResult> => {
  if (validFiles.length === 0) {
    onOverallProgress?.(0);
    return {
      successCount: 0,
      failureCount: 0,
      failures: [],
    };
  }

  const failures: UploadFailure[] = [];
  let successCount = 0;

  for (let i = 0; i < validFiles.length; i += 1) {
    const currentFile = validFiles[i];
    const completedBeforeThisFile = (i / validFiles.length) * 100;

    try {
      await uploadSingleReport(currentFile, uid, (fileProgress) => {
        const weightedProgress =
          completedBeforeThisFile + fileProgress / validFiles.length;
        onOverallProgress?.(Math.min(100, weightedProgress));
      });

      successCount += 1;
      onOverallProgress?.(((i + 1) / validFiles.length) * 100);
    } catch (error) {
      failures.push({
        file: currentFile.file,
        reason: normalizeUploadError(error),
      });
    }
  }

  return {
    successCount,
    failureCount: failures.length,
    failures,
  };
};

export const fetchReportsByStudentId = async (
  studentId: string,
): Promise<ReportRecord[]> => {
  const reportsRef = collection(db, "reports");

  try {
    const snapshot = await getDocs(
      query(
        reportsRef,
        where("studentId", "==", studentId),
        orderBy("createdAt", "desc"),
      ),
    );

    return snapshot.docs
      .map((doc) => hydrateReportRecord(doc.id, doc.data() as Omit<ReportRecord, "id">))
      .sort((a, b) => getReportSortTimestamp(a) - getReportSortTimestamp(b));
  } catch {
    const snapshot = await getDocs(
      query(reportsRef, where("studentId", "==", studentId)),
    );

    return snapshot.docs
      .map((doc) => hydrateReportRecord(doc.id, doc.data() as Omit<ReportRecord, "id">))
      .sort((a, b) => getReportSortTimestamp(a) - getReportSortTimestamp(b));
  }
};
