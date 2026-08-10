"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAutoMatchIndex,
  resolvePendingReportMatch,
} = require("./reportAutoMatcher");

const student = (overrides = {}) => ({
  docId: overrides.docId ?? overrides.uid ?? "student-doc",
  uid: overrides.uid ?? "student-uid",
  name: overrides.name ?? "손아정",
  role: overrides.role ?? "STUDENT",
  classId: overrides.classId ?? "class-a",
  classIds: overrides.classIds ?? [overrides.classId ?? "class-a"],
  studentId: overrides.studentId ?? null,
  phoneNumber: overrides.phoneNumber ?? null,
  phoneSuffix: overrides.phoneSuffix ?? null,
});

const pendingReport = (overrides = {}) => ({
  assignmentStatus: "unassigned_pending",
  studentUid: null,
  studentId: null,
  classId: "class-a",
  className: "(7월) 화 13:30 목동시대★(기본반4주)",
  sourceName: "손아정",
  sourceStudentId: null,
  sourcePhoneSuffix: null,
  ...overrides,
});

const classes = [
  { id: "class-a", name: "(7월) 화 13:30 목동시대★(기본반4주)" },
  { id: "class-b", name: "(7월) 목 18:00 대치 기본반" },
];

describe("scheduled report auto matcher", () => {
  it("matches one same-name student in the report class", () => {
    const index = buildAutoMatchIndex([student()], classes);
    const result = resolvePendingReportMatch(pendingReport(), index);

    assert.equal(result.status, "matched");
    assert.equal(result.student.uid, "student-uid");
    assert.equal(result.method, "scheduled_class_name_exact");
  });

  it("does not match the same name outside the report class", () => {
    const index = buildAutoMatchIndex(
      [student({ uid: "other", classId: "class-b", classIds: ["class-b"] })],
      classes,
    );
    const result = resolvePendingReportMatch(pendingReport(), index);

    assert.deepEqual(result, { status: "skipped", reason: "no_student" });
  });

  it("keeps same-class duplicate names unlinked without a tie-breaker", () => {
    const index = buildAutoMatchIndex(
      [student({ uid: "a" }), student({ uid: "b" })],
      classes,
    );
    const result = resolvePendingReportMatch(pendingReport(), index);

    assert.deepEqual(result, { status: "skipped", reason: "ambiguous_student" });
  });

  it("uses the phone suffix only to resolve same-class duplicate names", () => {
    const index = buildAutoMatchIndex(
      [
        student({ uid: "a", phoneSuffix: "0313" }),
        student({ uid: "b", phoneSuffix: "9988" }),
      ],
      classes,
    );
    const result = resolvePendingReportMatch(
      pendingReport({ sourceStudentId: "0313" }),
      index,
    );

    assert.equal(result.status, "matched");
    assert.equal(result.student.uid, "a");
    assert.equal(result.method, "scheduled_class_name_phone_suffix");
  });

  it("does not treat a numeric six-character custom ID as a phone suffix", () => {
    const index = buildAutoMatchIndex(
      [
        student({ uid: "a", studentId: "120313" }),
        student({ uid: "b", phoneSuffix: "9988" }),
      ],
      classes,
    );
    const result = resolvePendingReportMatch(
      pendingReport({ sourceStudentId: "990313" }),
      index,
    );

    assert.deepEqual(result, { status: "skipped", reason: "ambiguous_student" });
  });

  it("uses an exact student ID to resolve same-class duplicate names", () => {
    const index = buildAutoMatchIndex(
      [
        student({ uid: "a", studentId: "abc123" }),
        student({ uid: "b", studentId: "def456" }),
      ],
      classes,
    );
    const result = resolvePendingReportMatch(
      pendingReport({ sourceStudentId: "DEF456" }),
      index,
    );

    assert.equal(result.status, "matched");
    assert.equal(result.student.uid, "b");
    assert.equal(result.method, "scheduled_class_name_student_id");
  });

  it("resolves a missing class ID only from one exact normalized class name", () => {
    const index = buildAutoMatchIndex([student()], classes);
    const result = resolvePendingReportMatch(
      pendingReport({ classId: null, className: " (7월)화 13:30  목동시대★(기본반4주) " }),
      index,
    );

    assert.equal(result.status, "matched");
    assert.equal(result.classInfo.id, "class-a");
  });

  it("does not process duplicate-review or already-linked reports", () => {
    const index = buildAutoMatchIndex([student()], classes);

    assert.deepEqual(
      resolvePendingReportMatch(pendingReport({ assignmentStatus: "duplicate_pending" }), index),
      { status: "skipped", reason: "not_eligible" },
    );
    assert.deepEqual(
      resolvePendingReportMatch(pendingReport({ studentUid: "existing" }), index),
      { status: "skipped", reason: "not_eligible" },
    );
  });
});
