import { getPhoneLast4 } from "@/lib/phoneIdentity";

export type StudentIdentityCandidate = {
  uid: string;
  name?: string;
  studentPhone?: string | null;
  parentPhone?: string | null;
  studentPhoneLast4?: string | null;
  parentPhoneLast4?: string | null;
  phoneNumber?: string | null;
  phoneSuffix?: string | null;
  studentId?: string | null;
};

export type StudentIdentitySource = {
  studentPhoneLast4?: string | null;
  parentPhoneLast4?: string | null;
};

export type StudentIdentityResolution = {
  status: "matched" | "ambiguous" | "not_found" | "insufficient";
  student: StudentIdentityCandidate | null;
  candidates: StudentIdentityCandidate[];
  method: "student_phone_last4" | "student_parent_phone_last4" | null;
  reason: string;
};

const fourDigits = (value: string | null | undefined) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 4 ? digits : digits.length > 4 ? digits.slice(-4) : "";
};

export const getStudentIdentityLast4 = (student: StudentIdentityCandidate) =>
  fourDigits(student.studentPhoneLast4) ||
  getPhoneLast4(student.studentPhone) ||
  getPhoneLast4(student.phoneNumber) ||
  fourDigits(student.phoneSuffix) ||
  fourDigits(student.studentId);

export const getParentIdentityLast4 = (student: StudentIdentityCandidate) =>
  fourDigits(student.parentPhoneLast4) || getPhoneLast4(student.parentPhone);

const uniqueByUid = <T extends StudentIdentityCandidate>(rows: T[]) => {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!row.uid || seen.has(row.uid)) return false;
    seen.add(row.uid);
    return true;
  });
};

export const resolveStudentIdentity = <T extends StudentIdentityCandidate>(
  students: T[],
  source: StudentIdentitySource,
): StudentIdentityResolution & { student: T | null; candidates: T[] } => {
  const studentLast4 = fourDigits(source.studentPhoneLast4);
  const parentLast4 = fourDigits(source.parentPhoneLast4);

  if (!studentLast4) {
    return {
      status: "insufficient",
      student: null,
      candidates: [],
      method: null,
      reason: "학생 전화번호 뒤 4자리를 확인할 수 없습니다.",
    };
  }

  const primary = uniqueByUid(
    students.filter((student) => getStudentIdentityLast4(student) === studentLast4),
  );

  if (primary.length === 0) {
    return {
      status: "not_found",
      student: null,
      candidates: [],
      method: null,
      reason: `학생 전화번호 뒤 4자리(${studentLast4})와 일치하는 가입 학생이 없습니다.`,
    };
  }

  if (primary.length === 1) {
    return {
      status: "matched",
      student: primary[0],
      candidates: primary,
      method: "student_phone_last4",
      reason: `학생 전화번호 뒤 4자리(${studentLast4})가 단일 일치했습니다.`,
    };
  }

  if (!parentLast4) {
    return {
      status: "ambiguous",
      student: null,
      candidates: primary,
      method: null,
      reason: `학생 전화번호 뒤 4자리(${studentLast4})가 중복되어 학부모 전화번호 확인이 필요합니다.`,
    };
  }

  if (primary.some((student) => !getParentIdentityLast4(student))) {
    return {
      status: "ambiguous",
      student: null,
      candidates: primary,
      method: null,
      reason: "중복 후보 중 학부모 전화번호 정보가 없는 학생이 있어 자동 연결하지 않았습니다.",
    };
  }

  const secondary = primary.filter(
    (student) => getParentIdentityLast4(student) === parentLast4,
  );

  if (secondary.length === 1) {
    return {
      status: "matched",
      student: secondary[0],
      candidates: secondary,
      method: "student_parent_phone_last4",
      reason: `학생 번호가 중복되어 학부모 전화번호 뒤 4자리(${parentLast4})로 단일 확인했습니다.`,
    };
  }

  return {
    status: "ambiguous",
    student: null,
    candidates: secondary.length > 0 ? secondary : primary,
    method: null,
    reason:
      secondary.length > 1
        ? "학생/학부모 전화번호 뒤 4자리 조합이 중복되어 자동 연결하지 않았습니다."
        : "학부모 전화번호 뒤 4자리와 일치하는 후보를 확정할 수 없습니다.",
  };
};

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const findLabeledLast4 = (text: string, labels: string[]) => {
  for (const label of labels) {
    const matched = text.match(
      new RegExp(`${escapeRegex(label)}\\s*[:：]?\\s*([0-9][0-9\\s-]{7,16}[0-9])`, "i"),
    );
    const last4 = getPhoneLast4(matched?.[1]);
    if (last4) return last4;
  }
  return "";
};

export const extractPhoneIdentityHints = (
  rawText: string,
  fallbackStudentPhoneLast4?: string | null,
): Required<StudentIdentitySource> => {
  const text = String(rawText ?? "").normalize("NFKC");
  const studentPhoneLast4 =
    findLabeledLast4(text, [
      "학생 전화번호",
      "학생전화번호",
      "학생 연락처",
      "학생연락처",
      "본인 전화번호",
      "본인전화번호",
      "본인 연락처",
      "본인연락처",
    ]) || fourDigits(fallbackStudentPhoneLast4);
  const parentPhoneLast4 = findLabeledLast4(text, [
    "학부모 전화번호",
    "학부모전화번호",
    "학부모 연락처",
    "학부모연락처",
    "보호자 전화번호",
    "보호자전화번호",
    "보호자 연락처",
    "보호자연락처",
    "부모 전화번호",
    "부모전화번호",
    "부모 연락처",
    "부모연락처",
  ]);

  return { studentPhoneLast4, parentPhoneLast4 };
};
