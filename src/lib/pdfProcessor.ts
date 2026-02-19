import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  orderBy,
} from "firebase/firestore";
import {
  getDownloadURL,
  ref,
  uploadBytesResumable,
} from "firebase/storage";
import { db, storage } from "@/lib/firebase";

export type MatchStatus = "auto_matched" | "needs_selection" | "unregistered";

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
  essayTopic: string;
  grade: string;
  feedback: string;
  scores: ScoreBreakdown;
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
  essayTopic: string;
  grade: string;
  feedback: string;
  scores: ScoreBreakdown;
  totalScore: number;
  isRead: boolean;
  fileUrl: string;
  fileName: string;
  createdAt: Timestamp | null;
};

const EMPTY_PARSED: ParsedPdfData = {
  name: "",
  essayTopic: "",
  grade: "",
  feedback: "",
  scores: {
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

const extractField = (text: string, labels: string[]): string => {
  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*[:：]?\\s*([^\\n\\r]+)`, "i");
    const matched = text.match(regex);
    if (matched?.[1]) {
      return matched[1].trim();
    }
  }
  return "";
};

const extractFeedback = (text: string): string => {
  const start = text.search(/첨삭\s*총평\s*[:：]?/i);
  if (start < 0) {
    return "";
  }

  const fromLabel = text.slice(start).replace(/첨삭\s*총평\s*[:：]?/i, "").trim();
  const stopLabels = [/^논제\s*[:：]?/im, /^등급\s*[:：]?/im, /^총점\s*[:：]?/im];

  let endIndex = fromLabel.length;
  for (const stop of stopLabels) {
    const idx = fromLabel.search(stop);
    if (idx >= 0) {
      endIndex = Math.min(endIndex, idx);
    }
  }

  return fromLabel.slice(0, endIndex).trim();
};

const extractScore = (text: string, label: string): number | null => {
  const regex = new RegExp(`${label}\\s*[:：]?\\s*(-?\\d+(?:\\.\\d+)?)`, "i");
  const matched = text.match(regex);
  return parseNumber(matched?.[1]);
};

const parsePdfText = (text: string): ParsedPdfData => {
  const normalized = text
    .replace(/\u0000/g, "")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();

  const name = extractField(normalized, ["이름", "성명", "학생명"]);
  const essayTopic = extractField(normalized, ["논제", "주제"]);
  const grade = extractField(normalized, ["등급"]);

  const reading = extractScore(normalized, "독해력");
  const comprehension = extractScore(normalized, "내용\s*이해력");
  const problemUnderstanding = extractScore(normalized, "문제\s*이해력");
  const organization = extractScore(normalized, "구성력");
  const expression = extractScore(normalized, "표현력");

  const totalByLabel = extractScore(normalized, "총점");
  const totalByConverted = extractScore(normalized, "환산\s*점수");

  return {
    name,
    essayTopic,
    grade,
    feedback: extractFeedback(normalized),
    scores: {
      reading,
      comprehension,
      problemUnderstanding,
      organization,
      expression,
      total: totalByLabel ?? totalByConverted,
    },
    rawText: normalized,
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
  const sources = [
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs",
    "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.mjs",
  ];

  let lastError: unknown;

  for (const source of sources) {
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
    `pdfjs-dist 모듈을 로드하지 못했습니다. 네트워크를 확인해주세요. ${
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
      const text = content.items
        .map((item) => item.str ?? "")
        .join(" ")
        .trim();
      pageTexts.push(text);
    }

    return parsePdfText(pageTexts.join("\n"));
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
  return students.filter((s) => s.name.trim() === normalized);
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
          total: parsed.scores.total ?? fileHint.total ?? null,
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
        parseError:
          error instanceof Error ? error.message : "파싱 오류가 발생했습니다.",
      });
    }
  }

  return candidates;
};

const uploadPdfToStorage = async (
  studentUid: string,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<string> => {
  const storageRef = ref(storage, `reports/${studentUid}/${Date.now()}_${file.name}`);
  const task = uploadBytesResumable(storageRef, file);

  await new Promise<void>((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        if (!onProgress || snapshot.totalBytes === 0) {
          return;
        }
        onProgress((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
      },
      (error) => reject(error),
      () => resolve(),
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

      const student = allStudents.find((s) => s.uid === row.selectedStudentUid);
      if (!student) {
        throw new Error("매칭된 학생 정보를 찾을 수 없습니다.");
      }

      const url = await uploadPdfToStorage(student.uid, row.file, (fileProgress) => {
        const baseProgress = (i / uploadRows.length) * 100;
        onOverallProgress?.(baseProgress + fileProgress / uploadRows.length);
      });

      const created = await addDoc(collection(db, "reports"), {
        uid,
        classId: selectedClass.id,
        className: selectedClass.name,
        studentUid: student.uid,
        studentId: student.studentId ?? null,
        studentName: student.name,
        sourceName: row.parsed.name || "",
        essayTopic: row.parsed.essayTopic || "",
        grade: row.parsed.grade || "",
        feedback: row.parsed.feedback || "",
        scores: row.parsed.scores,
        totalScore: row.parsed.scores.total ?? 0,
        isRead: false,
        fileUrl: url,
        fileName: row.file.name,
        createdAt: serverTimestamp(),
      });

      successCount += 1;
      results.push({ candidateId: row.id, success: true, reportId: created.id });
      onOverallProgress?.(((i + 1) / uploadRows.length) * 100);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "배포 처리에 실패했습니다.";
      failures.push(
        `${row.file.name}: ${reason}`,
      );
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
