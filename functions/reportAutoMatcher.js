"use strict";

const AUTO_MATCH_VERSION = "class-name-v1";

const normalizeName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .trim();

const normalizeIdentifier = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();

const normalizePhoneSuffix = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
};

const legacyPhoneSuffixFromIdentifier = (value) => {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length === 4 ? digits : "";
};

const normalizeClassName = (value) =>
  String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .trim()
    .toLowerCase();

const firstNonEmpty = (...values) =>
  values.find((value) => String(value ?? "").trim().length > 0) ?? "";

const getStudentClassIds = (student) => {
  const values = Array.isArray(student.classIds) ? student.classIds : [];
  return new Set(
    [...values, student.classId]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
};

const isStudentRole = (student) =>
  String(student.role ?? "STUDENT").trim().toUpperCase() === "STUDENT";

const isPendingReport = (report) =>
  report.assignmentStatus === "unassigned_pending" &&
  !String(report.studentUid ?? "").trim() &&
  !String(report.studentId ?? "").trim();

const dedupeStudents = (students) => {
  const seen = new Set();
  return students.filter((student) => {
    const key = String(student.uid ?? student.docId ?? "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const buildAutoMatchIndex = (students, classes) => {
  const classById = new Map();
  const classesByName = new Map();

  classes.forEach((classInfo) => {
    const id = String(classInfo.id ?? "").trim();
    if (!id) return;

    const normalizedClass = { id, name: String(classInfo.name ?? "").trim() };
    classById.set(id, normalizedClass);

    const nameKey = normalizeClassName(normalizedClass.name);
    if (!nameKey) return;
    const rows = classesByName.get(nameKey) ?? [];
    rows.push(normalizedClass);
    classesByName.set(nameKey, rows);
  });

  const studentsByClassAndName = new Map();
  students.filter(isStudentRole).forEach((student) => {
    const nameKey = normalizeName(student.name);
    if (!nameKey) return;

    getStudentClassIds(student).forEach((classId) => {
      const key = `${classId}\u0000${nameKey}`;
      const rows = studentsByClassAndName.get(key) ?? [];
      rows.push(student);
      studentsByClassAndName.set(key, rows);
    });
  });

  return { classById, classesByName, studentsByClassAndName };
};

const resolveReportClass = (report, index) => {
  const reportClassId = String(report.classId ?? "").trim();
  if (reportClassId) {
    return {
      status: "resolved",
      classInfo: index.classById.get(reportClassId) ?? {
        id: reportClassId,
        name: String(firstNonEmpty(report.className, report.sourceClassName)).trim(),
      },
    };
  }

  const classNames = [report.className, report.sourceClassName]
    .map(normalizeClassName)
    .filter(Boolean);

  for (const nameKey of [...new Set(classNames)]) {
    const matches = index.classesByName.get(nameKey) ?? [];
    if (matches.length === 1) {
      return { status: "resolved", classInfo: matches[0] };
    }
    if (matches.length > 1) {
      return { status: "skipped", reason: "ambiguous_class" };
    }
  }

  return { status: "skipped", reason: "missing_class" };
};

const getReportSource = (report) => ({
  name: firstNonEmpty(report.sourceName, report.parsedJson?.name, report.studentName),
  studentId: firstNonEmpty(report.sourceStudentId, report.parsedJson?.studentId),
  phoneSuffix: firstNonEmpty(report.sourcePhoneSuffix, report.parsedJson?.phoneSuffix),
});

const studentMatchesIdentifier = (student, identifier) => {
  const expected = normalizeIdentifier(identifier);
  return Boolean(expected) && normalizeIdentifier(student.studentId) === expected;
};

const studentMatchesPhone = (student, phoneSuffix) => {
  const expected = normalizePhoneSuffix(phoneSuffix);
  if (!expected) return false;
  return [
    student.phoneSuffix,
    student.phoneNumber,
    legacyPhoneSuffixFromIdentifier(student.studentId),
  ]
    .some((value) => normalizePhoneSuffix(value) === expected);
};

const createMatch = (student, classInfo, method) => ({
  status: "matched",
  student,
  classInfo,
  method,
});

const resolvePendingReportMatch = (report, index) => {
  if (!isPendingReport(report)) {
    return { status: "skipped", reason: "not_eligible" };
  }

  const source = getReportSource(report);
  const nameKey = normalizeName(source.name);
  if (!nameKey) {
    return { status: "skipped", reason: "missing_name" };
  }

  const classResult = resolveReportClass(report, index);
  if (classResult.status !== "resolved") return classResult;

  const classInfo = classResult.classInfo;
  const candidates = dedupeStudents(
    index.studentsByClassAndName.get(`${classInfo.id}\u0000${nameKey}`) ?? [],
  );

  if (candidates.length === 0) {
    return { status: "skipped", reason: "no_student" };
  }
  if (candidates.length === 1) {
    return createMatch(candidates[0], classInfo, "scheduled_class_name_exact");
  }

  const idMatches = candidates.filter((student) =>
    studentMatchesIdentifier(student, source.studentId),
  );
  if (idMatches.length === 1) {
    return createMatch(idMatches[0], classInfo, "scheduled_class_name_student_id");
  }

  const phoneHint = firstNonEmpty(
    source.phoneSuffix,
    legacyPhoneSuffixFromIdentifier(source.studentId),
  );
  const phoneMatches = candidates.filter((student) =>
    studentMatchesPhone(student, phoneHint),
  );
  if (phoneMatches.length === 1) {
    return createMatch(phoneMatches[0], classInfo, "scheduled_class_name_phone_suffix");
  }

  return { status: "skipped", reason: "ambiguous_student" };
};

const validateSelectedStudent = (student, report, classInfo, method) => {
  if (!isStudentRole(student)) return false;
  if (!getStudentClassIds(student).has(classInfo.id)) return false;

  const source = getReportSource(report);
  if (normalizeName(student.name) !== normalizeName(source.name)) return false;

  if (method === "scheduled_class_name_student_id") {
    return studentMatchesIdentifier(student, source.studentId);
  }
  if (method === "scheduled_class_name_phone_suffix") {
    const phoneHint = firstNonEmpty(
      source.phoneSuffix,
      legacyPhoneSuffixFromIdentifier(source.studentId),
    );
    return studentMatchesPhone(student, phoneHint);
  }
  return method === "scheduled_class_name_exact";
};

module.exports = {
  AUTO_MATCH_VERSION,
  buildAutoMatchIndex,
  isPendingReport,
  normalizeClassName,
  normalizeName,
  resolvePendingReportMatch,
  validateSelectedStudent,
};
