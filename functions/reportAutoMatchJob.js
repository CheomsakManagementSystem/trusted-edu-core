"use strict";

const crypto = require("node:crypto");
const {
  AUTO_MATCH_VERSION,
  buildAutoMatchIndex,
  isPendingReport,
  resolvePendingReportMatch,
  validateSelectedStudent,
} = require("./reportAutoMatcher");

const LOCK_DOCUMENT = "system_jobs/report_auto_match";
const RUNS_COLLECTION = "report_auto_match_runs";
const LOCK_LEASE_MS = 10 * 60 * 1000;
const WRITE_CONCURRENCY = 20;

const MATCH_REASONS = {
  scheduled_class_name_exact: "오전 2시 자동 매칭: 반과 학생 이름이 단일 일치했습니다.",
  scheduled_class_name_student_id:
    "오전 2시 자동 매칭: 반과 학생 이름, 학생 고유 ID가 일치했습니다.",
  scheduled_class_name_phone_suffix:
    "오전 2시 자동 매칭: 반과 학생 이름, 전화번호 뒤 4자리가 일치했습니다.",
};

const createRunId = () =>
  `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}_${crypto.randomUUID().slice(0, 8)}`;

const runWithConcurrency = async (rows, concurrency, worker) => {
  let nextIndex = 0;
  const results = new Array(rows.length);
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), rows.length) },
    async () => {
      while (nextIndex < rows.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await worker(rows[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
};

const acquireLease = async (db, admin, runId, nowMs) => {
  const lockRef = db.doc(LOCK_DOCUMENT);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    const leaseUntilMs = snapshot.data()?.leaseUntil?.toMillis?.() ?? 0;
    if (leaseUntilMs > nowMs) return false;

    transaction.set(
      lockRef,
      {
        status: "running",
        runId,
        startedAt: admin.firestore.FieldValue.serverTimestamp(),
        leaseUntil: admin.firestore.Timestamp.fromMillis(nowMs + LOCK_LEASE_MS),
        version: AUTO_MATCH_VERSION,
      },
      { merge: true },
    );
    return true;
  });
};

const releaseLease = async (db, admin, runId, status, summary) => {
  const lockRef = db.doc(LOCK_DOCUMENT);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(lockRef);
    if (snapshot.data()?.runId !== runId) return;
    transaction.set(
      lockRef,
      {
        status,
        leaseUntil: admin.firestore.Timestamp.fromMillis(0),
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSummary: summary,
      },
      { merge: true },
    );
  });
};

const toStudent = (snapshot) => {
  const data = snapshot.data();
  return {
    docId: snapshot.id,
    uid: String(data.uid ?? snapshot.id),
    name: String(data.name ?? ""),
    role: String(data.role ?? "STUDENT"),
    classId: data.classId ?? null,
    classIds: Array.isArray(data.classIds) ? data.classIds : [],
    studentId: data.studentId ?? null,
    phoneNumber: data.phoneNumber ?? null,
    phoneSuffix: data.phoneSuffix ?? null,
  };
};

const toClass = (snapshot) => ({
  id: snapshot.id,
  name: String(snapshot.data().name ?? ""),
});

const createEmptySummary = (runId) => ({
  runId,
  version: AUTO_MATCH_VERSION,
  pendingCount: 0,
  matchCandidateCount: 0,
  matchedCount: 0,
  staleCount: 0,
  errorCount: 0,
  unmatched: {
    missingName: 0,
    missingClass: 0,
    ambiguousClass: 0,
    noStudent: 0,
    ambiguousStudent: 0,
    notEligible: 0,
  },
});

const countSkippedReason = (summary, reason) => {
  const keyByReason = {
    missing_name: "missingName",
    missing_class: "missingClass",
    ambiguous_class: "ambiguousClass",
    no_student: "noStudent",
    ambiguous_student: "ambiguousStudent",
    not_eligible: "notEligible",
  };
  const key = keyByReason[reason] ?? "notEligible";
  summary.unmatched[key] += 1;
};

