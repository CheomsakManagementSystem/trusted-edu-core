import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getPhoneLast4 } from "@/lib/phoneIdentity";
import { normalizeClassIds } from "@/services/classTransferService";
import {
  extractPhoneIdentityHints,
  resolveStudentIdentity,
  type StudentIdentityCandidate,
  type StudentIdentitySource,
} from "@/services/studentIdentityResolver";
import * as hotfix from "./pdfProcessorHotfix";
import type {
  ParsedPdfData,
  ReportRecord,
  ScoreBreakdown,
  StudentLite,
  UploadCandidate,
} from "./pdfProcessorHotfix";
import { resolveReportTotalScore } from "./reportScoreIntegrity";

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

type PhoneIdentityStudent = StudentLite & StudentIdentityCandidate & {
  studentPhone?: string | null;
  parentPhone?: string | null;
  studentPhoneLast4?: string | null;
  parentPhoneLast4?: string | null;
};

type PhoneIdentityParsed = ParsedPdfData & {
  studentPhoneLast4?: string | null;
  parentPhoneSuffix?: string | null;
};

type PhoneIdentityReport = ReportRecord & {
  sourceParentPhoneSuffix?: string | null;
  parsedJson?: PhoneIdentityParsed;
};

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

export const hydrateReportRecord = (
  id: string,
  data: Omit<ReportRecord, "id" | "examDate"> & Record<string, unknown> & { examDate?: string | null },
): ReportRecord => {
  const hydrated = hotfix.hydrateReportRecord(id, data);
  const recoveredTotal = resolveReportTotalScore(
    data.totalScore,
    hydrated.scores,
    hydrated.convertedScores,
  );

  return {
    ...hydrated,
    totalScore: recoveredTotal ?? hydrated.totalScore,
  };
};

export const fetchStudents = async (): Promise<StudentLite[]> => {
  const snapshot = await getDocs(
    query(collection(db, "users"), where("role", "in", ["student", "STUDENT"])),
  );

  return snapshot.docs.map((docSnap) => {
    const data = docSnap.data() as {
      uid?: string;
      name?: string;
      email?: string;
      classId?: string | null;
      classIds?: unknown;
      className?: string | null;
      studentId?: string | null;
      phoneNumber?: string | null;
      phoneSuffix?: string | null;
      studentPhone?: string | null;
      parentPhone?: string | null;
      studentPhoneLast4?: string | null;
      parentPhoneLast4?: string | null;
    };
    const studentPhoneLast4 =
      data.studentPhoneLast4 ||
      getPhoneLast4(data.studentPhone) ||
      getPhoneLast4(data.phoneNumber) ||
      data.phoneSuffix ||
      (/^\d{4}$/.test(data.studentId ?? "") ? data.studentId : null);
    const parentPhoneLast4 = data.parentPhoneLast4 || getPhoneLast4(data.parentPhone) || null;
    const classIds = normalizeClassIds(data.classIds, data.classId ?? null);

    return {
      docId: docSnap.id,
      uid: data.uid ?? docSnap.id,
      name: data.name ?? "이름없음",
      email: data.email ?? "",
      classId: data.classId ?? null,
      classIds,
      className: data.className ?? null,
      studentId: data.studentId ?? studentPhoneLast4 ?? null,
      phoneNumber: data.phoneNumber ?? data.studentPhone ?? null,
      phoneSuffix: data.phoneSuffix ?? studentPhoneLast4 ?? null,
      studentPhone: data.studentPhone ?? null,
      parentPhone: data.parentPhone ?? null,
      studentPhoneLast4: studentPhoneLast4 ?? null,
      parentPhoneLast4,
    } as PhoneIdentityStudent;
  });
};

const resolvePhoneSource = (
  parsed: Pick<ParsedPdfData, "studentId" | "phoneSuffix"> &
    Partial<PhoneIdentityParsed> & { rawText?: string },
): StudentIdentitySource => {
  const fallbackStudentLast4 =
    parsed.studentPhoneLast4 ||
    parsed.phoneSuffix ||
    (/^\d{4}$/.test(parsed.studentId ?? "") ? parsed.studentId : "");
  const hints = extractPhoneIdentityHints(parsed.rawText ?? "", fallbackStudentLast4);

  return {
    studentPhoneLast4: hints.studentPhoneLast4,
    parentPhoneLast4: parsed.parentPhoneSuffix || hints.parentPhoneLast4,
  };
};

