import type { DriveFile, ParsedSubmission, Student, SyncResult } from "@/types";

export const MATCH_PATTERN = /^([가-힣]+)(\d{4})_(\d+)점/;

export const parseFileName = (name: string): ParsedSubmission | null => {
  const match = name.match(MATCH_PATTERN);
  if (!match) return null;

  const [, studentName, phoneSuffix, scoreStr] = match;
  const score = Number(scoreStr);
  if (Number.isNaN(score)) return null;

  return {
    studentName,
    phoneSuffix,
    score,
  };
};

export const matchStudent = (
  parsed: ParsedSubmission,
  students: Student[]
): Student | undefined => {
  return students.find((s) => {
    const sameName = s.name === parsed.studentName;
    const sameSuffix =
      s.phoneSuffix === parsed.phoneSuffix ||
      s.studentKey?.endsWith(`_${parsed.phoneSuffix}`);
    return sameName && sameSuffix;
  });
};

export const buildSyncResults = (
  files: DriveFile[],
  students: Student[]
): SyncResult[] => {
  return files.map((file) => {
    const parsed = parseFileName(file.name);

    if (!parsed) {
      return {
        file,
        status: "parse_error",
        reason: "파일명을 규칙에 맞게 파싱할 수 없습니다.",
      };
    }

    const student = matchStudent(parsed, students);

    if (!student) {
      return {
        file,
        parsed,
        status: "no_student",
        reason: "해당 학생 정보를 찾을 수 없습니다.",
      };
    }

    return {
      file,
      parsed,
      student,
      status: "matched",
    };
  });
};