const commitMatch = async (db, admin, runId, candidate) => {
  const reportRef = candidate.snapshot.ref;
  const studentRef = db.collection("users").doc(candidate.match.student.docId);

  return db.runTransaction(async (transaction) => {
    const reportSnapshot = await transaction.get(reportRef);
    const studentSnapshot = await transaction.get(studentRef);
    if (!reportSnapshot.exists || !studentSnapshot.exists) return "stale";

    const report = reportSnapshot.data();
    const student = toStudent(studentSnapshot);
    if (
      !isPendingReport(report) ||
      !validateSelectedStudent(
        student,
        report,
        candidate.match.classInfo,
        candidate.match.method,
      )
    ) {
      return "stale";
    }

    transaction.update(reportRef, {
      studentUid: student.uid,
      studentId: String(student.studentId ?? "").trim() || null,
      studentName: student.name,
      classId: candidate.match.classInfo.id,
      className:
        String(report.className ?? "").trim() ||
        candidate.match.classInfo.name ||
        String(report.sourceClassName ?? "").trim(),
      assignmentStatus: "completed",
      status: "completed",
      assignedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      autoMatchedAt: admin.firestore.FieldValue.serverTimestamp(),
      autoMatchRunId: runId,
      autoMatchVersion: AUTO_MATCH_VERSION,
      matchMethod: candidate.match.method,
      matchReason: MATCH_REASONS[candidate.match.method],
    });
    return "matched";
  });
};

const runReportAutoMatchJob = async ({ admin, logger = console, now = () => Date.now() }) => {
  const db = admin.firestore();
  const runId = createRunId();
  const startedMs = now();
  const summary = createEmptySummary(runId);
  const acquired = await acquireLease(db, admin, runId, startedMs);

  if (!acquired) {
    logger.info("report_auto_match_skipped", { reason: "active_lease" });
    return { status: "skipped", reason: "active_lease" };
  }

  const runRef = db.collection(RUNS_COLLECTION).doc(runId);
  await runRef.set({
    ...summary,
    status: "running",
    schedule: "daily_02_kst",
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  try {
    const [studentSnapshot, classSnapshot, pendingSnapshot] = await Promise.all([
      db.collection("users").where("role", "in", ["student", "STUDENT"]).get(),
      db.collection("classes").get(),
      db.collection("reports").where("assignmentStatus", "==", "unassigned_pending").get(),
    ]);

    const students = studentSnapshot.docs.map(toStudent);
    const classes = classSnapshot.docs.map(toClass);
    const index = buildAutoMatchIndex(students, classes);
    const candidates = [];

    summary.pendingCount = pendingSnapshot.size;
    pendingSnapshot.docs.forEach((snapshot) => {
      const match = resolvePendingReportMatch(snapshot.data(), index);
      if (match.status === "matched") {
        candidates.push({ snapshot, match });
      } else {
        countSkippedReason(summary, match.reason);
      }
    });
    summary.matchCandidateCount = candidates.length;

    const outcomes = await runWithConcurrency(candidates, WRITE_CONCURRENCY, async (candidate) => {
      try {
        return await commitMatch(db, admin, runId, candidate);
      } catch (error) {
        logger.error("report_auto_match_write_failed", {
          runId,
          error: error instanceof Error ? error.message : String(error),
        });
        return "error";
      }
    });

    summary.matchedCount = outcomes.filter((outcome) => outcome === "matched").length;
    summary.staleCount = outcomes.filter((outcome) => outcome === "stale").length;
    summary.errorCount = outcomes.filter((outcome) => outcome === "error").length;
    const status = summary.errorCount > 0 ? "partial" : "success";
    const finishedMs = now();
    const finalSummary = { ...summary, durationMs: Math.max(0, finishedMs - startedMs) };

    await runRef.set(
      {
        ...finalSummary,
        status,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await releaseLease(db, admin, runId, status, finalSummary);
    logger.info("report_auto_match_completed", finalSummary);
    return { status, ...finalSummary };
  } catch (error) {
    const finishedMs = now();
    const errorMessage = error instanceof Error ? error.message : String(error);
    const finalSummary = {
      ...summary,
      durationMs: Math.max(0, finishedMs - startedMs),
      errorCount: summary.errorCount + 1,
    };

    await runRef.set(
      {
        ...finalSummary,
        status: "error",
        error: errorMessage,
        finishedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    await releaseLease(db, admin, runId, "error", finalSummary);
    logger.error("report_auto_match_failed", { runId, error: errorMessage });
    throw error;
  }
};

module.exports = {
  runReportAutoMatchJob,
};