export const resolveMatchStatus = (
  parsed: Pick<ParsedPdfData, "name" | "className" | "studentId" | "phoneSuffix"> &
    Partial<PhoneIdentityParsed> & { rawText?: string },
  classStudents: StudentLite[],
  allStudents: StudentLite[],
): Pick<UploadCandidate, "status" | "candidates" | "selectedStudentUid" | "matchReason"> => {
  const source = resolvePhoneSource(parsed);

  if (source.studentPhoneLast4) {
    const resolution = resolveStudentIdentity(
      allStudents as PhoneIdentityStudent[],
      source,
    );

    if (resolution.status === "matched" && resolution.student) {
      const resolved = allStudents.find((student) => student.uid === resolution.student?.uid) ?? null;
      if (!resolved) {
        return {
          status: "unregistered",
          candidates: [],
          selectedStudentUid: null,
          matchReason: "전화번호로 확인된 학생 정보를 다시 찾지 못해 자동 연결하지 않았습니다.",
        };
      }

      const belongsToSelectedClass = classStudents.some((student) => student.uid === resolved.uid);
      if (!belongsToSelectedClass) {
        return {
          status: "unregistered",
          candidates: [resolved],
          selectedStudentUid: null,
          matchReason: `${resolution.reason} 선택한 반 소속은 확인이 필요해 미연결로 보관합니다.`,
        };
      }

      return {
        status: "ready",
        candidates: [resolved],
        selectedStudentUid: resolved.uid,
        matchReason: `${resolution.reason} 전화번호 기준으로 자동 매칭했습니다.`,
      };
    }

    return {
      status: "unregistered",
      candidates: resolution.candidates as StudentLite[],
      selectedStudentUid: null,
      matchReason: `${resolution.reason} 자동 연결하지 않고 확인 대상으로 보관합니다.`,
    };
  }

  return hotfix.resolveMatchStatus(parsed, classStudents, allStudents);
};

export const prepareUploadCandidates = async (
  files: File[],
  classStudents: StudentLite[],
  allStudents: StudentLite[],
): Promise<UploadCandidate[]> => {
  const rows = await hotfix.prepareUploadCandidates(files, classStudents, allStudents);

  return rows.map((row) => {
    const stabilized = stabilizeParsedScores(row.parsed);
    const hints = extractPhoneIdentityHints(stabilized.rawText, stabilized.phoneSuffix);
    const parsed: PhoneIdentityParsed = {
      ...stabilized,
      phoneSuffix: hints.studentPhoneLast4 || stabilized.phoneSuffix,
      studentPhoneLast4: hints.studentPhoneLast4 || null,
      parentPhoneSuffix: hints.parentPhoneLast4 || null,
    };
    const match = resolveMatchStatus(parsed, classStudents, allStudents);

    return {
      ...row,
      parsed,
      ...match,
      parseError: hotfix.getUploadCandidateValidationError(parsed) ?? undefined,
    };
  });
};

const pendingAutoAssigning = new Set<string>();

export const subscribePendingReports = (
  onChange: (reports: ReportRecord[]) => void,
  onError?: (error: Error) => void,
) => hotfix.subscribePendingReports(
  (reports) => {
    onChange(reports);

    void fetchStudents()
      .then(async (students) => {
        await Promise.all(
          reports.map(async (report) => {
            if (pendingAutoAssigning.has(report.id)) return;

            const phoneReport = report as PhoneIdentityReport;
            const parsed = phoneReport.parsedJson;
            const source = resolvePhoneSource({
              studentId: report.sourceStudentId ?? parsed?.studentId ?? "",
              phoneSuffix: report.sourcePhoneSuffix ?? parsed?.phoneSuffix ?? "",
              studentPhoneLast4: parsed?.studentPhoneLast4,
              parentPhoneSuffix:
                phoneReport.sourceParentPhoneSuffix ?? parsed?.parentPhoneSuffix ?? null,
              rawText: parsed?.rawText ?? "",
            });
            const resolution = resolveStudentIdentity(
              students as PhoneIdentityStudent[],
              source,
            );
            if (resolution.status !== "matched" || !resolution.student) return;

            const student = students.find((row) => row.uid === resolution.student?.uid);
            if (!student) return;

            pendingAutoAssigning.add(report.id);
            try {
              await hotfix.assignPendingReportToStudent(report.id, student);
            } catch (error) {
              console.error("Failed to auto-assign pending report by phone identity", {
                reportId: report.id,
                error,
              });
            } finally {
              pendingAutoAssigning.delete(report.id);
            }
          }),
        );
      })
      .catch((error) => {
        onError?.(
          error instanceof Error
            ? error
            : new Error("전화번호 기반 미연결 리포트 확인에 실패했습니다."),
        );
      });
  },
  onError,
);
